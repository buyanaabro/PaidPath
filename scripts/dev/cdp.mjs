// Minimal Chrome DevTools Protocol driver (no dependencies): headless Brave/Chrome, one page.
// Used by browser-eval.mjs, capture-screens.mjs and the E2E suite.
//
// Page scripts can call `__cdpInput(JSON.stringify(...))` for trusted input (Bryntum ignores
// synthetic events): { x, y, button? } click, { move: true, x, y } hover, { text } type into
// the focused element, { key: "Enter" } key press. `__pp.click(el)` / `__pp.sleep(ms)` /
// `__pp.waitFor(fn, ms)` are injected helpers.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CANDIDATES = [
  process.env.BROWSER_BIN,
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const PRELUDE = `window.__pp = window.__pp || {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  click(el) {
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    __cdpInput(JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }));
  },
  async waitFor(fn, ms = 15000, every = 250) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      try { const v = await fn(); if (v) return v; } catch {}
      await new Promise((r) => setTimeout(r, every));
    }
    return null;
  },
};`;

export async function launch({ windowSize = process.env.WINDOW_SIZE ?? "1440,900", echoConsole = false, deviceScaleFactor = 1 } = {}) {
  const binary = CANDIDATES.find((path) => existsSync(path));
  if (!binary) throw new Error("No Chrome/Brave found — set BROWSER_BIN");
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/paidpath-cdp-${Date.now()}-${port}`,
      `--window-size=${windowSize}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .then((list) => list.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  if (!target) {
    proc.kill();
    throw new Error("Browser did not start");
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const logs = [];
  const exceptions = [];
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    for (const listener of listeners) listener(msg);
    if (msg.method === "Runtime.bindingCalled" && msg.params.name === "__cdpInput") {
      const { x, y, button = "left", text, key, move } = JSON.parse(msg.params.payload);
      if (move) send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      else if (text !== undefined) send("Input.insertText", { text });
      else if (key) {
        for (const type of ["keyDown", "keyUp"]) {
          send("Input.dispatchKeyEvent", {
            type,
            key,
            code: key,
            windowsVirtualKeyCode: key === "Enter" ? 13 : 0,
            ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}),
          });
        }
      } else {
        for (const type of ["mousePressed", "mouseReleased"]) {
          send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
        }
      }
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      logs.push({ type: msg.params.type, text });
      if (echoConsole) console.log(`[page ${msg.params.type}]`, text);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const text = msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text;
      exceptions.push(text);
      if (echoConsole) console.log("[page exception]", text);
    }
  });

  await send("Runtime.enable");
  await send("Runtime.addBinding", { name: "__cdpInput" });
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDE });
  if (deviceScaleFactor !== 1) {
    const [width, height] = windowSize.split(",").map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: false });
  }

  const page = {
    logs,
    exceptions,
    send,
    /** Navigates and waits for the load event, then `settleMs`. */
    async goto(url, settleMs = 1500) {
      const loaded = new Promise((resolve) => {
        const listener = (msg) => {
          if (msg.method === "Page.loadEventFired") {
            listeners.delete(listener);
            resolve();
          }
        };
        listeners.add(listener);
      });
      await send("Page.navigate", { url });
      await Promise.race([loaded, sleep(30_000)]);
      await sleep(settleMs);
    },
    /** Evaluates a function (serialized, with a JSON argument) or a script body in the page. */
    async evaluate(fnOrBody, arg) {
      const expression =
        typeof fnOrBody === "function"
          ? `(${fnOrBody.toString()})(${JSON.stringify(arg ?? null)})`
          : `(async () => { ${fnOrBody} })()`;
      let response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      // A navigation can replace the execution context mid-call; retry once on the new page.
      if (response.error && /context|navigat/i.test(response.error.message)) {
        await sleep(1500);
        response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      }
      if (response.error) throw new Error(`CDP: ${response.error.message}`);
      const { result } = response;
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    },
    async cookies() {
      return (await send("Network.getAllCookies")).result.cookies;
    },
    async setCookie(cookie) {
      await send("Network.setCookie", cookie);
    },
    /** PNG of the viewport, or of `clip` ({ x, y, width, height } in CSS pixels). */
    async screenshot(path, clip) {
      const { data } = (await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })).result;
      writeFileSync(path, Buffer.from(data, "base64"));
    },
    async close() {
      ws.close();
      proc.kill();
    },
  };
  return page;
}
