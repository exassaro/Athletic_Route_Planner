/** A saved route opened in the planner (blueprint Phase 5c amendments 2 and 7), against the live stack. */
import { expect, test } from "@playwright/test";
import { checkNumbersEverySnap, recordApi, setDistance, waitVersion } from "./helpers";
import { actAs, API, savedA01 } from "./savedApi";

test("a saved version that is not the latest opens as it was, and an edit applies to it", async ({ page, request }) => {
  const { token, headers, v1, saved } = await savedA01(request);
  const stops = v1.request.checkpoints!.length;
  expect(stops).toBe(6);
  const later = await request.patch(`${API}/v1/plans/${v1.plan_id}`, {
    headers: { ...headers, "Content-Type": "application/json-patch+json" }, timeout: 60_000,
    data: JSON.stringify([{ op: "replace", path: "/checkpoints", value: [] }]),
  });
  expect((await later.json()).version).toBe(2);

  await actAs(page, token);
  const bodies = recordApi(page);
  await page.goto(`/?edit=${saved.saved_id}`);
  await waitVersion(page, 1);
  await expect(page.getByTestId("diff-toast"), "a fresh result, no diff").toHaveCount(0);
  await expect(page.getByTestId("chips")).toContainText("6 stops");
  await expect(page.locator("[data-testid=stop-list] li[data-stop]")).toHaveCount(stops);
  await expect(page.getByTestId("elevation-chart")).toBeVisible();
  await checkNumbersEverySnap(page, bodies);

  await setDistance(page, 20);
  await waitVersion(page, 3);
  await expect(page.getByTestId("outcome")).toHaveAttribute("data-outcome", "over_budget");
  await expect(page.getByTestId("chips")).toContainText("6 stops");
  await checkNumbersEverySnap(page, bodies);

  await page.getByTestId("diff-toast").getByRole("button", { name: "Undo" }).click();
  await waitVersion(page, 4);
  await expect(page.locator('[data-chip="distance"] [data-value]')).toHaveAttribute("data-value", "25000");
  await expect(page.getByTestId("chips")).toContainText("6 stops");
});

test("opens on the saved route's candidate", async ({ page, request }) => {
  const { token, v1, saved } = await savedA01(request, "Second", 1);
  await actAs(page, token);
  await page.goto(`/?edit=${saved.saved_id}`);
  await waitVersion(page, 1);
  await page.waitForTimeout(800); // a card scrolled into place must not select another
  await expect(page.locator(".route-card.selected [data-field=foot_m]").first())
    .toHaveAttribute("data-value", String(v1.candidates[1]!.foot_m));
  await expect(page.locator(".route-card.selected")).toBeInViewport();
});

test("a route that isn't this client's, or is deleted: a calm message and the setup steps", async ({ page, request }) => {
  const mine = await savedA01(request);
  const theirs = await savedA01(request);
  await request.delete(`${API}/v1/me/routes/${mine.saved.saved_id}`, { headers: mine.headers });
  await actAs(page, mine.token);
  for (const id of [mine.saved.saved_id, theirs.saved.saved_id, "no-such-id"]) {
    await page.goto(`/?edit=${id}`);
    await expect(page.getByTestId("opening-note")).toHaveAttribute("data-state", "gone");
    await expect(page.locator(".setup")).toHaveAttribute("data-step", "1");
  }
});
