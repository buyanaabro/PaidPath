// Records a <3 min desktop demo of the live product (CDP screencast + macOS `say`).
// Usage: npm run video -- [--base http://localhost:3000]
// Output: /tmp/paidpath-video/paidpath-demo.mp4
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launch } from "./cdp.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const BASE = option("base", "http://localhost:3000").replace(/\/$/, "");
const OUT = "/tmp/paidpath-video";
const NARRATION = `${OUT}/narration.aiff`;
const FRAMES = `${OUT}/frames`;
const RAW = `${OUT}/raw.mp4`;
const FINAL = `${OUT}/paidpath-demo.mp4`;

const SCRIPT = [
  "Freelancers plan work in one tool and invoice in another.",
  "When a client pays late, the launch date does not move.",
  "PaidPath is the project plan that reacts to money.",
  "Here is the live demo. One click creates your own PayPal sandbox project.",
  "The Gantt already knows which milestones are waiting on payment.",
  "We send the first invoice. PaidPath simulates the plan:",
  "If they pay within seven days, launch moves about a week earlier,",
  "so it suggests a two percent discount. That is a real PayPal invoice.",
  "This is the client portal. They see their timeline, a PayPal pay button,",
  "and exactly how paying today moves the launch.",
  "We record the payment. Design pulls in. The finish date moves.",
  "Cash timing and delivery timing are now one picture.",
  "The copilot can answer: what if Aurora pays a week late?",
  "Bryntum schedules. PayPal invoices. Gemini writes the plan and the copilot.",
  "PaidPath. The plan that reacts to money.",
].join(" ");

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function api() {
  let cookie = "";
  const call = async (method, path, body) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, text };
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body ?? {}),
  };
}

const ganttReady = (page) =>
  page.evaluate(async () =>
    Boolean(
      await __pp.waitFor(
        () =>
          typeof bryntum !== "undefined" &&
          bryntum.queryAll("gantt").some((g) => !g.isDestroyed && g.taskStore.count > 0),
        60000,
        500,
      ),
    ),
  );

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  console.log("narration…");
  await run("say", ["-r", "175", "-v", "Samantha", "-o", NARRATION, SCRIPT]);

  const client = api();
  const page = await launch({ windowSize: "1440,900" });
  let frame = 0;
  const off = page.on("Page.screencastFrame", (params) => {
    const n = String(++frame).padStart(5, "0");
    writeFileSync(`${FRAMES}/${n}.jpg`, Buffer.from(params.data, "base64"));
    page.send("Page.screencastFrameAck", { sessionId: params.sessionId });
  });
  await page.send("Page.startScreencast", {
    format: "jpeg",
    quality: 72,
    everyNthFrame: 1,
    maxWidth: 1440,
    maxHeight: 900,
  });

  try {
    console.log("landing");
    await page.goto(`${BASE}/`, 1500);
    await sleep(4000);
    await page.evaluate(() => __pp.click(document.querySelector('form[action="/api/demo"] button')));
    await sleep(4000);
    await ganttReady(page);
    await sleep(5000);

    const href = await page.evaluate(() => location.pathname);
    const projectId = Number(href.match(/\/projects\/(\d+)/)?.[1]);
    if (!projectId) throw new Error(`demo did not open a project: ${href}`);
    console.log("project", projectId);

    console.log("send invoice");
    await page.evaluate(async () => {
      const button = [...document.querySelectorAll('[data-pp-action="send"]')].find((b) =>
        /Direction approved/.test(b.closest(".b-grid-row")?.innerText ?? ""),
      );
      __pp.click(button);
      await __pp.waitFor(() => {
        const text = document.querySelector('[data-testid="discount-suggestion"]')?.innerText;
        return text && !/Simulating/.test(text) ? text : null;
      });
    });
    await sleep(5000);
    await page.evaluate(() => {
      __pp.click(
        [...document.querySelectorAll('[aria-labelledby="send-invoice-title"] button')].find(
          (b) => b.innerText === "Send invoice",
        ),
      );
    });
    await page.evaluate(async () => {
      await __pp.waitFor(() => document.querySelector(".pp-pill-discount"), 60000);
    });
    await sleep(4000);

    console.log("portal");
    const share = await client.post(`/api/projects/${projectId}/share`);
    await page.goto(`${BASE}${share.json.path}`, 2000);
    await ganttReady(page);
    await page.evaluate(async () => {
      await __pp.waitFor(() => document.querySelector('[data-testid="portal-pay-today"]'), 20000);
    });
    await sleep(5000);

    const invoices = (await client.get(`/api/projects/${projectId}/invoices`)).json.invoices;
    const first = invoices.find((i) => /Direction approved/.test(i.milestoneName));
    await client.post(`/api/projects/${projectId}/invoices/${first.id}/record-payment`);
    await page.evaluate(async () => {
      await __pp.waitFor(
        () => [...document.querySelectorAll(".b-toast")].map((t) => t.innerText).join(" ") || null,
        40000,
        500,
      );
    });
    await sleep(3000);

    console.log("workspace after pay");
    await page.goto(`${BASE}/projects/${projectId}`, 2000);
    await ganttReady(page);
    await sleep(5000);

    console.log("copilot");
    await page.evaluate(async () => {
      const g = bryntum.queryAll("gantt").filter((x) => !x.isDestroyed)[0];
      const cp = g.features.ai.chatPanel;
      __pp.click(document.querySelector(".b-chat-button"));
      await __pp.sleep(1200);
      const field = cp.widgetMap.messageField.element.querySelector("textarea, [contenteditable]");
      __pp.click(field);
      await __pp.sleep(300);
      __cdpInput(JSON.stringify({ text: "What if Aurora pays a week late?" }));
      await __pp.sleep(300);
      __cdpInput(JSON.stringify({ key: "Enter" }));
      let last = "";
      await __pp.waitFor(() => {
        const reply = (cp.widgetMap.chatBubbles.element.innerText.split("What if Aurora pays a week late?")[1] ?? "").trim();
        const done = /slip|finish|launch|earlier|later/i.test(reply) && reply === last;
        last = reply;
        return done ? reply : null;
      }, 45000, 1500);
    }).catch((err) => console.warn("copilot skipped:", err.message));
    await sleep(4000);

    await page.goto(`${BASE}/`, 1500);
    await sleep(4000);
  } finally {
    await page.send("Page.stopScreencast").catch(() => {});
    off();
    await page.close();
  }

  if (frame < 10) throw new Error(`too few frames: ${frame}`);
  console.log(`${frame} frames → encode`);
  await run("ffmpeg", [
    "-y",
    "-framerate",
    "8",
    "-pattern_type",
    "glob",
    "-i",
    `${FRAMES}/*.jpg`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2",
    RAW,
  ]);
  await run("ffmpeg", [
    "-y",
    "-i",
    RAW,
    "-i",
    NARRATION,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    FINAL,
  ]);
  console.log("wrote", FINAL, existsSync(FINAL) ? "" : "MISSING");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
