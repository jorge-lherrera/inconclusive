import { test } from "@playwright/test"
import { ADMIN_STATE } from "../playwright.config"
import { credsFromEnv, loginThroughUi, readSessionFacts, storedSessionIsUsable } from "../harness/session"

test("seed the admin session", async ({ page, context }) => {
  if (storedSessionIsUsable(ADMIN_STATE)) {
    test.info().annotations.push({ type: "session", description: "reused, token still valid" })
    return
  }

  await loginThroughUi(page, credsFromEnv("ADMIN"))
  const facts = await readSessionFacts(page)
  test.info().annotations.push({ type: "session", description: `${facts.name} (${facts.role})` })
  await context.storageState({ path: ADMIN_STATE })
})
