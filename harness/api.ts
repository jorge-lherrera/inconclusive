import fs from "node:fs"
import { expect, type APIRequestContext, type Page, type Response } from "@playwright/test"

export const APP_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100"

export type SessionFacts = { token: string; profile: { email: string; name: string; role: string } | null }

export function readState(statePath: string): SessionFacts {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>
  }
  const read = (name: string): string | null => {
    for (const origin of state.origins ?? []) {
      for (const entry of origin.localStorage ?? []) {
        if (entry.name === name) return entry.value
      }
    }
    return null
  }
  const token = read("token")
  if (!token) throw new Error(`no token in ${statePath}. Run "bun run auth".`)
  const raw = read("profile")
  return { token, profile: raw ? (JSON.parse(raw) as SessionFacts["profile"]) : null }
}

export function headersFromState(statePath: string): Record<string, string> {
  return {
    Authorization: `Bearer ${readState(statePath).token}`,
    "Content-Type": "application/json",
  }
}

export type CapturedCall = { url: string; status: number; body: unknown }

/**
 * Captures every response whose url matches, and returns the LAST one. Taking the
 * first is a race: a refetch, a double mount or a navigation can leave you asserting
 * the dom that one response painted against the body of a different one.
 */
export async function captureApiCall(
  page: Page,
  urlFragment: string,
  action: () => Promise<void>,
  options: { settleMs?: number } = {}
): Promise<CapturedCall> {
  const seen: Response[] = []
  const collect = (response: Response) => {
    if (response.url().includes(urlFragment)) seen.push(response)
  }

  page.on("response", collect)
  try {
    const first = page.waitForResponse((response) => response.url().includes(urlFragment), {
      timeout: 30_000,
    })
    await action()
    await first
    await page.waitForTimeout(options.settleMs ?? 250)
  } finally {
    page.off("response", collect)
  }

  const last = seen.at(-1)
  if (!last) throw new Error(`no response matched "${urlFragment}"`)

  let body: unknown = null
  try {
    body = await last.json()
  } catch {
    body = await last.text().catch(() => null)
  }
  return { url: last.url(), status: last.status(), body }
}

/**
 * The number of rows the api actually sent. Deliberately refuses to fall back to a
 * total-count field: on a paginated endpoint that compares a page of rows against a
 * grand total and fails for a reason that is not a bug.
 */
export function countRows(body: unknown): number {
  const node = body as Record<string, unknown> | null
  const inner = (node?.data ?? node) as Record<string, unknown> | unknown[] | null
  if (Array.isArray(inner)) return inner.length
  const content = (inner as Record<string, unknown> | null)?.content
  if (Array.isArray(content)) return content.length
  throw new Error(`countRows found no array of rows in ${JSON.stringify(body).slice(0, 200)}`)
}

export function rowLabels(body: unknown): string[] {
  const node = body as Record<string, unknown> | null
  const inner = (node?.data ?? node) as Record<string, unknown> | unknown[] | null
  const rows = Array.isArray(inner) ? inner : ((inner as Record<string, unknown> | null)?.content as unknown[])
  if (!Array.isArray(rows)) throw new Error("rowLabels found no array of rows")
  return rows.map((row) => String((row as Record<string, unknown>).label ?? ""))
}

/**
 * Data rows only. The grid paints an empty-state row with a single cell, and it is
 * not data; counting it turns "the api sent nothing" into "the grid painted one".
 */
export const DATA_ROWS = "table tbody tr:not([aria-hidden]):not(:has(td:only-child))"

export function dataRows(page: Page) {
  return page.locator(DATA_ROWS)
}

/**
 * A direct GET against the api, for reading a fact the browser did not fetch. It does
 * NOT pass through the browser write guard, which is why it is GET only and why the
 * signature does not accept a method.
 */
export async function apiGet(
  request: APIRequestContext,
  path: string,
  statePath: string
): Promise<unknown> {
  const response = await request.get(`${APP_URL}${path}`, { headers: headersFromState(statePath) })
  expect(response.ok(), `GET ${path} answered ${response.status()}`).toBeTruthy()
  return response.json()
}
