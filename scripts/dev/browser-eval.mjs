// Dev tool: open a URL in headless Brave/Chrome, evaluate a JS expression in the page
// (awaiting promises), print the result and page console output.
// Usage: node scripts/dev/browser-eval.mjs <url> <expression-file.js> [waitMs]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
  "--window-size=1440,900",
  "about:blank",
], { stdio: "ignore" });

const watchdog = setTimeout(() => {
  console.error("TIMEOUT after 60s");
  proc.kill();
  process.exit(1);
}, 60_000);

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
  ws.close();
} finally {
  clearTimeout(watchdog);
  proc.kill();
}
