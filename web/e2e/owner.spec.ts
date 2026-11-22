/** The owner's bar on the share page (blueprint Phase 5c amendment 9): owner, visitor, unknown token. */
import { expect, test } from "@playwright/test";
import { TOKEN_KEY } from "../src/plan/planClient";
import { actAs, API, savedA01 } from "./savedApi";

test("a visitor sees nothing new and gets no session", async ({ page, request }) => {
  const { saved } = await savedA01(request);
  const calls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/v1/")) calls.push(new URL(r.url()).pathname); });
  await page.goto(`/s/${saved.share_slug}`);
  await page.locator(".pin-start").waitFor();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("owner-bar")).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
});

for (const who of ["another client", "an unknown token"] as const) {
  test(`${who} sees nothing new`, async ({ page, request }) => {
    const { saved } = await savedA01(request);
    const token = who === "another client" ? (await (await request.post(`${API}/v1/session`)).json()).token : "not-a-token";
    await actAs(page, token);
    const asked = page.waitForResponse((r) => r.url().endsWith(`/v1/share/${saved.share_slug}`));
    await page.goto(`/s/${saved.share_slug}`);
    expect((await (await asked).json()).is_owner).toBe(false);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("owner-bar")).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBe(token);
  });
}

test("the owner renames, edits, deletes and can undo", async ({ page, request }) => {
  const { token, saved } = await savedA01(request);
  const share = `/s/${saved.share_slug}`;
  await actAs(page, token);
  await page.goto(share);
  const bar = page.getByTestId("owner-bar");
  await expect(bar).toContainText("Your route");
  await page.waitForTimeout(2000); // the fit
  const box = (await bar.boundingBox())!;
  const sheet = (await page.locator(".sheet").boundingBox())!;
  const pin = (await page.locator(".pin-start").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(sheet.y);
  expect(box.height, "slim").toBeLessThanOrEqual(52);
  expect(pin.y + pin.height, "the route is fitted clear of it").toBeLessThanOrEqual(box.y + 2);
  for (const action of await bar.locator(".owner-action").all()) {
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: test.info().outputPath("owner-bar.png") });

  await bar.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Route name").fill("Morning coast");
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Morning coast");
  await expect(bar.getByRole("button", { name: "Rename" })).toBeFocused();

  await bar.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(new RegExp(`edit=${saved.saved_id}$`));
  await expect(page.getByTestId("update")).toHaveText("Update Morning coast");

  await page.goto(share);
  await bar.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.getByTestId("deleted-toast")).toContainText("Deleted Morning coast. Its share link stopped working.");
  await page.getByTestId("deleted-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".saved-card h2")).toHaveText("Morning coast");
  expect((await page.goto(share))!.status()).toBe(200);
});
