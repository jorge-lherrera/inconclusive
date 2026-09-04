import { test as base, expect } from "@playwright/test"
import { APP_URL } from "./api"
import { classify, isApiCall } from "./mutations"
import { append, type LedgerEntry } from "./ledger"

export const WRITES_TAG = "@writes"
export const PREFIX = "E2E"

type CreatedResource = { url: string; body: unknown; deletePath: string | null }

export type DemoGuard = {
  runId: string
  name: (base: string) => string
  writesAllowed: boolean
  /**
   * Declare how a create response becomes its delete path. Deriving it by appending
   * an id to the create url is a guess, and a guess that misses reports a 404 as a
   * successful cleanup while the row stays behind forever.
   */
  cleanUp: (resolve: (body: unknown, url: string) => string | null) => void
  /**
   * Let one mutation through BECAUSE the point of the test is that the server refuses
   * it. Verifying a refusal is the one case default-deny cannot express, and the
   * honest answer is not to switch the guard off for the whole spec: it is to name the
   * path and then check that the refusal actually happened. If the server ever answers
   * 2xx here, the guard under test has regressed and this fixture says so.
   */
  expectRefused: (pattern: RegExp) => void
  created: CreatedResource[]
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[-:T.]/g, "").slice(2, 12)
}

function targetIsLocal(): boolean {
  return /^(localhost|127\.0\.0\.1)(:|$)/.test(new URL(APP_URL).host)
}

export const test = base.extend<{ demo: DemoGuard }>({
  demo: [
    async ({ page }, use, testInfo) => {
      const writesAllowed = testInfo.tags.includes(WRITES_TAG) && targetIsLocal()
      const runId = makeRunId()
      const blocked: string[] = []
      const created: CreatedResource[] = []
      let resolveDeletePath: ((body: unknown, url: string) => string | null) | null = null
      let authHeader: string | null = null
      const refusalExpected: RegExp[] = []
      const notRefused: string[] = []

      await page.route("**/*", async (route) => {
        const request = route.request()
        if (!isApiCall(request.url(), APP_URL)) return route.continue()

        const auth = await request.headerValue("authorization")
        if (auth) authHeader = auth

        const pathname = new URL(request.url()).pathname
        const verdict = classify(request.method(), pathname)
        const awaitingRefusal = refusalExpected.some((pattern) => pattern.test(pathname))
        if (verdict.mutates && !writesAllowed && !awaitingRefusal) {
          blocked.push(`${request.method()} ${pathname} — ${verdict.reason}`)
          return route.abort("blockedbyclient")
        }
        return route.continue()
      })

      page.on("response", (response) => {
        const pathname = new URL(response.url()).pathname
        if (!isApiCall(response.url(), APP_URL)) return
        if (!refusalExpected.some((pattern) => pattern.test(pathname))) return
        if (!classify(response.request().method(), pathname).mutates) return
        if (response.status() < 400) {
          notRefused.push(`${response.request().method()} ${pathname} answered ${response.status()}`)
        }
      })

      if (writesAllowed) {
        page.on("response", async (response) => {
          const request = response.request()
          if (request.method().toUpperCase() !== "POST") return
          if (!isApiCall(response.url(), APP_URL)) return
          if (!classify(request.method(), new URL(response.url()).pathname).mutates) return
          if (response.status() >= 300) return

          const body = await response.json().catch(() => null)
          if (body === null) return

          const deletePath = resolveDeletePath ? resolveDeletePath(body, response.url()) : null
          const entry: LedgerEntry = {
            runId,
            spec: testInfo.titlePath.join(" > "),
            method: request.method(),
            url: response.url(),
            deletePath,
            createdAt: new Date().toISOString(),
          }
          created.push({ url: response.url(), body, deletePath })
          append(entry)
        })
      }

      await use({
        runId,
        name: (value: string) => `${PREFIX}-${runId}-${value}`,
        writesAllowed,
        cleanUp: (resolve) => {
          resolveDeletePath = resolve
        },
        expectRefused: (pattern) => {
          if (!targetIsLocal()) {
            throw new Error(
              `expectRefused() lets a real mutation reach ${APP_URL}, which is not local. ` +
                `Point the suite at a disposable instance before asserting a refusal.`
            )
          }
          refusalExpected.push(pattern)
        },
        created,
      })

      const failures: string[] = []
      if (writesAllowed && created.length > 0) {
        const headers: Record<string, string> = { "Content-Type": "application/json" }
        if (authHeader) headers.Authorization = authHeader

        for (const resource of [...created].reverse()) {
          if (!resource.deletePath) {
            failures.push(`${resource.url} was created but no cleanUp() resolver claimed it`)
            continue
          }
          const target = `${new URL(resource.url).origin}${resource.deletePath}`
          const removed = await page.request.delete(target, { headers }).catch(() => null)
          if (!removed || (!removed.ok() && removed.status() !== 404)) {
            failures.push(`DELETE ${resource.deletePath} answered ${removed?.status() ?? "no response"}`)
            continue
          }
          /**
           * Confirm the delete instead of trusting its status code. Cleanup that reports
           * itself complete without looking is the same invisible failure the guard exists
           * to prevent, wearing the shape of a teardown.
           */
          const check = await page.request.get(target, { headers }).catch(() => null)
          if (check && check.status() !== 404) {
            failures.push(`${resource.deletePath} still answers ${check.status()} after DELETE`)
          }
        }
        testInfo.annotations.push({
          type: "cleanup",
          description: `${created.length} resource(s) created; ${failures.length} left behind`,
        })
      }

      if (blocked.length > 0) {
        const detail = [...new Set(blocked)].map((line) => `  - ${line}`).join("\n")
        throw new Error(
          `This spec tried to WRITE and was blocked.\n${detail}\n\n` +
            `If the write is the point of the test, declare it:\n` +
            `  test("...", { tag: "${WRITES_TAG}" }, async ({ page, demo }) => { ... })\n` +
            (targetIsLocal()
              ? ``
              : `The target is ${APP_URL}, which is not local. The tag does not lift the block ` +
                `against a shared environment.\n`) +
            `If it is a READ that got misclassified, add its pattern to harness/mutations.ts.`
        )
      }

      if (notRefused.length > 0) {
        const detail = [...new Set(notRefused)].map((line) => `  - ${line}`).join("\n")
        throw new Error(
          `A mutation declared with expectRefused() was NOT refused:\n${detail}\n\n` +
            `The server accepted a write this spec only allowed through on the promise that ` +
            `it would be rejected. Something was written.`
        )
      }

      if (failures.length > 0) {
        throw new Error(`Cleanup did not finish:\n${failures.map((line) => `  - ${line}`).join("\n")}`)
      }
    },
    { auto: true },
  ],
})

export { expect }
