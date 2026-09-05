# inconclusive

**A browser test that passes proves nothing.** It proves the DOM exists today. It does not
prove your fix did anything.

`inconclusive` runs the same spec against two live instances — your fix, and the commit
before it — and refuses to say *verified* unless the spec **fails without the fix**.

[![license: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![runtime: bun](https://img.shields.io/badge/runtime-bun-f9f1e1)](https://bun.sh)
[![docs: usage](https://img.shields.io/badge/docs-usage-2f5bd7)](docs/USAGE.md)

---

## Three outcomes, not two

The old discipline is to watch the test go red before you fix anything. That red is an
anecdote: it happens once, on your machine, and it is gone the moment you merge. Nobody
else can reproduce it, and nothing in your pipeline knows it ever happened.

This turns it into an artifact anyone can re-run:

```
== 4/4  the spec must FAIL without the fix, 3 times out of 3

---------------- VERDICT ----------------
  spec                : specs/parts-grid.spec.ts
  with the fix   (demo-base-4-g63f7b0f) : PASS
  without it     (9c5c45c)              : 0 of 3 runs failed

  INCONCLUSIVE: passes on both arms. The spec does not touch the defect,
  or the defect was never in 9c5c45c.

$ echo $?
3
```

**Inconclusive is a first-class outcome, not a shade of green.** "My test proves nothing"
and "my fix does not work" are different diagnoses, and a suite that can only return 0 and
1 cannot tell you which one you are holding. Here each outcome gets its own exit code, so a
machine can insist on it — not just a human reading a log.

## Run it

```bash
bun install
bunx playwright install chromium
bun run verify
```

No database, no docker, no backend to point at. The subject under test is a 400-line parts
warehouse that ships in this repository, with two defects planted in a tagged commit, so
the differential has something real to differentiate.

Each outcome on its own:

```bash
bun run ab specs/delete-guard.spec.ts demo-base                       # exit 0, VERIFIED
bun run ab specs/parts-grid.spec.ts demo-base                         # exit 3, INCONCLUSIVE
bun run ab specs/delete-guard.spec.ts demo-base --fix-ref demo-base   # exit 4, no fix
```

And the plain suite, which starts the app for you:

```bash
bun run test
```

Full instructions, including how to point the harness at your own application, are in
[docs/USAGE.md](docs/USAGE.md).

## The contract

| exit | verdict | meaning |
|---|---|---|
| 0 | `VERIFIED` | fails without the fix, passes with it |
| 2 | usage | bad arguments, missing spec, an unusable ref |
| 3 | `INCONCLUSIVE` | passes on both arms, or the control only failed sometimes |
| 4 | `FIX DOES NOT CLOSE IT` | still fails with the fix applied |

The control arm runs **three times by default** and all three must fail. One flaky pass
there signs a `VERIFIED` that never happened, so the differential is worth exactly as much
as the determinism of the spec — and this is the only place that measures it.

Which is also why `retries: 0` is a consequence rather than an oversight: a retry that
turns the control arm green downgrades a legitimate differential to `INCONCLUSIVE`.

## Assert twice

A spec here compares the DOM against **the HTTP response captured during that same
navigation**, so the failure message can say which side of the wire broke:

```
Error: The api answered 409 PART_IN_USE naming 2 open job(s) and the ui painted
"Could not delete part". The code is stable and the ui is throwing it away:
the mapping is missing in the frontend.
```

That is the whole point. `expected 12, received 0` starts an argument about whose ticket it
is. Two numbers with their provenance attached ends it.

The strong form is not counting rows — a count only catches losses.
`specs/select-order.spec.ts` compares labels **and order**, because a frontend that
re-sorts an already-ordered payload keeps the count right and the grid looking fine.

## Writes are denied by default

Point a browser suite at an environment you share with other people and every write that
escapes stays there, mixed into somebody else's data. So the fixture intercepts every
request the page makes: `PUT`, `PATCH` and `DELETE` always write; `POST` writes **unless**
its path matches a known read pattern.

The bias is chosen, because the two errors are not symmetric:

- **A read blocked by mistake:** the test fails, prints the method and path, and you add
  the pattern. Thirty seconds.
- **A write let through by mistake:** a row appears that nobody asked for. Found weeks
  later, if ever.

There is one case default-deny cannot express: a test whose whole point is that a write is
**refused**. Switching the guard off for that spec — the obvious answer — is also the worst
one, because if the server-side guard ever regresses to `200`, the row really is gone. So
the spec names that one path instead:

```ts
demo.expectRefused(/^\/api\/parts\/part-\d+$/)
```

The mutation goes through, and the fixture fails the test if the server answers anything
other than a refusal.

Anything a spec does create is recorded to a JSONL ledger at response time, deleted in
reverse order, and **confirmed with a read** — a teardown that reports itself complete
without looking is the same invisible failure the guard exists to prevent, wearing a
different hat. `bun run sweep` replays whatever a crashed run left behind.

## What is in here

```
app/          the subject under test: 24 parts, 3 work orders, ~400 LOC, no build step
harness/      the tool: write guard, response capture, ledger, session
specs/        six specs, including the one that is deliberately INCONCLUSIVE
tools/        ab-verify.sh (the differential), verify-all.sh, sweep.ts, preflight.ts
auth/         real UI login, stored per origin
```

Two details worth pointing at, because both are consequences of the differential rather
than decoration:

- **Sessions are cached per origin**, with the port in the file name. Two apps are alive at
  once, and a single state file would carry one origin's session into the other.
- **Selectors avoid anything the fix introduced.** Every spec also has to run against the
  arm *without* the fix, where the new markup does not exist yet.

## Prior art, named honestly

**TDD's red-green** is the same instinct. The difference is durability: red-before-green is
something you saw once; this is a gate another machine can re-run after you have merged.

**`git bisect run`** is the closest mechanical relative, and in one way better — it finds
the commit for you. It does not stand two web servers up side by side, and it has no third
outcome: bisect assumes the test is a reliable oracle, which is exactly the assumption this
tool refuses to make.

**Mutation testing** (Stryker, PIT) is the honest comparison, and `INCONCLUSIVE` is
literally a *surviving mutant*. The difference is scope: mutation testing generates N
mutants automatically to measure the sensitivity of a whole suite; this has exactly one
mutant, chosen by hand — your fix, reverted — to measure the sensitivity of one spec.
Poorer in coverage, far cheaper, and it reaches somewhere Stryker does not: a real browser
in front of a real running app.

**Contract testing** (Pact) is where the double assertion comes from, moved from contract
time to render time.

## What this does not do

- It does not find bugs. It tells you whether the spec you already wrote is evidence.
- It does not make a flaky spec trustworthy. It reports the flake as `INCONCLUSIVE` and
  stops, which is the most it can honestly do.
- The guard sees what the **page** requests. A direct call from a spec through
  `APIRequestContext` does not pass through it, which is why `apiGet` is GET-only and why
  `tools/preflight.ts` exists.
- The read-shaped-`POST` list belongs to *your* API. The four patterns here are the ones
  this demo needs; a real legacy backend will need its own, and such a list is a config
  file that rots. Pointing the suite at a disposable instance is the better long-term
  answer, and the guard is what buys you the time to get there.
- Nothing here is agent-specific, CI-specific or framework-specific. It is Playwright, bash
  and git worktrees.

## License

MIT. See [LICENSE](LICENSE).
