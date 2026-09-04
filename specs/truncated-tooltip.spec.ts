import { test, expect } from "../harness/fixtures"
import { dataRows } from "../harness/api"

/**
 * Geometry, not guesswork: a label is truncated when its scroll width exceeds its
 * client width. The spec finds both groups at runtime instead of hardcoding which row
 * is long, so it keeps working when the seed changes.
 *
 * The negative case is what makes this an assertion. Without it, an app that shows a
 * tooltip on every label passes.
 */
type Measured = { index: number; text: string; truncated: boolean; tooltip: string | null }

async function measure(page: import("@playwright/test").Page): Promise<Measured[]> {
  return page.$$eval("table tbody td.label span.truncated", (nodes) =>
    nodes.map((node, index) => ({
      index,
      text: node.textContent ?? "",
      truncated: node.scrollWidth > node.clientWidth,
      tooltip: node.getAttribute("title"),
    }))
  )
}

test("a label that is cut off carries its full text in a tooltip", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBeGreaterThan(0)

  const measured = await measure(page)
  const cut = measured.filter((item) => item.truncated)
  const whole = measured.filter((item) => !item.truncated)

  expect(cut.length, "no label is truncated at this viewport, so there is nothing to assert").toBeGreaterThan(0)
  expect(whole.length, "every label is truncated, so the control case is missing").toBeGreaterThan(0)

  test.info().annotations.push({
    type: "geometry",
    description: `${cut.length} truncated, ${whole.length} fit`,
  })

  const withoutTooltip = cut.filter((item) => item.tooltip !== item.text)
  expect(
    withoutTooltip.map((item) => item.text),
    `${withoutTooltip.length} of ${cut.length} labels are cut off by the ellipsis and carry no ` +
      `tooltip with the full text, so the text is unreachable. The api sent the whole string; ` +
      `the frontend is the half that dropped it.`
  ).toEqual([])
})

test("a label that fits gets no tooltip", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBeGreaterThan(0)

  const spurious = (await measure(page)).filter((item) => !item.truncated && item.tooltip !== null)

  expect(
    spurious.map((item) => item.text),
    `These labels fit inside their cell and still carry a tooltip. A tooltip on every label ` +
      `is not a fix, it is noise that makes the real one impossible to see.`
  ).toEqual([])
})
