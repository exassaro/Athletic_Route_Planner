/**
 * The Phase 5c screens on a phone (390 x 844) in light and dark -> docs/reports/phase5c/screenshots/:
 * saved routes, the menu, the rename dialog, the delete's Undo, the editing save control, the owner's bar, a dead link.
 */
import { expect, test, type Page } from "@playwright/test";
import { THEME_KEY } from "../src/theme/theme";
import { setDistance, waitVersion } from "./helpers";
import { actAs, API, savedA01 } from "./savedApi";

const OUT = "../docs/reports/phase5c/screenshots";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

for (const theme of ["light", "dark"] as const) {
  test(`Phase 5c screens, ${theme}`, async ({ page, request }) => {
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(700); // transitions and label fades
      await p.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    };
    const { token, headers, v1, saved } = await savedA01(request, "Coast run");
    const second = await request.post(`${API}/v1/routes/${v1.candidates[1]!.route_id}/save`, { headers, data: { name: "Short way to Kozhikode" } });
    expect(second.ok()).toBe(true);
    await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [THEME_KEY, theme]);
    await actAs(page, token);

    await page.goto("/routes");
    await expect(page.locator(".saved-card")).toHaveCount(2);
    await shot(page, "01-saved-routes");
    const more = page.getByRole("button", { name: "More for Coast run" });
    await more.click();
    await shot(page, "02-saved-menu");
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await shot(page, "03-rename-dialog");
    await page.keyboard.press("Escape");

    await page.goto(`/?edit=${saved.saved_id}`);
    await waitVersion(page, 1);
    const intoView = async () => {
      for (let i = 0; i < 3 && (await page.locator(".sheet").getAttribute("data-snap")) !== "full"; i++) await page.locator(".sheet-handle").click();
      await page.getByTestId("editing-save").scrollIntoViewIfNeeded();
    };
    await intoView();
    await shot(page, "04-editing-no-changes");
    await page.locator(".sheet-body").evaluate((el) => el.scrollTo(0, 0));
    await setDistance(page, 20);
    await waitVersion(page, 2);
    await intoView();
    await shot(page, "05-editing-update");
    await page.getByTestId("update").click();
    await expect(page.getByTestId("saved-toast")).toBeVisible();
    await shot(page, "06-updated-undo");

    await page.goto(`/s/${saved.share_slug}`);
    await expect(page.getByTestId("owner-bar")).toBeVisible();
    await page.waitForFunction(() => (window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap?.loaded());
    await page.waitForTimeout(3600); // the fit and the three hops
    await shot(page, "07-owner-bar");

    await page.goto("/routes");
    await page.getByRole("button", { name: "More for Coast run" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByTestId("deleted-toast")).toBeVisible();
    await shot(page, "08-deleted-undo");
    await page.goto(`/s/${saved.share_slug}`);
    await expect(page.getByTestId("dead-link")).toBeVisible();
    await page.waitForTimeout(3400); // the mascot's hops
    await shot(page, "09-dead-link");
  });
}
