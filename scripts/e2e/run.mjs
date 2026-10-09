// End-to-end smoke suite: drives a real headless browser through PaidPath's core loop on a
// fresh demo copy. Real PayPal sandbox calls; the copilot step needs the server in
// COPILOT_MODE=replay (recorded Gemini responses) and is opt-in.
//
// Usage: npm run e2e -- [--base http://localhost:3000] [--copilot]
//        npm run e2e -- --base https://paidpath.onrender.com
import { launch } from "../dev/cdp.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const BASE = option("base", "http://localhost:3000").replace(/\/$/, "");
const WITH_COPILOT = flag("copilot");

const results = [];
let failed = false;
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** API client sharing the visitor cookie with the browser. */
function api() {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
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
    get cookie() {
      return cookie;
    },
    get: (path) => call("GET", path),
    post: (path, body, headers) => call("POST", path, body ?? {}, headers),
  };
}

async function milestoneIds(client, projectId) {
  const query = encodeURIComponent(JSON.stringify({ type: "load", requestId: 1, stores: ["tasks"] }));
  const { json } = await client.get(`/api/projects/${projectId}/gantt?data=${query}`);
  const ids = {};
  const walk = (rows) => rows.forEach((r) => (r.amount && (ids[r.name.replace(/^Milestone:\s*/, "")] = r.id), r.children && walk(r.children)));
  walk(json.tasks.rows);
  return ids;
}

const workspaceState = () => {
  const g = bryntum.queryAll("gantt").filter((x) => !x.isDestroyed)[0];
  return {
    rows: g?.taskStore.count ?? 0,
    kpi: document.querySelector('[data-testid="finish-kpi"]')?.innerText ?? null,
    clock: document.querySelector('[aria-label="Demo clock"]')?.innerText.split("\n")[0] ?? null,
    guide: [...document.querySelectorAll("[data-testid=demo-guide] [data-step]")].map((s) => `${s.dataset.step}:${s.dataset.done}`),
    pills: [...document.querySelectorAll(".pp-pill-discount, .pp-pill-paid")].map((p) => p.innerText),
  };
};
/** Waits until the page's Bryntum Gantt has loaded its tasks (hosted cold starts are slow). */
const ganttReady = (page) =>
  page.evaluate(async () =>
    Boolean(
      await __pp.waitFor(
        () => typeof bryntum !== "undefined" && bryntum.queryAll("gantt").some((g) => !g.isDestroyed && g.taskStore.count > 0),
        60000,
        500,
      ),
    ),
  );
const finishOf = (kpi) => kpi?.match(/Projected finish (\w+ \d+, \d{4})/)?.[1] ?? null;
const guideDone = (state, step) => state.guide.includes(`${step}:true`);
const browserErrors = (page) => [
  ...page.exceptions,
  ...page.logs.filter((l) => l.type === "error" && !/favicon|Download the React DevTools/.test(l.text)).map((l) => l.text),
];

async function main() {
  console.log(`PaidPath E2E against ${BASE}${WITH_COPILOT ? " (with copilot replay)" : ""}\n`);
  const client = api();
  const page = await launch({ windowSize: "1440,900" });
  try {
    // 1. Landing → "Try the live demo" → own demo copy.
    await page.goto(`${BASE}/`, 1000);
    const landing = await page.evaluate(() => ({
      title: document.querySelector("h1")?.innerText,
      cta: Boolean(document.querySelector('form[action="/api/demo"] button')),
    }));
    check("landing page renders with the demo CTA", /reacts to money/i.test(landing.title ?? "") && landing.cta, landing.title);
    await page.evaluate(() => __pp.click(document.querySelector('form[action="/api/demo"] button')));
    await new Promise((r) => setTimeout(r, 4000));
    await ganttReady(page);
    await new Promise((r) => setTimeout(r, 2000));
    const href = await page.evaluate(() => location.pathname);
    const projectId = Number(href.match(/\/projects\/(\d+)/)?.[1]);
    check("demo CTA opens a fresh project", Boolean(projectId), href);
    const visitor = (await page.cookies()).find((c) => c.name === "pp_visitor");
    check("visitor cookie is set (httpOnly)", Boolean(visitor?.httpOnly));
    const fromClient = await client.get("/projects");
    check("other visitors don't see this demo copy", !fromClient.text.includes(`/projects/${projectId}"`));
    const initial = await page.evaluate(workspaceState);
    check("Gantt loads the demo plan", initial.rows >= 14, `${initial.rows} rows`);
    check("demo copy starts on the first milestone date", /Nov 7, 2026/.test(initial.clock ?? ""), initial.clock);
    check("demo guide shows five open steps", initial.guide.length === 5 && !initial.guide.some((s) => s.endsWith(":true")));
    const ids = await milestoneIds(client, projectId);

    // 2. Send dialog: simulated discount suggestion → send.
    const dialog = await page.evaluate(async () => {
      const button = [...document.querySelectorAll('[data-pp-action="send"]')].find((b) => /Direction approved/.test(b.closest(".b-grid-row")?.innerText ?? ""));
      __pp.click(button);
      const box = await __pp.waitFor(() => {
        const text = document.querySelector('[data-testid="discount-suggestion"]')?.innerText;
        return text && !/Simulating/.test(text) ? text : null;
      });
      const checked = document.querySelector('[aria-labelledby="send-invoice-title"] input[type=checkbox]')?.checked;
      __pp.click([...document.querySelectorAll('[aria-labelledby="send-invoice-title"] button')].find((b) => b.innerText === "Send invoice"));
      return { box, checked };
    });
    check("send dialog suggests a discount from the simulation", /launch moves about \d+ days earlier/.test(dialog.box ?? "") && dialog.checked, dialog.box?.split("\n")[0]);
    const afterSend = await page.evaluate(async () => {
      await __pp.waitFor(() => document.querySelector(".pp-pill-discount"), 60000);
      await __pp.sleep(1500);
      return (() => {
        const g = bryntum.queryAll("gantt").filter((x) => !x.isDestroyed)[0];
        return {
          pills: [...document.querySelectorAll(".pp-pill-discount")].map((p) => p.innerText),
          indicator: document.querySelectorAll(".pp-discount-indicator").length,
          guide: [...document.querySelectorAll("[data-testid=demo-guide] [data-step]")].map((s) => `${s.dataset.step}:${s.dataset.done}`),
          rows: g.taskStore.count,
        };
      })();
    });
    check("invoice sent with a discount (ledger pill + Gantt marker)", afterSend.pills.some((p) => /^2% until/.test(p)) && afterSend.indicator > 0, afterSend.pills.join(", "));
    check("guide ticks 'send'", afterSend.guide.includes("send:true"));
    const kpiBeforePay = (await page.evaluate(workspaceState)).kpi;

    // 3. Client portal: read-only, no owner data, prediction comes true.
    const share = await client.post(`/api/projects/${projectId}/share`);
    const token = share.json?.path?.split("/").pop();
    const snapshot = await client.get(`/api/portal/${token}`);
    check("portal snapshot hides owner-only data", snapshot.status === 200 && !/invoicerUrl|noteSource|clientEmail|sb-[a-z0-9]+@/.test(snapshot.text));
    check("portal has no write route", (await client.post(`/api/portal/${token}/gantt`)).status === 405);
    await page.goto(`${BASE}${share.json.path}`, 2000);
    await ganttReady(page);
    const portal = await page.evaluate(async () => {
      await __pp.waitFor(() => document.querySelector('[data-testid="portal-pay-today"]'), 20000);
      const g = bryntum.queryAll("gantt").filter((x) => !x.isDestroyed)[0];
      return {
        readOnly: g?.readOnly,
        prediction: document.querySelector('[data-testid="portal-pay-today"]')?.innerText ?? null,
        discount: document.querySelector('[data-testid="portal-discount"]')?.innerText ?? null,
        pay: document.querySelector('[data-testid="portal-invoice"] a')?.href ?? null,
      };
    });
    const predicted = portal.prediction?.match(/moves to (\w+ \d+, \d{4})/)?.[1];
    check("portal is read-only with a PayPal pay link", portal.readOnly === true && /paypal\.com/.test(portal.pay ?? ""), portal.pay ?? "");
    check("portal shows the discount and 'pay today' prediction", Boolean(portal.discount && predicted), portal.prediction ?? "");
    const invoices = (await client.get(`/api/projects/${projectId}/invoices`)).json.invoices;
    const first = invoices.find((i) => /Direction approved/.test(i.milestoneName));
    const paid = await client.post(`/api/projects/${projectId}/invoices/${first.id}/record-payment`);
    check("payment recorded at the discounted amount", paid.status === 200 && paid.json.invoices.find((i) => i.id === first.id)?.paidAmountCents === 147_000);
    const portalAfter = await page.evaluate(async () => {
      const toast = await __pp.waitFor(() => [...document.querySelectorAll(".b-toast")].map((t) => t.innerText).join(" ") || null, 40000, 500);
      await __pp.sleep(1000);
      return { toast, launch: document.querySelector('[data-testid="portal-launch"]')?.innerText ?? "" };
    });
    check("portal thanks the client and moves the launch", /Thank you/.test(portalAfter.toast ?? ""), portalAfter.toast ?? "no toast");
    check("'pay today' prediction came true", Boolean(predicted) && portalAfter.launch.includes(predicted), `${predicted} → ${portalAfter.launch}`);

    // 4. Back in the workspace: plan pulled in, guide progress.
    await page.goto(`${BASE}/projects/${projectId}`, 2000);
    await ganttReady(page);
    await new Promise((r) => setTimeout(r, 3000));
    const afterPay = await page.evaluate(workspaceState);
    check(
      "workspace finish moved earlier after payment",
      Boolean(finishOf(afterPay.kpi) && finishOf(kpiBeforePay) && Date.parse(finishOf(afterPay.kpi)) < Date.parse(finishOf(kpiBeforePay))),
      `${finishOf(kpiBeforePay)} → ${finishOf(afterPay.kpi)}`,
    );
    check("guide ticks 'client' and 'pay'", guideDone(afterPay, "client") && guideDone(afterPay, "pay"), afterPay.guide.join(" "));

    // 5. Late payment: next invoice with a short discount, clock past due → overdue, slip, expiry.
    const second = await client.post(`/api/projects/${projectId}/invoices`, { taskId: ids["Designs signed off"], discount: { percent: 2, days: 3 } });
    check("second invoice sent", second.status === 200, second.json?.message ?? "");
    const clock = await client.post(`/api/projects/${projectId}/clock`, { shiftDays: 21 });
    const late = clock.json.invoices.find((i) => /Designs signed off/.test(i.milestoneName));
    check("clock past the due date makes it overdue and closes the discount", late?.overdue === true && Boolean(late?.discountExpiredAt), clock.json.clock?.today);
    await page.goto(`${BASE}/projects/${projectId}`, 2000);
    await ganttReady(page);
    await new Promise((r) => setTimeout(r, 3000));
    const afterLate = await page.evaluate(workspaceState);
    check("guide ticks 'overdue'", guideDone(afterLate, "overdue"));
    const activity = (await client.get(`/api/projects/${projectId}/activity`)).json.items.map((i) => `${i.actor}:${i.action}`);
    check(
      "activity feed attributes every actor",
      ["client:portal_viewed", "automation:discount_expired", "user:record_payment", "automation:demo_created"].every((a) => activity.includes(a)),
    );

    // 6. Copilot (replay mode only).
    if (WITH_COPILOT) {
      const answer = await page.evaluate(async () => {
        const g = bryntum.queryAll("gantt").filter((x) => !x.isDestroyed)[0];
        const cp = g.features.ai.chatPanel;
        __pp.click(document.querySelector(".b-chat-button"));
        await __pp.sleep(1500);
        const field = cp.widgetMap.messageField.element.querySelector("textarea, [contenteditable]");
        __pp.click(field);
        await __pp.sleep(300);
        __cdpInput(JSON.stringify({ text: "What if Aurora pays a week late?" }));
        await __pp.sleep(300);
        __cdpInput(JSON.stringify({ key: "Enter" }));
        // Final answer (not a status line) that has stopped changing.
        let last = "";
        return __pp.waitFor(() => {
          const reply = (cp.widgetMap.chatBubbles.element.innerText.split("What if Aurora pays a week late?")[1] ?? "").trim();
          const done = /slip|finish|launch|earlier|later/i.test(reply) && reply === last;
          last = reply;
          return done ? reply : null;
        }, 60000, 1500);
      });
      check("copilot answers a what-if (replay)", Boolean(answer), answer?.split("\n").pop()?.slice(0, 120) ?? "");
      await page.goto(`${BASE}/projects/${projectId}`, 2000);
      await ganttReady(page);
      await new Promise((r) => setTimeout(r, 3000));
      check("guide ticks 'copilot'", guideDone(await page.evaluate(workspaceState), "copilot"));
    }

    const errors = browserErrors(page);
    check("no page exceptions or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await page.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
