/** Saved-route errors and edge cases (blueprint Phase 5c): offline, 5xx, dead links. */
import { expect, test, type Page } from "@playwright/test";
import { actAs, API, savedA01 } from "./savedApi";

async function chooseDelete(page: Page) {
  await page.getByRole("button", { name: "More for Coast run" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
}

for (const failure of ["offline", "a 503"] as const) {
  test(`delete with ${failure} keeps the card and says so`, async ({ page, request }) => {
    const { token, saved } = await savedA01(request);
    await actAs(page, token);
    await page.goto("/routes");
    await expect(page.getByTestId("device-note")).toHaveText("Saved routes live on this device until you sign in");
    await page.route("**/v1/me/routes/*", (route) => (route.request().method() !== "DELETE" ? route.fallback()
      : failure === "offline" ? route.abort("internetdisconnected")
        : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down", message: "down" }) })));
    await chooseDelete(page);
    await expect(page.getByTestId("saved-error")).toContainText("Could not delete. Try again.");
    await expect(page.locator(".saved-card")).toHaveCount(1);
    await expect(page.getByTestId("deleted-toast")).toHaveCount(0);
    expect((await request.get(`${API}/v1/share/${saved.share_slug}`)).status()).toBe(200);

    await page.goto(`/s/${saved.share_slug}`);
    await page.getByTestId("owner-bar").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("owner-error")).toHaveText("Could not delete. Try again.");
    await expect(page).toHaveURL(new RegExp(`/s/${saved.share_slug}$`));
  });
}

test("a restore that fails rolls back and can be tried again", async ({ page, request }) => {
  const { token } = await savedA01(request);
  await actAs(page, token);
  await page.goto("/routes");
  await chooseDelete(page);
  await page.route("**/restore", (route) => route.abort("internetdisconnected"));
  await page.getByTestId("deleted-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("saved-error")).toContainText("Could not undo. Try again.");
  await expect(page.locator(".saved-card")).toHaveCount(0);
  await page.unroute("**/restore");
  await page.getByTestId("deleted-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".saved-card")).toHaveCount(1);
});

test("a failed load is not an empty list", async ({ page }) => {
  await page.route("**/v1/me/routes", (route) => route.abort("internetdisconnected"));
  await page.goto("/routes");
  await expect(page.locator(".opening-note")).toContainText("Saved routes didn't load");
  await expect(page.getByTestId("saved-empty")).toHaveCount(0);
});

test("deleted while open elsewhere: the next load is the page an unknown link gets", async ({ page, request }) => {
  const { headers, saved } = await savedA01(request);
  await page.goto(`/s/${saved.share_slug}`);
  await expect(page.locator("h1")).toHaveText("Coast run");
  await request.delete(`${API}/v1/me/routes/${saved.saved_id}`, { headers });
  expect((await page.reload())!.status()).toBe(404);
  const dead = page.getByTestId("dead-link");
  await expect(dead).toContainText("This link doesn't work any more");
  await expect(page.getByTestId("dead-link-plan")).toHaveText("Plan a run");
  const [text, title] = [await dead.innerText(), await page.title()];
  expect((await page.goto("/s/never-issued"))!.status()).toBe(404);
  expect([await dead.innerText(), await page.title()]).toEqual([text, title]);
});
