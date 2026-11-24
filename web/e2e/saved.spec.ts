/** The saved routes page (blueprint Phase 5c): cards, menu, rename dialog, delete with Undo. Live stack. */
import { expect, test } from "@playwright/test";
import { actAs, API, savedA01 } from "./savedApi";

test("the card, its menu and the rename dialog", async ({ page, request }) => {
  const { token, saved } = await savedA01(request);
  await actAs(page, token);
  await page.goto("/routes");
  const card = page.locator(".saved-card");
  await expect(card).toContainText("Updated just now");
  await expect(card).toContainText("ends at Francis Road");
  await expect(card.locator(".saved-actions .btn")).toHaveText(["Open", "Edit", "Follow"]);   // Follow: Phase 5d
  await expect(card.locator("[data-value]")).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("saved-card.png") });

  const toggle = page.getByRole("button", { name: "More for Coast run" });
  const box = (await toggle.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Open in…", "Download GPX", "Delete"]);
  for (const item of await page.getByRole("menuitem").all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(item).toBeInViewport();
  }
  await page.screenshot({ path: test.info().outputPath("saved-menu.png") });
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Download GPX" }).click()]);
  expect(file.suggestedFilename()).toMatch(/\.gpx$/);

  await toggle.click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const field = page.getByLabel("Route name");
  await expect(field).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog")), "focus stays inside").toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rename-dialog")).toHaveCount(0);
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await field.fill("  Morning coast  ");
  await page.screenshot({ path: test.info().outputPath("rename-dialog.png") });
  await page.keyboard.press("Enter");                        // submits
  await expect(card.locator("h2")).toHaveText("Morning coast");
  await expect(page.getByRole("button", { name: "More for Morning coast" })).toBeFocused();
  const shared = await (await request.get(`${API}/v1/share/${saved.share_slug}`)).json();
  expect(shared.name).toBe("Morning coast");
});

test("delete shows Undo, which brings the card and the link back", async ({ page, request }) => {
  const { token, saved } = await savedA01(request);
  const share = `${API}/v1/share/${saved.share_slug}`;
  await actAs(page, token);
  await page.goto("/routes");
  const remove = async () => {
    await page.getByRole("button", { name: "More for Coast run" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByTestId("deleted-toast")).toContainText("Deleted Coast run. Its share link stopped working.");
  };
  await remove();
  await expect(page.getByTestId("saved-empty")).toContainText("Nothing saved yet");
  await expect(page.getByTestId("saved-empty").getByTestId("mascot")).toBeVisible();
  expect((await request.get(share)).status()).toBe(404);
  await page.screenshot({ path: test.info().outputPath("deleted-undo.png") });
  await page.getByTestId("deleted-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".saved-card")).toHaveCount(1);
  await expect.poll(async () => (await request.get(share)).status()).toBe(200);

  await remove();
  await expect(page.getByTestId("deleted-toast"), "10 seconds").toHaveCount(0, { timeout: 14_000 });
});
