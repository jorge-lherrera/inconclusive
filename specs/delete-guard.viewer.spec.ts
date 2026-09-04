import { test, expect } from "../harness/fixtures"
import { dataRows } from "../harness/api"

/**
 * The second stored session, and the reason there are two. Hiding a button is not
 * authorization: the ui omits the control for a viewer AND the api refuses the call,
 * and only the second one is a guarantee.
 *
 * The direct call is declared with expectRefused, so the guard lets exactly that one
 * through and then fails the test if the server answers anything but a refusal.
 */
test("a viewer gets no delete control, and the api refuses anyway", async ({ page, demo }) => {
  demo.expectRefused(/^\/api\/parts\/part-\d+$/)

  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBeGreaterThan(0)

  await expect(page.locator('button[data-action="delete"]')).toHaveCount(0)

  const status = await page.evaluate(async () => {
    const response = await fetch("/api/parts/part-024", {
      method: "DELETE",
      headers: { authorization: `Bearer ${localStorage.getItem("token")}` },
    })
    return response.status
  })

  expect(
    status,
    `A viewer's delete answered ${status}. The button being absent from the dom is a ` +
      `convenience; this is the check that says the row is safe.`
  ).toBe(403)
})
