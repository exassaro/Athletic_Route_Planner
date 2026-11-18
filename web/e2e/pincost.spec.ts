// Phase 5b step 13: the start pin's main-thread cost (docs/reports/phase5b/summary.md). npx playwright test --project=pincost
// A01's base route on the phone viewport; CPU slowed 4x (as Lighthouse's mobile profile); main-thread work
// (Chrome's Performance metrics) over 5 s windows: the pin hopping, the pin still, the pin removed, and hopping with will-change.
import { test } from "@playwright/test";
import { planA01Base } from "./helpers";

test("start pin cost", async ({ page }) => {
  test.setTimeout(300_000);
  await planA01Base(page);
  const sheet = page.locator(".sheet");
  for (let i = 0; i < 3 && (await sheet.getAttribute("data-snap")) !== "peek"; i++) await page.locator(".sheet-handle").click();
  await page.waitForTimeout(3000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const window = async (label: string) => {
    await page.waitForTimeout(1500);
    const a = await metric();
    await page.waitForTimeout(5000);
    const b = await metric();
    const d = (k: string) => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000);
    return { label, task_ms: d("TaskDuration"), script_ms: d("ScriptDuration"), style_ms: d("RecalcStyleDuration"), layout_ms: d("LayoutDuration"),
      layouts: Math.round((b.LayoutCount ?? 0) - (a.LayoutCount ?? 0)), styles: Math.round((b.RecalcStyleCount ?? 0) - (a.RecalcStyleCount ?? 0)) };
  };
  const rows = [];
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => document.getElementById("pin-cost")?.remove());
    rows.push(await window("hopping"));
    await page.evaluate(() => { const s = document.createElement("style"); s.id = "pin-cost";
      s.textContent = ".pin-start-hop,.pin-start-shade{animation:none!important}"; document.head.appendChild(s); });
    rows.push(await window("still"));
    await page.evaluate(() => { document.getElementById("pin-cost")!.textContent = ".pin-start{display:none!important}"; });
    rows.push(await window("removed"));
    await page.evaluate(() => { document.getElementById("pin-cost")!.textContent = ".pin-start-hop,.pin-start-shade{will-change:transform,opacity}"; });
    rows.push(await window("hopping+will-change"));
  }
  console.log("PINCOST " + JSON.stringify(rows));
  console.log("PINCOST hop running:", await page.evaluate(() => {
    document.getElementById("pin-cost")?.remove();
    return getComputedStyle(document.querySelector(".pin-start-hop")!).animationName;
  }));
});
