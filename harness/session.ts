import fs from "node:fs"
import { expect, type Page } from "@playwright/test"

export type Credentials = { email: string; password: string }

export function credsFromEnv(role: "ADMIN" | "VIEWER"): Credentials {
  const email = process.env[`E2E_${role}_EMAIL`]
  const password = process.env[`E2E_${role}_PASSWORD`]
  if (!email || !password) {
    throw new Error(`E2E_${role}_EMAIL / E2E_${role}_PASSWORD are not set`)
  }
  return { email, password }
}

/**
 * Log in through the ui and let the app establish its own session. Rebuilding the
 * token by hand is the one thing guaranteed to drift from what a user gets.
 */
export async function loginThroughUi(page: Page, creds: Credentials): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.locator("#login-email").fill(creds.email)
  await page.locator("#login-password").fill(creds.password)
  await page.locator('#login-form button[type="submit"]').click()

  await expect(page.locator("#app-view")).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => Boolean(localStorage.getItem("token") && localStorage.getItem("profile")))
}

function decodeExp(token: string): number | null {
  const body = token.split(".")[1]
  if (!body) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp : null
  } catch {
    return null
  }
}

/**
 * Reuse a stored session only while its token is still valid, with a margin for the
 * run itself. A fixed cache window is a number invented independently of the token,
 * and the day they disagree the whole suite fails with a cascade of 401s.
 */
export function storedSessionIsUsable(statePath: string, marginSeconds = 120): boolean {
  if (!fs.existsSync(statePath)) return false
  let token: string | null = null
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>
    }
    for (const origin of state.origins ?? []) {
      for (const entry of origin.localStorage ?? []) {
        if (entry.name === "token") token = entry.value
      }
    }
  } catch {
    return false
  }
  if (!token) return false
  const exp = decodeExp(token)
  if (exp === null) return false
  return exp * 1000 - Date.now() > marginSeconds * 1000
}

export async function readSessionFacts(page: Page) {
  return page.evaluate(() => {
    const parse = (key: string) => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "null") as { name?: string; role?: string } | null
      } catch {
        return null
      }
    }
    const profile = parse("profile")
    return { name: profile?.name ?? null, role: profile?.role ?? null }
  })
}
