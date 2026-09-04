import { test, expect } from "../harness/fixtures"
import { captureApiCall } from "../harness/api"

/**
 * The strong form of the double assertion: content and ORDER, not cardinality. Codes
 * are segmented decimals, so a frontend that re-sorts the payload as text puts 630.10
 * before 630.5 and 10 before 4, while the count stays right and the grid looks fine.
 *
 * Like parts-grid, this passes on both arms of the differential. It earns its place by
 * being the assertion that would catch a re-sort, not by catching a planted defect.
 */
test("the part select keeps the order the api sent", async ({ page }) => {
  const call = await captureApiCall(page, "/api/parts/labels", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
  })

  expect(call.status).toBe(200)
  const fromApi = ((call.body as { data?: Array<{ label: string }> }).data ?? []).map((item) => item.label)
  expect(fromApi.length).toBeGreaterThan(0)

  const select = page.locator("#part-select option")
  await expect.poll(() => select.count(), { timeout: 15_000 }).toBe(fromApi.length)
  const fromDom = await select.allTextContents()

  const firstDivergence = fromDom.findIndex((label, index) => label !== fromApi[index])
  expect(
    fromDom,
    firstDivergence === -1
      ? "order matches"
      : `Option ${firstDivergence} is "${fromDom[firstDivergence]}" and the api sent ` +
        `"${fromApi[firstDivergence]}" at that position. The rows are the same; the order is not, ` +
        `so the frontend re-sorted a payload that was already ordered.`
  ).toEqual(fromApi)
})
