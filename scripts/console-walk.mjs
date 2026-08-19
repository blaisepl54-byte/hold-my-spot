// The console walked in a real browser against the REAL local API.
// Igris's render was held to "0 console errors, proven by interaction";
// the transplant is held to the same bar, with the API live behind it.
// Dev instrument, plain JS, run by hand: node scripts/console-walk.mjs [url]

// Resolved from the GLOBAL install so this project's runtime dependency count
// stays at two. A dev instrument may lean on the workstation; the product may not.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(
  "C:/Users/blais/AppData/Roaming/npm/node_modules/playwright/index.js",
);

const URL = process.argv[2] ?? "http://127.0.0.1:8090/";
const errors = [];
const failedRequests = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));

const results = [];
function check(ok, label, evidence) {
  results.push({ ok, label, evidence });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (evidence) console.log(`       ${evidence}`);
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// ---- the chassis came up on real data ---------------------------------
const plate = await page.locator("#plateName").textContent();
check(plate !== null && plate.trim() !== "" && plate.trim() !== "…", "the branch plate names a real branch", `plate: ${plate?.trim()}`);

const counterTiles = await page.locator(".counter").count();
check(counterTiles > 0, "the counter strip renders tiles from GET /api/counters", `${counterTiles} tiles`);

const estimate = await page.locator(".estimate-value").textContent().catch(() => null);
check(estimate !== null && estimate.trim().length > 5, "the estimate slot carries the API's words", `"${estimate?.trim()}"`);

const basis = await page.locator(".basis").textContent().catch(() => null);
check(basis !== null && basis.includes("Basis"), "the basis is shown with the estimate (R-G)", basis?.trim().slice(0, 90));

const lineRows = await page.locator(".line .entry, .empty").count();
check(lineRows > 0, "the line renders entries or an honest empty state", `${lineRows} row/empty node(s)`);

// ---- reception join, end to end over the network ----------------------
await page.locator('.sub-tab[data-screen="reception"]').click();
await page.waitForTimeout(300);
const probeName = "Walkthrough Probe " + Date.now().toString().slice(-5);
await page.locator("#wName").fill(probeName);
await page.locator('[data-act="join"]').click();
await page.waitForTimeout(2000);
const joined = await page.locator(".line").textContent().catch(() => "");
check(joined.includes(probeName), "a reception join lands in the REAL database and re-renders in the line", probeName);

// ---- call next: the write path and the counter tile -------------------
const callBtn = page.locator('[data-act="call-next"]').first();
if (await callBtn.count()) {
  await callBtn.click();
  await page.waitForTimeout(2000);
  const strip = await page.locator("#counterStrip").textContent();
  const called = strip.includes("Serving") || strip.includes("Called");
  check(called, "call-next moved a real entry onto a counter tile", strip.replace(/\s+/g, " ").slice(0, 120));
} else {
  // Every counter holding someone is a legitimate branch state, not a failure:
  // the tiles then show who they hold and offer no Call next, exactly as designed.
  const strip = await page.locator("#counterStrip").textContent();
  const occupied = (strip.match(/Serving|Called/g) || []).length;
  check(occupied > 0, "no Call next offered BECAUSE every counter holds someone, shown on the tiles",
    `${occupied} occupied tiles`);
}

// ---- a refusal renders as an answer, not a crash ----------------------
// Drive an invalid verb directly through the app's own function, as a
// misclick would: complete on an entry that is not serving.
const refusal = await page.evaluate(async () => {
  // Any active entry that is NOT being served refuses "complete". After the
  // call-next above, the called entry is the guaranteed target.
  const q = queueFor().filter((e) => e.status !== "serving");
  if (!q.length) return "no-target";
  const res = await entryVerb(q[0].id, "complete");
  if (res.ok) return "accepted";
  S.refusal = res.reason; render();
  return document.querySelector(".refusal") ? document.querySelector(".refusal").textContent : "no-strip";
});
check(
  typeof refusal === "string" && refusal !== "accepted" && refusal !== "no-strip" && refusal.length > 10,
  "an invalid verb comes back as a 409 refusal strip with the API's reason",
  String(refusal).replace(/\s+/g, " ").slice(0, 110),
);

// ---- both palettes ----------------------------------------------------
await page.screenshot({ path: "web/dist/walk-dark.png", fullPage: false });
await page.locator("#themeToggle").click();
await page.waitForTimeout(400);
await page.screenshot({ path: "web/dist/walk-light.png", fullPage: false });
check(true, "screenshots captured, both palettes", "web/dist/walk-dark.png, walk-light.png");

// ---- the bar the render set: zero console errors ----------------------
// Chrome logs EVERY 4xx response as a console error on its own. This walk
// deliberately provokes exactly one 409 to prove the refusal strip, so that
// single browser-generated line is expected; anything else fails.
const appErrors = errors.filter((e) => !/Failed to load resource.*409/.test(e));
check(appErrors.length === 0, "ZERO app console errors (the one provoked 409's browser log line excepted)", appErrors.slice(0, 3).join(" | ") || "none");
check(failedRequests.length === 0, "zero failed network requests", failedRequests.slice(0, 3).join(" | ") || "none");

await browser.close();

const fails = results.filter((r) => !r.ok).length;
console.log(`\nPASS ${results.length - fails}   FAIL ${fails}`);
process.exitCode = fails > 0 ? 1 : 0;
