import { test, expect } from "../harness/fixtures"
import { captureApiCall, dataRows } from "../harness/api"

/**
 * The flagship. Two parts are consumed by open work orders, so the api refuses to
 * delete them with 409 PART_IN_USE, and the ui has to turn that code into something
 * the user can act on.
 *
 * Double assertion: the toast is compared against the http response captured in the
 * SAME interaction. If the api sent 409 PART_IN_USE and the ui painted the generic
 * message, the mapping is missing in the frontend. If the api sent 200, the guard
 * itself regressed. The failure message says which, so the ticket does not bounce.
 *
 * No @writes tag: each case declares the one mutation it expects to be REFUSED, and
 * the fixture fails the test if the server ever accepts it.
 */
const CASES = [
  { part: "part-014", usedBy: 2, blocking: "job-1 and job-2" },
  { part: "part-019", usedBy: 1, blocking: "job-2" },
] as const

const GENERIC = /could not delete part/i

for (const testCase of CASES) {
  test(`${testCase.part} is used by ${testCase.blocking}: the refusal reaches the user`, async ({
    page,
    demo,
  }) => {
    demo.expectRefused(new RegExp(`^/api/parts/${testCase.part}$`))

    await page.goto("/", { waitUntil: "domcontentloaded" })
    await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBeGreaterThan(0)

    const call = await captureApiCall(page, `/api/parts/${testCase.part}`, async () => {
      await page.locator(`button[data-action="delete"][data-id="${testCase.part}"]`).click()
    })

    expect(call.status, `the api answered ${call.status}, so the refusal never happened`).toBe(409)
    expect((call.body as { code?: string }).code).toBe("PART_IN_USE")
    expect((call.body as { usedBy?: string[] }).usedBy).toHaveLength(testCase.usedBy)

    const toast = page.locator("#toast")
    await expect(toast).toBeVisible()
    const painted = (await toast.textContent()) ?? ""

    expect(
      painted,
      `The api answered 409 PART_IN_USE naming ${testCase.usedBy} open job(s) and the ui ` +
        `painted "${painted}". The code is stable and the ui is throwing it away: the ` +
        `mapping is missing in the frontend.`
    ).not.toMatch(GENERIC)
    expect(painted.toLowerCase()).toContain("open job")

    /**
     * A refusal that still deleted the row is the failure nobody sees, because the
     * status code alone cannot tell you. Reload and count.
     */
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect
      .poll(() => page.locator(`tr[data-id="${testCase.part}"]`).count(), { timeout: 15_000 })
      .toBe(1)
  })
}
