import fs from "node:fs"
import path from "node:path"

export type LedgerEntry = {
  runId: string
  spec: string
  method: string
  url: string
  deletePath: string | null
  createdAt: string
}

const LEDGER_DIR = path.resolve(import.meta.dirname, "../.sweep")
const LEDGER_FILE = path.join(LEDGER_DIR, "pending.jsonl")

export function ledgerPath(): string {
  return LEDGER_FILE
}

export function append(entry: LedgerEntry): void {
  fs.mkdirSync(LEDGER_DIR, { recursive: true })
  fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(entry)}\n`, "utf8")
}

export function readAll(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_FILE)) return []
  return fs
    .readFileSync(LEDGER_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerEntry)
}

export function rewrite(entries: LedgerEntry[]): void {
  fs.mkdirSync(LEDGER_DIR, { recursive: true })
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n")
  fs.writeFileSync(LEDGER_FILE, entries.length ? `${body}\n` : "", "utf8")
}
