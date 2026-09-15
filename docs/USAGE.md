# Usage

Everything you need to run `inconclusive`, write specs with it, and point it at your own
application.

- [Requirements](#requirements)
- [First run](#first-run)
- [The commands](#the-commands)
- [The loop: closing a bug with it](#the-loop-closing-a-bug-with-it)
- [Reading the verdict](#reading-the-verdict)
- [Writing a spec](#writing-a-spec)
- [Writes](#writes)
- [Sessions and roles](#sessions-and-roles)
- [Using it on your own application](#using-it-on-your-own-application)
- [Configuration reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| | |
|---|---|
| [Bun](https://bun.sh) | 1.1 or newer. Runs the app, the tools and the TypeScript, with no build step. |
| Git | 2.20 or newer. The control arm is a `git worktree`, so the repository must be a real clone, not a downloaded zip. |
| A POSIX shell | `tools/*.sh`. On Windows, Git Bash. |
| Chromium | installed by Playwright, not by you. |

Nothing else. No database, no docker, no service to point at.

## First run

```bash
bun install
bunx playwright install chromium
bun run verify
```

`bun run verify` takes a couple of minutes. It runs the differential three times and
asserts that each of the three verdicts comes back correctly — a real fix `VERIFIED`
against the defect it closes, a spec that never touches the defect reported
`INCONCLUSIVE`, and the defect present on both arms reported `FIX DOES NOT CLOSE IT`. It
exits non-zero if any of them is wrong.

That is the proof the tool works. Once it is green, everything below is yours to use.

## The commands

```bash
bun run test                      # the whole suite; starts the app for you
bun run test specs/parts-grid.spec.ts
bun run test:headed               # same, with a visible browser
bun run ui                        # Playwright's UI mode
bun run report                    # open the last HTML report

bun run ab <spec> [base-ref]      # THE DIFFERENTIAL
bun run verify                    # the three verdicts, end to end

bun run app                       # just the app under test, on :3100
bun run auth                      # refresh the stored sessions
bun run sweep                     # replay deletes a crashed run left behind
bun run preflight                 # refuse to run writing specs against a shared host
bun run typecheck
```

### `bun run ab`

```
bun run ab <spec> [base-ref] [options]

  <spec>            path to the spec, e.g. specs/delete-guard.spec.ts
  [base-ref]        the control arm, default HEAD (i.e. your fix is uncommitted)

  --fix-ref <ref>   build the fix arm from a ref too, instead of the working tree
  --control-runs N  how many times the control must fail, default 3
  --project NAME    Playwright project, default admin
```

The default is the normal case: **your fix is in the working tree, uncommitted, and the
control is the last commit.** Once the fix is committed, name the commit before it:

```bash
bun run ab specs/delete-guard.spec.ts HEAD~1
```

## The loop: closing a bug with it

**1. Write the spec first, against the broken code.** Run it plainly and watch it fail for
the reason you expect. If it fails for a different reason, the spec is wrong, not the app.

```bash
bun run test specs/my-bug.spec.ts
```

**2. Fix the app.** Run the spec again until it passes.

**3. Run the differential.** This is the step that turns "it passes" into evidence.

```bash
bun run ab specs/my-bug.spec.ts
```

**4. Read the verdict, not the colour.** A green spec and an `INCONCLUSIVE` verdict mean
you have not proven anything yet — see below.

You do not need step 1 to come first. The differential works just as well on a spec written
after the fix, which is exactly the case where you most want it: a spec written while
looking at working code has a habit of passing on both arms.

## Reading the verdict

```
---------------- VERDICT ----------------
  spec                : specs/delete-guard.spec.ts
  with the fix   (demo-base-6-g247b32f) : PASS
  without it     (9c5c45c)              : 3 of 3 runs failed

  VERIFIED: the spec reproduces the defect at 9c5c45c and the fix closes it.
```

| exit | verdict | what to do about it |
|---|---|---|
| `0` | `VERIFIED` | Nothing. The spec fails without the fix and passes with it: it is evidence. |
| `2` | usage | Bad arguments, missing spec file, an unusable ref. |
| `3` | `INCONCLUSIVE` | The spec passes on both arms, or the control only failed some of the runs. See below. |
| `4` | `FIX DOES NOT CLOSE IT` | The spec still fails with the fix applied. Either the fix is incomplete or the spec is asserting something else. |

**`INCONCLUSIVE` has two shapes, and the verdict block tells you which.**

*"0 of 3 runs failed"* — the spec passes without your fix. Either it never touches the
defect (the usual case: the assertion is too loose, or it asserts on the wrong element), or
the defect was never present at the base ref you named. Tighten the assertion, or check you
picked the right base.

*"1 of 3 runs failed"* — the spec is flaky. It reproduces the defect sometimes. That is not
a differential, and no amount of re-running turns it into one: a spec that only sometimes
fails on the control arm would also sometimes pass on the fix arm, and then you would have
signed a `VERIFIED` that never happened. Make it deterministic first — replace sleeps with
`expect.poll` and `waitForResponse` — and run it again.

## Writing a spec

Import `test` from the harness, not from Playwright. That is what installs the write guard.

```ts
import { test, expect } from "../harness/fixtures"
import { captureApiCall, countRows, dataRows } from "../harness/api"
```

### Assert twice

The pattern the whole repository is built around: capture the HTTP response that painted
the screen, in the same navigation, and compare the DOM against **it** rather than against
a number you typed.

```ts
test("the grid paints exactly the rows the api sent", async ({ page }) => {
  const call = await captureApiCall(page, "/api/parts/search", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
  })

  expect(call.status).toBe(200)

  const fromApi = countRows(call.body)
  const rows = dataRows(page)
  await expect.poll(() => rows.count()).toBeGreaterThan(0)

  expect(
    await rows.count(),
    `The api sent ${fromApi} rows and the grid painted them. Both numbers come from the ` +
      `same navigation, so the gap is in the frontend, not the backend.`
  ).toBe(fromApi)
})
```

`captureApiCall` collects **every** response whose URL contains the fragment and returns the
last one. Taking the first is a race: a refetch, a double mount or a navigation leaves you
asserting the DOM one response painted against the body of a different one.

**Write the failure message for the person reading it tomorrow at eight.** `expected 12,
received 0` starts an argument about whose ticket it is. Two numbers with their provenance
attached ends it — and that is the only reason to capture the response at all.

### Compare order, not just counts

A count catches losses. It does not catch a frontend that re-sorts a payload that was
already ordered, which keeps the count right and the grid looking fine. When order is part
of the contract, assert the whole list:

```ts
const fromApi = call.body.data.map((item) => item.label)
const fromDom = await page.locator("#part-select option").allTextContents()
expect(fromDom).toEqual(fromApi)
```

### Selectors have to survive both arms

Every spec runs against the arm **without** the fix too. If you select on markup the fix
introduced — a new `data-` attribute, a new class, a new test id — the control arm fails
because the element does not exist yet, not because the defect is there, and the verdict
becomes a lie that looks like a `VERIFIED`.

Select on things both arms have: roles, stable ids, exact text, `data-id` on a row.

### Helpers

| | |
|---|---|
| `captureApiCall(page, fragment, action)` | Runs `action`, returns `{ url, status, body }` of the last matching response. |
| `countRows(body)` | Rows in the payload. Throws rather than falling back to a total-count field, because on a paginated endpoint that compares a page against a grand total. |
| `rowLabels(body)` | The `label` of each row, for order assertions. |
| `dataRows(page)` | The grid's data rows, excluding `aria-hidden` filler and single-cell empty-state rows. |
| `apiGet(request, path, statePath)` | A direct GET, for reading a fact the browser never fetched. GET only, deliberately: it does not pass through the browser guard. |

## Writes

**Every spec is read-only by default.** The fixture intercepts each request the page makes
and aborts anything that mutates: `PUT`, `PATCH` and `DELETE` always; `POST` unless its path
matches a read pattern in `harness/mutations.ts`.

A blocked spec fails with the method and the path printed, so a misclassified read takes
thirty seconds to fix. That bias is deliberate — the opposite error, a write that slips
through, is the one nobody sees.

### When the write is the point

Tag the test and declare how to undo it:

```ts
test("creates a part", { tag: "@writes" }, async ({ page, demo }) => {
  demo.cleanUp((body) => {
    const id = (body as { data?: { id?: string } }).data?.id
    return id ? `/api/parts/${id}` : null
  })

  await page.locator("#new-label").fill(demo.name("Cable ferrule"))
  await page.locator("#create-part").click()
  // ...
})
```

- `demo.name("x")` prefixes with `E2E-<runId>-`, so anything orphaned is identifiable.
- `demo.cleanUp(fn)` **declares** the delete route. It is not derived by appending an id to
  the create URL: a derived route that misses reports its 404 as a successful cleanup and
  leaves the row behind forever.
- Every created resource is appended to `.sweep/pending.jsonl` at response time, deleted in
  reverse order at teardown, and then **confirmed with a GET**. If anything is left behind,
  the test fails.

The tag only lifts the block while the target is `localhost` or `127.0.0.1`. Against a
shared host it does not, and no flag makes it.

### When the point is that the write is *refused*

Default-deny cannot express "attempt this and expect a 409". Switching the guard off for
the whole spec is the obvious answer and the worst one: if the server-side guard ever
regresses to `200`, the row really is deleted. Name the one path instead:

```ts
test("a part in use cannot be deleted", async ({ page, demo }) => {
  demo.expectRefused(/^\/api\/parts\/part-014$/)
  // the DELETE goes through; the fixture fails the test if the server accepts it
})
```

No `@writes` tag needed. If the server answers anything below 400 on that path, the test
fails with *"the server accepted a write this spec only allowed through on the promise that
it would be rejected"*.

### Cleaning up after a crash

```bash
bun run sweep
```

Replays the deletes still in the ledger, confirming each with a read. Note what this does
**not** cover: the ledger is written when the response arrives, so it survives the process
dying afterwards — not the window between the server creating the row and the client
hearing about it. It is a post-hoc record, not a write-ahead log.

## Sessions and roles

`auth/*.setup.ts` logs in **through the UI** and stores the resulting `storageState`. The
session is never reconstructed by hand, so it cannot drift from what a real user gets.

- One state file per **origin**: `.auth/admin-3100.json`, `.auth/admin-3101.json`. The
  differential has two apps alive at once, and a single file would carry one origin's
  session into the other.
- A stored session is reused only while its token is still valid, read from the token's own
  `exp`. A fixed cache window is a number invented independently of the token, and the day
  they disagree the suite fails with a cascade of 401s.
- Two profiles: `admin` and `viewer`. A spec named `*.viewer.spec.ts` runs under the viewer
  session; everything else runs as admin.

Force a refresh with `bun run auth`, or delete `.auth/`.

## Using it on your own application

### 1. Point it at your app

Set `E2E_BASE_URL` and stop the bundled app from starting:

```bash
E2E_BASE_URL=http://localhost:5173 E2E_MANAGED_SERVER=0 bun run test
```

Or edit `playwright.config.ts`: change the default `BASE_URL`, and change `webServer.command`
to your own dev server (or delete the block if you start it yourself).

### 2. Teach it your login

`harness/session.ts` → `loginThroughUi`. Three selectors and whatever your app stores:

```ts
await page.goto("/login")
await page.locator("#email").fill(creds.email)
await page.locator("#password").fill(creds.password)
await page.locator('form button[type="submit"]').click()
await expect(page).not.toHaveURL(/\/login/)
```

If your app keeps the session in a cookie rather than `localStorage`, `storageState`
captures it anyway — but `storedSessionIsUsable` reads the JWT out of `localStorage`, so
adjust it or replace the check with a plain age limit.

### 3. Teach it your API

- `harness/mutations.ts` → `READ_ONLY_POST`. **This list is yours.** The four patterns here
  are what this demo needs; an older backend that paginates, searches and exports behind
  `POST` needs every one of those spelled out. Run the suite, watch what gets blocked, and
  add patterns until only real writes are.
- `harness/mutations.ts` → `isApiCall`. It matches origin **plus** a `/api/` path prefix.
  If your API lives on another host, compare against that host instead.
- `harness/api.ts` → `countRows` and `rowLabels` unwrap `{ data: { content: [...] } }`.
  Change them to your envelope.
- `harness/api.ts` → `DATA_ROWS`. The selector that says which `<tr>` is data and which is
  chrome. Get this wrong and the double assertion fails for a reason that is not a bug.

### 4. Teach the differential where your repository is

`tools/ab-verify.sh` assumes the app and the harness share one repository, which is why it
runs `git worktree add` in its own root. If you keep the harness **outside** your app's
repository — a reasonable choice, since then nothing of it lands in your team's PRs — change
two things:

- add `REPO=/path/to/your/app` and run `git -C "$REPO" worktree add ...`;
- in `serve()`, run your app's dev command instead of `bun app/server.ts`, and install
  dependencies in the worktree the first time (`bun install`, `npm ci`, whatever it needs).

Everything else — the two arms, the three verdicts, the repeated control, the exit codes —
is unchanged.

### 5. Delete the demo

Once your own specs run: remove `app/`, `specs/*.spec.ts`, `tools/verify-all.sh`, and the
`app` script from `package.json`. What remains is `harness/`, `auth/`, `tools/ab-verify.sh`,
`tools/sweep.ts` and `tools/preflight.ts` — about 800 lines.

## Configuration reference

| variable | default | what it does |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3100` | The app under test. Also the origin the write guard watches. |
| `E2E_MANAGED_SERVER` | unset | `0` stops Playwright from starting the bundled app. The differential sets this itself. |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | `admin@example.test` / `inconclusive` | Admin credentials. |
| `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD` | `viewer@example.test` / `inconclusive` | Viewer credentials. |
| `FIX_PORT` | `3100` | Port for the fix arm. |
| `CONTROL_PORT` | `3101` | Port for the control arm. |
| `CONTROL_RUNS` | `3` | How many times the control must fail. Same as `--control-runs`. |
| `PROJECT` | `admin` | Playwright project for the differential. Same as `--project`. |
| `APP_JWT_SECRET` | a fixed demo string | Signing key of the demo app's toy JWT. |

Paths worth knowing: `.auth/` (stored sessions), `.sweep/pending.jsonl` (the ledger),
`playwright-report/` and `test-results/` (Playwright output), `.fix-server.log` and
`.control-server.log` (what each arm printed). All of them are ignored by git.

## Troubleshooting

**`ABORT: something is already answering on :3100`**
A server from a previous run is still up. That is not pedantry: if the arm you meant to
start cannot bind, the health check answers from whatever was already there, and the verdict
describes code nobody is running. Stop it and retry.

**`INCONCLUSIVE` on a spec you are sure catches the bug**
Check the base ref. `bun run ab spec.ts` defaults to `HEAD`, which is right only while your
fix is uncommitted. Once it is committed, you want `HEAD~1`.

**Every spec fails with `no token in .auth/...`**
The stored session expired or the app changed its login. `bun run auth`, or delete `.auth/`
and run again.

**A spec fails saying it tried to write**
Read the printed path. If it is a genuine write, tag the test `@writes`. If it is a read
behind `POST`, add its pattern to `harness/mutations.ts` — that is the list rotting, which
it will, and it is why the message prints the path.

**`Cleanup did not finish`**
A `@writes` spec created something the teardown could not remove or could not confirm gone.
Look at `.sweep/pending.jsonl` and run `bun run sweep`.

**The control arm fails to start**
`tail .control-server.log`. The usual cause is that the base ref predates something the app
now needs. Try an older or newer base.
