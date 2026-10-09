// Regenerates the landing-page screenshots in public/screens/ (2× density, cropped to the
// interesting region) from a fresh demo copy, plus public/screens/manifest.json with sizes.
// Real PayPal sandbox calls. For the copilot shot run the server with COPILOT_MODE=record
// (first time) or replay; HIDE_DEV_INDICATOR=1 hides the Next.js dev badge.
// Usage: npm run screens [-- --base http://localhost:3000]
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launch } from "./cdp.mjs";

const index = process.argv.indexOf("--base");
const BASE = (index >= 0 ? process.argv[index + 1] : "http://localhost:3000").replace(/\/$/, "");
const OUT = "public/screens";
const SCALE = 2;
const VIEW = { width: 1280, height: 800 };
mkdirSync(OUT, { recursive: true });
const manifest = {};

const demo = await fetch(`${BASE}/api/demo`, { method: "POST", headers: { accept: "application/json" } });
const cookie = demo.headers.get("set-cookie")?.split(";")[0];
const { projectId } = await demo.json();
console.log("demo project", projectId);

const page = await launch({ windowSize: `${VIEW.width},${VIEW.height}`, deviceScaleFactor: SCALE });

/** Crops to a page region (CSS px; clamped to the viewport) and records the pixel size. */
async function shot(name, region = { x: 0, y: 0, width: VIEW.width, height: VIEW.height }) {
  const clip = {
    x: Math.max(0, Math.round(region.x)),
    y: Math.max(0, Math.round(region.y)),
    width: Math.round(Math.min(region.width, VIEW.width - Math.max(0, region.x))),
    height: Math.round(Math.min(region.height, VIEW.height - Math.max(0, region.y))),
  };
  await page.screenshot(`${OUT}/${name}.png`, clip);
  manifest[name] = { width: clip.width * SCALE, height: clip.height * SCALE };
  console.log(`✓ ${name}`, `${clip.width}×${clip.height}`);
}
const rect = (selector, pad = 0) =>
  page.evaluate(
    ({ selector, pad }) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
    },
    { selector, pad },
  );

try {
  const [name, value] = cookie.split("=");
  await page.setCookie({ name, value, url: BASE });
  await page.goto(`${BASE}/projects/${projectId}`, 500);
  await page.evaluate(() => localStorage.setItem("pp-demo-guide-hidden", "1"));
  await page.goto(`${BASE}/projects/${projectId}`, 7000);
  // Plan: the Gantt with priced milestones and payment holds.
  await shot("plan", { x: 0, y: 150, width: 900, height: 440 });

  await page.evaluate(async () => {
    const button = [...document.querySelectorAll('[data-pp-action="send"]')].find((b) => /Direction approved/.test(b.closest(".b-grid-row")?.innerText ?? ""));
    __pp.click(button);
    await __pp.waitFor(() => {
      const text = document.querySelector('[data-testid="discount-suggestion"]')?.innerText;
      return text && !/Simulating/.test(text);
    });
    await __pp.sleep(500);
  });
  await shot("send-dialog", await rect('[aria-labelledby="send-invoice-title"] > div', 28));

  await page.evaluate(async () => {
    __pp.click([...document.querySelectorAll('[aria-labelledby="send-invoice-title"] button')].find((b) => b.innerText === "Send invoice"));
    await __pp.waitFor(() => document.querySelector(".pp-pill-discount"), 60000);
    await __pp.sleep(2500);
  });
  // Hero: header, KPIs, Gantt with the discounted invoice, start of the ledger.
  await shot("workspace", { x: 0, y: 0, width: 1280, height: 720 });

  const share = await (await fetch(`${BASE}/api/projects/${projectId}/share`, { method: "POST" })).json();
  await page.goto(`${BASE}${share.path}`, 6000);
  await page.evaluate(async () => Boolean(await __pp.waitFor(() => document.querySelector('[data-testid="portal-pay-today"]'), 20000)));
  await shot("portal", { x: 0, y: 0, width: 820, height: 560 });

  await page.goto(`${BASE}/projects/${projectId}`, 7000);
  await page.evaluate(async () => {
    __pp.click(document.querySelector('[data-pp-action="record-payment"]'));
    await __pp.waitFor(() => document.querySelector(".b-toast"), 40000, 200);
    // The click scrolled ancestors to reveal the button; put the layout back.
    for (const el of [document.scrollingElement, ...document.querySelectorAll("main, section")]) if (el) el.scrollTop = 0;
    await __pp.sleep(900);
  });
  await shot("pulled-in", { x: 520, y: 50, width: 760, height: 750 });

  await sleep(5000);
  const answered = await page.evaluate(async () => {
    const g = bryntum.queryAll("gantt").filter((x) => !x.isDestroyed)[0];
    const cp = g.features.ai.chatPanel;
    __pp.click(document.querySelector(".b-chat-button"));
    await __pp.sleep(1500);
    __pp.click(cp.widgetMap.messageField.element.querySelector("textarea, [contenteditable]"));
    await __pp.sleep(300);
    __cdpInput(JSON.stringify({ text: "What if Aurora pays a week late?" }));
    await __pp.sleep(300);
    __cdpInput(JSON.stringify({ key: "Enter" }));
    // Wait for the final answer (not "Thinking"/tool status) and for it to stop changing.
    let last = "";
    const ok = await __pp.waitFor(() => {
      const reply = cp.widgetMap.chatBubbles.element.innerText.split("week late?")[1] ?? "";
      const done = /slip|finish|launch|earlier|later/i.test(reply) && reply === last;
      last = reply;
      return done;
    }, 90000, 1500);
    await __pp.sleep(800);
    return Boolean(ok);
  });
  if (!answered) console.log("✖ copilot did not answer (server in replay without a fixture?)");
  await shot("copilot", { x: 520, y: 0, width: 760, height: 520 });
  writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await page.close();
}
