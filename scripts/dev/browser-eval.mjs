// Dev tool: open a URL in headless Brave/Chrome, evaluate a JS expression in the page
// (awaiting promises), print the result and page console output.
// Usage: node scripts/dev/browser-eval.mjs <url> <expression-file.js> [waitMs]
// In the page script, `__cdpInput(JSON.stringify({ x, y, button: "right" }))` sends a trusted
// mouse click (needed for widgets like Bryntum menus that ignore synthetic events).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [url, exprFile, waitMs = "4000"] = process.argv.slice(2);
const browser =
  process.env.BROWSER_BIN ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const port = 9333;

const proc = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/paidpath-cdp-${Date.now()}`,
  `--window-size=${process.env.WINDOW_SIZE ?? "1440,900"}`,
  "about:blank",
], { stdio: "ignore" });

const timeoutMs = Number(process.env.BROWSER_EVAL_TIMEOUT_MS ?? 60_000);
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT after ${timeoutMs / 1000}s`);
  proc.kill();
  process.exit(1);
}, timeoutMs);

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .then((list) => list.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  if (!target) throw new Error("Browser did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.bindingCalled" && msg.params.name === "__cdpInput") {
      // Page scripts can request trusted mouse input: __cdpInput(JSON.stringify({ x, y, button }))
      // Also { text } (types into the focused element) and { key: "Enter" }.
      // { move: true, x, y } hovers without clicking.
      const { x, y, button = "left", text, key, move } = JSON.parse(msg.params.payload);
      if (move) send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      else if (text !== undefined) send("Input.insertText", { text });
      else if (key) {
        for (const type of ["keyDown", "keyUp"]) {
          send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 0, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) });
        }
      } else {
        for (const type of ["mousePressed", "mouseReleased"]) {
          send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
        }
      }
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      console.log(`[page ${msg.params.type}]`, text);
    } else if (msg.method === "Runtime.exceptionThrown") {
      console.log("[page exception]", msg.params.exceptionDetails.exception?.description);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Runtime.addBinding", { name: "__cdpInput" });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(Number(waitMs));

  const expression = readFileSync(exprFile, "utf8");
  const { result } = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    console.error("EVAL ERROR", result.exceptionDetails.exception?.description);
    process.exitCode = 1;
  } else {
    console.log("RESULT", JSON.stringify(result.result.value, null, 2));
  }
  // SCREENSHOT=/path/to/file.png captures the page after the script ran.
  if (process.env.SCREENSHOT) {
    const { data } = (await send("Page.captureScreenshot", { format: "png" })).result;
    writeFileSync(process.env.SCREENSHOT, Buffer.from(data, "base64"));
    console.log("SCREENSHOT", process.env.SCREENSHOT);
  }
  ws.close();
} finally {
  clearTimeout(watchdog);
  proc.kill();
}
