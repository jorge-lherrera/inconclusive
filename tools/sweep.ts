import { request } from "@playwright/test"
import { readAll, rewrite, type LedgerEntry } from "../harness/ledger"

const APP_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.test"
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "inconclusive"

/**
 * Replays the deletes a crashed run never got to. The ledger is written at response
 * time, so it survives the process dying afterwards -- it does NOT cover the window
 * between the server creating the row and the client hearing about it. Calling it a
 * write-ahead log would be a lie; it is a post-hoc record, and that is still useful.
 */
async function main(): Promise<void> {
  const pending = readAll()
  if (pending.length === 0) {
    console.log("nothing to sweep: the ledger is empty")
    return
  }

  console.log(`${pending.length} resource(s) pending\n`)
  const context = await request.newContext()

  const login = await context.post(`${APP_URL}/api/session`, {
    data: { email: EMAIL, password: PASSWORD },
  })
  if (!login.ok()) {
    console.error(`cannot authenticate against ${APP_URL} (${login.status()}); the ledger is untouched`)
    await context.dispose()
    process.exitCode = 1
    return
  }
  const token = ((await login.json()) as { data: { token: string } }).data.token
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const survivors: LedgerEntry[] = []
  for (const entry of [...pending].reverse()) {
    if (!entry.deletePath) {
      console.log(`  ?  no route     ${entry.method} ${entry.url} -> delete it by hand`)
      survivors.push(entry)
      continue
    }
    const target = `${new URL(entry.url).origin}${entry.deletePath}`
    const removed = await context.delete(target, { headers }).catch(() => null)
    const status = removed?.status() ?? 0

    if (!removed || (!removed.ok() && status !== 404)) {
      console.log(`  x  ${status}         DELETE ${entry.deletePath} -> still pending`)
      survivors.push(entry)
      continue
    }
    /**
     * Confirm with a read. Treating a 404 from the delete as success is how a wrong
     * route reports itself clean while the row is still there under another path.
     */
    const check = await context.get(target, { headers }).catch(() => null)
    if (check && check.status() !== 404) {
      console.log(`  x  gone?       ${entry.deletePath} still answers ${check.status()}`)
      survivors.push(entry)
      continue
    }
    console.log(`  ok ${status}         DELETE ${entry.deletePath}`)
  }

  await context.dispose()
  rewrite(survivors)
  console.log(`\nswept ${pending.length - survivors.length}, ${survivors.length} left`)
  if (survivors.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
