// The start pin's main-thread cost (blueprint Phase 5b amendments 10 and 13). npx playwright test --project=pincost
// A01's base route on the phone viewport; CPU slowed 4x (as Lighthouse's mobile profile); main-thread work (Chrome's
// Performance metrics) over 5 s windows. At rest must match the pin removed; the three hops are measured for the record.
import { expect, test } from "@playwright/test";
import { planA01Base } from "./helpers";

const ROUNDS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("the resting pin costs what no pin costs", async ({ page }) => {
  test.setTimeout(360_000);
  await planA01Base(page);
  const sheet = page.locator(".sheet");
  for (let i = 0; i < 3 && (await sheet.getAttribute("data-snap")) !== "peek"; i++) await page.locator(".sheet-handle").click();
  await expect(page.locator(".pin-start.hop")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(3000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const measure = async (label: string, start?: () => Promise<void>) => {
    await page.waitForTimeout(1500);
    const a = await metric();
    await start?.();
    await page.waitForTimeout(5000);
    const b = await metric();
    const d = (k: string) => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000);
    return { label, task_ms: d("TaskDuration"), script_ms: d("ScriptDuration"), style_ms: d("RecalcStyleDuration"), layout_ms: d("LayoutDuration"),
      layouts: Math.round((b.LayoutCount ?? 0) - (a.LayoutCount ?? 0)), styles: Math.round((b.RecalcStyleCount ?? 0) - (a.RecalcStyleCount ?? 0)) };
  };
  const show = (on: boolean) => page.evaluate((on) => {
    document.getElementById("pin-cost")?.remove();
    if (on) return;
    const s = document.createElement("style");
    s.id = "pin-cost";
    s.textContent = ".pin-start{display:none!important}";
    document.head.appendChild(s);
  }, on);

  const rows: Awaited<ReturnType<typeof measure>>[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    // alternate which goes first, so a drift over the run favours neither
    for (const state of round % 2 ? ["removed", "resting"] : ["resting", "removed"]) {
      await show(state === "resting");
      rows.push(await measure(state));
    }
  }
  await show(true);
  const hopping = await measure("three hops", () => page.evaluate(() => {
    const pin = document.querySelector<HTMLElement>(".pin-start")!;
    pin.style.setProperty("--hops", "3");
    pin.classList.add("hop");
  }));
  console.log("PINCOST " + JSON.stringify([...rows, hopping]));

  const of = (label: string) => rows.filter((r) => r.label === label);
  expect(median(of("resting").map((r) => r.styles)), "style recalculations").toBe(median(of("removed").map((r) => r.styles)));
  expect(median(of("resting").map((r) => r.layouts)), "layouts").toBe(median(of("removed").map((r) => r.layouts)));
  expect(median(of("resting").map((r) => r.task_ms)), "main-thread time, within the spread of the runs without a pin")
    .toBeLessThanOrEqual(Math.max(...of("removed").map((r) => r.task_ms)));
});
