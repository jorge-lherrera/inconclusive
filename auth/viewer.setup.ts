import { test } from "@playwright/test"
import { VIEWER_STATE } from "../playwright.config"
import { credsFromEnv, loginThroughUi, readSessionFacts, storedSessionIsUsable } from "../harness/session"

test("seed the viewer session", async ({ page, context }) => {
  if (storedSessionIsUsable(VIEWER_STATE)) {
    test.info().annotations.push({ type: "session", description: "reused, token still valid" })
    return
  }

  await loginThroughUi(page, credsFromEnv("VIEWER"))
  const facts = await readSessionFacts(page)
  test.info().annotations.push({ type: "session", description: `${facts.name} (${facts.role})` })
  await context.storageState({ path: VIEWER_STATE })
})
