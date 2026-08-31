# Pre-flight consistency scan — Tasks 15–22

Plan: `docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md`
Slice: Task 15 (line 4057) → Task 22 (7015–8459), plus binding lines 1–105.
Method: every `import` in the slice checked against the producing task's declared
exports; every `ck`/`ck_pass` id, every `# expect-fail:` / `# baseline-fail:`
header, and every stated count re-derived from the code in the plan.
All line numbers are lines in the plan file.

---

## Table A — cross-task interface pairs

| Tasks | Produced | Consumed | Finding |
|---|---|---|---|
| T15 → T17 | `.env.local` keys `RHCSA_VMX`, `RHCSA_VM_IP` (4255–4258) | `loadVmConfig(env)` reads `RHCSA_VMX`, `RHCSA_VM_IP`, `RHCSA_SSH_PORT`, `RHCSA_SSH_USER`, `RHCSA_SSH_KEY`, `RHCSA_VMRUN`, `RHCSA_TRANSPORT` (4775–4823) | OK — every name matches; the three the checklist does not write all have defaults |
| T15 → T19 | guest with `student` in `wheel` (4155), no root SSH (4153) | `provision.sh` → `runProgramInGuest -gu student`, then `sudo` inside `guest-provision.sh` (5558, 5722–5724) | **F6** — nothing ever grants passwordless `sudo`; non-interactive `sudo` cannot authenticate |
| T15 → T19 | manual install; no `clean` snapshot | `provision.sh` creates the live `clean` snapshot (4243) | OK — ownership is explicit in both directions |
| T16 → T18 | R1 answer: is WSL2 → VMnet8:22 reachable (4320) | `chooseTransport` default preference (5449) | OK — T18 works either way, only the outcome differs |
| T2 → T17 | `LabTransport`, `ExecResult` (301, 400) | `VmrunTransport implements LabTransport` (4868) | OK |
| T2 → T18 | `FakeTransport(handler: FakeHandler, opts?)` (301, 417) | `new FakeTransport()` in `test/vm/select.test.ts` (5216) | **F4** — required first argument omitted; typecheck failure |
| T2 → T18 | `LabTransport`, `ExecResult` | `SshTransport implements LabTransport` (5336) | OK |
| T2 → T18 | `TransportKind` incl. `'fake'` | `stub(kind: 'ssh' \| 'vmrun', …)` via `Object.assign` (5215–5221) | OK — assignable |
| T17 → T17 | argv `[…, hostPath, guestPath]`, guestPath at index 7 (4885–4891) | `expect(r.calls[0]?.[3]).toMatch(/^\/tmp\/rhcsa-…\.sh$/)` (4619) | **F5** — index 3 is `-gu`'s value, not the script path |
| T17 → T18 | `VmConfig`, `Runner`, `VmrunTransport`, `realRunner` (4775, 4820, 4868) | `select.ts` imports `VmConfig`, `VmrunTransport`; `Runner`/`realRunner` declared consumed at 5082 but never imported | **F18** (low) — Interfaces over-declares |
| T17 → T18 | `VmrunConfigSlice` (4840) | `SshConfigSlice` is a separate structural slice (5324) | OK — both are satisfied by `VmConfig` |
| T17 → T21 | `loadVmConfig`, `VmController` (4509, 4512) | `src/cli/index.ts` imports both (6796–6798, 6833–6834) | OK |
| T18 → T21 | `chooseTransport(cfg, opts?)`, `require?: TransportKind` (5086, 5449) | `chooseTransport(cfg, require ? { require } : {})` (6838) | OK — matches `ChooseOptions` |
| T17/T18 → T23 | tree line 99 promises `sshArgs` in `config.ts`, "T23" | nothing in the plan defines or imports `sshArgs` | **F17** (low) — dangling tree annotation |
| T20 → T11 | `content/lib/assert.sh` (5844) | `loadTaskScripts` prepends it (6374, 6841) | OK |
| T20 → T21/T22 | `ck`, `ck_pass`, `ck_fail`, `ck_skip` (6088–6096), `to_bytes`, `within_pct`, `lv_size_bytes`, `mount_source`, `fs_size_bytes`, `is_persistent` | T21 grader uses `to_bytes`, `lv_size_bytes`, `mount_source`, `fs_size_bytes`, `is_persistent`; T22 graders use none | OK — all exist; `within_pct` is defined and never used (see **F2**) |
| T20 → T23 | `ck` emitters | `countCheckpoints` regex `/^[ \t]*ck[ \t]+…/` (9000) | **F1** — matches only bare `ck`; T21's grader uses only `ck_pass`/`ck_fail` |
| T5 → T21/T22 | `parseVerdict` over JSONL `{id,desc,status,detail}` | `_emit` output shape (6088–6096) | OK |
| T10 → T22 | `parseExpectations` throws `ContentError` when an antisolution has no `# expect-fail:` header, or an empty one (2510–2526); phases `pre`/`post`/`both` (2482–2488) | `users/006` antisolution 01 deliberately declares nothing (7203–7222) | **F3** — the loader rejects it before the fixture runs |
| T10 → T21/T22 | `@post` phase suffix | `sshd-listening@post`, `stamp-effect@post` (7688, 7716, 7893) | OK — suffix and semantics match the phase table |
| T11 → T21 | `HarnessDeps`, `FixtureResult`, `TaskScripts`, `loadTaskScripts`, `validateTask` (2758–2766) | `validateBank` builds `HarnessDeps` and calls `validateTask` (6653) | OK — field-by-field match |
| T3 → T21/T22 | `TaskSpec`, 17 fields, `loadTask` (495) | 5 `task.yaml` files (6289, 7048, 7250, 7480, 7746) | OK — every field present, no extras, `transport: vmrun` accepted |
| T4 → T21/T22 | `ConceptSpec` front matter `id/title/rhel/objectives/sources/prerequisites` (808–860) | 10 concept cards | OK — 3 cards declare `prerequisites`, all resolve inside the 10 |
| T6/T13 → T21/T22 | `objectives.yaml` ids incl. `storage.lvm.resize` (3608) | 5 `task.yaml` + 10 cards reference 10 distinct objective ids | OK — plan already instructs reconciling against the T13 transcription (7037, 8360) |
| T7 → T21 | `loadBank`, `checkCoverage`, `Bank.tasks: TaskSpec[]`, `tasksById` (1770–1777) | `validateBank` iterates and filters `bank.tasks` (6653) | OK — mutable array, no readonly conflict |
| T12 → T21 | `option`, `flag`, `CliIo`, `run` (3355–3570) | `validate` subcommand wiring (6794–6845) | OK |
| T9/T23 → T21 | masked checkpoint total from `countCheckpoints` | T21 grader's 12 `ck_pass`/`ck_fail` call sites for 5 checkpoints | **F1** — count cannot be derived by call-site counting under T21's style |

---

## Table B — per-task internal consistency

| Task | Files declared vs touched | Tests/fixtures vs code | Finding |
|---|---|---|---|
| T15 (4057) `vm-build-checklist.md` | Creates `docs/vm-build-checklist.md`, `.env.local`; both in the tree (55, 58) | No tests (manual) | OK — but see **F6**: the checklist's own guest is not `sudo`-capable non-interactively |
| T16 (4310) `r1-probe.sh` | `scripts/r1-probe.sh`, `docs/r1-findings.md`; both in the tree (66, 53) | No unit tests; probe is the acceptance | OK |
| T17 (4496) `config.ts` + `vmrun.ts` | Files omits `test/vm/config.test.ts` even though Step 2 writes it (4503 vs 4521) | Stated 5 config + 13 vmrun tests; `it(` blocks = 5 + 13 | **F14** (low) files list; **F5** argv index; **F12** flag syntax |
| T18 (5072) `ssh.ts` + `select.ts` | `src/engine/vm/ssh.ts`, `select.ts`, `test/vm/ssh.test.ts`, `test/vm/select.test.ts` — all created | Step 6 says "10 ssh tests"; 9 `it(` blocks exist. Select tests = 6, matches | **F3'**→ **F10** (count), **F4** (`new FakeTransport()`), **F18** (Interfaces) |
| T19 (5530) `provision.sh` | Creates `scripts/provision.sh` **and** `scripts/guest-provision.sh`; the tree lists only the former (67) | No unit tests; `bash -n` + a live run | **F15** (low) tree; **F16** (low) guardrail message; **F6** (sudo) |
| T20 (5839) `assert.sh` | `content/lib/assert.sh`, `test/lib/assert.test.ts`; tree line 72 matches | Prose says "Eight helpers" — 10 functions defined; "~24 tests" — 26 `it(` blocks | **F8** (escaping test cannot pass), **F17'**→ **F19** (low counts) |
| T21 (6256) first task + `validate` | Declares `test/cli/validate.test.ts` (6272), which no step creates; omits `src/engine/validate/run.ts` (6628) and `test/validate/run.test.ts` (6680), both of which Step 7 creates and the commit adds (6995) | 6 fixtures (`none` + 2 solutions + 3 antisolutions) vs `6/6 fixtures ok` (6972) — arithmetic OK; 2 `validateBank` tests | **F11** (files list), **F2** (fixtures cannot reach 6/6) |
| T22 (7015) four tasks + 8 cards | 4 task dirs × 8 files + 8 cards; `concepts: 10` = 2 (T21) + 8 ✓; `tasks: 5` ✓; `untaught concepts: 0` verified — all 10 cards are named by some `requires_concepts` | 3 SSH tasks × 6 fixtures = `18/18` (8402) ✓ arithmetic; vmrun task 6 fixtures ✓ | **F3** (headerless antisolution breaks 18/18), **F9** (Step 8 script), **F7** (firewall over-fit) |

---

## Table C — grader and content rules, per authored task directory

| Task dir | `ck` ids all literal? | `baseline-fail` matches goal checkpoints? | Every antisolution's `expect-fail` exact? | Read-only? | Finding |
|---|---|---|---|---|---|
| `storage/014-grow-home-lv` (6261) | Yes — 12 `ck_pass`/`ck_fail` sites, 5 literal ids, no loops, no interpolation | Yes — `lv-home-size, fs-home-size` are the 2 goals; `home-from-lv`, `var-intact`, `persist-config` are correctly left undeclared as invariants | Yes — 01 `fs-home-size`; 02 `persist-config`; 03 `lv-home-size, fs-home-size` (verified against each script's effect in both verdicts) | Yes — no `set -e`, no writes, `lvs`/`findmnt`/`df`/`grep` only | **F1** (emitter style breaks `countCheckpoints`), **F2** (`fs-home-size` unreachable for both solutions) |
| `users/006-team-provisioning` (7048) | Yes — 8 `ck` sites, 8 literal ids; the `in_devops` helper is used instead of a loop (7121) | Yes — 7 goals declared; `student-intact` correctly undeclared | **No** — `antisolutions/01-primary-group-only.sh` declares no header at all (7203–7222) | Yes — `getent`/`id`/`sudo -l -U`; the outer `sudo` in `sudo sudo -l -U alice` (7145) is correct, not redundant | **F3** |
| `selinux/019-httpd-alt-port` (7250) | Yes — 8 `ck` sites, 8 literal ids | Yes — 7 goals; `selinux-enforcing` correctly undeclared | Yes — 01 `context-permanent@post` + `page-served@post`; 02 `firewall-permanent@post`; 03 `port-labeled`, `page-served` (each re-derived from the script) | Yes — `semanage -l`, `matchpathcon -n`, `stat -c %C`, `curl` | OK |
| `systemd/017-boot-time-service` (7480) | Yes — 5 `ck` sites, 5 literal ids | Yes — `unit-verifies, stamp-enabled, stamp-effect`; `default-target` and `sshd-intact` correctly undeclared invariants, and `setup.sh` pre-sets `multi-user.target` on purpose (7584) | Yes — 01 `stamp-enabled, stamp-effect@post`; 02 `unit-verifies, stamp-enabled, stamp-effect@post`; 03 `default-target` only, and it does still pass in verdict B because `graphical.target` pulls in `multi-user.target` | Yes — `systemd-analyze verify`, `systemctl is-enabled`, `[ -f ]` | OK. `stamp-effect` does mean something different in A ("it can run") than in B ("it ran at boot"), which the grader states outright (7605–7610); both solutions use an explicit start, so no fixture breaks |
| `troubleshooting/028-restore-remote-access` (7746) | Yes — 5 `ck` sites, 5 literal ids | Yes — 4 goals; `student-intact` correctly undeclared | Yes — 01 `sshd-enabled, sshd-listening@post`; 02 `firewall-ssh`; 03 `net-autoconnect`. Verdict B of 03 leaves the guest with no network, which is exactly why `transport: vmrun` is pinned | Yes — `systemctl is-enabled`, `ss -H -ltn`, `firewall-cmd --list-all`, `nmcli -g` | **F7** (`firewall-ssh` accepts only the named service), **F13** (`nmcli -g FILENAME` in solution 02) |

Also verified for all five: the grader deliberately avoids a checkpoint whose
verdict changes meaning ("does the machine have an IP", 7817–7821); no grader
uses `set -e`, so a failing probe cannot abort the run before later `ck` calls;
`$?` is always the exit status of the immediately preceding command, and the
`"…$(cmd)"` detail arguments are expanded left-to-right after `$?`, so they
cannot clobber it.

---

## Findings requiring a ruling

### High

**F1 — `countCheckpoints` returns 0 for the first real task.**
Lines 9000 (`const CK_CALL = /^[ \t]*ck[ \t]+[a-z0-9][a-z0-9-]*/gm`), 6367–6448,
7154–7159.
T21's `grade.sh` emits exclusively through `ck_pass`/`ck_fail`; `ck_pass` does
not match `ck` followed by whitespace, so `countCheckpoints` returns **0** for
`storage/014-grow-home-lv` and the Lab screen's masked total is 0. T23's own test
fixture (8815–8825) uses bare `ck`, so the unit test passes and nothing catches
it. Broadening the regex alone is not enough: T21's grader has **12** emit sites
for **5** checkpoints (if/else branches per id), so the plan's stated rule "the
count of `ck` call sites is the masked total" (7154) is false for T21's style.
Smallest fix: make `countCheckpoints` collect ids and return the deduplicated
count —
`[...new Set(gradeScript.match(/^[ \t]*ck(?:_pass|_fail|_skip)?[ \t]+([a-z0-9][a-z0-9-]*)/gm)?.map(m => m.trim().split(/[ \t]+/)[1]) ?? [])].length`
— and restate the rule in T22 as "every id is a literal", not "one call site per
checkpoint". The existing `toBe(2)` assertion (8840) still holds.

**F2 — `fs-home-size` can never pass, so T21's acceptance `6/6 fixtures ok` is unreachable.**
Lines 6380 (`TARGET=$(to_bytes 12G)`), 6407 (`elif [[ ${fs_bytes:-0} -ge $TARGET ]]`),
6463 and 6476 (both solutions size the LV to exactly 12 GiB), 6972.
`fs_size_bytes` is `df -B1 --output=size` (5862 region), and an XFS filesystem
always reports less than its device — metadata overhead — so `df` on a 12 GiB LV
returns roughly 11.98 GiB and the `-ge` test fails for *both* correct solutions.
`within_pct` exists in `assert.sh` (6134) for precisely this and is never used.
Smallest fix: at 6407 use
`elif within_pct "${fs_bytes:-0}" "$TARGET" 2 || [[ ${fs_bytes:-0} -ge $TARGET ]]; then`.

**F3 — `users/006` antisolution 01 has no `# expect-fail:` header, which T10 treats as a fatal content error.**
Lines 7203–7222 (`# Nothing is declared: id -nG lists primary groups too.`)
against 2510–2526 (`parseExpectations` throws `ContentError` for a missing or
empty header). `validate` aborts on the fixture instead of running it, so
`18/18 fixtures ok` (8402) and the diagnosis row at 8408 are both unreachable.
The script is in fact a *correct* answer — a primary-group provisioning passes
every checkpoint — so the smallest fix is to move it to
`solutions/03-primary-group-only.sh`, leaving that directory with 3 solutions and
2 antisolutions: still 6 fixtures, so the 18/18 arithmetic is unchanged.

**F4 — `new FakeTransport()` omits the required handler.**
Line 5216 against T2's declared constructor `(handler: FakeHandler, opts?: { available?: boolean })`
(301, 417). `tsc --noEmit` fails. Smallest fix:
`const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }))`
(matching `ExecResult` as T2 declares it).

**F5 — the vmrun test asserts the guest script path at the wrong argv index.**
Line 4619 `expect(r.calls[0]?.[3]).toMatch(/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/)` against
the implementation at 4885–4891, where the argv is
`['copyFileFromHostToGuest', vmx, '-gu', user, '-gp', pass, hostPath, guestPath]`
— index 3 is the username, and the guest path is index 7. The test fails on a
correct implementation. Smallest fix: assert `r.calls[0]?.at(-1)`.

**F6 — nothing in the plan grants passwordless `sudo`, yet every guest-side script depends on it.**
Line 23 asserts "the transports already run as root inside the VM"; T2's `exec`
doc repeats it (389). Neither is true as implemented: T15 declines root SSH
(4153) and only adds `student` to `wheel` (4155); `SshTransport` runs
`BatchMode=yes` as `RHCSA_SSH_USER` (5340–5388) and `VmrunTransport` runs
`-gu student` (4846). Everything downstream then calls `sudo` non-interactively —
`guest-provision.sh` (5558+), all five `setup.sh`, four of five `grade.sh`, and
every solution and antisolution. With no TTY and no NOPASSWD rule, `sudo` fails
and Tasks 19–22 cannot pass a single fixture. Smallest fix: add a step to
`guest-provision.sh` that installs and validates a sudoers drop-in —
`printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer`,
`sudo chmod 0440 …`, `sudo visudo -cf /etc/sudoers.d/rhcsa-trainer` — bootstrapped
from the checklist's interactive console session, and correct line 23 to say the
transports run as `student` with passwordless `sudo`.

**F7 — `firewall-ssh` only accepts the named service, contradicting its own solution's rationale.**
Lines 7834–7836 (`sudo firewall-cmd --permanent --list-all | grep -qw ssh`)
against 7863–7867, where solution 02 states that `--add-port=22/tcp` "is a
correct way to permit ssh and would be rejected by a grader that greps
`firewall-cmd --list-services`, which is why the checkpoint uses `--list-all`".
`--list-all` prints `ports: 22/tcp` on a separate line from `services:`, so
`grep -qw ssh` does **not** match a port-only answer — the checkpoint over-fits
to one mechanism, which is the failure spec 6.5 rule 1 forbids. The fixture
matrix cannot catch it because solution 02 adds *both* the port and the service
(7876–7878), which also destroys the independence the file's comment claims.
Smallest fix: at 7834
```bash
perm=$(sudo firewall-cmd --permanent --list-all 2>/dev/null)
grep -qw ssh <<<"$perm" || grep -qw 22/tcp <<<"$perm"
```
and delete `sudo firewall-cmd --permanent --add-service=ssh` from solution 02 so
the two solutions are genuinely independent.

### Medium

**F8 — the escaping test in T20 is one backslash level off and fails as written.**
Line 5913 `await sh(\`ck_fail weird 'says "hi"' 'back\\\\slash and<TAB>tab'\`)` vs the
assertion at 5917 `expect(...detail).toContain('back\\slash')`. Inside a
single-quoted bash string, `\\\\` in the TS template is two literal
backslashes in the shell, so the emitted JSON detail contains `back\\slash`,
while the assertion looks for one backslash. Smallest fix: write `\\\\` in the
shell snippet only if the assertion is `'back\\\\slash'`; simplest is to make the
snippet `'back\\slash …'` (one literal backslash) and leave the assertion alone.

**F9 — T22 Step 8's id cross-check reports a false `UNDECLARED-ID` for the T21 task.**
Lines 8377–8387. The loop runs over `content/tasks/*/*`, which includes
`storage/014-grow-home-lv`, but greps `^[[:space:]]*ck [a-z0-9]…` — the T21
grader has no bare `ck` calls, so `emitted` is empty, `comm -13` returns every
declared id, and the step prints `UNDECLARED-ID content/tasks/storage/014-grow-home-lv: …`
against its own stated expectation of no such lines. An agent will "fix" correct
content to silence it. Smallest fix: same regex change as F1 —
`grep -oE '^[[:space:]]*ck(_pass|_fail|_skip)? [a-z0-9][a-z0-9-]*'` with
`awk '{print $NF}'`.

**F10 — T18 Step 6 states a test count that does not match the file.**
Line 5473 claims "10 ssh tests"; the suite at 5100–5200 has 9 `it(` blocks.
Smallest fix: say 9, or add the missing case.

**F11 — T21's Files list names a test file no step creates and omits two files that steps do create.**
Line 6272 declares `test/cli/validate.test.ts`; no step writes it. Step 7 creates
`src/engine/validate/run.ts` (6628) and `test/validate/run.test.ts` (6680), and
the commit at 6995 adds exactly those two. Tree line 95 also assigns
`validate/run.ts` to T21. Smallest fix: replace line 6272 with the two real paths.

**F12 — `-noWait=false`, `-activeWindow=false`, `-interactive=false` are not vmrun syntax.**
Lines 4622, 4896–4899, 5707, 5712, 5723. `vmrun runProgramInGuest` takes these as
bare presence flags; `-noWait=false` is parsed as a program argument or rejected,
and blocking-until-exit is already the default. Smallest fix: drop all three
flags from the argv at 4896–4899, from `provision.sh` (5707, 5712, 5723), and drop
the assertion at 4622.

**F13 — `nmcli -g FILENAME connection show "$conn"` is a list-mode field used in profile mode.**
Line 7880 (troubleshooting solution 02). In profile mode `nmcli connection show <id>`
takes `<setting>.<property>` fields; `FILENAME` is a field of the connection
*list*. If nmcli rejects it, `file` is empty, `sed -i` errors, and `set -euo pipefail`
aborts solution 02 for a reason that has nothing to do with the grader — a
fixture failure the diagnosis table cannot explain. Verify on the guest; the
unambiguous form is
`file=$(sudo nmcli -g NAME,FILENAME connection show | awk -F: -v c="$conn" '$1==c{print $2; exit}')`.

### Low

**F14 — T17's Files list omits `test/vm/config.test.ts`** (declared files at 4503,
file written at 4521), **and its Interfaces list omits the exported
`VmrunConfigSlice`** (4840), which T18 must know about to satisfy structurally.

**F15 — the File Structure tree lists only `scripts/provision.sh`** (line 67) while
T19 creates two scripts, `provision.sh` and `guest-provision.sh` (5535–5536), the
second of which is what actually runs in the guest. Add it to the tree.

**F16 — T19 Step 4's stated guardrail message is wrong in the common case.**
Lines 5781–5785 describe the "no `.env.local`" message, but with `.env.local`
present the script stops earlier at the `RHCSA_GUEST_PASSWORD` check (5672),
whose message names neither file. State both outcomes, or make the
`RHCSA_GUEST_PASSWORD` message name the file to set it in.

**F17 — tree line 99 promises `sshArgs` in `src/engine/vm/config.ts`, "T23".**
No task in the plan defines or imports `sshArgs`; T18's `SshTransport` hardcodes
its option list inline (5340–5388). Either delete the annotation or say which
task owns it.

**F18 — T18's Interfaces section over-declares its consumption** (line 5082 lists
`Runner` and `realRunner` from T17); `select.ts` imports neither.

**F19 — two stated counts in T20 disagree with the code**: "Eight helpers" (5858)
against 10 defined functions, and "~24 tests" (6206) against 26 `it(` blocks.

---

## Explicitly checked and correct

Recorded so these are not re-litigated: the 5 + 13 T17 test counts; the
reboot-poll timeout arithmetic with `pollMs: 1`; every `RHCSA_*` name against
`loadVmConfig` and `.env.local`; `TransportKind` including `'fake'`;
`HarnessDeps`/`loadTaskScripts`/`FixtureResult`/`TaskScripts` field-by-field;
the 17-field `TaskSpec` literal in all five `task.yaml` files; `Bank.tasks`
mutability; `option`/`flag`/`CliIo`/`run` from T12; `storage.lvm.resize` present
in T13; `validateBank`'s exported name matching tree line 95; every
`baseline-fail` header equalling exactly its task's goal set with every invariant
left undeclared; every `expect-fail` set in T21, `selinux/019`,
`systemd/017` and `troubleshooting/028` re-derived from the script's effect in
both verdicts, `@post` suffixes included; all `ck` ids literal in all five
graders; no grader writing state or using `set -e`; the `/home`-not-`/var` and
`graphical.target` safety arguments; `troubleshooting/028` deliberately omitting
a verdict-ambiguous "has an IP" checkpoint; `sudo sudo -l -U alice` being correct
rather than redundant; `date -u` and `/etc/shadow` field 8 for `carol-expiry`
matching the concept card's field numbering; `semanage port -l` merging local
additions into the `http_port_t` line so `grep -qw 82` works; `ss -H -ltn`
column 4 being the local address; and the counts `tasks: 5`, `concepts: 10`,
`untaught concepts: 0`, `6/6`, `18/18`, `6/6`.
