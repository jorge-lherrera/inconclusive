import { test, expect } from "../harness/fixtures"
import { captureApiCall, countRows, dataRows } from "../harness/api"

/**
 * The double assertion in its plainest form, and the demo's INCONCLUSIVE case: neither
 * planted defect touches row counting, so this spec passes on the fix arm AND on the
 * control arm. Run `bun run ab specs/parts-grid.spec.ts demo-base` and the verdict is
 * INCONCLUSIVE with exit 3. That is not a broken demo. That is the demo.
 */
test("the grid paints exactly the rows the api sent", async ({ page }) => {
  const call = await captureApiCall(page, "/api/parts/search", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
  })

  expect(call.status, `the api answered ${call.status} at ${call.url}`).toBe(200)

  const fromApi = countRows(call.body)
  const rows = dataRows(page)
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  const fromDom = await rows.count()

  test.info().annotations.push({ type: "differential", description: `api=${fromApi} dom=${fromDom}` })

  expect(
    fromDom,
    `The api sent ${fromApi} rows and the grid painted ${fromDom}. ` +
      `Both numbers come from the same navigation, so the gap is in the frontend or in ` +
      `the row selector — not in the backend, which is the half this assertion rules out.`
  ).toBe(fromApi)
})
