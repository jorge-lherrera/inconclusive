import { test, expect } from "../harness/fixtures"
import { dataRows } from "../harness/api"

/**
 * The one spec that writes, and the case that keeps the delete guard honest: a guard
 * that refuses every delete passes delete-guard.spec.ts and is still broken. Here a
 * part with no work order behind it is created and then deleted through the ui, so the
 * permitted path is exercised too.
 *
 * @writes only lifts the block while the target is local. The cleanup route is
 * DECLARED, not derived from the create url: a derived route that misses reports a 404
 * as a successful cleanup and leaves the row behind forever.
 */
test("a part with no open job behind it can be created and deleted", { tag: "@writes" }, async ({
  page,
  demo,
}) => {
  demo.cleanUp((body) => {
    const id = (body as { data?: { id?: string } }).data?.id
    return id ? `/api/parts/${id}` : null
  })

  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBeGreaterThan(0)

  const before = await dataRows(page).count()
  const label = demo.name("Spare cable ferrule")

  await page.locator("#new-code").fill("999")
  await page.locator("#new-label").fill(label)
  await page.locator("#create-part").click()

  await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBe(before + 1)
  const row = page.locator("table tbody tr", { hasText: label })
  await expect(row).toHaveCount(1)

  const id = await row.getAttribute("data-id")
  expect(id, "the new row carries no id, so nothing can clean it up").toBeTruthy()

  await row.locator('button[data-action="delete"]').click()

  await expect.poll(() => dataRows(page).count(), { timeout: 15_000 }).toBe(before)
  await expect(page.locator("table tbody tr", { hasText: label })).toHaveCount(0)
})
