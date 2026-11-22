/**
 * Journey SR01 (blueprint Phase 5c), on the phone project: plan A01, save, rename, edit to 20 km, update, the share
 * link shows the new numbers under the same slug; delete, Undo, delete again, the link is dead. At 20 km A01 is
 * over budget, so the route updated to is the full route, not 20 km: its exact API value is checked.
 */
import { expect, test, type Page } from "@playwright/test";
import { addA01Stops, checkNumbers, checkNumbersEverySnap, planA01Base, recordApi, setDistance, strayNumbers, waitVersion } from "./helpers";

async function numbers(page: Page, api: unknown[]) {
  await checkNumbers(page, api);
  expect(await strayNumbers(page), "a number without data-value").toEqual([]);
}

test("SR01: save, rename, edit, update under the same link, delete, undo, delete again", async ({ page, browser }) => {
  const api = recordApi(page);
  const base = process.env.E2E_API ?? "http://localhost:8000";
  await planA01Base(page);
  await addA01Stops(page);
  await page.getByTestId("route-name").fill("Coast run");
  await page.getByTestId("save").click();
  const link = (await page.getByTestId("share-link").getAttribute("href"))!;
  const slug = link.split("/s/")[1]!;
  await expect(page.locator(".route-card.selected [data-field=foot_m]").first()).toHaveText("25.0 km");
  await numbers(page, api);
  // the check itself: a bare number on the page is caught
  await page.evaluate(() => document.querySelector(".sheet-body")!.insertAdjacentHTML("beforeend", "<p id=stray>3.7 km</p>"));
  expect(await strayNumbers(page)).toHaveLength(1);

  await page.goto("/routes");
  await page.getByRole("button", { name: "More for Coast run" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Route name").fill("Evening coast");
  await page.keyboard.press("Enter");
  await expect(page.locator(".saved-card h2")).toHaveText("Evening coast");
  await numbers(page, api);

  await page.getByTestId("saved-edit").click();
  await waitVersion(page, 7);                       // the version that was saved: the six stops are versions 2 to 7
  await expect(page.locator("[data-testid=stop-list] li[data-stop]")).toHaveCount(6);
  await expect(page.getByTestId("update")).toBeDisabled();
  await setDistance(page, 20);
  await waitVersion(page, 8);
  await expect(page.getByTestId("outcome")).toHaveAttribute("data-outcome", "over_budget");
  await checkNumbersEverySnap(page, api);
  await numbers(page, api);
  const foot = page.locator(".route-card.selected [data-field=foot_m]").first();
  const updatedTo = Number(await foot.getAttribute("data-value"));
  await expect(foot).toHaveText("22.3 km");
  await page.getByTestId("update").click();
  await expect(page.getByTestId("saved-toast")).toContainText("Updated Evening coast.");
  expect(await page.getByTestId("share-link").getAttribute("href"), "the same link").toBe(link);

  const visitor = await browser.newContext({ ignoreHTTPSErrors: process.env.E2E_INSECURE === "1" });
  const share = await visitor.newPage();
  expect((await share.goto(link))!.status()).toBe(200);
  await expect(share.getByTestId("summary").locator("[data-field=foot_m]").first()).toHaveAttribute("data-value", String(updatedTo));
  await expect(share.locator("h1")).toHaveText("Evening coast");
  await expect(share.getByTestId("owner-bar")).toHaveCount(0);
  await numbers(share, [await (await share.request.get(`${base}/v1/share/${slug}`)).json()]);

  await page.goto("/routes");
  await expect(page.locator(".saved-card [data-field=foot_m]")).toHaveAttribute("data-value", String(updatedTo));
  await numbers(page, api);
  const remove = async () => {
    await page.getByRole("button", { name: "More for Evening coast" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByTestId("deleted-toast")).toContainText("Deleted Evening coast. Its share link stopped working.");
  };
  await remove();
  expect((await share.goto(link))!.status()).toBe(404);
  await page.getByTestId("deleted-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".saved-card")).toHaveCount(1);
  await expect.poll(async () => (await share.request.get(`${base}/v1/share/${slug}`)).status()).toBe(200);
  expect((await share.goto(link))!.status()).toBe(200);

  await remove();
  expect((await share.goto(link))!.status()).toBe(404);
  await expect(share.getByTestId("dead-link")).toContainText("This link doesn't work any more");
  expect((await share.request.get(`${base}/v1/share/${slug}`)).status()).toBe(404);
  expect((await share.request.get(`${base}/v1/share/${slug}/gpx`)).status()).toBe(404);
  await visitor.close();
});
