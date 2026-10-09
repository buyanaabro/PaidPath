// Dev tool: open a URL in headless Brave/Chrome, evaluate a script in the page (awaiting
// promises), print the result and page console output.
// Usage: node scripts/dev/browser-eval.mjs <url> <script-file.js> [waitMs]
// Env: WINDOW_SIZE=1440,900  SCREENSHOT=/tmp/x.png  BROWSER_EVAL_TIMEOUT_MS=60000
// Trusted input from page scripts: see scripts/dev/cdp.mjs (`__cdpInput`, `__pp`).
import { readFileSync } from "node:fs";
import { launch } from "./cdp.mjs";

const [url, scriptFile, waitMs = "4000"] = process.argv.slice(2);
const timeoutMs = Number(process.env.BROWSER_EVAL_TIMEOUT_MS ?? 60_000);
const page = await launch({ echoConsole: true });
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT after ${timeoutMs / 1000}s`);
  void page.close();
  process.exit(1);
}, timeoutMs);

try {
  await page.goto(url, Number(waitMs));
  try {
    console.log("RESULT", JSON.stringify(await page.evaluate(readFileSync(scriptFile, "utf8")), null, 2));
  } catch (error) {
    console.error("EVAL ERROR", error.message);
    process.exitCode = 1;
  }
  if (process.env.SCREENSHOT) {
    await page.screenshot(process.env.SCREENSHOT);
    console.log("SCREENSHOT", process.env.SCREENSHOT);
  }
} finally {
  clearTimeout(watchdog);
  await page.close();
}
