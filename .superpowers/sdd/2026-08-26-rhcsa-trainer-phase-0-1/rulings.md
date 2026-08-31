# Pre-flight rulings — 62 findings

Scan slices: `preflight-1-14.md` (16), `preflight-15-22.md` (F1–F19),
`preflight-23-25-crosscut.md` (F1–F27). Two findings were reported twice by two
independent slices; they are ruled once here and cross-referenced.

Authority order used throughout: **spec > plan > my judgment**. Where a finding
is a factual error inside the plan (a wrong count, a wrong argv index, a missing
import), the ruling is simply "the plan is wrong, correct it" — there is nothing
to weigh. Only the entries marked **JUDGMENT** involved a real choice.

Plan file: `docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md`
Line numbers below are as of commit `6791d4d` and drift as edits land — locate
by the quoted text, not the number.

---

## A. Ruled ACCEPT-AS-DIAGNOSED (the plan is factually wrong; apply the fix)

### A1 — Tasks 1–14

| # | Finding | Amendment |
|---|---|---|
| S1-1 | T11's fixture handler `if/return` chain means `CORRECT='GROW\nPERSIST\n'` never sets `persisted`; the headline test fails (L2806–2833) | Replace the if/return chain in `world()`'s handler with three non-exclusive statements: `if (script.includes('GROW')) { state.grown = true; state.mounted = true }` / `if (script.includes('PERSIST')) { state.persisted = true }` / `if (script.includes('GROW') \|\| script.includes('PERSIST')) return { stdout: '', stderr: '', code: 0 }` |
| S1-2 | T11 pushes the inventory gate *before* the fixture loop, so `results[0]` is `fixture-inventory` in five tests and five `toMatch` assertions are unreachable (L3320–3321) | In `validateTask`, move the gate push to after the fixture loop: `for (const fixture of scripts.fixtures) results.push(await runFixture(task, scripts, fixture, deps))` then `if (!gate.ok) results.push(gate)` then `return results` |
| S1-3 | T11 uses `ExpectedFailure` without importing it → TS2304 (L3211 vs L3095) | `import { expectedStatus, parseExpectations, type ExpectedFailure } from './expectations.ts'` — the inline `type` is required by `verbatimModuleSyntax` |
| S1-4 | T1 Step 5 writes `src/_guard.ts` before any task creates `src/`; the erasable-syntax guard proves nothing and then tells the agent to raise an already-correct TypeScript version (L259–266) | Insert `mkdir -p src` before the `printf`, and `rmdir src 2>/dev/null \|\| true` after the `rm`. Keep the version-raise advice — it is now reachable for its real cause |
| S1-5 | T7 claims 8 new tests; 9 are written (L1878) | "9 new tests PASS" |
| S1-6 | T9 claims 14 new tests; 15 are written (L2423) | "15 new tests PASS" |
| S1-8 | File Structure summary calls the VM gate directory-based, contradicting T1's config and its own comment (L52; stale rationale at L293) | L52 → "`test/**/*.vm.test.ts` needs `RHCSA_VM=1`". Delete the stale one-sentence rationale at L293; keep the filename `test/fake-transport.test.ts` |
| S1-10 | T1 Step 2's red probe may install-and-pass, or block on npx's prompt (L168–169) | `npx --no vitest run`; drop the "will either error or prompt" hedge and state "exits non-zero because vitest is not installed locally yet" |
| S1-11 | T3 comment claims 11 problems; the fixture yields 12 (L601) | "at least 11 of the 12 problems this fixture contains" |
| S1-12 | T11's `@post`-without-reboot guard has a dead `\|\| d.phase === 'both'` disjunct (L3225–3235) | Drop the disjunct from the `some()`. Leave the `ids !== ''` guard (now redundant but harmless and defensive) |
| S1-13 | T14's spot-check uses `require()`, forbidden by the plan's own ESM-only constraint (L4026 vs L22) | Replace with `node --input-type=module -e "const l = JSON.parse(await (await import('node:fs/promises')).readFile('corpus/r9/labs.json','utf8')); console.log(l.find(i=>i.id==='Lab 15.1').text.slice(0,400))"` |
| S1-14 | T11's Interfaces block claims it consumes `ContentError` (T2); `harness.ts` never imports it (L2752) | Delete `ContentError (T2)` from the Consumes list |
| S1-16 | T11's duplicate-id check runs inside `checkVerdict`, so a `reboot_check: true` task reports the same duplicate twice (L3186–3189) | Hoist the `duplicateIds` check out of `checkVerdict` into `runFixture`, run it once against `result.verdictA` |

### A2 — Tasks 15–22

| # | Finding | Amendment |
|---|---|---|
| S2-F2 | `fs-home-size` compares `df -B1` bytes against exactly 12 GiB, which XFS can never report; both correct solutions fail, so T21's `6/6 fixtures ok` is unreachable. `within_pct` exists for this and is unused (L6407) | `elif within_pct "${fs_bytes:-0}" "$TARGET" 2 \|\| [[ ${fs_bytes:-0} -ge $TARGET ]]; then` |
| S2-F3 | `users/006` antisolution `01` has no `# expect-fail:` header, which `parseExpectations` treats as fatal — and it is in fact a *correct* answer (L7203–7222) | Move it to `solutions/03-primary-group-only.sh`. That directory becomes 3 solutions + 2 anti-solutions = still 6 fixtures, so the `18/18` arithmetic is unchanged. Update T22's file list and its `git add` line |
| S2-F4 | `new FakeTransport()` omits the required handler → `tsc --noEmit` fails (L5216) | `const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }))` |
| S2-F5 | The vmrun test asserts the guest script path at argv index 3, where the username sits; it is index 7 (L4619) | `expect(r.calls[0]?.at(-1)).toMatch(/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/)` |
| S2-F7 | `firewall-ssh` greps `--list-all` for `ssh`, so a correct `--add-port=22/tcp` answer fails — the over-fit spec §6.5 rule 1 forbids. Solution 02 hides it by adding *both* spellings, which also destroys its claimed independence (L7834–7836, L7863–7878) | Checkpoint body: `perm=$(sudo firewall-cmd --permanent --list-all 2>/dev/null)` then `grep -qw ssh <<<"$perm" \|\| grep -qw 22/tcp <<<"$perm"`. Delete `sudo firewall-cmd --permanent --add-service=ssh` from solution 02 so the two solutions are genuinely independent |
| S2-F8 | T20's escaping test is one backslash level off and fails as written (L5913 vs L5917) | Make the shell snippet contain one literal backslash — `'back\slash and<TAB>tab'` in the emitted shell — and leave the assertion `toContain('back\\slash')` alone |
| S2-F10 | T18 Step 6 claims 10 ssh tests; the suite has 9 (L5473) | "9 ssh tests" |
| S2-F12 | `-noWait=false`, `-activeWindow=false`, `-interactive=false` are not vmrun syntax; they are bare presence flags and blocking is already the default (L4622, L4896–4899, L5707, L5712, L5723) | Drop all three from the `runProgramInGuest` argv, from `provision.sh`'s three call sites, and drop the assertion at L4622 |
| S2-F13 | `nmcli -g FILENAME connection show "$conn"` is a list-mode field used in profile mode; if nmcli rejects it, `set -euo pipefail` aborts solution 02 for a reason the diagnosis table cannot explain (L7880) | `file=$(sudo nmcli -g NAME,FILENAME connection show \| awk -F: -v c="$conn" '$1==c{print $2; exit}')`. Add a one-line note that the profile-mode form takes `<setting>.<property>` and cannot return `FILENAME` |
| S2-F14 | T17's Files list omits `test/vm/config.test.ts`; its Interfaces list omits the exported `VmrunConfigSlice` that T18 must satisfy structurally | Add both |
| S2-F16 | T19 Step 4's stated guardrail message is wrong in the common case: with `.env.local` present the script stops earlier at the `RHCSA_GUEST_PASSWORD` check, whose message names neither file (L5781–5785, L5672) | Make the `RHCSA_GUEST_PASSWORD` message name `.env.local` explicitly, and state both outcomes in Step 4 |
| S2-F17 | Tree line 99 promises `sshArgs` in `src/engine/vm/config.ts`, "T23"; no task defines or imports it (T18 hardcodes its option list inline) | Delete the `sshArgs` annotation from the tree |
| S2-F18 | T18's Interfaces section claims it consumes `Runner` and `realRunner` from T17; `select.ts` imports neither (L5082) | Delete both from the Consumes list |
| S2-F19 | T20 says "Eight helpers" against 10 defined functions (L5858) and "~24 tests" against 26 `it(` blocks (L6206) | "Ten helpers" and "26 tests" |

### A3 — Tasks 23–25 and cross-cutting

| # | Finding | Amendment |
|---|---|---|
| S3-F4 | T25 asserts `phase === 'done'`, but `SessionPhase = 'active' \| 'graded'` (L11362) | `expect(done.phase).toBe('graded')` |
| S3-F5 | T24 Step 15 item 9 states the wrong baseline verdict. Hand-computed against T21's `setup.sh`: `lv-home-size` and `fs-home-size` fail, `home-from-lv` / `var-intact` / `persist-config` pass (L11152) | `3 / 5 passed` |
| S3-F7 / S2-F11 | T21's Files list names `test/cli/validate.test.ts`, which no step writes, and omits `src/engine/validate/run.ts` and `test/validate/run.test.ts`, which steps do write and the commit does add (L6272) | Replace the one path with the two real paths, and add both to the File Structure block |
| S3-F8 | `test/web/rail.test.tsx` has no DOM cleanup between tests: `@testing-library/react`'s auto-cleanup registers only when a global `afterEach` exists, which Vitest provides only under `globals: true`. First collision is `getByText('01:30 / 10:00')` in rail test 2 | Add `globals: true` to the `test` block of **both** copies of `vitest.config.ts` (Task 1's and Task 24's restatement) so the two never drift. Do **not** add `@testing-library/jest-dom`; if any web test uses `toBeInTheDocument`, rewrite it as `expect(el).toBeTruthy()` |
| S3-F9 | T23's Produces block describes `interface LabRuntime { transportKind; reset; runSetup; gradeTask }`; the implementation is `{ transportKind; reset; exec }`. T24 and T25 plan against this block (L8489 vs L9145–9155) | `interface LabRuntime { transportKind: TransportKind; reset(): Promise<void>; exec(script: string): Promise<ExecResult> }` |
| S3-F10 | T23's `dev:server` and its own Step 20 never load `.env.local`, so `loadVmConfig` throws `RHCSA_VMX is not set` (L10052, L10058) | Add `--env-file-if-exists=.env.local` to both |
| S3-F11 | `index.html` and `vite.config.ts` are marked "Modify" in T24, but no task creates them (L10135–10136) | Relabel both as "Create" |
| S3-F15 | `test:vm` runs `. ./.env.local` with no guard, so it hard-fails when the file is absent (L11220) | `[ -f .env.local ] && { set -a; . ./.env.local; set +a; }; RHCSA_VM=1 vitest run .vm.test.ts` |
| S3-F16 | Nested unfenced code blocks break two heredocs: T25's README heredoc and T21's concept card each contain a ``` fence inside a ``` block | Fence both outer blocks with six backticks |
| S3-F19 / S2-F15 | `scripts/guest-provision.sh` is created by T19 and copied into the guest, but is missing from the File Structure block (created L5536, used L5722; tree lists only `scripts/provision.sh`) | Add it to the tree with a one-line description: "runs *inside* the guest; everything `provision.sh` cannot do over vmrun" |
| S3-F20 | `exclude: []` in VM mode discards Vitest's defaults, so `node_modules` gets scanned (L10163/10166) | `exclude: process.env.RHCSA_VM === '1' ? ['**/node_modules/**', '**/dist/**'] : ['**/node_modules/**', '**/dist/**', 'test/**/*.vm.test.ts']` — in both copies of the config |
| S3-F21 | `node-pty` appears in T23's dependency install line and in the plan's Tech Stack, though Global Constraints and spec §6.2 rule it out (no C compiler, no sudo) | Delete `node-pty` from the Tech Stack line. In T23 Step 1, delete `npm install node-pty \|\| echo "NODE_PTY_UNAVAILABLE"` and the "record which one applies" fork; keep only `spawnSshPipe` and keep the paragraph explaining why a fixed-size terminal is the right Phase 1 answer. Delete `spawnSshPty` and the `PtyLike` *dual* framing is retained only if `PtyLike` still has one implementation — keep the interface (T25 and the tests reference it), drop the second implementation |
| S3-F24 | Verdict B can race sshd: T25 waits on vmrun guest-tools readiness after reboot, not on sshd accepting connections, so the first `exec` can 500 (L11340–11380) | After the guest-tools wait, poll `runtime.exec('true')` until it resolves with `code === 0`, up to 30 attempts, 2 s apart, and fail with a message naming sshd if it never does |
| S3-F25 | T19 attaches two spare disks; T3's comment says one (L802) | Correct the T3 comment to two |

### A4 — the two findings both scans reported

| # | Finding | Amendment |
|---|---|---|
| **S2-F1 / S3-F1** | **`countCheckpoints` cannot see T21's checkpoints, so `checkpointTotal` is 0 where T23 and T25 both assert 5.** The regex matches a bare `ck ` call only; T21's real grader emits exclusively through `ck_pass`/`ck_fail`, at **12 call sites covering 5 ids**. T23's own unit fixture uses bare `ck`, so the unit test passes and nothing catches it (L8994–8998, consumed L10074 and L11321) | See **§C1** — the regex change alone is insufficient; the counting rule itself has to be restated |
| **S2-F6 / S3-F2** | **Nothing in the plan grants passwordless `sudo`, yet every guest-side script depends on it.** Global Constraints claim "the transports already run as root inside the VM"; T15 declines root SSH and only adds `student` to `wheel`; `SshTransport` uses `BatchMode=yes`; `VmrunTransport` uses `-gu student`. With RHEL 9's default `%wheel ALL=(ALL) ALL` and no TTY, every `sudo` prompts, and because the script arrives on ssh's stdin the prompt eats the rest of the script. **Correct student work grades as failure on every task in the bank, and Tasks 19–22 cannot pass a single fixture.** | See **§C2** |

---

## B. Ruled with a JUDGMENT call

### B1 — S1-7 (MEDIUM): T2's second test promises defaulting that nothing implements

**Ruling: option (a). Rename the test to "returns the handler's result unchanged" and leave `FakeHandler` alone.**

Why: the test's *name* is the only thing that is wrong. Widening `FakeHandler` to
`Partial<ExecResult>` would change a published type that T8 and T11 build their
handlers against, to buy a convenience no task asked for. A fake that forces you
to state all three fields is also the better fake — an omitted `code` is exactly
the kind of accident a transport test should not paper over.

Cost if wrong: authors of later fakes type three fields instead of one.

### B2 — S1-9 (LOW): `engines.node` says `>=22.18.0`, the constraint says 22.23.2

**Ruling: keep `">=22.18.0"` and add the rationale to the plan.**

Why: 22.18.0 is where type stripping became on-by-default, which is the actual
floor this project's *code* requires. 22.23.2 is what happens to be installed.
An `engines` field should state the real requirement.

Amendment: after the `package.json` block, add one line — "`engines.node` is
`>=22.18.0`, not the installed 22.23.2: 22.18.0 is where `--experimental-strip-types`
became the default, which is the real floor. Do not raise it to match the
Global Constraint."

Cost if wrong: someone runs the project on 22.18–22.23 and hits a Node bug the
plan did not anticipate.

### B3 — S1-15 (LOW): T11 contains a duplicated test

**Ruling: keep it, make it distinguishing.**

Why: deleting it loses a name that documents an invariant worth naming
("an invariant checkpoint passes at baseline"). Change its body to assert
`var-from-lv` is `pass` in verdict A *while* `lv-var-size` is `fail`, which the
first test does not assert. Stated count stays 13.

Cost if wrong: one test costs a few hundred milliseconds.

### B4 — S2-F9 (MEDIUM): T22 Step 8's id cross-check false-fires on T21's task

Same root cause as S2-F1. **Ruling: apply the same regex, and make the step's
stated expectation match.**

Amendment: `grep -oE '^[[:space:]]*ck(_pass|_fail|_skip)? [a-z0-9][a-z0-9-]*'`
piped through `awk '{print $NF}' | sort -u`. Keep the stated expectation of "no
`UNDECLARED-ID` lines" — it becomes true.

### B5 — S3-F3 (CRITICAL): tsconfig never gains web settings, so `npm run typecheck` cannot pass after T24

**Ruling: accept, and put the tsconfig edit in T24 rather than T1.**

Why: T1's tsconfig is correct for T1 — a DOM lib and a `jsx` factory in a
project with no `.tsx` files would be noise, and `"types": ["vite/client"]`
would fail before vite is installed. T24 is the task that makes the settings
true, so T24 is the task that adds them.

Amendment: add `tsconfig.json` to T24's **Modify** list, and add a step (before
the first `.tsx` file is written) that sets `"jsx": "react-jsx"`,
`"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"types": ["node", "vite/client"]`.
`vite/client` is what declares `*.css` imports, so no separate ambient
declaration for `./index.css` is needed — state that in the step so nobody adds one.

Cost if wrong: `npm run typecheck` fails at T24 Step 14 instead of passing, and
the implementer discovers this in one command.

### B6 — S3-F6 (HIGH): T24's dependencies are not all installed, and it claims Task 1 installed them

**Ruling: accept, narrowed.** T24 Step 1 already installs `react`, `react-dom`,
`@xterm/xterm`, `@vitejs/plugin-react`, `@tailwindcss/vite`, the `@types`, and
`jsdom`. What is genuinely missing is **`vite` and `tailwindcss` themselves**,
and the claim that Task 1 installed them is false.

Amendment: add `vite tailwindcss` to the devDependency install line; replace the
paragraph "Task 1 already installed `vite`, `tailwindcss` and their config" with
"Task 1 installed none of this — it scaffolded the Node side only. Installing a
dependency twice is harmless, so run the whole line even if some of it is
already present." Do not add `@testing-library/jest-dom` (see S3-F8).

Cost if wrong: nothing; a redundant install is a no-op.

### B7 — S3-F12 (HIGH): T25 promises an `e2e` script it never defines

**Ruling: delete the promise, do not add the script.**

Why: the e2e test *is* `test/vm/e2e-exit-criterion.vm.test.ts` and is already
run by `test:vm`. A second script that runs the same file under a different
gate is two ways to do one thing, and the one that omits `RHCSA_VM=1` would
silently match nothing.

Amendment: remove `e2e` from T25's Files note and list `test:vm` and `coverage`
there instead.

Cost if wrong: the user types `npm run test:vm` instead of `npm run e2e`.

### B8 — S3-F13 (MODERATE): `dev:server` silently loses `--watch`

**Ruling: REJECTED. Dropping `--watch` is correct; make it deliberate and say why.**

Why: `node --watch` restarts the process on any file change. This server holds
the session store in memory and owns a WebSocket-attached `ssh -tt` pipe to the
guest. A restart mid-lab drops the terminal and loses the session — during a
timed practice attempt, that is worse than any edit-reload convenience it buys.
Losing `--watch` was the right change made for the wrong reason (a rewrite),
so the ruling is to keep it lost and record the rationale.

Amendment: drop `--watch` from T23's `dev:server` too, and add one line to T25's
script block: "No `--watch`: a restart drops the WebSocket terminal and the
in-memory session store mid-lab. Restart the server by hand."

Cost if wrong: the developer restarts the server manually after editing
server-side code.

### B9 — S3-F14 (MODERATE): `TerminalPane` writes to a disposed terminal on unmount

**Ruling: accept, with the smaller of the two proposed fixes.**

Amendment: in the effect's cleanup, `ws.onclose = null` **before** `ws.close()`,
then `term.dispose()`. A `disposed` boolean would work too but adds state to
reason about; nulling the handler removes the callback that would fire.

Cost if wrong: a console error on unmount, which is what we are fixing.

### B10 — S3-F17 (MODERATE): `.env.local` is in the File Structure block but no task creates it

**Ruling: Task 19 creates it if missing; Task 16's checklist tells the user which
two values only they can supply.**

Why: T1 cannot create it usefully — every value in it is either discovered by
provisioning (`RHCSA_VM_IP`) or known only to the user (`RHCSA_VMX`,
`RHCSA_GUEST_PASSWORD`). T19 is the first task that has a real value to write.

Amendment: T19 Step 1 creates `.env.local` from a commented template if absent
(every key present, only the discovered ones filled), and T16's checklist gains
a line: "before running `provision.sh`, put `RHCSA_VMX` and
`RHCSA_GUEST_PASSWORD` in `.env.local` at the repo root. Nothing else in this
project needs credentials, and your Red Hat account password must not go in
any file in this repo."

Cost if wrong: the user creates the file by hand from the README table.

### B11 — S3-F18 (MODERATE): `explanation.md` and spec §7.1 post-attempt teaching are orphaned

**Ruling: drop `explanation.md` from the File Structure block; record the
deferral as a stated Phase-2 limit.**

Why: spec §7.1's teaching duty is discharged in Phase 1 by the rung-3 concept
cards, which the exit criterion asserts on directly (`length > 1500`, must
mention `physical volume` and `xfs_growfs`). A separate authored post-mortem per
task is a second content surface with no consumer, no loader field and no UI —
building it now is the definition of YAGNI, and leaving a filename in the tree
that nothing writes is worse than either.

Cost if wrong: after a failed attempt the user reads the concept card again
instead of a purpose-written post-mortem. Phase 2 adds it with a loader field
and a `SessionView` slot.

### B12 — S3-F22 (MODERATE): no task defines the exam duration / passing score

**Ruling: accept — one small module, owned by Task 9.**

Why: spec §16 lists these as Phase 0 deliverables and §13.2 consumes them, and
the scan is right that no task owns them. T9 is the only mode-aware module in
Phase 1 (it already encodes the per-mode rung caps), so the constants live
beside it. The values are still an open Phase-0 blocker for the user to confirm,
so they are marked as such in the source, in one place, behind named exports.

Amendment: T9 creates `src/engine/exam/limits.ts`:

```ts
/**
 * EX200 exam parameters. UNCONFIRMED — Phase 0 blocker: verify against the
 * current Red Hat exam objectives page before Phase 2 builds exam mode.
 * Nothing in Phase 1 enforces these; they exist so there is exactly one
 * place to correct.
 */
export const EXAM_DURATION_MINUTES = 150
export const EXAM_TOTAL_SCORE = 300
export const EXAM_PASSING_SCORE = 210
```

plus one test asserting `EXAM_PASSING_SCORE / EXAM_TOTAL_SCORE === 0.7` — which
is the invariant worth pinning, because it is the ratio that survives if Red Hat
rescales the exam. Add the file to T9's Files list, the tree, and its `git add`.
Raise T9's stated count from 15 to 16.

Cost if wrong: two numbers are wrong in a file nothing reads yet, and the
comment says so.

### B13 — S3-F23 (MODERATE): Phase 1's `reset` control has no route and no button

**Ruling: accept. `LabRuntime.reset` exists and spec §16 P1 lists the control as
a deliverable; an unreachable capability is not a delivered one.**

Amendment: T23 adds `POST /api/session/:id/reset`, which calls
`runtime.reset()`, re-runs the task's `setup.sh`, and returns the session
unchanged apart from a fresh `startedAt`. It does **not** reset the rung: the
disclosure you have already spent is spent, or resetting becomes a way to
launder hints. T24's `Rail` gains a Reset button that confirms first ("this
reverts the VM and restarts the timer") and shows `reverting…` while in flight,
reusing the `busy`/`starting` pattern already in `TaskPicker`.

Cost if wrong: one route and one button of scope. Cheaper than the alternative,
which is the user power-cycling a VM by hand mid-lab.

### B14 — S3-F26 (LOW): spec §11 rule 1 (VM state visible) has no implementation

**Ruling: defer to Phase 2, explicitly, and say what Phase 1 does instead.**

Why: the rail already shows `transport: ssh | vmrun`, which answers the question
the rule exists to answer — *can the app reach the VM right now* — for every
failure mode the user can act on. A full power-state indicator needs a vmrun
poll loop and a push channel, which is Phase 2 work.

Amendment: add to T25's `docs/exit-criterion.md` stated limits: "The UI shows
which transport is live, not the VM's power state. Spec §11 rule 1 is only
partly met; a polled state indicator is Phase 2."

Cost if wrong: on a suspended VM the user sees a failed request instead of a
greyed-out indicator.

### B15 — S3-F27 (LOW): `task.yaml`'s `weight` is parsed but never consumed

**Ruling: keep the field, record the deferral.** Removing it from the schema now
would force a content migration in Phase 2 for five already-authored tasks.
Add to T25's stated limits: "`weight` is authored and validated but no selection
logic reads it — spec §14.4 scheduling is Phase 2."

---

## C. The two architectural amendments

### C1 — `countCheckpoints` (S2-F1 / S3-F1)

Two things are wrong and both must be fixed, because either alone still gives a
wrong total for T21's grader: the **regex** misses the suffixed emitters, and the
**rule** ("one `ck` call site per checkpoint") is false for any grader that emits
a given id from more than one branch.

Replace the comment and constant in `src/server/session.ts`:

```ts
/**
 * Every checkpoint id a grader can emit, found without running it. Graders emit
 * through `ck`, `ck_pass`, `ck_fail` or `ck_skip`, and a single checkpoint is
 * routinely emitted from several branches of an if/else — so this counts
 * distinct ids, not call sites. Task 22's authoring rule is what makes it
 * possible: every id is a literal, never a variable.
 */
const CK_CALL = /^[ \t]*ck(?:_pass|_fail|_skip)?[ \t]+["']?([a-z0-9][a-z0-9-]*)/gm

export function countCheckpoints(gradeScript: string): number {
  return new Set([...gradeScript.matchAll(CK_CALL)].map(m => m[1])).size
}
```

Two further edits follow from it:

1. **T23's unit test is complicit.** Its fixture uses bare `ck`, so it passes
   against the broken regex. Add a second fixture in the same test, in T21's
   real style — one id emitted from both an `if` and an `else` branch — and
   assert the count is the number of *ids*, not branches. The existing
   `toBe(2)` assertion still holds and stays.
2. **T22's authoring rule is misstated.** "The count of `ck` call sites is the
   masked total" becomes "every checkpoint id is written as a literal in the
   grader — never a variable, never interpolated — so the masked total can be
   derived without running anything. Emitting one id from several branches is
   normal and does not change the total."

### C2 — passwordless `sudo` in the guest (S2-F6 / S3-F2)

This is the only finding that would have shipped a system where **correct work
grades as failure**, and it is load-bearing for Tasks 19 through 25.

**Ruling: grant `student` passwordless sudo in the guest, install it from
`guest-provision.sh`, validate it before trusting it, and correct the Global
Constraint that claims the problem does not exist.**

Why this and not the alternatives: enabling root SSH (rejected in T15 for good
reason) widens the attack surface of a VM that will hold no secrets but sits on
the host network; teaching every grader to authenticate `sudo` over stdin is
impossible, because the script *is* stdin. A NOPASSWD drop-in for one
unprivileged account in a disposable local lab VM is the standard arrangement,
and it is also what the real exam gives you — on the RHCSA you get the root
password, not a sudo prompt to fight.

**C2.1 — Global Constraints.** Replace:

> Guest-side root is fine: the transports already run as root inside the VM.

with:

> Guest-side root is fine, but it is *arranged*, not free: both transports
> connect as `student`, and `guest-provision.sh` installs
> `/etc/sudoers.d/rhcsa-trainer` granting `student` passwordless `sudo`. Every
> guest-side script — `setup.sh`, `grade.sh`, solutions, anti-solutions —
> therefore calls `sudo` explicitly and non-interactively. A guest-side script
> that assumes it is already root is a bug.

**C2.2 — `guest-provision.sh`** gains this as its first step, before anything
that needs privilege:

```bash
# Everything after this point — and every grader, setup script and solution the
# app will ever run — reaches root through sudo with no TTY to answer a prompt.
# RHEL 9's default %wheel rule asks for a password, and because our scripts
# arrive on ssh's stdin, sudo's prompt would eat the rest of the script and the
# failure would look like a broken grader. So: install the rule, validate it,
# and prove it works before continuing.
printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
sudo visudo -cf /etc/sudoers.d/rhcsa-trainer   # a malformed drop-in can lock out sudo entirely
sudo -n true || { echo "FATAL: passwordless sudo is not in effect for student" >&2; exit 1; }
```

The bootstrap sequencing is the one subtlety: this script's *own* `sudo` calls
still need a password the first time. It runs from the interactive console
session in T15's checklist, where a password prompt is answerable — so T15's
checklist gains the step "run `guest-provision.sh` from the VM console, not over
ssh; it will ask for `student`'s password once and never again."

**C2.3 — T18's `SshTransport`** keeps `BatchMode=yes`. That is now correct rather
than accidentally correct, and it should stay: with NOPASSWD in place, any
password prompt means the drop-in is missing, and `BatchMode` turns that into a
fast clean failure instead of a hang.

**C2.4 — T19 acceptance** gains one line: after provisioning, `ssh
student@$RHCSA_VM_IP -o BatchMode=yes sudo -n id -u` must print `0`. If it
prints anything else, stop — no grader in the bank will work until it does.

Cost if wrong: a lab VM where one unprivileged account can become root without
a password. The VM is local, disposable, holds no credentials, and is reverted
to a snapshot between labs.

---

## D. Consequences for the run

- **Task 9** grows one file and one test (B12): 15 → 16 tests.
- **Task 19** grows the sudoers step and the `.env.local` template (C2.2, B10).
- **Task 15** checklist grows two lines (C2.2 bootstrap, B10 credentials).
- **Task 23** grows the reset route (B13) and a second `countCheckpoints`
  fixture (C1).
- **Task 24** grows the tsconfig step (B5), `vite`/`tailwindcss` (B6) and the
  Reset button (B13).
- **Task 25**'s stated Phase-2 limits grow three entries (B11, B14, B15).
- No task is added, removed, split or reordered. The 25-task sequence stands.

---

## E. Follow-up rulings raised while applying the amendments

The agent applying sections A–D found that two of my rulings were themselves
wrong, and reported three deviations. Ruled here; all five applied.

### E1 — S3-F25's premise was false in both directions. Re-ruled.

The scan said "T19 attaches two spare disks; T3's comment says one." Neither is
what the plan says. The truth: spec §4.1's VM design has **three** spare disk
slots, `MAX_SPARE_DISKS = 3` is derived from it, and Task 19 deliberately
attaches **zero** in Phase 1 — with a good reason already written down ("a spare
disk with stale partition tables makes later exercises non-deterministic; Phase 2
adds them with `vmware-vdiskmanager` when a task needs one"). Applying the scan's
fix literally produced a worse sentence than the one it replaced.

**Ruling: keep the cap at 3 and stop the prose claiming disks are attached.**
`MAX_SPARE_DISKS` is a schema bound taken from the spec's VM design, not a
statement about the running VM — a task declaring `requires_disks: 2` is
well-formed content that Phase 1 simply cannot host, and that is the correct
distinction for a *loader* to draw. Do not tighten the cap to 0: that would
reject valid Phase 2 content at parse time and would force edits to T3's test
and five fixtures to buy nothing.

Corrected all three sites to say the bound comes from the spec's VM design and
that Phase 1 attaches none: T3's `MAX_SPARE_DISKS` doc comment, T3's test
comment, and T3's commit message body.

Cost if wrong: a Phase 2 task could declare a disk the VM lacks and fail at
runtime rather than at validation. Task 19's provisioning is where that belongs.

### E2 — S3-F9 deleted a method that exists and is called. Re-ruled.

My ruling rewrote T23's Produces block as
`interface LabRuntime { transportKind; reset; exec }`. The real interface has a
fourth member, `gradeTask(task, gradeScript): Promise<GradeResult>`, and `app.ts`
calls it. I took the scan's list of what was wrong as a complete list of what was
there. Only two of its three claims were right: `runSetup` never existed, and
`exec` was undocumented — but `gradeTask` was never spurious.

**Ruling: restore `gradeTask` to the Produces block with its full signature.**
The Produces block exists so T24's and T25's implementers can plan against an
interface they cannot see; a block that omits the method doing the actual grading
is worse than the one that named a method that did not exist.

Cost if wrong: none. This is a correction to a correction.

### E3 — `/api/sessions/:id/reset`, plural. Accepted as applied.

B13's amendment wrote the route singular. The agent made it plural to match all
five sibling routes and flagged the deviation. It is right: consistency across
the route table beats the wording of my prose, and a lone singular route is the
kind of detail that costs someone twenty minutes later.

### E4 — `#require` is a private method, not CommonJS. No change.

Four `require(` hits survive the ESM-only sweep, all of them `#require(` — a
private class method of `SessionStore`. The Global Constraint forbids CommonJS
`require`, not the word. Left alone.

### E5 — S3-F24's sshd race also affects verdict B's reboot. Accepted, scope extended.

My amendment guarded the post-reboot wait in `beforeAll`. The agent found
`guestUp()` polls guest tools via vmrun in `controller.reboot` as well, so
verdict B's reboot has the identical unguarded race — the grading path, which is
worse than the setup path, because a 500 there reads as a persistence failure.
Guarding both is the same fix applied twice; accepted.
