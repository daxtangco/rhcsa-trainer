# Parked for the whole-branch review — consolidated, pointers re-verified

Every item below was parked by a task review with the whole-branch review named as its
destination. This file exists so the final review dispatch does not have to reconstruct
them from a 348k-byte ledger, and so no item is lost.

**Pointer hygiene.** Line numbers drift. Six pointers in my mandates had already drifted by
the time I checked them (four in Task 25's mandate 8, one in its mandate 9, one in my own
parked notes). Every pointer in this file was **re-run against `ab32303`** on the date this
file was written. Each item says whether it is `MEASURED` (a command was run here) or
`CARRIED` (inherited from a task report and not re-verified — verify before acting).

**Do not treat a count in this file as a target for a grep.** Two of my parked counts were
wrong and one produced a near-miss false correction. Where a set matters, the files are
named individually.

---

## P1 — `as` casts in `src/` behind one `oneOf` predicate helper. `MEASURED`

Five lines, **seven** cast tokens. My earlier note said "five cast sites", which was five
*lines*; two of the lines carry two casts each:

| line | casts |
|---|---|
| `src/engine/content/task.ts:96` | 2 — `raw.scope as string`, `raw.scope as TaskScope` |
| `src/engine/content/task.ts:101` | 2 — `raw.weight as string`, `raw.weight as TaskWeight` |
| `src/engine/content/task.ts:108` | 1 — `rawTransport as TaskTransport` |
| `src/engine/vm/config.ts:54` | 1 — `forced as TransportKind \| undefined` |
| `src/engine/grading/verdict.ts:29` | 1 — `v.status as CheckpointStatus` |

`scripts/` has **zero** — an earlier ledger note claiming casts at
`scripts/extract-corpus.ts:47-53` was stale and is struck.

The shape all five share is `LIST.includes(x as string) ? (x as T) : fallback`, which a
single predicate closes:

```ts
function oneOf<const T extends readonly string[]>(list: T, v: unknown): v is T[number]
```

`config.ts:54` is the odd one out — it is not a `.includes` test but a re-assertion of a
value already validated at `:40` by `Object.hasOwn(KINDS, forced)`. A narrowing helper over
`KINDS` removes it. See P10, which lives on the same line.

## P2 — `config.ts` empty-string defeats `??`. `MEASURED`

`src/engine/vm/config.ts:48-55`:

```ts
sshUser: env.RHCSA_SSH_USER ?? 'student',
sshKey: env.RHCSA_SSH_KEY ?? join(homedir(), '.ssh', 'rhcsa_lab'),
vmrun: env.RHCSA_VMRUN ?? DEFAULT_VMRUN,
```

`??` falls back on `undefined` and `null` only, so `RHCSA_SSH_KEY=` yields `sshKey: ''` and
an `ssh -i ''` whose error names nothing the user recognises. `provision.sh` uses
`${VAR:-default}` for the same keys, which treats empty as unset — the two disagree.

**Newly reachable as of Task 25.** `npm run test:vm` uses `set -a; . ./.env.local`, which
**exports** blank assignments; `provision.sh:52` filters `=[[:space:]]*$` lines out before
sourcing precisely so they never reach the environment. And the template `provision.sh`
writes ships these keys as commented blanks (`#RHCSA_SSH_KEY=`), so uncommenting without
filling in is the expected accident. Fix: a `val()` helper returning `undefined` for `''`.

Not affected, both `MEASURED`: `ip: env.RHCSA_VM_IP` (guarded by `!cfg.ip` at
`src/engine/vm/ssh.ts:131` and `:176`, which catches `''`), and `RHCSA_TRANSPORT=''`
(rejected at `config.ts:40`, message at `:42`).

**Re-verified at `f65d0a4`, and one of these pointers resists a naive grep.** `grep -nE
'!cfg\.ip' src/engine/vm/ssh.ts` returns **only** `:131`, because the second guard is
`if (!this.#cfg.ip) return false` — a private field, not the parameter. `:176` is correct; the
grep is wrong. Use `grep -nE 'cfg\.ip'`. Do not "correct" `:176` out of this note — that is the
third false correction this file has warned about, and two have already been attempted. Also
re-verified unmoved by round 4: `config.ts:40`/`:42`, `guestPassword` at `config.ts:53`,
`select.ts:80`, and `SessionPhase` at `src/server/session.ts:12` (round 4 added 248 lines to that
file, all below line 12).

**Narrowed by the Task 23 review — read this before acting.** That review examined the same
`??` pattern and reported the "empty-string-defeats-`??`" premise as *wrong in outcome*. It is
right, **but only for the keys that have a range check**: `Number('')` is `0` and `0 < 1`, so
`RHCSA_SSH_PORT=''` and `RHCSA_PORT=''` both throw a message naming the variable. Nothing is
silent there.

P2 survives for the three keys with **no** range check — `sshUser`, `sshKey`, `vmrun` — where
`RHCSA_SSH_KEY=` still produces `ssh -i ''`. Do not read the Task 23 review as closing P2;
read it as removing the port keys from P2's scope. The `val()` helper fix is unchanged.

## P3 — `set -o pipefail` with `| grep -q` can SIGPIPE. `CARRIED`, files named

F10 from an earlier task: `grep -q` exits as soon as it matches, and under `pipefail` the
upstream command's SIGPIPE becomes the pipeline's status. One site is a deliberate pass and
has a test proving it.

**I am deliberately not giving a count.** My earlier note said "nine sites"; a grep for
`| grep -q` in files carrying `pipefail` returns far more, because that superset includes
sites where the upstream cannot be killed early. A count here invites a grep that produces
either a false correction or a wasted round — that has already happened once in this
project. The precise site list is in the F10 report; the files that contain candidates are:

`content/tasks/selinux/019-httpd-alt-port/{grade.sh,setup.sh}`,
`content/tasks/systemd/017-boot-time-service/{grade.sh,setup.sh}`,
`content/tasks/troubleshooting/028-restore-remote-access/{grade.sh,setup.sh}`,
`content/tasks/users/006-team-provisioning/{grade.sh,setup.sh}`,
`scripts/provision.sh`, `scripts/r1-probe.sh`.

## P4 — `waitForGuest` returns before the guest has finished booting. `MEASURED`. Highest severity here.

`src/engine/vm/vmrun.ts:252-293`.

`guestUp()` (`:253-261`) returns true as soon as `echo up` runs in the guest.
`waitForGuest()` (`:263-272`) polls that and returns. `reboot()` (`:286-293`) sleeps one
poll interval, then waits for `guestUp`. But `echo up` succeeds long before
`multi-user.target` is reached.

`src/engine/grading/grader.ts:97` calls `reboot()` and then grades **verdict B**. So verdict
B can be graded against a half-booted system: a service that is `enabled` but not yet
`started` grades as failed, verdict A passed, and pass→fail is reported as a **persistence
failure**. That is a false regression, and it is the worst signal this app can emit —
verdict B's entire meaning is "survives reboot", so a spurious failure there teaches the
student that a correct answer was wrong.

Fix: poll `systemctl is-system-running` and accept `running` **or `degraded`**. `degraded`
must be accepted or a single unrelated failed unit in a lab VM hangs the poll until timeout.

## P5 — `checkCoverage` does not validate concept-card objective ids. `CARRIED`

Implementation is in `src/engine/content/bank.ts` (with the CLI wiring in
`src/cli/index.ts`), **not** a `coverage.ts` — an earlier note implied otherwise. A card
can name an objective id that exists in no taxonomy and coverage stays silent. Objective ids
are permanent FSRS scheduling keys, so a typo is durable.

**Upgraded to `MEASURED`, and I no longer think this is low severity.** Read at `ccdba26`:
`checkCoverage` at `src/engine/content/bank.ts:174-197` validates three of the four edges in the
referential graph — `task.requiresConcepts` → concept map, `task.objectives` → `bank.objectives.byId`
(emitting `… maps to unknown objective`), and `concept.prerequisites` → concept map. The concept loop at
`:192-197` reads **only** `prerequisites`. A concept card's own `objectives:` list is validated nowhere.

What makes it more than tidiness is the sibling test: `test/content/concept.test.ts:42` rejects an omitted
`objectives` key with the comment *"a card with no objectives is unreachable from the disclosure ladder"*,
and `:50` rejects an explicit empty list distinctly from the omitted case. So the project already holds
that an unreachable card is a defect worth two dedicated tests — and a card naming a **typo'd or renamed**
objective id is unreachable in exactly that way, while looking completely valid. The two guarded cases are
the ones a human notices; the unguarded one is the one a rename produces silently.

The fix is a loop mirroring `:181-183`. Note the difference in what it may claim: a task's mapping feeds
`coveredObjectives`, but a card's must **not** — coverage is a property of exam-objective tasks
(spec 6.4), so this check emits a problem and nothing else.

Also worth stating because it bears on the whole-branch review's invariant sweep: the id set itself **is**
protected. `test/content/objectives-golden.test.ts` locks the full `id -> { text, chapters }` map of both
taxonomies against a committed fixture, written after three silent mutations passed the structural tests.
So a rename is caught in the taxonomy; it is the *references* to a renamed id that leak, and only through
concept cards.

## P6 — `(err as ContentError)` casts in tests need an `instanceof` sweep. `MEASURED`

**29 casts across five files**, not six as an earlier note said:

| file | casts |
|---|---|
| `test/content/objectives.test.ts` | 8 |
| `test/validate/expectations.test.ts` | 7 |
| `test/content/bank.test.ts` | 7 |
| `test/content/concept.test.ts` | 4 |
| `test/content/task.test.ts` | 3 |

The count was right and the file count was wrong. An `instanceof ContentError` guard
replaces all of them and makes the assertion real rather than asserted.

## P7 — the `(( ))` integral-bytes assumption. `MEASURED`, and my parked note pointed at the wrong risk

I had this as "three LVM sites consuming `to_bytes`". That is wrong in the safe direction:
`to_bytes` (`content/lib/assert.sh:77-95`) ends with
`awk -v n=… -v m=… 'BEGIN { printf "%d\n", n * m }'`, and `%d` forces an integer. **Every
`to_bytes` consumer is safe**, including `014/grade.sh:32,57,87`, which use `[[ … -ge … ]]`
and are additionally fail-closed at `:12-21` when `to_bytes` fails.

The real exposure is the two reads that **bypass** `to_bytes` and feed a raw string straight
into `(( ))`:

- `content/tasks/storage/014-grow-home-lv/setup.sh:32` → `:34`
  (`lvs --noheadings --nosuffix --units b -o lv_size`)
- `content/tasks/storage/014-grow-home-lv/setup.sh:38` → `:40`
  (`vgs --noheadings --nosuffix --units b -o vg_free`)

Both are `-n`-guarded at `:33` and `:39`, so the empty case is closed. The open question is
whether `lvs`/`vgs` under `--units b --nosuffix` can ever emit a non-integer (locale decimal
comma, or a field that ignores `--units`), which `(( ))` cannot parse. **`reasoned`, not
measured — there is no LVM on this host.** Low severity; route through `to_bytes` for
uniformity rather than as a bug fix.

## P8 — `scripts/r1-probe.sh`'s catch-all conflates timeout with unknown. `MEASURED`

`scripts/r1-probe.sh:258` — the `*)` arm prints "R1 CONFIRMED AS A PROBLEM", so an exit
status of `124` (project-wide: "timed out") is reported as a confirmed reachability failure
rather than as an inconclusive run. R1 is still INCONCLUSIVE, so this arm is load-bearing
for the one risk the project has not closed.

## P9 — `VmrunTransport.exec()` leaks its temp dir when `writeFile` fails. `MEASURED`

`src/engine/vm/vmrun.ts:136-139` are **outside** the `try` that begins at `:141`:

```ts
const dir = await mkdtemp(join(tmpdir(), 'rhcsa-stage-'))
const hostPath = join(dir, 'script.sh')
const guestPath = guestScriptPath()
await writeFile(hostPath, script, 'utf8')
try {
```

The `finally` at `:170-178` does `rm(dir, …)`, so a `writeFile` rejection skips cleanup and
leaves a `rhcsa-stage-*` directory behind. Fix: move `mkdtemp` above the `try` but
`writeFile` inside it.

## P10 — `KINDS` conflates "valid `TransportKind`" with "valid `RHCSA_TRANSPORT` value". `MEASURED`

`src/engine/vm/config.ts:40` validates `RHCSA_TRANSPORT` against `KINDS`, which includes
`fake`. So `RHCSA_TRANSPORT=fake` passes config validation and then fails later — which is
why `src/engine/vm/select.ts:80-90` needs a comment explaining that `fake` is accepted here
but rejected there. Two sets, one constant. Same line as P1's `config.ts:54` cast.

## P11 — `new URL(...).pathname` instead of `fileURLToPath`, seven test files. `MEASURED`, files named

`.pathname` on a `file:` URL does not percent-decode, so a repo path containing a space or
`#` breaks. The seven:

`test/content/bank.test.ts`, `test/content/coverage.test.ts`,
`test/content/objectives-golden.test.ts`, `test/content/concept.test.ts`,
`test/content/objectives-real.test.ts`, `test/content/task.test.ts`,
`test/content/objectives.test.ts`.

**A naive `grep -rn '\.pathname' test/` returns nine.** `test/lib/assert.test.ts` and
`test/cli/validate.test.ts` already use `fileURLToPath` and only *mention* `.pathname` in a
comment. Seven is right; the grep is wrong. I nearly shipped a false correction on this one.

**Per-file correction (Task 23 review, F14):** `test/content/bank.test.ts` has **8** call
sites, not the 7 I wrote in Task 23's mandate 8. The *file* count — seven files — is correct,
which is the number that matters here. Do not use my per-file figures; count them yourself.

Also correct and out of scope: `src/server/terminal.ts`'s `url.pathname` is a **request**
path, not a filesystem path, so `fileURLToPath` does not apply to it.

## P12 — `# unprobed-invariant:` is not enforced against emitted ids. `CARRIED`

The union of probed and unprobed ids should equal the emitted set, and nothing checks it
outside `rhcsa validate`. Needs the ids plumbed out through `FixtureResult`. **Task 25's
mandate 11 covers the static half** (a `rhcsa lint` subcommand); this item is what remains
after that lands, so re-scope it rather than reporting it twice.

## P13 — N1: `default dev lo` selects `lo` through the route path. `CARRIED`

R1/R6 closed the `head -1` hazard in `selinux/019-httpd-alt-port/setup.sh` and
`troubleshooting/028-restore-remote-access/setup.sh` by deriving the device from
`ip -o route show default`. But a route table containing `default dev lo` makes both files
select `lo` again — the same hazard through the other door. Parked because nothing in this
project produces a default route via loopback. The close is one line in each of the two
files, beside the guard already there.

## P14 — ~~N3: `CK_CALL` cannot see the idiom `assert.sh` documents.~~ **CLOSED at `2cfbe8b`**

**Closed, and re-measured rather than assumed.** `test -f /etc/fstab; ck gamma` → **1**,
`true && ck delta` → 1, `… | ck x` → 1, and the two invariants this file demanded as the condition
of closure both hold: `countCheckpoints(content/lib/assert.sh)` → **0**, and 019=8, 014=5, 017=5,
028=5, 006=8, unchanged. Both directions the reviewer paired with it are closed too — a `ck` inside
a heredoc body is excluded, and the phantom id from a separator inside a string is gone.

It took **three** fix rounds and each round's fix introduced the next defect (F4 → F16/heredoc →
N1/N2 → R1). `countCheckpoints` is the most defect-dense function on the branch; round 4 is
repairing five more findings in it. **Do not read the history below as the current behaviour — the
docstrings in `src/server/session.ts` are the authority, and they are kept accurate deliberately
(two rounds were spent correcting them).** The original entry follows for provenance only.

## P14 (original entry, superseded) — `CK_CALL` cannot see the idiom `assert.sh` documents

`src/server/session.ts:34` is anchored to line start, so `true; ck x "d" $?` and
`… | ck x "d" $?` yield no ids — while `content/lib/assert.sh:60` documents
`some_condition; ck my-id "what was checked" $? "what to look at"` as *the* usage. An
under-count makes `incomplete` false (`session.ts:100`) and disables mandate 7's truncation
guard, i.e. a false pass.

Latent, not live: no shipped grader uses the form (only hit for
`[;&|][[:space:]]*ck` is `assert.sh:60` itself), and current counts 019=8, 014=5, 017=5,
028=5, 006=8 are correct.

**Status: sent to Task 23's fix round 1 as an addendum to F4, and expected to close there.**
Re-measured before sending, `MEASURED`: `test -f /etc/fstab; ck gamma "d" $?` → **0** ids,
`&&` → 0, `|` → 0, and a script mixing one column-0 call with one documented-inline call
counts **1** of 2. So the under-count does not merely coexist with F4's fix — it *disables*
it, because a grader declaring 3 of its real 5 gives `incomplete === false` on a run
truncated at 3.

The reviewer independently found the **opposite** direction on the same regex (a `ck` inside
a heredoc body counts a checkpoint that never executes → false `incomplete` → false fail).
Both directions went into the same fix. **Verify the two invariants held before treating this
as closed:** `countCheckpoints` over `content/lib/assert.sh` must still be **0**, and the five
grader counts above must be unchanged.

## P15 — both port parsers accept hex and surrounding whitespace. `MEASURED` by the Task 23 review

`readPort` (`src/server/config.ts` after Task 23's fix round, previously `index.ts`) and
`loadVmConfig` (`src/engine/vm/config.ts`) share a shape that accepts `'0x50'` as **80** and
`' 22 '` as **22**, because `Number()` does both. Cosmetic — every accepted value is a real
port and the range check still holds — but the two parsers should agree with the
`${VAR:-default}` shell convention they sit beside. Deliberately **not** fixed during Task
23's extraction, so that the move stayed faithful and therefore reviewable.

## P16 — the shared `upgrade` listener destroys sockets for every other path. `MEASURED`, parked with a comment

Task 23's F13. `attachTerminal` adds a `server.on('upgrade')` that `socket.destroy()`s
anything that is not `/ws/terminal`. It is the only upgrade consumer today, so nothing is
broken; a second WebSocket endpoint added later would have its handshakes destroyed by this
one, with no error naming the cause. **Ruling was: park with a comment naming the
constraint** — the comment is the whole fix until there is a second consumer.

## P17 — `transport` names two different things across the API. `MEASURED`, carried into Task 24

On `/api/tasks` summaries (`src/server/app.ts:56`) `transport` is the **task's** transport. On
`/api/health`, the session response and `view()` it is the **server's**. Task 23's mandate 10
chose this deliberately and the reviewer agreed with the choice, but Task 24 reads
`/api/tasks` and will get the other meaning of the same field name. Rename or document at the
UI boundary; do not silently rely on which one you got.

## P18 — extract a shared `lexBash`. `MEASURED` twice. Parked by ruling out of round 5; the strongest structural item here.

`countCheckpoints` in `src/server/session.ts` hand-rolls a bash lexer (~165 lines, file now ~640) and
has a **divergent twin** at `src/engine/disclosure/content.ts:91`. It produced **eight** defects across
six rounds. I ruled the extraction out of round 5 because a refactor in the last round before the
breaker has nothing downstream to catch its regressions — that reasoning was about *timing*, not about
whether it should happen.

Two measured instances of the failure mode a shared lexer removes by construction:

1. `content.ts`'s twin still carries R1's escape bug. Measured unreachable through the sketcher because
   `commandSketch` runs over `ctx.solution`.
2. **F1 (round 5) was a drift defect between two call sites of the same helper inside one function** —
   `session.ts:282` passed `carried.ansiC` where `:371` correctly passed `ch === '"' || ansiC`, six
   lines from a docstring warning about exactly this. Fixed in round 6.

The differential oracle (`test/server/checkpoint-oracle.ts`) is what makes this extraction safe to
attempt now and was not available in rounds 1-3: it compares id sets against real `bash`, and it is the
**only instrument in the suite** that catches a compensating-pair error, because `expectedTotal` is a
number so two cancelling errors disarm the `incomplete` guard silently. Do the extraction against the
oracle, not against the 349-test suite.

## P19 — N13: `CK_CALL` cannot see a `ck` behind a command prefix. `MEASURED`, disclosed, deliberately not fixed

Five shapes count 0 against bash's 1 — **silent fail-open** each: `! ck id`, `VAR=x ck id`,
`time ck id`, `eval 'ck id …'`, and `ck \` + newline. Unreachable in the bank today (verified).

Round 5's report claimed "three fail-opens, one regex change". **That is wrong and the correction
matters:** measured, one character (adding `!` to `CK_CALL`'s anchor class) closes **only `! ck`**.
`VAR=x ck`, `time ck` and `eval` need real command-prefix modelling. I declined this for round 6's
exception because it is inherited debt rather than a round-5 regression, and the exception was for
regressions only. It is the first candidate for any future work on this function.

**Re-found independently by the Task 25 review as its F3, with a wider shape list and a better argument
for parking it.** The reviewer added `if ck "$x"`, `while ck "$x"` and `LC_ALL=C ck "$x"` to the five
above, and then made the point that neither my note nor round 6's disclosure had made: **`rhcsa lint` is
blind to these shapes in exactly the same way the counter is, so the lint's view of a grader agrees with
the runtime's rather than diverging from it.** That is what makes this parkable rather than urgent — a
lint that saw a `ck` the counter cannot count would produce a *new* class of disagreement, and it does
not. Re-confirmed measured that no grader in the bank uses any of the eight shapes, and the limitation is
documented in the lint's own docstring.

`Ruling: keep P19 parked and do not fix it in the whole-branch fix dispatch — why: it is inherited debt
whose two consumers are blind identically, so the tools agree; the real fix is command-prefix modelling
inside the extractor, which belongs with P18's lexBash extraction rather than as a regex patch; and
nothing in the bank reaches it — cost if wrong: a future grader written with a command prefix has its
ids uncounted by both the lint and the runtime equally, which is the pre-existing parked condition and
not a new one.`

## P20 — three measured divergences disclosed in round 6, not fixed. Verify the disclosure text, not just the code

- **`echo $[1 << 2]`** reads `2]` as a heredoc delimiter and swallows the rest of the file — **silent
  fail-open**. `$[ ]` deprecated since bash 2, absent from `content/`. Note this **contradicts round 5's
  argument that widening the delimiter parser could only fail closed**: the `arith === 0` guard covers
  `$((` and `((`, not `$[`.
- **`subst` and `arith` are `scanLine` locals** and reset per line, while `quoted` survives the newline —
  two pieces of lexical state with different lifetimes. **~~Fail-closed.~~ WRONG DIRECTION: it is a
  silent FAIL-OPEN in composition — see P25.** I parked it as fail-closed and round 6 disclosed it as
  fail-closed. Both wrong, and I have measured it.
- **A trailing `\` immediately before a `ck` line** glues the previous word onto it. **Fail-closed**,
  pre-existing at every commit. Confirmed correct by the round-6 review.

Also corrected: the `$[` bullet above frames the class as **deprecated syntax only**, which is wrong —
five *current-syntax* arithmetic contexts fail the same way. See **P26**.

## P21 — the property test over the oracle. `ENDORSED with a non-optional condition`

Generate lines from the grammar, run real bash, compare id sets against `checkpointIds`. Endorsed by the
final Task 23 reviewer and by me as the right instrument to carry forward — it changes how this code is
verified rather than what it does.

**The condition is not optional: the generator must itself be mutation-tested, and each run must assert
a floor on `bash -n`-valid cases.** The reviewer's own first fuzzer run produced **78% invalid cases and
false `OVER` verdicts** because it put `>/dev/null` in the pool applied to `ck` lines, redirecting the
checkpoint JSONL away — the same "looks measured, proves nothing" failure as a heredoc pin with a space
in the wrong place. An unvalidated generator's silence is worthless.

**And it is not a substitute for reading the diff:** the fuzzer did **not** find F1 or F2. Those came
from asking which argument crosses the newline. Gate it behind an env var; require each run to report
its valid-case count.

## P22 — an overstated mechanism propagated into four places. `MEASURED`. Doc-only; fold into the whole-branch fix dispatch.

This sentence is wrong and it is mine: *"`expectedTotal` collapses toward 0, `incomplete` goes false, and
a grader that died on its first command reports the lab passed to a student who changed nothing."*
It now appears in the F1 code comment in `src/server/session.ts`, the `28ad7f0` commit message, and both
the round-5 and round-6 sections of `task-23-report.md`.

**Measured:** `allPassed` (`src/engine/grading/verdict.ts:81`) is
`v.checkpoints.length > 0 && v.checkpoints.every(pass)`.

| scenario | `incomplete` | `allPassed` |
| --- | --- | --- |
| real total 8, counter collapsed to 0, nothing arrived | false | **false** |
| real total 8, counter collapsed to **1**, that 1 passed | false | **true** ← the false pass |
| real total 8, counter correct at 8, only 1 arrived | **true** | false |

`incomplete` cannot distinguish a legitimately-zero grader from a counter that swallowed the file — both
give `false` — but `allPassed`'s length guard is the backstop against a **total** collapse.

> **CORRECTION, and this one is also mine — round 6 measured it and it reverses the paragraph above.**
> I wrote *"the false pass requires a PARTIAL collapse."* **That is wrong**, and it is the second
> mis-stated mechanism I built a ruling on. `allPassed`'s `length > 0` guard is not a backstop against a
> total collapse of the **count** — it is a backstop against **zero arrivals**, which is a property of the
> *run*, not of the count. The two are independent events and my three rows conflated them. Measured
> through `reportFor` at `28ad7f0`: real 8 / counter **0** / 1 arrival passing → `incomplete false`,
> `allPassed` **TRUE**. A collapse to 0 is the **widest** hole, not the safe one — it disarms `incomplete`
> for *every* nonzero arrival count. Deeper collapse, wider hole.
>
> The correct condition, stated once so it replaces the wrong one everywhere it propagated:
>
> **`arrivals >= expectedTotal` AND `arrivals >= 1` AND every arrival passed AND `arrivals < real total`.**
>
> `incomplete` is the only guard against a grader that stopped part-way, and it is disarmed whenever
> `expectedTotal <= arrivals`. A lexical collapse lowers `expectedTotal`; whether the grader also stopped
> part-way is a separate event.
>
> And the original sentence is wrong in a **narrower** way than "wrong mechanism": *"died on its first
> command"* names the one arrival count `allPassed` actually catches. Died on its **second**, having passed
> the first, is the false pass. Measured end-to-end on a real F-A collapse — an eight-`ck` grader with
> `limit=$((` / `1 << 2 ))` at line 5, counter says 2: dies after `ck one` → caught; dies after `ck two` →
> **FALSE PASS**; dies before emitting → caught. Note that a collapse to **2** still catches the 1-arrival
> death and a collapse to **0** would not.

Direction and severity of F1/F2 were right; the mechanism was overstated **twice, in opposite ways**. Fix
the wording in all four places **using the block-quoted condition above, not the paragraph before it** —
and see **P28** for the copy that shipped into committed source. This is the **false-disclosure class
(N5/R7/N9)** on this task again, and the worst variant, because it sends a reader after `incomplete` when
the field that decides it is `allPassed` — and then my own correction sent the next reader after the
collapse *magnitude*, which does not gate the false pass at all.

**One consequence that matters for Task 24, and it is good news.** Mandate 10.5(b) tells the Lab screen to
render a visible count-suspicion warning when `total > expectedTotal`. Measured: at a collapse to 0 with 1
or 2 passing arrivals, `status.size > expectedTotal` **is** true, so the warning fires on exactly the
inverted case. The condition it misses is `arrivals == expectedTotal` — a counter that under-counts by
precisely the truncation amount. But every heredoc fail-open measured in this function **zeroes**
`expectedTotal` rather than deflating it (P24's table), so the exact-match case is not reachable from the
measured fail-open class at all. **Mandate 10.5's warning covers the whole of it.** Do not weaken it, and
do not let the whole-branch review reason from the wrong mechanism and conclude it is redundant.

## P23 — F2's precedence rule rests on a control-flow property. Re-open only on a named trigger. `MEASURED`

F2's fix gives a carried quoted run precedence over a pending heredoc body **unconditionally**, decided
from five shapes. The uncovered case is the inverse nesting — a heredoc body containing an unterminated
quote — and the reason it cannot arise is structural, not incidental:

`quoted` is declared at `session.ts:461` with **exactly one** assignment (`quoted = scanned.open` at
`:480`), and that sits *after* the heredoc-body branch's `continue` at `:474`. A body line takes the
`continue` and never calls `scanLine`, so it cannot return an `open` and cannot set `quoted`. Hence the
state pair "`pending` non-empty AND `quoted` set" has exactly one producer: a single line that both opens
a heredoc and leaves a quote open, since `scanLine` returns `heredocs` and `open` from one call. That is
the A-family the precedence rule was measured against.

Because this is control flow and not bank contents, it does **not** decay as graders are added — unlike
"no `<<` in the counted text". **The trigger to re-open is specific:** any change that routes heredoc-body
lines through `scanLine`. The guard is `grep -n 'quoted' src/server/session.ts` — expect one assignment,
after the `continue`. Do not re-open this on shape count.

## P24 — THE TOP ITEM ON THIS LIST. One line makes a grader's expected count 0, and 0 reports a pass. `MEASURED` by me

This is the amplifier that makes every counter fail-open dangerous, and it needs no lexer knowledge to
understand or to fix.

Measured against `28ad7f0`, injecting a single line at the top of grader 019 (baseline 8, standalone and
prepended):

```
inject 'x="a'        -> 019 count 0   (also 0 when injected at assert.sh's position)
inject 'cat <<NOPE'  -> 019 count 0   (also 0 at assert.sh's position)
inject "x='a"        -> 019 count 8   (a later ' in the grader closes the run)
inject 'x=$(('       -> 019 count 8   (needs a `<<` on a later line; see P25)
```

Then, read from `src/server/session.ts:569` and `:591`:

```ts
const incomplete = status.size < expectedTotal          // 0 < 0 === false
allPassed: allPassed(v) && !incomplete                  // → (length > 0 && every pass)
```

So at `expectedTotal === 0`, `incomplete` can never fire, and **any nonempty all-passing prefix reports
`allPassed: true`** — a grader that died a third of the way down tells the student the lab passed. The
"nothing arrived" case is safe (`allPassed`'s `length > 0` guard, `verdict.ts:81`); **the dangerous case
is a passing prefix**, which is exactly what a truncated grader produces.

**There is already a runtime trace nobody can see.** `session.ts:579-584` `console.warn`s when
`status.size > expectedTotal`, with the text "countCheckpoints under-counted this grader" — so every
instance of this bug announces itself to the server log. The comment at `:571-578` deliberately warns
rather than fails, and that reasoning is sound: over-arrival means the *counter* is wrong, not the
student, so failing there would be a false fail.

**Recommended shape, and it is better than only guarding zero:**
1. Refuse to create a session when `countCheckpoints` returns 0 for a grader — a grader with no
   checkpoints is a content bug, and there is no legitimate zero in the bank (`assert.sh` alone is 0, but
   it is never a grader on its own).
2. Promote the `:579` over-arrival warning into a **report field** (e.g. `countSuspect: boolean`) so the
   UI can say "this grader's checkpoint count is wrong, treat the result as unreliable" **without**
   failing the student. That catches every under-count at runtime, not just total collapse, and it
   preserves the deliberate decision not to fail a correct run over a bad count.

Do 1 and 2 in the whole-branch fix dispatch. Together they convert this entire class from silent to loud,
which is worth more than any individual lexer fix on this list.

**Correction to item 2, added at `45344bd` after tracing it rather than re-reading this note.** Item 2 says
the warn should be promoted "so the UI can say … treat the result as unreliable". The UI **already says it**:
`Rail.tsx:93` derives `countSuspect = report.total > report.expectedTotal` and `verdictFor` (`:64`) returns
`null` on it, so at `expectedTotal === 0` with checkpoints arriving the visible verdict is already withheld
and the amber box at `:170` fires. What does *not* consult it is the rating: `src/server/app.ts:316-323`
feeds `passed: report.allPassed` into `deriveRating` with no countSuspect equivalent, so the report the screen
refuses to score still yields a rating that calls it a pass — and that rating persists into FSRS scheduling
against a permanent objective id. **The unguarded path is the durable one, not the visible one.** Also
measured: `grep -rn countSuspect src/ test/` gives five hits, all in `Rail.tsx`, **none in `test/`** — the
guard that does exist is untested. The wrong framing above is left in place on purpose so a reader who
remembers it learns it was wrong; the live version is in the whole-branch brief's target 1.

## P25 — `arith` resets across the newline: a silent FAIL-OPEN, and both my parked note and round 6's disclosure had the direction backwards. `MEASURED` by me

```
x=$((
1 << 2 ))
ck real-id "d" 0
```
→ bash `["real-id"]`, counter `[]`. **Silent fail-open**; the rest of the grader is discarded. The
same expression on one line (`x=$(( 1 << 2 ))`) agrees, so it is purely the newline.

Mechanism: `arith` is a `scanLine` local and resets per line while `quoted` now survives, so on line 2
the `<<` is outside any arithmetic context and becomes a heredoc opener with delimiter `2`.

This is P20's second bullet, which **I** parked as fail-closed and round 6 disclosed as fail-closed. The
round-6 docstring also claims the entry "pins what that costs" — it pins one third of the class, and the
unpinned third is the fail-open one. **Not reachable in the bank today, but `$(( ))` / `(( ))` appear
6× in the counted text including `content/lib/assert.sh`**, which is prepended to every grader — so this
is the closest thing on this list to reachable, and it is one authoring choice away (a `$((` left open at
end of line). Fix the direction in the disclosure and the docstring; consider making `arith`/`subst`
carry across the newline the way `quoted` now does.

## P26 — the arithmetic-context class is CURRENT syntax, not deprecated. `MEASURED` by me

The `$[1 << 2]` disclosure frames this as a deprecated-syntax curiosity. It is not. All three of these are
**silent fail-opens** at `28ad7f0`, and all three are ordinary modern bash:

```
a=(1 2 3 4 5); i=1; echo ${a[i << 1]}     -> bash ["real-id"], counter []
declare -a a; a[1 << 1]=x                 -> bash ["real-id"], counter []
s=abcdefgh; echo ${s: 1 << 1}             -> bash ["real-id"], counter []
```

Array subscripts, subscripted assignment targets and substring offsets are all arithmetic contexts that
the `arith` counter does not enter, so `<<` inside them is read as a heredoc opener and the rest of the
grader is discarded. The disclosure's wording must say "arithmetic contexts", not "`$[ ]`, deprecated".

## P27 — a THIRD `closingQuote` call site, already wrong. `MEASURED` by the round-6 review, direction confirmed by me

`heredocDelimiter` (`src/server/session.ts:190`) computes `escapes` a **third** way, distinct from both
sites F1 reconciled. bash does ANSI-C-dequote a heredoc delimiter, so `cat <<$'EOF'` is a **silent
fail-open** (measured by me: bash `["real-id"]`, counter `[]`); two further shapes fail closed.

This is the third measured instance of the drift that **P18** (extract a shared `lexBash`) exists to
remove by construction, and it is the direct answer to the question I asked the reviewer: yes, there is a
third site, and it was already wrong before F1 was fixed by duplicating the expression into the second.
**P18 is no longer optional in my view** — three sites computing one predicate three ways, in a function
with eight defects in six rounds, is a structural defect and not a style preference.

## P28 — my wrong mechanism shipped into committed source as a comment, and I sent the reviewer to the wrong file looking for it. `MEASURED` by the round-6 review

**The one doc correction on this list that is in tracked code rather than in scratch.** Round 6's F-J.

I reported that P22's wrong sentence had propagated into "the F1 code comment in `src/server/session.ts`."
**It had not.** Measured: `session.ts:286-292` stops at *"the walk stays inside the string, and every
remaining line of the grader is discarded"*, which is accurate, and the `28ad7f0` commit message is clean
too — it says "silent fail-opens that discard every remaining line of a grader" and never states the
`incomplete` mechanism. So P22's file list is itself wrong on one of its four entries.

The one copy in the tree is the H-family header comment **`28ad7f0` added** to
`test/server/checkpoint-oracle.ts:530-532`:

> *"The direction is the bad one: the walk stays **inside** the string, so `expectedTotal` collapses toward
> 0, `incomplete` goes false, and a grader that died on its first command reports the lab passed."*

Per P22's correction the final clause is **false**: at a collapse to 0, a grader that died on its *first*
command reports the lab **failed** (`allPassed`'s `length > 0` fires). It is true of a grader that died on
its *second*. The comment therefore overstates in the one direction this task cannot afford — it tells a
future reader the zero case is already the worst case, when the zero case is the single arrival count that
is **safe** and every other one is not.

**Severity: medium as documentation, and higher than a normal comment defect for one reason.**
`checkpoint-oracle.ts` is the file a future lexer author reads to learn what the failure modes are, and its
own stated rule is *"where a shape has two faces, pin both."* A false disclosure there is worse than no
disclosure, because a grader author writes something unsafe on its authority. This is the **sixth**
occurrence of the N5/R7/N9 class on Task 23.

**Ruling — parked, not a round 7.** `Ruling: fix the comment in the whole-branch review's single fix
dispatch, not now — why: Task 23 is closed and its one breaker exception is spent; a false comment in a
test-support module cannot produce a wrong truth-claim to a student, so it does not clear the bar that
bought the exception, and opening a round for a sentence is round 7 under another name — cost if wrong: a
future lexer author reads a wrong failure-mode note for the length of one review cycle.` It is a
three-line edit with the replacement already written above, so the fix dispatch can apply it mechanically.

Fold it into P22's wording fix and correct P22's own file list at the same time: the four places are the
`28ad7f0` **oracle comment** (this one), the commit message (**clean — leave it**), and the round-5 and
round-6 sections of `task-23-report.md`. Three surviving scratch copies —
`task-23-fix-6-exception.md:26-27`, `task-23-rereview-5.md:311-312`, `progress.md:6323` — are annotated in
P22 and are git-ignored, so they need no edit.

## P29 — Task 24's F4: Finish stays enabled on a run the rail has refused to score. `MEASURED` by the Task 24 review. P24's sibling — read them together.

When `verdictFor` returns `null` — a truncated run, or `total > expectedTotal` — the rail prints **"This
is not a score"**, and yet Finish stays **enabled** and derives a rating from `report.allPassed`, which is
`false` for the truncated case. So a grader that timed out records a `hard`-shaped rating against a lab
the student may well have solved. Two surfaces disagree about the same run in the same instant: one says
it declines to judge, the other quietly judges.

This is the **same root as P24 seen from the UI end**, which is why they must be fixed in one pass or not
at all. P24 is the server-side hole (a collapsed `expectedTotal` makes a real grader's count 0, and 0
with one passing arrival reports a pass); P29 is what the client does with the report P24 produces. Fixing
either alone leaves a coherent-looking screen over an incoherent verdict.

`Ruling: park F4 for the whole-branch review alongside P24, and fix both in the single fix dispatch —
why: disabling Finish on its own would trap the student in a session with no way to close it, no mandate
asked for it, Phase 0/1 does not schedule off the rating yet, and the real fix is a countSuspect-aware
finish path whose field mandate 10.5(b) explicitly parks — cost if wrong: one early rating is shaped by a
timed-out grader in a phase that does not read ratings yet.`

The shape of the joint fix, so the dispatch does not have to rediscover it: **refuse to create a session
at count 0** (a lab whose expected count is zero is a content or lexer failure, not a lab), and **promote
the `console.warn` at mandate 10.5's guard into a report field** that marks the run unreliable — then have
Finish read that field rather than `allPassed`. That flags the run without failing the student and without
trapping them. Do **not** let the fix reduce to "disable Finish".

**Locus correction, traced at `45344bd`.** Everything above about direction and mechanism holds: the rating
*is* derived from `report.allPassed`, and for the truncated case that is a **false fail** on a lab the student
may have solved. What is misplaced is "have Finish read that field". **Finish derives nothing.**
`Rail.tsx:262-263` calls `props.onFinish` and is enabled whenever a report exists; `App.tsx:186` takes
`done.rating` from the server; the derivation is one server-side call, `src/server/app.ts:316-323`, with
`passed: report.allPassed`. So P29 and P24 do not merely share a root — **they share a single unguarded line**,
and both directions run through it: truncated (`incomplete` true → `allPassed` false → false fail) and
collapsed count (`expectedTotal === 0` → `incomplete` false → `allPassed` true → false pass). A fix applied
at `app.ts:318` and its neighbours `anyPassed` / `hadRegression` addresses both; a fix applied to the Finish
button addresses neither. See the whole-branch brief's target 1.

## P30 — Task 25's F9: under dropped packets the VM e2e test times out at 120 s instead of printing the diagnostic it wrote. `CARRIED`, low

`beforeAll` hits vitest's timeout before the reachability helper's own diagnostic message can be printed,
so the first-contact failure mode is a bare timeout rather than the sentence written to explain it. The
Task 25 reviewer ruled this needs nothing and I agreed; it is recorded here only because R1 (WSL2 →
VMnet8) is still **unverified**, so this is plausibly the very first thing the user sees when the ISO
lands and the test runs for real. If the whole-branch review is looking for a cheap first-contact
improvement, this is one; it is not a defect in shipped behaviour.

Note the standing convention when reading its output: **`124` means timed out** project-wide.

## P31 — a rejecting `exec` is never tested, and it is the highest-probability false fail on the branch. `MEASURED` by me

`LabTransport.exec` is documented at `src/engine/vm/transport.ts:20` as **"Never throws on non-zero
exit."** Both real transports honour that literally, and both still reject — for infrastructure, not exit
status. `ssh.ts:132` throws when there is no guest IP, placed there deliberately so every consumer
inherits it. `vmrun.ts` rejects when staging the script on the host fails or the injected Runner throws;
its own comment at `:279-280` says so.

`FakeTransport.exec` (`fake.ts:25-28`) returns whatever its handler returns, and a handler *may* reject —
the signature permits `ExecResult | Promise<ExecResult>`. **No test makes one do so.** Measured at
`ccdba26`: across the five test files that use `FakeTransport`, zero throwing or rejecting handlers.

So the only real-transport failure mode that is not an exit code has **no test anywhere in 408 tests**.
What the engine does with a rejected `exec` mid-grade is unknown behaviour: it may be caught, or it may
surface as an unhandled rejection, a 500, or a report that reads as a failed lab.

**Direction: false fail, and it is the most likely one on the branch.** R1 (WSL2 → VMnet8 reachability) is
still **unverified**, so "the transport cannot reach the guest" is a plausible first-contact state for this
user rather than an exotic one — and a student who solved the lab being told they did not, because the
network dropped, teaches the wrong lesson at the worst moment.

`Ruling: hand P31 to the whole-branch review as a directed target rather than opening a task round for it
— why: it is a gap in test coverage over a path whose behaviour I have not established, so the fix is
unknown until someone measures what the engine currently does with a rejection, and guessing at a fix
before that measurement is how a false-fail becomes a swallowed error; the whole-branch review is the right
place because the answer spans the transport, the grading sequence and the Lab screen — cost if wrong: the
single fix dispatch inherits a finding that needs a test plus possibly an error path, which is more than a
line.`

Do **not** let the fix reduce to catching the rejection and reporting a failed checkpoint. That converts an
unhandled error into a certified false fail, which is worse.

## P32 — the fourth silent-green channel: `# unprobed-invariant:` is optional, so absent and misspelled are indistinguishable. `MEASURED` by the Task 25 implementer. Parked, and here is the line I am drawing

Same shape as F1 and as the `antisolutions/` channel, one layer down: because the header is optional, a
misspelling reads as a deliberate omission. Measured: `# unproved-invariant:` gives `rhcsa lint` **exit 0**
with zero problems, and `var-intact` silently demotes from a declared invariant to an informational note.

`Ruling: park P32 rather than fix it in Task 25 — why: nothing outside src/cli/lint.ts reads that header
(grepped), so no verdict, no grade and no student-visible number moves when it demotes; and unlike F1 and
round 2's rule 3 the golden fixture *does* catch this one, measured — the inventory differs — cost if wrong:
a mistyped invariant header goes uncounted as an invariant while still being visible as a note, in a field
no consumer reads today.`

**The line this draws, which matters more than the item.** I refused the "the golden fixture would catch
it" defence for F1 and I refused it again for the `antisolutions/` channel, so parking P32 *on that same
defence* needs the distinction stated or it is just inconsistency:

- For **F1** the fixture argument failed because the fixture is enforced by a **different command**, and a
  gate's contract must not rest on another gate.
- For **rule 3** it failed harder — solutions carry no headers at all, so the fixture was not merely
  insufficient, it was **unavailable**. Exit 0 with a byte-identical inventory.
- For **P32** the fixture is **available and effective**, measured, *and* the field has **no consumer**. Both
  legs have to hold. If either changes — a second command starts reading `# unprobed-invariant:`, or the
  inventory stops covering it — this becomes a live instance of the class and should be fixed on sight.

So P32 is parked on "no consumer plus a working detector", not on "some other gate probably catches it."
Whoever gives that header its first real consumer inherits this item.

## Residuals that are documented on purpose — do not report these as findings

- **The redactor's unquoted-delimiter case.** `sed -i s\|a\|b\| /etc/hosts` yields `hosts`.
  Task 23's fix round strips *quoted* runs before splitting, which closes the `Listen` /
  `DocumentRoot` / `sdb1` / `grep -E 'foo|bar'` class. The unquoted form survives by ruling —
  chasing it means writing a shell parser for a hint.
- **`for u in alice bob` → `u`, and a `case` label → `a`.** Harmless noise in a hint. Both
  disclosed by Task 23's implementer and accepted by its reviewer.
- **A wrapped command sketches as its wrapper.** `sudo sh -c "systemctl restart httpd"` yields
  `sh` alone from `commandSketch`. Measured unreachable today — no solution, antisolution or setup
  script in the bank uses `sh -c` or `bash -c` — so it is disclosed in that function's docstring
  rather than fixed, for the same reason as the unquoted-delimiter case above.
- **`src/engine/vm/vmrun.ts:108` puts the guest password on `vmrun`'s argv**, visible in `ps`
  for the duration of the call. `scripts/provision.sh:64` documents it; `vmrun` offers no
  file-based guest auth; Task 25's mandate 12 records it as a known limit rather than fixing
  it. The *durable* half of that exposure — the password in shell history — is fixed.

---

## Smaller items, all `CARRIED` — verify the pointer before acting

- Task 10's brief omitted `parseExpectations`'s third parameter.
- Mandate 12.3's rationale was wrong (recorded in that task's report).
- Mandate 14.1's void-count table.
- Task 16's round-2 diff was never separately reviewed.
- Task 18's stdin tests are slow; `makeSshRunner({ timeoutMs: 500 })` is the lever.
- Task 20 blurred "control character" with "C0".
- Task 21's F6 and F8.
- The colon-in-profile-name exposure in `028/setup.sh` — fail-closed, and pre-existing
  rather than introduced.
- ~~`src/server/index.ts` has **zero** test coverage and holds two of the three controls on
  the unauthenticated terminal endpoint.~~ **Struck — closed in Task 23's fix round 1.** The
  reviewer ruled extract, on a better reason than the one I parked it under: `HOST` is one
  character from binding `::` (measured both arms) and no test would have failed. A
  side-effect-free `src/server/config.ts` now holds `readPort`, `HOST`, `VITE_DEV_PORT` and
  `allowedOriginsFor`, pinned by a test that asserts `server.address()` is
  `127.0.0.1`/IPv4 — the regression test for mandate 2(a) itself. Verify it landed before
  treating this as closed.
- Task 24's Step 16 checks 4-6 and 9-13 are a blank second manual scenario.
- `provision.sh:34`'s quoting comment is placed above the wrong line.

## Not findings — do not report these

- `shellcheck` is not installed. Six tasks have confirmed it.
- **Any absolute `as`-cast figure quoted in these documents.** "src 5 / test 29" and its variants
  are counts of one specific pattern (P6's `(err as ContentError)`), not of all casts, and a `git
  grep -oE '\bas [A-Za-z]'` sweep I ran to check them matched English prose in comments and was
  itself wrong. The gate is per-commit — "this diff adds no cast" — measured on the diff. Do not
  reconcile a document's absolute number against the tree.
- `npm run validate` and `npm run test:vm` cannot run: no ISO, no VM. Their absence is not
  a finding, and neither is any manual step gated on them.
- The `content/concepts/*.md` glob matches nothing — the cards are in per-area
  subdirectories, and under zsh a failed glob is an error rather than an empty expansion.
  Use `find`. The bank holds 5 tasks and 10 cards.

## P33 — a walk still remains under rule 6: deleting a whole task directory gives `rhcsa lint` exit 0. `MEASURED` by the Task 25 re-reviewer. Parked by ruling, and the reason is architectural rather than a matter of taste

Round 2's rule 6 reconciles the graders found on disk back against `bank.tasks`, which was the right
direction and which caught the real hole it was aimed at — a task whose `task.yaml` is removed vanishes from
the bank, and the lint used to agree with a bank that had silently shrunk.

But the reconciliation bottoms out on a walk in **both** directions, because `bank.tasks` is itself built by
walking for `task.yaml`. So the failure one level up survives: **delete an entire task directory and the lint
exits 0, reporting `no problems in 4 grader(s)`.** Nothing is inconsistent — the bank genuinely has four
tasks now, and all four are well-formed. Only the golden-fixture drift test discriminates the state, because
only it holds a committed record of what the inventory used to be.

I am not fixing this in a fix round, and this is deliberately *not* the golden-fixture defence I refused
twice earlier on this task. The distinction: **a walk cannot detect the absence of something it has no
independent record of.** For F1 and for rules 1-6, an in-command source of truth existed and was simply not
consulted — `bank.tasks` was right there. Here there is none. Closing P33 honestly requires a **committed
manifest of expected task ids**, which is a new content artifact carrying its own regeneration and drift
story, and inventing one inside a fix round is how a gate acquires a second gate to maintain.

`Ruling: park as P33 rather than fix it in Task 25 round 3 — why: unlike every other channel found on this
task there is no in-command source of truth being ignored, so the honest fix is a new committed artifact
rather than a guard, and that is a feature decision for the whole-branch review or Phase 2; the golden
fixture does discriminate the state today, and the exposure is an entire task directory vanishing, which is a
far louder event than the misspelled subdirectory that motivated rule 1 — cost if wrong: deleting a task, or
never committing one, goes uncaught by the gate that runs on every commit and is caught only by a drift
test whose failure reads as "the fixture is stale" rather than "a task is missing".`

For the whole-branch reviewer: the decision to make is whether the manifest is worth building now. The
argument for is that it also closes the drift test's own weakness — a fixture that a hurried author
regenerates rather than investigates. The argument against is that it is one more file to keep true.

## P34 — `coverage --strict` is already red on the shipped bank, so nothing may treat it as a backstop. `MEASURED` by the Task 25 re-reviewer, low severity and high blast radius as an argument

While ruling on P33 the re-reviewer checked whether `coverage --strict` could serve as the second gate that
notices a vanished task. It cannot: **it is already red on the committed bank, with 58 uncovered
objectives.** That is expected at the end of Phase 1 — five tasks cannot cover the full EX200 taxonomy, and
nobody claimed otherwise.

The reason this is worth parking is not the redness. It is that **a gate which is red on the shipped tree
cannot be anyone's backstop**, and reasoning of the form "well, `coverage --strict` would catch that" has
appeared informally more than once on this branch. A permanently-failing gate is one nobody runs, and a
check nobody runs is a check that does not exist — the same conclusion this whole task arrived at from the
other direction.

Two things for the whole-branch reviewer to rule on: whether `coverage --strict` should be given a
Phase-appropriate threshold so that it becomes a gate someone can act on, and whether any doc, script, or
comment currently cites it as protection for something. If it does, that citation is the wrong-disclosure
class again.

## P35 — an anti-solution whose body does nothing is certified as a working detector. `REASONED`, needs a guest to measure, and **statically closable for the common case**. Corrected once after the implementer retracted its own version and I had to retract half of mine

This item went through two wrong framings before landing. Both are recorded because the corrections are the
useful part.

**The implementer's framing, retracted by the implementer.** It named `runFixture`'s
`if (fixture.script.trim() !== '')` at `src/engine/validate/harness.ts:199` as a precondition computed from
the thing it validates, and reasoned a whitespace-only anti-solution would slip through. It then read the code
and retracted: `parseExpectations` runs at `:165`, **thirty-four lines above the guard**, and
`expectations.ts:41-45` throws `must declare a "# expect-fail:" header…` when no header matches, returning
`ok: false` at `:167`. So a whitespace-only anti-solution has no header and is **already red before the guard
is consulted**. `measured` by code reading, verified independently by me. The guard is reachable only for the
`kind: 'none'` baseline fixture, whose script is `''` by construction and for which skipping is correct —
**right shape, no bite. It is not the culprit and there is nothing to fix at `:199`.**

**My framing, half retracted.** I widened it to three shapes and claimed the first was live. It is not — the
retraction above kills it. What I got right is that the guard is the wrong culprit and that the real defect is
the absence of any **baseline comparison**. The implementer arrived at the same place independently, which is
the strongest evidence either of us produced.

### The defect that survives, and why it is worse than the version we both started with

An anti-solution exists to prove the grader **detects a specific wrong answer**. `runFixture` resets, runs
`setup.sh`, runs the fixture, grades, and compares the verdict against `declared`. **Nothing establishes that
applying the anti-solution changed the machine.** So a fixture that leaves the machine at the unsolved
baseline passes: at baseline the goal checkpoints fail, which is exactly what it declared. It is green because
the task is unsolved, not because the grader caught anything.

Two reachable shapes:

- **Shape A — a body of only comments** (plus `set -euo pipefail`). Header present, so `trim() !== ''` is
  true, `exec` runs, bash exits 0 having done nothing. **And note the header line is itself a comment**, so
  this is not a contrived state — it is the *natural* form of a half-written anti-solution: write the
  `# expect-fail:` header and the explanatory paragraph first, add the command later. Every anti-solution in
  the bank is written in exactly that style. This is the shape to fix.
- **Shape B — a command that succeeds but is a no-op on this machine.** Harder, and possibly not closable
  without per-fixture assertions.

### What the shipped bank actually shows — narrower than I first wrote

I claimed this was "live on the shipped bank." That was too strong and I am correcting it.
**Statically there is no shape-A instance:** the thinnest three anti-solutions each carry exactly one real
command (`014/01-forgot-growfs.sh`, `014/03-wrong-lv.sh`, `017/02-faked-the-end-state.sh`), the rest three to
fourteen. `measured` by the implementer.

What the bank does contain is a **shape-B candidate flagged by its own author**.
`content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh` declares exactly the grade script's
`# baseline-fail:` ids, deliberately, and says so:

> Declares exactly the same ids as grade.sh's `# baseline-fail:` header, on purpose - this is a genuine
> detector, not a copy-paste accident. […] That is only safe because harness.ts now checks this fixture's own
> exit code (mandate 2): if lvextend here silently failed for lack of free space, the machine would be
> indistinguishable from the baseline and this fixture would report ok while probing nothing.

The author reached this defect class independently and **wrote the failure sentence almost verbatim**, then
concluded the exit-code check closes it. The exit-code check catches a fixture that *errors*. It does not
catch shape A (exits 0, does nothing) and it does not catch shape B (`lvextend` succeeding while consuming
free space that was never there to matter). So the comment is the **wrong-disclosure class** in committed
content: protection asserted over one of three routes to the same outcome, reading as though it covers all
three. That fixture's declared-equals-baseline design is precisely the condition under which a verdict
comparison cannot discriminate it.

### Direction, severity, and the thing neither of us saw first

**False green on the bank itself**, and the most consequential instance of that direction on the branch,
because it certifies the grader's *discrimination* — the property a student's pass or fail actually rests on.
Capped by one fact: `harness.ts` is `npm run validate`, which **has never executed against a guest** and
cannot until the ISO is downloaded. So it is latent, not currently misreporting. It becomes load-bearing the
first day `validate` runs, which is also the first day anyone trusts it. `REASONED` — settling it needs
verdict A, which needs a guest.

**But shape A is statically closable, in the gate that already runs, and neither of us said so.** The
implementer concluded "the check that would close it also needs a guest, so it is a `harness.ts` feature."
That holds for shape B. It does **not** hold for shape A: strip comments, blank lines and `set -e…` from an
anti-solution body, and if nothing remains, the fixture does nothing — no guest, no verdict, pure content
inspection. It belongs in `rhcsa lint`, it would not fire on any of the sixteen anti-solutions in the bank
(measured above), and it is the cheapest real fix on the parked list. **This is the concrete recommendation.**

The runtime fix for shape B remains a `harness.ts` change: require the anti-solution's verdict A to differ
from the baseline's verdict A.

There is also a **static signal for the shape-B candidate** — "this anti-solution declares exactly the grade
script's `# baseline-fail:` set" needs no guest. **Do not simply add it as a rule:** it fires on
`03-wrong-lv.sh`, which is committed, deliberate and defended in writing, so as an error it is a false fail on
the bank. As a warning, or paired with the runtime check, it is defensible.

`Ruling: park as P35 for the whole-branch review rather than open Task 25 round 4 — why: the runtime half
lives in harness.ts, outside this task's scope (touched for two exports only) and in the gate that has never
run, and burning round 4 of 5 there spends the task's remaining budget on the wrong file; the static half
(shape A in `rhcsa lint`) is genuinely in Task 25's territory but was identified after `45344bd` was already
in re-review, and reopening a committed, re-reviewed round to add an unrequested rule is how this task
acquired three of its four silent-green channels in the first place — cost if wrong: an inert anti-solution
stays certified until validate first runs, which is exactly when someone starts trusting it.`

Three questions for the whole-branch reviewer: whether the shape-A static rule belongs in the single fix
dispatch (my view: yes, it is cheap, needs no guest, and fires on nothing today); whether shape B is closable
at all without per-fixture assertions; and whether `03-wrong-lv.sh`'s header should be corrected regardless of
whether any code changes, since it currently tells a reader the hazard is handled.

### Update — shape A is in Task 25 round 4; shape B and the header correction remain here

The venue ruling above is superseded for the same reason P36's was: NEW-3 made a round 4 mandatory, so the
premise "rather than opening a round 4" no longer holds, and shape A's static rule went into
`task-25-fix-4.md` alongside NEW-3 because all three items are rules in `src/cli/lint.ts` sharing the
`isFile`/walk vocabulary. **What the whole-branch dispatch still carries from P35:**

- **Shape B**, unchanged — a command that succeeds but is a no-op on this machine. The fix is a `harness.ts`
  runtime check requiring the anti-solution's verdict A to differ from the baseline's. Still `REASONED`, still
  needs a guest, still latent until `validate` first runs.
- **The `03-wrong-lv.sh` header correction**, and it is the one to rule on. Its author reached this defect
  class independently and wrote the failure sentence almost verbatim, then concluded the exit-code check closes
  it. **It does not:** the exit-code check catches a fixture that *errors*, not one that exits 0 having done
  nothing (shape A) and not one whose command succeeds vacuously (shape B). So a committed content file
  currently asserts protection over one of three routes to the same outcome, in wording that reads as though it
  covers all three. It was deliberately excluded from round 4 — editing a content file in the same diff as a
  new content rule creates the appearance and the risk of a rule tuned to its own fixture.
- **The shape-B static signal** ("declares exactly the grade script's `# baseline-fail:` set"), also excluded
  from round 4: it fires on `03-wrong-lv.sh`, which is committed, deliberate and defended, so as an error it is
  a false fail on the shipped bank. Adding a warning tier to accommodate it is a new concept in `rhcsa lint`
  and was not fix-round work. As a warning, or paired with the runtime check, it stays defensible — that is a
  decision for the whole-branch review.

## P36 — **SUPERSEDED by NEW-3 and routed into Task 25 round 4.** Everything below is retained as the record; the live item is NEW-3 in `task-25-rereview-2.md`

**Read this header before the entry.** The round-3 re-review measured this residual to be **materially wider
than the entry below states**, and produced the formulation the addendum asked for. Two corrections:

1. The entry says the cost is `--allow-empty` **+** zero graders **+** no anti-solutions **+** an unloadable
   bank. Measured, the anti-solution condition is real but the rest understates it: the same stripped bank
   with **one broken `objectives.yaml`**, or with `concepts/` deleted, or with `tasks` as a regular file, is
   exit 0 / 0 problems / empty stderr. So this is not a narrow flag-only curiosity — **it re-opens NEW-1's
   exact channel for any bank that fails to load**, reachable from a single YAML typo.
2. The formulation exists and is one line:
   `if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml'))))`. Measured to close all three
   exit-0 holes while preserving the bare directory, round 1's `emptyRoot()` and the zero-task case at exit 0,
   with the full suite at 431 pass / 0 fail. It reuses the `isFile` helper round 3 added.

**The addendum's phrasing requirement was met independently.** It demanded *"this named file is absent"* over
*"the walk found no `task.yaml`"* — a filesystem fact about a fixed path rather than NEW-1's shape one artifact
along. The re-reviewer, working by measurement and without reading the addendum, implemented exactly the safe
phrasing. That convergence is the strongest evidence either produced that the distinction is real.

**The venue ruling at the bottom of this entry is also superseded.** It sent P36 to the whole-branch fix
dispatch on the explicit premise "rather than opening a round 4". NEW-3 is load-bearing and re-opens round 3's
own blocker, so a round 4 became mandatory and the premise no longer holds. P36 and P35 shape A are both in
round 4's brief (`task-25-fix-4.md`). **The whole-branch fix dispatch no longer carries P36 at all.**

The original entry follows unedited, because a reader who remembers it should learn where it was wrong rather
than find it silently rewritten.

### P36 (original entry) — `rhcsa lint` reports a clean bank on a half-authored task directory, and the state is a real authoring state rather than a constructed one. `MEASURED`. Bounded by two neighbouring commands

The residual the Task 25 implementer disclosed in round 3 and pointedly did **not** defend, which was the
right posture. After NEW-1 was fixed, the bank-did-not-load *message* still sits behind
`graders.length > 0`. Cost: `--allow-empty` **+** zero graders **+** no anti-solutions **+** an unloadable
bank → **exit 0, 0 problems**. With anti-solutions present it is exit 1 either way (16 orphan rows); without
the flag, exit 1. It survives because removing the guard outright breaks `--allow-empty` on a bare directory.

Two measurements that between them decide how much this matters:

**Reachability of the flag: low.** `--allow-empty` appears in **no npm script, no `docs/` page, no README
line and no CI file** — only in `USAGE` and in tests. So `npm run lint:content`, the gate the exit criterion
actually points a reader at, cannot reach this state; a human has to type the flag.

**Reachability of the root state: high, and this is the uncomfortable half.** `task.yaml` written first with a
YAML error, no `grade.sh` and no `antisolutions/` yet is **precisely the half-authored case `--allow-empty`
documents itself for**. So this is not a curiosity that requires constructing a hostile directory; it is the
flag's own advertised use case landing on its blind spot.

**What bounds it:** both neighbouring commands catch the same root. `rhcsa coverage` and `rhcsa validate`
each report the five `task.yaml` parse errors and exit **1**, and `validate` does so from `loadBank` **before
it touches `loadVmConfig`**, so no guest is involved. `measured`.

So: a hole in *this* command's coverage, covered by two commands beside it. That is a materially weaker
finding than a hole nothing catches — but it is still `rhcsa lint` printing a reassuring `0 problems` over
content it could not read, which is the sentence this whole task exists to eliminate.

`Ruling: park as P36 rather than reopen the committed and re-reviewed 45344bd — why: the flag is unreachable
from every scripted path, two neighbouring commands catch the same root without a guest, and the implementer
disclosed it rather than defending it, so nothing is hidden; reopening a re-reviewed commit to fix a
human-typed-flag-only path would cost a fourth round for a state two other commands already report — cost if
wrong: a half-authored bank reads as clean to anyone who types --allow-empty and does not then run coverage or
validate.`

I have asked the round-3 re-reviewer one question that could change this ruling: **is there a formulation that
keeps `--allow-empty` working on a bare directory while still reporting an unloadable bank?** The implementer
established that *removing* the guard breaks the former, which is true and is not the only option —
distinguishing "no bank file at all" from "a bank file that failed to load" may separate the two cases
cleanly. If it does and it is small, this should be fixed in the single whole-branch fix dispatch rather than
parked.

### P36 addendum — the formulation exists, it is small, and it comes with the trap named

Asked whether a formulation exists that keeps `--allow-empty` working on a bare directory *while* still
reporting an unloadable bank, the Task 25 implementer answered `reasoned` (from the code, not measured) and the
answer is good enough to act on:

**`--allow-empty`'s real assertion is "no task is authored here," which is a question about named paths rather
than about counts.** `objectives.yaml` existing, and any `task.yaml` existing under `<root>/tasks`, are both
answerable with the `isFile`/walk vocabulary already in `src/cli/lint.ts`. Either being present means the root
**is** a bank, at which point a load failure is a problem the flag must not suppress. No inspection of the
aggregated `ContentError` is needed.

**And it named the trap, which is the part that makes this worth quoting rather than paraphrasing.** Phrase the
condition as *"the walk found no `task.yaml`"* and it is **NEW-1's shape again, one artifact along** — a
precondition computed from a walk of the very thing being validated. Phrase it as *"this named file is
absent"* and it is a filesystem fact about a fixed path, which is safe. The two read almost identically in
English and are not the same check. **Require the second phrasing**, plus a test pinning the
malformed-`task.yaml`-with-no-`grade.sh` root at **exit 1 under the flag**, since that root is the flag's
advertised use case landing on its blind spot.

### Venue: the single whole-branch fix dispatch, not a Task 25 round 4

`Ruling: fix P36 and P35's shape-A rule together in the whole-branch fix dispatch rather than opening Task 25
round 4 — why: both are rules in src/cli/lint.ts using the same isFile/walk vocabulary, so one dispatch on one
file with one review is strictly cheaper than a round 4 plus the whole-branch dispatch that will touch that
file anyway; and the escalation rule puts rounds 4-5 on a fresh implementer one tier up, which would discard
the accumulated context on this exact file to do work the later dispatch already covers — cost if wrong: two
cheap lint rules land one gate later than they could have, with the half-authored-bank state reading clean to
anyone who types --allow-empty in the interim.`

Both items are therefore **fix candidates for the single dispatch**, not merely findings to adjudicate:

1. **P35 shape A** — an anti-solution whose body is only comments, blank lines and `set -e…` does nothing;
   report it. Pure text, no guest, fires on none of the sixteen anti-solutions in the bank today.
2. **P36** — gate the bank-load *message* on "`objectives.yaml` or any `tasks/**/task.yaml` is present as a
   named path," not on the grader count, so `--allow-empty` still exits 0 on a genuinely bare directory while
   an unloadable bank is always reported. Written the "named file absent" way, never the "the walk found none"
   way.

---

## P37 — `CARRIED`. The content gate asks a named-path question and accepts a walk's answer; the two disagree about symlinks. Plus the sentence that reframes P36/NEW-3's whole distinction.

**Source:** round 4 of Task 25, answering the closing question *"now that you have the named-path-vs-walk
distinction in hand, is it used interchangeably anywhere else in `src/cli/lint.ts`?"* It swept every
filesystem-derived fact in the file in **both roles** — as the question asked and as the answer supplied — and
found exactly one site. Independently verified by `task-25-rereview3`; see that report for the confirmation.

**The site: `!graders.has(join(task.dir, 'grade.sh'))` at `src/cli/lint.ts:375`.** The *question* is a
named-path fact — is there a readable `grade.sh` at this exact path? The *answer* comes from the walk.

**The divergence, both ends measured:** `shellScripts` filters on `entry.isFile()`, which does **not** follow
symlinks. `isFile` uses `stat`, which does. On a bank copy with `014-grow-home-lv/grade.sh` replaced by a
symlink to a real script: `graders checked: 4`, exit 1, 4 problems — `014-grow-home-lv is in the bank but has
no grade.sh`, plus three `no sibling grade.sh`. The same substitution on `setup.sh`, which *is* checked by
named path, gives exit 0 / 0 problems. `loadTaskScripts` reads both with `readFile`, which follows symlinks, so
**`isFile`'s answer matches the runtime and the walk's does not.**

### Why this is parked rather than fixed, and the sentence that decides it

The argument is round 4's, and it is the most useful thing produced on this task:

> NEW-1's shape is a walk supplying the **expectation**. Here the expectation comes from `bank.tasks` and the
> walk supplies only the **observation**. A walk that under-reports an observation against an independent
> expectation makes the rule fire when it should not — a **false fail**, loud. A walk that supplies the
> expectation makes the rule not fire at all — a false green, silent. **Direction, not structure, is what
> separates them.**

Every prior formulation of this distinction on the branch was purely structural — *where does the precondition
come from*. This one says structure alone does not settle it; you must also ask which way it fails. It
retroactively explains why the `setup.sh` rule and the `grade.sh` rule can share a shape while only one of them
is a problem, and it is the cleanest available statement of what NEW-1, P36 and NEW-3 were all circling.

Two adjacent sites round 4 checked and recorded clean, worth spot-checking rather than re-deriving:

- **`taskDirOf(grader)` against `new Set(bank.tasks.map(t => t.dir))` (`:436`)** — two walk results compared to
  each other, no named-path fact involved, so not an instance of the interchange. The path strings agree by
  construction: `task.dir` and every grader path are both composed with `join` from the same `root` string
  `lintContent` received, with no `realpath` or renormalisation on either side. (That this reconciles two walks
  and therefore cannot notice an entire task directory vanishing is **P33**, parked separately.)
- **`emittedByTask.get(dirname(dirname(file)))` (`:639`)** — a task directory derived by name from a walk-found
  path, looked up in a map keyed by `taskDirOf`. Both sides come from the same `files` walk, so they agree by
  construction for the shape the bank uses; where they can diverge (an anti-solution nested one level deeper)
  it fails closed twice, measured: the `extra/` directory is reported as a non-`.sh` entry under
  `antisolutions/`, and the nested file as `no sibling grade.sh`. Exit 1, 2 problems.

No site was found where the reverse substitution happens — a walk-shaped question answered by a named-path
fact — and none where a named-path fact asserts the absence of something the file has no independent
expectation for. The one candidate for the latter, `graders.length === 0` at `:486`, is a walk result reported
as its own subject: the message says the walk found nothing, which is exactly what the walk knows.

`Ruling: parked, not fixed in Task 25. Why: it fails closed in every constructed case, nothing in the committed
bank symlinks a grader, and Task 25's gate was whether items 1-3 landed — a closing question answered with a
measured divergence and a direction argument is the question working, not a failure. Cost if wrong: a future
bank that symlinks a grade.sh gets a spurious exit 1 on the content gate — loud, attributable, and incapable of
reaching a student as a false pass.`

**For the whole-branch reviewer:** the cheap fix is one line — ask the named-path question with the named-path
check (`await isFile(join(task.dir, 'grade.sh'))`) instead of consulting the walk's set — but it is not
obviously correct, because `graders` is also the set the rest of the command iterates, and making the two
disagree in the *other* direction (a grader that `isFile` accepts but the walk never visited, so it is never
linted) would be worse than the current state. Rule on that before touching it. This is a good candidate for
"correct as documented behaviour" rather than a code change.

---

## P38 — a comment asserts the rules ran, on the only path that reaches it

**`src/cli/lint.ts:519`.** Severity Low. Direction: **understates a false-green residual to the next
reader** — the disclosure class, eleventh-plus occurrence, and the third consecutive round to leave an
inaccurate sentence in a comment it rewrote. Not load-bearing.

The sentence:

> This condition is about the **message**, not about the rules. The rules ran unconditionally above and
> nothing here can suppress them; all that is decided here is whether the loader's failure earns a line.

`checkFixtureFloors` is called at **`:575`** — after the `try`/`catch` closes, gated on
`bank !== undefined`. Inside the `catch`, `bank` is `undefined`. So on the only path where this comment
is ever read, the rules did not run and will not run. `MEASURED` by the re-review: a stripped bank with
a broken `objectives.yaml` and five `task.yaml` declared exits 1 with **exactly one** problem — the
`the bank did not load` line, zero floor problems, though five tasks are declared and every `grade.sh`
is missing. The same root with `objectives.yaml` deleted gives **0 problems total**.

The intent is true and was verified: this condition governs only whether a line is pushed, and the
floors are genuinely not gated on `graders` (round 3's fix). The charitable reading of "above" is "at
the location the block comment above documents". But the indicative past tense asserts something false
in that branch, and the inference a reader draws from it is exactly the one that produced NEW-3: *the
floors already reported on this root, so suppressing the message loses nothing.*

Mitigated twice by the same comment, both times correctly — its opening line is `"The floors could not
be checked" is itself a problem`, and its residual paragraph states the true outcome plainly ("the
command exits 0 with empty stderr"). A reader who reads the whole comment gets the truth; only one who
stops at that sentence does not.

**Fix is one clause:** `The rules above are not gated on this condition, and nothing here can suppress
them.` Do not delete the sentence — the distinction it draws is the one a reader needs; only its tense
is wrong.

## P39 — `SHELL_OPTION_LINE` swallows a `set`-plus-command one-liner: a false fail on content

**`src/cli/lint.ts:211`, applied at `:225`.** Severity Low. Direction: **false fail on content** — the
risk direction item 3's brief flagged as the unusual one for this rule, materialising. Not
load-bearing.

```ts
const SHELL_OPTION_LINE = /^set\s+[-+]/          // :211
if (line === '' || line.startsWith('#') || SHELL_OPTION_LINE.test(line)) continue   // :225
```

Start-anchored only, so everything after the option prefix is discarded with the line. `MEASURED`: an
anti-solution whose entire body is

```bash
#!/usr/bin/env bash
# expect-fail: fs-home-size
set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home
```

is reported as `nothing here but comments and shell options`, exit 1 — a fixture that does real work,
rejected, with the rule named in the message so the author is told the opposite of the truth.

The constant's own comment is adjacent to the cause: "the trailing `pipefail` of `set -euo pipefail`
needs no clause of its own, because **the whole line is what matches**." Under the reading "the whole
line must match" that is false; what is true is that the whole line is *discarded* once the prefix
matches — which is precisely the false fire. So P39 is P38's class as well as a code defect.

Not load-bearing: no committed fixture uses that style, the rule fires on none of the sixteen, and the
shape requires an author to put `set` and a real command on one line, against the convention every
fixture in the bank follows.

**Fix:** `/^set\s+[-+][^;]*$/`, or split each line on `;` before testing. If you take the regex form,
fix the constant's comment in the same edit — the sentence that misdescribes it is how the defect
survived authoring.

**Note on the pairing:** P38 and P39 are both one-line edits in `src/cli/lint.ts`, the same file target
6 and P35's remainder already open. Do them in that dispatch, not as their own.
