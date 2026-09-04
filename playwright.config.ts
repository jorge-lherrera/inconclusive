import { defineConfig, devices } from "@playwright/test"
import path from "node:path"

/**
 * Zero configuration on purpose: the subject under test ships in this repo, so a
 * visitor clones and runs. Every value below can be overridden from the environment.
 */
process.env.E2E_ADMIN_EMAIL ??= "admin@example.test"
process.env.E2E_ADMIN_PASSWORD ??= "inconclusive"
process.env.E2E_VIEWER_EMAIL ??= "viewer@example.test"
process.env.E2E_VIEWER_PASSWORD ??= "inconclusive"

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const PORT = new URL(BASE_URL).port || "3100"

/**
 * One stored session per ORIGIN, with the port in the file name. The differential
 * runs two apps at once, and a single state file would carry one origin's cookies
 * into the other.
 */
const originTag = new URL(BASE_URL).port || new URL(BASE_URL).hostname
export const ADMIN_STATE = path.resolve(import.meta.dirname, `.auth/admin-${originTag}.json`)
export const VIEWER_STATE = path.resolve(import.meta.dirname, `.auth/viewer-${originTag}.json`)

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },

  /**
   * Serial, and no retries. Not an omission: a retry that turns the control arm green
   * downgrades a legitimate differential to INCONCLUSIVE, so the contract in
   * tools/ab-verify.sh only holds while a spec is allowed to fail once and stay failed.
   */
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  /**
   * The differential starts both arms itself and sets E2E_MANAGED_SERVER=0, so this
   * only runs for a plain `bun run test`.
   */
  webServer:
    process.env.E2E_MANAGED_SERVER === "0"
      ? undefined
      : {
          command: `bun app/server.ts`,
          url: BASE_URL,
          env: { PORT },
          reuseExistingServer: true,
          timeout: 30_000,
        },

  projects: [
    { name: "setup-admin", testDir: "./auth", testMatch: /admin\.setup\.ts/ },
    { name: "setup-viewer", testDir: "./auth", testMatch: /viewer\.setup\.ts/ },
    {
      name: "admin",
      testDir: "./specs",
      testMatch: /^(?!.*\.viewer\.).*\.spec\.ts$/,
      dependencies: ["setup-admin"],
      use: { ...devices["Desktop Chrome"], storageState: ADMIN_STATE },
    },
    {
      name: "viewer",
      testDir: "./specs",
      testMatch: /\.viewer\.spec\.ts$/,
      dependencies: ["setup-viewer"],
      use: { ...devices["Desktop Chrome"], storageState: VIEWER_STATE },
    },
  ],
})
