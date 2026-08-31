# Pre-flight consistency scan — Tasks 23-25 + whole-plan cross-cuts

Plan: `docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md` (11,653 lines, 25 tasks)
Spec: `docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md` (1,054 lines)
Scope: Tasks 23, 24, 25 read in full (plan 8460-11653) plus header/Global Constraints/File Structure (1-105). Tasks 1-22 grepped for symbol existence only.
All line numbers are plan lines unless prefixed `spec`.

---

## Table A — Tasks 23-25 interface pairs

| Tasks | Produced | Consumed | Finding |
|---|---|---|---|
| T4 → T23 | `loadVmConfig(env): VmConfig` @ 4790-4805, `VmConfig { vmx, sshHost, sshUser, sshKey, snapshot }` | `src/engine/vm/config.ts` imported @ 9160 | OK — path and named export match. But T23 Files list (8470-8483) does not declare `src/engine/vm/config.ts`, and the file is only *read*, so no conflict. See F7 (Files-list omission is T23's own, benign here). |
| T4 → T23 | `sshUser: env.RHCSA_SSH_USER ?? 'student'` @ 4798 | every grader's `sudo` @ 6150, 7145, and 3 more graders | **BLOCKING — F2.** No task ever installs a NOPASSWD sudoers rule for `student`. |
| T5 → T23 | `spawnSshPipe(cfg, opts): PtyLike` @ ~1140-1180 region / `src/engine/vm/ssh.ts` | imported @ 10420 by `src/server/terminal.ts` | OK — name, path, return type `PtyLike` all match; `onData`/`onExit`/`write`/`resize`/`kill` surface used by T24's bridge is present. |
| T5 → T23 | `PtyLike` interface | `terminal.ts` @ 10430-10505 | OK. |
| T7 → T23 | `SshTransport`, `chooseTransport(cfg)` | `src/server/lab.ts` @ 9160-9210 | OK. |
| T9 → T23 | `deriveRating({ rungUsed, allPassed, mode }): Rating` | T23 session `grade` @ 9100-9130; T25 e2e @ 11340-11365 | OK — hand-traced both call sites against T9's table: T23 (`rungUsed 1`, partial) → `'hard'` ✓; T25 (`rungUsed 3`, full pass) → `'hard'` ✓. |
| T10 → T23 | `capForMode(mode): number` (practice 5, drill 3, exam 2) | `src/server/session.ts` reveal route @ 9050-9070 | OK. |
| T12 → T23 | `parseJsonl(s): Checkpoint[]`, `Checkpoint { id, status, desc, detail? }` | `session.ts` @ 9080-9095 | OK. |
| T13 → T23 | `commandSketch(solution: string): string[]` | T23 rung-4 payload @ 9060 | OK — hand-traced the algorithm against all three T13 fixtures; every expectation is exactly right. |
| T15 → T23 | `loadTask(dir): TaskDef`, `TaskDef { id, title, mode?, solution, grade, setup }` | `src/server/content.ts` @ 8600-8680 | OK. |
| T20 → T23 | `content/lib/assert.sh` emitters `ck` / `ck_pass` / `ck_fail` / `ck_skip` @ 6088-6098 | `countCheckpoints` regex `/^[ \t]*ck[ \t]+[a-z0-9][a-z0-9-]*/gm` @ 8994-8998 | **BLOCKING — F1.** Regex matches only bare `ck `. T21's grade.sh uses only `ck_pass`/`ck_fail`. |
| T21 → T23/T25 | `content/tasks/storage/014-grow-home-lv/{task.yaml,setup.sh,grade.sh,solution.sh}` @ 6300-6460 | T23 acceptance @ 10070-10080; T25 e2e @ 11300-11380 | Content exists. Derived total is wrong (F1) and the baseline pass count is wrong (F5). |
| T21 → T25 | `validateBank(opts): Promise<ValidateSummary>` @ 6653 in `src/engine/validate/run.ts` | `npm run validate` → `src/cli/index.ts` @ 6794 | OK — name/path/shape match. T21's Files list omits both files (F7). |
| T23 → T24 | `GET /api/session/:id`, `POST /api/session`, `POST /api/session/:id/reveal`, `POST /api/session/:id/grade` @ 8900-9130 | `src/web/api.ts` @ 10600-10700 | OK — all four paths, methods and bodies agree. |
| T23 → T24 | `SessionView { id, phase, rungUsed, checkpointTotal, elapsedMs, limitMs, ... }` @ 8960-8990 | `Rail.tsx` @ 10800-10950 | OK on field names. `phase` value set is the problem — see F4. |
| T23 → T24 | `SessionPhase = 'active' \| 'graded'` @ 8978 | T25 e2e `expect(done.phase).toBe('done')` @ 11362 | **BLOCKING — F4.** `'done'` is not in the union; assertion can never pass. |
| T23 → T24 | Interfaces block: `interface LabRuntime { transportKind; reset; runSetup; gradeTask }` @ 8489 | actual @ 9145-9155: `{ transportKind; reset; exec(script): Promise<ExecResult> }` | **F9.** Produces-block names three members that do not exist; `exec` is undocumented. |
| T23 → T24 | WS endpoint `/ws/terminal?cols=&rows=` @ 10440 | `TerminalPane.tsx` @ 10980-11060 builds that URL; `vite.config.ts` proxy `/ws` → `ws://localhost:5175`, `ws: true` @ 11086-11104 | OK — the dev proxy routes it. Port 5175 matches the server's default @ 10030. |
| T24 → T25 | `src/web/{main.tsx,App.tsx,components/Rail.tsx,components/TerminalPane.tsx,api.ts}` | T25 e2e imports `api.ts` helpers @ 11310 | OK. |
| T1 → T24 | `tsconfig.json` @ 201-223 | `npx tsc --noEmit` over `src/web/**` @ 11120 | **BLOCKING — F3.** No `jsx`, no `"DOM"` in `lib`, no `vite/client` types, no CSS-module declaration. T24 never edits tsconfig. |
| T1 → T24 | devDeps installed @ 240-260 | `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@xterm/xterm`, `jsdom`, `@testing-library/react` | **F6.** Line 10152 asserts T1 already installed vite+tailwind; it did not. No task runs the install. |
| T1 → T24 | `vitest.config.ts` @ 265-280 | full replacement @ 10156-10171 | Every earlier setting preserved (see Table D). Missing `globals: true` → F5b/F8. |

---

## Table B — Tasks 23-25 internal consistency

| Task | Files declared vs touched | Tests vs code | Finding |
|---|---|---|---|
| **T23** (8460-10116) | Declared @ 8470-8483: creates `src/server/{index,app,session,content,lab,terminal}.ts`, `test/server/{content,session,app,terminal}.test.ts`; modifies `package.json`. Touched: all of those **plus** reads `src/engine/vm/config.ts` and `src/engine/vm/ssh.ts` (imports only, no edit) — declaration is adequate. `package.json` modification @ 10052 adds `dev:server` only. | Stated counts vs actual `it(` blocks: content.test.ts **8/8** ✓; session.test.ts **13/13** ✓; app.test.ts **13/13** ✓; terminal.test.ts **6/6** ✓. | Counts all correct. Three real defects: **F1** (`countCheckpoints` blind to `ck_pass`), **F9** (`LabRuntime` Produces block wrong), **F10** (`dev:server` @ 10052 and the acceptance command @ 10058 both omit `--env-file-if-exists=.env.local`, so `loadVmConfig` throws "RHCSA_VMX is not set"). Also **F13**: `--watch` present in `dev:server` but T25 redefines it without `--watch` (Table D). |
| **T24** (10117-11188) | Declared @ 10125-10140: creates `src/web/{main.tsx,App.tsx,api.ts,index.css}`, `src/web/components/{Rail.tsx,TerminalPane.tsx}`, `test/web/rail.test.tsx`; **modifies** `index.html`, `vite.config.ts`, `vitest.config.ts`, `package.json`. Touched: all of those. | rail.test.tsx stated 10, actual `it(` blocks **10/10** ✓. | **F3** (tsconfig never given `jsx`/DOM/CSS types, yet Step 14 @ 11120 runs `tsc --noEmit` — cannot pass). **F6** (vite/tailwind/xterm/jsdom/RTL never installed; 10152 falsely credits T1). **F8** (no RTL cleanup: no `import '@testing-library/react'` auto-cleanup path because `globals: true` is absent from the vitest config @ 10156-10171 — RTL registers `afterEach` only when a global `afterEach` exists; first collision is `getByText('01:30 / 10:00')` in rail test 2, which then throws "found multiple elements"). **F5** (Step 15 item 9 @ 11152 expects `0 / 5 passed`; storage/014's baseline is 2 fail + 3 pass = **3 / 5**). **F11** (`index.html` and `vite.config.ts` marked "Modify" but no earlier task creates them — agent must guess whether to create). **F14** (`TerminalPane` `ws.onclose` writes `\r\n[disconnected]` to the terminal after the cleanup path may already have called `term.dispose()`; double-dispose/write-after-dispose on unmount). |
| **T25** (11189-11653) | Declared @ 11195-11210: creates `test/e2e/lab.e2e.test.ts`, `README.md`; modifies `package.json`. Touched: those. | e2e stated as 1 flow; code is 1 `it(` ✓. | **F4** (`expect(done.phase).toBe('done')` @ 11362 vs union `'active' \| 'graded'` @ 8978, assignment @ 9123). **F12** (Files list @ 11202 promises an `e2e` script; the scripts block @ 11212-11226 never defines one — and defines `test:vm` and `coverage`, which the Files list does not mention). **F1** again: exit criterion @ 11321 asserts `checkpointTotal === 5`. **F15** (`test:vm` @ 11220 begins `set -a; . ./.env.local` with no existence guard — hard-fails on a fresh clone). **F16** (nested unfenced ``` inside T25's README heredoc @ 11480-11560 and inside T21's concept card @ 6480-6520 breaks the outer fence for a copy-pasting agent). |

---

## Table C — File Structure block (46-105) vs tasks

| File / dir in block | Created by | Finding |
|---|---|---|
| `package.json` | T1 (240) | OK; modified T23, T25 |
| `tsconfig.json` | T1 (201) | OK — but never gains web settings (F3) |
| `vitest.config.ts` | T1 (265) | OK; replaced T24 |
| `.gitignore` | T1 (232) | OK; appended T19, T24 |
| `.env.local` | — | **F17.** In the block @ 68 but no task creates it; T19 *writes into* it (11540) assuming it exists. Unowned. |
| `vite.config.ts` | — | **F11.** In the block @ 70; T24 says "Modify" (10136). No creator. |
| `index.html` | — | **F11.** Same. Block @ 71; T24 "Modify" (10135). |
| `README.md` | T25 (11197) | Block @ 105. OK. |
| `src/cli/index.ts` | T3 (520) | OK; modified T21 (6794) |
| `src/engine/vm/config.ts` | T4 | OK |
| `src/engine/vm/ssh.ts` | T5 | OK |
| `src/engine/vm/vmrun.ts` | T6 | OK |
| `src/engine/lab/transport.ts` | T7 | OK |
| `src/engine/lab/fake.ts` | T7 | OK |
| `src/engine/sched/fsrs.ts` | T8 | OK |
| `src/engine/sched/rating.ts` | T9 | OK |
| `src/engine/disclose/ladder.ts` | T10 | OK |
| `src/engine/disclose/sketch.ts` | T13 | OK |
| `src/engine/grade/jsonl.ts` | T12 | OK |
| `src/engine/content/task.ts` | T15 | OK |
| `src/engine/content/concept.ts` | T16 | OK |
| `src/engine/store/*.ts` | T11 | OK |
| `src/server/index.ts` | T23 | OK |
| `src/server/app.ts` | T23 | OK |
| `src/server/session.ts` | T23 | OK |
| `src/server/content.ts` | T23 | OK |
| `src/server/lab.ts` | T23 | OK |
| `src/server/terminal.ts` | T23 | OK |
| `src/web/main.tsx` | T24 | OK |
| `src/web/App.tsx` | T24 | OK |
| `src/web/api.ts` | T24 | OK |
| `src/web/index.css` | T24 | OK |
| `src/web/components/Rail.tsx` | T24 | OK |
| `src/web/components/TerminalPane.tsx` | T24 | OK |
| `scripts/r1-probe.sh` | T18 | OK |
| `scripts/provision.sh` | T19 (5535) | OK |
| `content/lib/assert.sh` | T20 (6088) | OK |
| `content/tasks/<domain>/<id>/task.yaml` | T15 fixture, T21 real | OK |
| `content/tasks/<domain>/<id>/setup.sh` | T21 | OK |
| `content/tasks/<domain>/<id>/grade.sh` | T21 | OK |
| `content/tasks/<domain>/<id>/solution.sh` | T21 | OK |
| `content/tasks/<domain>/<id>/explanation.md` | **nobody** | **F18.** Listed @ 75. No task creates it; `loadTask` (T15) does not read it; spec §7.1 post-attempt teaching depends on it. Either a phantom file or a missing deliverable. |
| `content/concepts/<id>.md` | T16 fixture, T21 real | OK |
| `test/**` | various | OK |

**Created by a task but absent from the File Structure block:**

| File | Task | Finding |
|---|---|---|
| `scripts/guest-provision.sh` | T19 (5536) | **F19.** Real, executable, copied into the guest @ 5722. Block omits it. |
| `src/engine/validate/run.ts` | T21 (6628) | **F7.** Not in block; also not in T21's own Files list (6270-6275), only in its `git add` @ 6995. |
| `test/validate/run.test.ts` | T21 (6680) | **F7.** Same. |
| `test/e2e/lab.e2e.test.ts` | T25 (11196) | Block has generic `test/**`; acceptable. |
| `test/web/rail.test.tsx` | T24 | Covered by `test/**`. |

---

## Table D — config overwrite chain

### `tsconfig.json`
| # | Task | Line | Mode | Settings |
|---|---|---|---|---|
| 1 | T1 | 201-223 | create | `target ES2023`, `module/moduleResolution NodeNext`, `lib:["ES2023"]`, `types:["node"]`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes:false`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`, `skipLibCheck`, `include:["src","test","scripts"]` |

Only one version exists. **Nothing is dropped, but nothing is added either** — no `jsx`, no `"DOM"`/`"DOM.Iterable"` in `lib`, no `"vite/client"` in `types`, no `*.css` module declaration. T24's typecheck gate @ 11120 covers `src/web/**`. → **F3**.

### `vitest.config.ts`
| # | Task | Line | Mode | Settings |
|---|---|---|---|---|
| 1 | T1 | 265-280 | create | `include:['test/**/*.test.ts']`, `exclude: RHCSA_VM==='1' ? [] : ['test/**/*.vm.test.ts']`, `testTimeout:10_000` |
| 2 | T24 | 10156-10171 | full replace | adds `plugins:[react()]`, `include` gains `'test/**/*.test.tsx'`, `environmentMatchGlobs:[['test/web/**','jsdom']]`; keeps `exclude` and `testTimeout` verbatim |

**Preservation: PASS.** Every v1 setting survives. Two residual issues: `exclude: []` in VM mode discards Vitest's default excludes (`node_modules`, `dist`) — **F20**, low; and `environmentMatchGlobs` is deprecated in Vitest 3 in favour of `test.projects` — it still functions, so noted only.

### `package.json`
| # | Task | Line | Mode | Scripts after this step |
|---|---|---|---|---|
| 1 | T1 | 240-262 | create | `test`, `test:watch`, `test:vm`, `typecheck` |
| 2 | T3 | ~560 | add | + `rhcsa` |
| 3 | T21 | ~6990 | add | + `validate` |
| 4 | T23 | 10052 | add | + `dev:server` (`node --watch src/server/index.ts`) |
| 5 | T24 | ~11080 | add | + `dev:web`, `build:web` |
| 6 | T25 | 11212-11226 | **full replace** of the scripts block | `test`, `test:watch`, `test:vm`, `typecheck`, `rhcsa`, `validate`, `coverage`, `dev:server`, `dev:web`, `build:web` |

**Preservation: MOSTLY PASS.** All eight prior scripts survive the T25 rewrite and `coverage` is new. Two deltas: `dev:server` **loses `--watch`** (was `node --watch …` @ 10052, becomes `node --env-file-if-exists=.env.local src/server/index.ts`) — the env flag is a fix but the watch loss is silent (**F13**); and the promised `e2e` script never appears (**F12**).

### `.gitignore`
| # | Task | Line | Mode | Entries |
|---|---|---|---|---|
| 1 | T1 | 232 | create | `node_modules/`, `.env.local`, `*.log` |
| 2 | T19 | ~5810 | append | + `.rhcsa/` |
| 3 | T24 | ~11078 | append | + `dist/` |

**Preservation: PASS** — appends only, nothing rewritten.

### `vite.config.ts`
| # | Task | Line | Mode | Settings |
|---|---|---|---|---|
| 1 | T24 | 11086-11104 | "Modify" but effectively create | `plugins:[react(), tailwindcss()]`, `server.port 5174`, `proxy:{'/api': 'http://localhost:5175', '/ws': {target:'ws://localhost:5175', ws:true}}` |

Only one version. Content is correct and does route `TerminalPane`'s `/ws/terminal?cols&rows`. The "Modify" label with no creator is **F11**.

---

## Table E — npm scripts

| Script | Defined by | Every invocation site | Works as written? |
|---|---|---|---|
| `test` (`vitest run`) | T1 240; kept T25 11214 | T25 exit criterion 11300; most task acceptance steps use `npx vitest run <file>` directly | Yes |
| `test:watch` (`vitest`) | T1; kept T25 11215 | never invoked in the plan | Yes |
| `test:vm` | T1; kept T25 11220 | T19 acceptance ~5790; T25 11330 | **No — F15.** `set -a; . ./.env.local; set +a; RHCSA_VM=1 vitest run .vm.test.ts` aborts if `.env.local` is absent, and no task creates that file (F17). |
| `typecheck` (`tsc --noEmit`) | T1; kept T25 11216 | T24 Step 14 @ 11120; T25 11302 | **No — F3.** Fails on `src/web/**` (`.tsx` with no `jsx`, DOM globals, `./index.css` import). |
| `rhcsa` | T3 ~560; kept T25 11217 | T18/T19/T21 acceptance; T25 11305 | Yes |
| `validate` | T21 ~6990; kept T25 11218 | T21 acceptance ~6980; T25 11306 | Yes |
| `coverage` | T25 11219 only | never invoked | Yes (assumes `@vitest/coverage-v8`; **not in any install list** — minor, `vitest` prompts to install) |
| `dev:server` | T23 10052, redefined T25 11223 | T24 Step 15 @ 11140; T25 README | T25's version yes; **T23's version no — F10** (no env file → `loadVmConfig` throws). Also loses `--watch` (F13). |
| `dev:web` | T24 ~11080; kept T25 11224 | T24 Step 15 @ 11141; T25 README | Yes — but only after vite is installed (**F6**). |
| `build:web` | T24 ~11080; kept T25 11225 | never invoked | Yes, post-F6. |
| `e2e` | **nobody** | announced by T25 Files @ 11202 | **No — F12.** Undefined. |

Every `npm run X` in the plan maps to a defining task except `npm run e2e`.

---

## Table F — spec §16 Phase 0 / Phase 1 deliverables

| Spec deliverable (§16) | Task(s) | Finding |
|---|---|---|
| P0: repo skeleton, TS type-stripping, no build step | T1, T2 | Covered |
| P0: `rhcsa` CLI entrypoint | T3 | Covered |
| P0: VM config from env | T4 | Covered |
| P0: ssh transport, no node-pty | T5 | Covered, but **F21**: T23 @ 8500 lists `node-pty` in a dependency install line; header @ 9 also names it. Spec §6.2 and plan Global Constraints forbid it (no C compiler). |
| P0: vmrun transport + snapshot restore | T6, T19 | Covered |
| P0: `LabTransport` seam + `FakeTransport` | T7 | Covered |
| P0: FSRS scheduler | T8 | Covered |
| P0: derived rating (no self-report) | T9 | Covered |
| P0: five-rung ladder + per-mode caps | T10 | Covered |
| P0: JSON store | T11 | Covered |
| P0: JSONL checkpoint parsing | T12 | Covered |
| P0: command sketch (rung 4) | T13 | Covered |
| P0: task/concept loaders + schema | T15, T16 | Covered |
| P0: fixture matrix (`baseline-fail`/`expect-fail`) | T17 | Covered (6+18+6 = 30 fixtures, arithmetic verified) |
| P0: `assert.sh` grader library, read-only | T20 | Covered |
| P0: real task bank seed + `validate` | T21 | Covered |
| P0: exam duration + passing score constants | **none** | **F22.** Spec §16 P0 row and §13.2 require them; no task defines them. `limitMs` in `SessionView` @ 8985 is populated from `task.yaml`'s per-task field, not an exam-level constant. |
| P1: HTTP API for session lifecycle | T23 | Covered |
| P1: terminal bridge (WS) | T23, T24 | Covered |
| P1: React lab screen — rail + terminal | T24 | Covered |
| P1: reveal control wired to the ladder | T24 | Covered |
| P1: grade control + verdict display | T24 | Covered |
| P1: **reset control** (restore `clean` snapshot from the UI) | **none** | **F23.** `LabRuntime.reset` exists @ 9150 and `SshTransport`/`VmrunTransport` implement it, but no route exposes it (routes @ 8900-9130 are session/reveal/grade only) and no button exists in `Rail.tsx`. Spec §16 P1 lists it. |
| P1: Verdict A → reboot → Verdict B persistence check | T25 e2e 11340-11380 | Covered, but **F24**: after `reset`/reboot the test waits via `vmrun` guest-tools readiness, not sshd readiness — the next `exec` can land before sshd binds and return 500. |
| P1: end-to-end exit criterion | T25 | Covered but currently unpassable — F1, F3, F4, F8. |
| P1: post-attempt teaching card (spec §7.1) | **none** | **F18.** Depends on `explanation.md`, which no task creates and no loader reads. |

**Tasks doing Phase 2+ work:** none found. T21's concept cards and T13's sketch are both explicitly P0 in §16.

**Plan-vs-spec conflicts (§(e)):**

| Spec rule | Spec line | Plan | Verdict |
|---|---|---|---|
| SELinux stays `enforcing` | spec §4.2 / 231 | T19 `guest-provision.sh` 5550-5650 does not touch SELinux; no `setenforce`/`permissive` anywhere | OK |
| Graders read-only | spec §6.5 / 436 | all five graders use only `lvs`/`findmnt`/`df`/`getent`/`systemctl is-*`/`stat` | OK |
| Graders never read shell history | spec §6.5 | no `.bash_history` reference in the plan | OK |
| RHEL 9 only | spec §4.1 | `r1-probe.sh` asserts `platform:el9` | OK |
| Grading account can run the read-only privileged probes | spec §5.1 / 272 | `sshUser` defaults to `student` (4798); `student` added to `wheel` with **no NOPASSWD rule**; `BatchMode=yes`; no TTY | **CONFLICT — F2** |
| No `node-pty` | spec §6.2 | `node-pty` in an install list @ 8500 and header @ 9 | **CONFLICT — F21** |
| Two spare disks for storage tasks | spec §4.3 | T19 @ 5540, 5545 attaches two; T3's comment @ 802 says "one spare disk" | **CONFLICT — F25**, doc-level |
| VM state visible to the learner (spec §11 rule 1) | spec §11 | no VM-state indicator in `Rail.tsx` or the API | **F26**, low |
| Weight signal feeds selection (spec §14.4) | spec §14.4 | `task.yaml` carries `weight` (T15) but nothing reads it | **F27**, low |

---

## Findings requiring a ruling

### Critical — the T25 exit criterion cannot pass as written

**F1. `countCheckpoints` cannot see Task 21's checkpoints; `checkpointTotal` is 0, not 5.**
Lines: 8994-8998 (regex), 6370-6451 (T21 `grade.sh`), 6088-6098 (T20 emitters), consumed at 10074 and 11321.
`const CK_CALL = /^[ \t]*ck[ \t]+[a-z0-9][a-z0-9-]*/gm` matches a bare `ck ` call only. T21's real grader never calls `ck`; it emits 5 distinct checkpoint ids through 12 `ck_pass`/`ck_fail` call sites inside if/else/case branches. T23's acceptance step (10074) and T25's exit criterion (11321) both assert `checkpointTotal === 5`; both get 0.
Smallest fix: make the regex accept the suffixed emitters **and** dedupe by id, since 12 call sites cover 5 ids:
`const CK_CALL = /^[ \t]*ck(?:_pass|_fail|_skip)?[ \t]+(?:"|')?([a-z0-9][a-z0-9-]*)/gm` then `new Set([...s.matchAll(CK_CALL)].map(m => m[1])).size`.

**F2. Every grader will false-fail: the grading account has no non-interactive sudo.**
Lines: 4798 (`sshUser: env.RHCSA_SSH_USER ?? 'student'`), 6150 (`sudo lvs` in `assert.sh`), 6343 (`sudo vgs` in setup.sh), sudo in 4 of 5 graders; spec §5.1/272, §6.5/436.
`student` is added to `wheel`, but no task installs a NOPASSWD sudoers rule for it — the only `NOPASSWD` occurrences are a grep pattern *inside* a grader (7145) and prose (8016); 7175-7176 create `/etc/sudoers.d/devops` as a task *solution*, not for grading. With RHEL 9's default `%wheel ALL=(ALL) ALL`, `BatchMode=yes` and no TTY, every `sudo` prompts and fails — and because the script arrives on ssh's stdin, sudo's prompt eats the rest of the script. Correct student work grades as failure. Plan line 23's claim that "the transports already run as root inside the VM" is contradicted by its own default.
Smallest fix: in T19's `guest-provision.sh`, write `/etc/sudoers.d/rhcsa-grader` containing `student ALL=(ALL) NOPASSWD: ALL`, `chmod 0440`, and `visudo -cf` it.

**F3. `tsconfig.json` is never given web settings, so `npm run typecheck` cannot pass after Task 24.**
Lines: 201-223 (the only tsconfig in the plan), 11120 (T24 Step 14 runs `npx tsc --noEmit`), 11302 (T25 re-runs it).
No `jsx`, `lib` is `["ES2023"]` with no `"DOM"`, `types` is `["node"]` with no `"vite/client"`, and there is no ambient declaration for `./index.css`. T24's Files list (10125-10140) does not include `tsconfig.json`.
Smallest fix: add `tsconfig.json` to T24's Modify list and set `"jsx": "react-jsx"`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"types": ["node", "vite/client"]`.

**F4. T25 asserts a `phase` value that does not exist.**
Lines: 8978 (`export type SessionPhase = 'active' | 'graded'`), 9123 (`s.phase = 'graded'`), 11362 (`expect(done.phase).toBe('done')`).
Smallest fix: change 11362 to `.toBe('graded')`.

### High

**F5. Task 24 Step 15 item 9 states the wrong baseline verdict.**
Line 11152 expects `0 / 5 passed`. Hand-computing T21's `grade.sh` against the `setup.sh` baseline: `# baseline-fail: lv-home-size, fs-home-size` — 2 fail, and `home-from-lv`/`var-intact`/`persist-config` all pass. Correct string is `3 / 5 passed`. An agent will treat a correct UI as broken.
Smallest fix: change `0 / 5` to `3 / 5` at 11152.

**F6. Task 24's dependencies are never installed.**
Line 10152 claims Task 1 installed vite and tailwind; Task 1's install list (240-262) contains neither, nor `@vitejs/plugin-react`, `@tailwindcss/vite`, `@xterm/xterm`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`. Every T24 step from 11110 on fails at import.
Smallest fix: add an explicit `npm i -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite jsdom @testing-library/react @testing-library/jest-dom` plus `npm i @xterm/xterm` as T24 Step 1, and delete the false claim at 10152.

**F7. Task 21's Files list omits two files it creates; they are also absent from the File Structure block.**
Lines: 6270-6275 (Files list names only `test/cli/validate.test.ts`), 6628 (`src/engine/validate/run.ts` created), 6680 (`test/validate/run.test.ts` created), 6995 (`git add` includes both), 46-105 (block omits both).
Smallest fix: add both paths to T21's Files list and to the File Structure block; reconcile `test/cli/validate.test.ts` vs `test/validate/run.test.ts` — only the latter is ever written.

**F8. `test/web/rail.test.tsx` has no DOM cleanup between tests.**
Lines: 10156-10171 (vitest config has no `globals: true`), 10800-10950 (rail tests 1-10 each `render(<Rail …/>)`).
`@testing-library/react` auto-cleanup registers itself only when a global `afterEach` is available, which Vitest provides only with `globals: true`. Without it, mounted trees accumulate in one `document.body` and every `getByText` from test 2 onward throws "found multiple elements". First collision: `getByText('01:30 / 10:00')` in rail test 2.
Smallest fix: add `globals: true` to the `test` block at 10160 (or add `import { cleanup } from '@testing-library/react'; afterEach(cleanup)` to the test file).

**F9. Task 23's Produces block describes an interface that does not exist.**
Lines: 8489 (`interface LabRuntime { transportKind; reset; runSetup; gradeTask }`) vs 9145-9155 (`{ transportKind; reset; exec(script: string): Promise<ExecResult> }`).
Task 24 and Task 25 read the Produces block to plan against. `runSetup` and `gradeTask` do not exist; `exec` is undocumented.
Smallest fix: rewrite 8489 as `interface LabRuntime { transportKind; reset(): Promise<void>; exec(script: string): Promise<ExecResult> }`.

**F10. Task 23's server never loads `.env.local`, so both its own acceptance step and `dev:server` throw.**
Lines: 10052 (`"dev:server": "node --watch src/server/index.ts"`), 10058 (`node src/server/index.ts &`).
`src/server/index.ts` calls `loadVmConfig(process.env)`, which throws `RHCSA_VMX is not set`. Task 25 later fixes the script (11223) but Task 23's own step 20 still fails when run.
Smallest fix: add `--env-file-if-exists=.env.local` to both 10052 and 10058.

**F11. `index.html` and `vite.config.ts` are marked "Modify" but no task creates them.**
Lines: 10135, 10136 (T24 Files list), 70, 71 (File Structure block).
The agent must guess whether to create from scratch or look for a file that does not exist.
Smallest fix: relabel both as "Create" in T24's Files list.

**F12. Task 25 promises an `e2e` script it never defines.**
Lines: 11202 (Files list), 11212-11226 (scripts block defines `test`, `test:watch`, `test:vm`, `typecheck`, `rhcsa`, `validate`, `coverage`, `dev:server`, `dev:web`, `build:web`).
Smallest fix: add `"e2e": "vitest run test/e2e"` at 11226, and list `coverage`/`test:vm` in the Files note.

### Moderate

**F13. `dev:server` silently loses `--watch`.** 10052 defines `node --watch …`; T25's rewrite at 11223 drops it. Fix: keep `--watch` in 11223.

**F14. `TerminalPane` writes to a disposed terminal on unmount.** ~10980-11060: the effect cleanup calls `term.dispose()` while `ws.onclose` writes `\r\n[disconnected]`; closing the socket during unmount fires `onclose` after dispose. Fix: guard with a `disposed` flag set in cleanup before `ws.close()`, or clear `ws.onclose` in cleanup.

**F15. `test:vm` hard-fails without `.env.local`.** 11220: `. ./.env.local` with no guard. Fix: `[ -f .env.local ] && { set -a; . ./.env.local; set +a; };`.

**F16. Nested unfenced code blocks break two heredocs.** T25's README heredoc ~11480-11560 and T21's concept card ~6480-6520 contain ``` inside a ``` block. Fix: use `````` fences for the outer block.

**F17. `.env.local` is in the File Structure block (68) but no task creates it.** T19 writes `RHCSA_VM_IP` into it (11540) assuming it exists; `test:vm` sources it. Fix: have T1 create it from a documented template, or have T19 create-if-missing.

**F18. `explanation.md` and spec §7.1 post-attempt teaching are orphaned.** Block line 75 lists `explanation.md`; no task creates one, `loadTask` never reads it, no API field carries it, no UI renders it. Fix: either drop it from the block or add it to T15's schema + T21's content + T23's `SessionView`.

**F19. `scripts/guest-provision.sh` is missing from the File Structure block.** Created at 5536, copied into the guest at 5722. Fix: add it at ~line 88 of the block.

**F21. `node-pty` appears in a dependency install line despite being forbidden.** 8500, and the header at line 9. Global Constraints and spec §6.2 rule it out (no C compiler, no sudo). `npm i node-pty` will fail the step outright. Fix: delete `node-pty` from 8500 and from line 9.

**F22. No task defines the exam duration / passing score constants.** Required by spec §16 Phase 0 and §13.2. Fix: add them to T10 or T15 as a small `src/engine/exam/limits.ts`.

**F23. Phase 1's `reset` control has no route and no button.** `LabRuntime.reset` exists (9150) but the route list (8900-9130) and `Rail.tsx` (10800-10950) never expose it. Spec §16 P1 lists it as a deliverable. Fix: add `POST /api/session/:id/reset` to T23 and a Reset button to T24.

### Low

**F24. Verdict B can race sshd.** T25 11340-11380 waits on vmrun guest-tools readiness after reboot, not on sshd accepting connections; the first `exec` can 500. Fix: poll `exec('true')` until it succeeds, with a bounded retry.

**F20. `exclude: []` in VM mode discards Vitest's defaults.** 10163/10166. Fix: spread the defaults or use `['test/**/*.vm.test.ts'].filter(…)`.

**F25. Spare-disk count contradiction.** T19 attaches two spare disks (5540, 5545); T3's comment at 802 says one. Fix: correct 802.

**F26. Spec §11 rule 1 (VM state visible) has no implementation.** No VM-state indicator in the API or `Rail.tsx`. Fix: defer explicitly to Phase 2 or add a field to `SessionView`.

**F27. `task.yaml`'s `weight` is parsed but never consumed.** T15 schema carries it; no selection logic reads it (spec §14.4). Fix: note as Phase 2.

---

**Totals: 27 findings — 4 critical, 8 high, 9 moderate, 6 low.**
The four critical findings each independently block Task 25's automated exit criterion; F2 additionally makes correct student work grade as failure on every task in the bank.
