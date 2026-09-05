import fs from "node:fs"
import path from "node:path"

/**
 * The portable version of a guard that used to live in a machine-local hook. A hook
 * protects the person who installed it; this runs in the suite, so it protects anyone
 * who clones the repo -- which is the difference between a mechanism and a habit.
 */
const APP_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const SPEC_DIR = path.resolve(import.meta.dirname, "../specs")

function isLocal(url: string): boolean {
  try {
    return /^(localhost|127\.0\.0\.1)(:|$)/.test(new URL(url).host)
  } catch {
    return false
  }
}

const tagged = fs
  .readdirSync(SPEC_DIR)
  .filter((name) => name.endsWith(".spec.ts"))
  /**
   * The declaration, not the word. A spec that merely mentions the tag in a comment is
   * not a spec that writes, and counting it teaches people to ignore this warning.
   */
  .filter((name) => /tag:[^\n]*@writes/.test(fs.readFileSync(path.join(SPEC_DIR, name), "utf8")))

if (tagged.length === 0) {
  console.log(`preflight: no spec writes; ${APP_URL} is safe either way`)
  process.exit(0)
}

if (isLocal(APP_URL)) {
  console.log(`preflight: ${tagged.length} spec(s) write, and ${APP_URL} is local. Go.`)
  process.exit(0)
}

console.error(
  `preflight: ${tagged.join(", ")} ${tagged.length === 1 ? "carries" : "carry"} @writes and ` +
    `E2E_BASE_URL is ${APP_URL}, which is not local.\n` +
    `Point the suite at a disposable instance. The tag does not lift the block against a shared one.`
)
process.exit(1)
