# Task 22 — final scoped verification of fix rounds 2 and 3

Scope: `decf75d..9300d2b` (`850c567` = R1–R5 + R4b/R4c/R1b, `9300d2b` = R6). Five files,
107 insertions / 32 deletions, all under `content/tasks/`.

**Overall verdict: APPROVED.**

Every item R1–R6 plus the three sweep sites is CLOSED. Nothing in the two commits reports a
pass where the state is wrong, or a fail where the state is right, on any input I could
construct. One genuinely new item is recorded in section 9; it is out of scope for these
commits and I am not withholding approval over it.

Every conclusion below is labelled **measured** or **reasoned**. Nothing ran against a RHEL 9
guest; there is no VM, no `nmcli`, no `firewalld` and no `systemd` on this host. `ip` *is*
present (iproute2-6.19.0) and I used it, which makes the route-parse conclusions stronger than
the previous passes could make them.

## Per-item disposition

| Item | Site | Disposition | Basis |
| --- | --- | --- | --- |
| R1 | `019/setup.sh:144-146` device derivation | **CLOSED** | measured — 11 shapes, §2 |
| R1b | `019/setup.sh:163-164` permanent half | **CLOSED** | measured for the selection, reasoned for `nmcli`'s output format, §2 |
| R2 | `users/006/grade.sh:39-47` | **CLOSED** | measured — §4 |
| R3 | `028/solutions/02` comment | **CLOSED** | measured — §5 |
| R4 | `019/setup.sh:81-84` `httpd-enabled` | **CLOSED** | measured — §6 |
| R4b | `017/setup.sh:65-68` `stamp-enabled` | **CLOSED** | measured — §6 |
| R4c | `017/setup.sh:98-100` `sshd-intact` mirror | **CLOSED** | measured for the comparison, reasoned for the guest states, §6 |
| R5 | `task-22-report.md:118`, `:174` | **CLOSED** | measured by reading — §7 |
| R6 | `028/setup.sh:32-49` | **CLOSED** | measured — §1, §3 |

Standing constraints: **no checkpoint drift** (§8), all six gates pass (§10).

Both of the team lead's rulings hold on the substance. One number in `task-22-fix-3.md`'s
framing and in the verification context is wrong (§9.2): the goal-id count is **23**, not 22.

---

## 1. R6 — the shape table, reproduced independently

Harness: `/tmp/t22v/r6/`. Stub `ip` and `nmcli` on `PATH`; both selection blocks **extracted
from git with `git show`, not retyped**, so a transcription error on my side cannot make the
result look better than the code. `bash -n` asserted on both generated runners.

```
SHAPE                                                OLD            NEW
A1 lo sorts first (the hazard)                       lo             ens160
A2 NIC sorts first                                   ens160         ens160
A3 lo first, name has spaces                         lo             Wired connection 1
A4 only lo ACTIVE, NIC route exists                  lo             ens160
A5 only lo managed, no default route                 lo             LOUD-FAIL
A6 nothing at all                                    LOUD-FAIL      LOUD-FAIL
A7 route device owned by NO profile                  lo             LOUD-FAIL
A8 two default routes                                lo             primary
```

**All eight rows reproduce the implementer's table exactly** — old selects `lo` in 6 of 8, new
in none. **Measured.** The two rows that matter, A5 and A7, go from `lo` to a loud stop with
the `docs/vm-build-checklist.md` wording: a guest that cannot run the task now refuses instead
of setting `autoconnect no` on loopback, recording `lo`, and letting every fixture pass.

### Seven shapes of my own that the table does not contain

```
B1 multipath default route (ip -o folds nexthops)    lo             primary
B2 route device unmanaged by NM (device show errors) lo             LOUD-FAIL
B3 IPv6-only guest (no v4 default route)             lo             LOUD-FAIL
B4 route profile name contains a colon (escaped)     lo             odd\:name
B5 route ends `... dev ens160` with nothing after    lo             ens160
B6 default onlink + table + src tokens               lo             cloud
C1 ip binary absent (exit 127)                       lo             LOUD-FAIL
```

- **B1** — a multipath default route. `ip -o` folds the `nexthop` continuation lines onto one
  line with a literal `\`, so `dev` sits nowhere near a fixed column. The new form resolves the
  *first* nexthop's device to its profile. Sane, and it proves the parse is not positional.
- **B2** — the route device exists but NetworkManager does not manage it, so `device show`
  writes to stderr, exits 10 and prints nothing on stdout. Distinct from A7, where the device
  is known and reports `--`. Result: `conn` empty → loud stop. Fail-closed.
- **B3** — an IPv6-only guest. `ip -o route show default` is the v4 table, so it prints nothing
  and the new form refuses. This is a **behaviour change** relative to the old form, which
  proceeded (against whatever sorted first, i.e. the bug). Refusing is the correct direction, so
  it is not a regression, but it is worth writing down: a guest with only a v6 default route can
  no longer be staged for `028` or `019`. That `route show` without `-6` omits v6 routes is
  **reasoned** — this host has no v6 default route, so I could not measure the omission.
- **B4** — confirms the implementer's own disclosure: `$conn` comes back as `odd\:name`, with
  the backslash. See §5 for whether that is fail-closed.
- **B5** — `dev` in the second-to-last field, which the `n < NF` bound reaches. Works. A `dev`
  in the *final* field would not be reached, and `iproute2` never emits one, since `dev` always
  takes an argument; on such input the result is empty, which is the fail-closed direction.
- **B6** — `onlink`, `table`, `src` and `metric` tokens shifting everything right. Works.
- **C1** — `ip` missing entirely. Only the new form asks it, so only the new form stops.

### The parse, against real `iproute2`

```
$ ip -V              -> ip utility, iproute2-6.19.0
$ ip -o route show default
  default via 172.22.96.1 dev eth0 proto kernel
$ ... | awk '{for (n=1; n<NF; n++) if ($n == "dev") { print $(n+1); exit }}'
  eth0
$ ip -j route show default
  [{"dst":"default","gateway":"172.22.96.1","dev":"eth0","protocol":"kernel","flags":[]}]
```

**Measured against real output, cross-checked against `ip -j`'s own `"dev"` key.** The shipped
`awk` extracts the device correctly and does not depend on a column position: I fed it `dev` at
four different depths behind `proto`, `metric`, `onlink`, `table`, `scope` and `src` tokens and
it returned `tun0` every time. **Measured.**

## 2. R1 and R1b — `019/setup.sh`

Harness: `/tmp/t22v/r1/`, same method, derivations extracted from git.

```
SHAPE (device derivation)                      OLD          NEW
S1 NM lists lo first (the R1 hazard)           lo           ens160
S2 NM lists the NIC first                      ens160       ens160
S3 only lo is managed                          lo           ens160
S4 no default route, nmcli lo first            lo           ens160
S5 nmcli silent                                ens160       ens160
S6 both silent (must be <none>)                <none>       <none>
S7 only lo, no route (must be <none>)          lo           <none>
S8 two default routes, lo first in nmcli       lo           enp0s3
M1 no route; nmcli lists ONLY lo twice         lo           <none>
M2 no route; device named "lox" (not lo)       lox          lox
M3 no route; nmcli emits a trailing blank line <none>       <none>
```

**All eight of the implementer's rows reproduce: old returns `lo` in 5 of 8, new in none.**
**Measured.** S7 is the one that matters — old waved a guest through, new takes the loud `fail`
branch.

Three of mine. **M2** matters: the exclusion is `grep -vxF lo`, and I confirmed on real `grep`
that it filters only the exact line `lo`, leaving `lox`, `vlo`, `lo0` and `ens160` — so a bond
or bridge whose name merely contains `lo` is not silently dropped. A bare `grep -v lo` would
have been a fail-closed-but-wrong bug; this is anchored correctly. **Measured.** **M3** shows a
leading blank line in `nmcli`'s output makes `head -1` yield empty and setup fail loudly. That
is identical in old and new (both use `head -1`), so unchanged, and it is the fail-closed
direction.

**R1b, the permanent half.** The old form never consulted `$dev` at all:

```
SHAPE                                          OLD aconn (first active NAME)  NEW aconn (owner of $dev)
S1 NM lists lo first (the R1 hazard)           lo                             ens160
S2 NM lists the NIC first                      ens160                         ens160
S3 only lo is managed                          lo                             ens160
S4 no default route, nmcli lo first            lo                             ens160
P1 route device owned by NO profile (--)       lo                             SKIPPED(no profile)
```

The old permanent half read the `lo` profile's `connection.zone` in 4 of 5 shapes, i.e. it
would have passed for exactly the wrong reason while the runtime half measured the real NIC.
The new form asks which profile owns `$dev`. **Measured.** That `nmcli -g GENERAL.CONNECTION
device show` prints the owning profile's name and `--` for none is **reasoned** — no `nmcli`
here.

P1's `SKIPPED` is not a fail-open: a device with no profile cannot have a `connection.zone`, so
there is nothing for the permanent half to check, and the *runtime* zone check still runs
against a non-empty `$dev`. **Reasoned.** Note the deliberate asymmetry with `028`, where an
unowned route device is a loud stop — correct, because `019` needs the *device* and `028` needs
the *profile*.

**Byte-identity of the `ip -o route` line, by string comparison rather than by eye:**

```
019/setup.sh:144  md5 89dcb72aa3ada1593e0b188c0477435d
028/setup.sh:32   md5 89dcb72aa3ada1593e0b188c0477435d
```

Identical. **Measured.**

## 3. R6's single-derivation claim, and the guard it kept

Every `dev=` / `conn=` occurrence in `028/setup.sh`:

```
32:dev=$(ip -o route show default 2>/dev/null | awk ...)      <- the ONE derivation of $dev
33:conn=""                                                     <- initialisation
36:  conn=$(nmcli -g GENERAL.CONNECTION device show "$dev" ...) <- the ONE derivation of $conn
37:  [ "$conn" = "--" ] && conn=""                             <- normalisation
```

Exactly one derivation of each. First use of `$dev` is line 34, after 32; first use of `$conn`
is line 37, after 33/36. No path reaches a use before its assignment, and neither can trip
`set -u`, because line 32 assigns unconditionally and line 33 initialises. The zone block's
second derivation via `GENERAL.DEVICES` is gone. **Measured by grep and control-flow reading.**

**The kept guard's stated reason is true.** Real `awk`, the shipped zone expression, a
three-zone `--get-active-zones` fixture:

```
i=''       otherzone EMPTY -> [ -z ] true -> NO fail -> CHECK PASSES
i='ens160' otherzone EMPTY -> [ -z ] true -> NO fail -> CHECK PASSES   (correct: default zone)
i='lo'     otherzone='trusted' -> fail                                 (correct: hazard caught)
```

With `i=""` the `awk` compares every interface against the empty string, matches nothing, and
the check **passes silently**. `awk`'s default field splitting never produces an empty field, so
`$n == ""` can never be true. The guard is therefore the only thing that would stop a future
reordering from turning the zone check off without a sound. **It is not dead code justified by
a fiction, and it must stay.** **Measured.**

## 4. R2 — the sentinel that was almost shipped

Harness: `/tmp/t22v/r2/`. Stub `date` (switchable), `getent`, `sudo`, `id`; the graded excerpt
extracted from git for both revisions; the real `content/lib/assert.sh` sourced; the stub's
shadow field 8 round-trip asserted before any measurement.

```
=== date BROKEN (emits nothing) ===
--- old form
  stderr: line 3: / 86400 : arithmetic syntax error: operand expected
  stderr: line 5: want: unbound variable
  checkpoints emitted: 0 of 4
--- new form
  {"id":"carol-expiry","status":"fail","detail":"shadow field 8=20998, want=unavailable"}
  {"id":"alice-maxdays","status":"pass"}
  {"id":"sudo-devops","status":"fail"}
  {"id":"student-intact","status":"pass"}
  checkpoints emitted: 4 of 4
```

**The 0-of-4 vs 4-of-4 claim reproduces exactly.** **Measured.**

**No field-8 value can pass when `date` produced nothing:**

```
shadow field 8    old       new            shadow field 8    old       new
'20998'           ABSENT    fail           '99999'           ABSENT    fail
'unavailable'     ABSENT    fail           ''                ABSENT    fail
'0'               ABSENT    fail           '-1'              ABSENT    fail
```

**The normal path is unchanged, and F1's arithmetic still holds** (TZ=PST here, local day count
for 2027-06-30 = **20998**, as expected):

```
shadow field 8    old       new
'20998'           pass      pass      <- the correct value
'20997'           fail      fail      <- a day early, rejected
'20999'           fail      fail      <- a day late, rejected
''                fail      fail      <- unset expiry, rejected
'0'               fail      fail
'unavailable'     fail      fail      <- the sentinel string, rejected
```

**And the near-miss was real.** I reconstructed the unshipped `want=unavailable` comparison by
removing the `[ -n "$want_epoch" ]` conjunct:

```
sentinel form, field8=unavailable   -> PASS   <- the false pass, reachable from data
sentinel form, field8=20998         -> fail
```

The shipped form guards on `want_epoch` directly and closes it. **Measured.** The sentinel now
appears only in the detail string, where it is a diagnostic and not an operand.

## 5. R3, and the same class in R6's own new code

The comment's claims, against real `awk`, real `sed`, and `nmcli` terse output modelled with
its own `\:` escaping:

```
extracted: [/etc/NetworkManager/system-connections/odd\:name.nmconnection]
backslash present: YES (sub() does NOT un-escape)
path exists: no
sed exit=2  stderr: sed: can't read .../odd\:name.nmconnection: No such file or directory
=> FAILS LOUDLY
name with spaces: extracted intact, nothing splits on whitespace  -> YES
old name-keyed form on the same input: <empty>  -> would have edited nothing
```

Every clause of the new comment is true and every clause of the old one that was false is gone.
The file carries `set -euo pipefail` at line 8, so `sed` exiting 2 aborts the script rather than
continuing. **Measured.** CLOSED.

**R6's own colon exposure is fail-closed, not fail-open.** With a colon in the route-carrying
profile's name, `$conn` is `odd\:name` (measured, shape B4). Tracing `028/setup.sh`: line 50
records that string in `/etc/rhcsa-conn`, then line 69 runs
`need sudo nmcli connection modify "odd\:name" connection.autoconnect no`, which cannot resolve
a profile of that literal name, so `need` prints `FAILED` and exits 1 — before any precondition
runs and before setup can report success. **Reasoned** for `nmcli`'s lookup failure, **measured**
for the value `$conn` holds.

One nuance the implementer's "identical exposure, unchanged rather than introduced" glosses, and
it does not change the disposition: the old form hit this path only when the colon-named profile
happened to sort first, whereas the new form hits it deterministically whenever the
*route-carrying* profile is the one with the colon. The exposure class is unchanged and the
outcome is a loud exit in both, so it cannot produce a false pass — but the reachability is
narrowly different, not identical.

## 6. R4, R4b, R4c — the fail-open, and the mirror F15 broke

**The team lead's "three-line consistency edit" ruling was wrong; the implementer's fail-open
finding is correct.** Real `grep`, both comparisons, against values a `2>&1` capture can hold
(`~` = newline):

```
CAPTURED VALUE (2>&1)                                        OLD-refuses  NEW-refuses
enabled                                                      YES          YES
disabled / static / enabled-runtime / indirect / generated    no           no
alias / masked                                               no           no
enabled~The unit files have no installation config (...)      no           YES   <- the fail-open
Failed to get unit file state for httpd.service: ...~disabled no           no
```

On a two-line capture whose first line is `enabled`, `[ "$state" != "enabled" ]` compares the
whole blob, stops matching, and setup proceeds having concluded httpd is disabled while
`httpd-enabled` would pass at baseline. `grep -qx` still finds the line. **Measured** for the
divergence given the capture; **reasoned** that `systemd` ever emits such a hint on this path.

**R4c is the important one, and the mirror is now exact in both directions.**

```
is-enabled prints    exit status (old setup)  grep -qx (new setup)  grader (grep -qx)
enabled              ACCEPT                   ACCEPT                pass
disabled             refuse                   refuse                FAIL
static               ACCEPT                   refuse                FAIL
indirect             ACCEPT                   refuse                FAIL
generated            ACCEPT                   refuse                FAIL
alias                ACCEPT                   refuse                FAIL
enabled-runtime      ACCEPT                   refuse                FAIL
masked               refuse                   refuse                FAIL
```

`decf75d` (F15) made `sshd-intact`'s grader strict and left the setup mirror on the bare exit
status, so setup accepted five states the grader rejects — the invariant would then have failed
for every fixture, which is a direct violation of mandate 9. The shipped predicates are now the
same expression:

```
017/grade.sh:42-43   sshd_state=$(systemctl is-enabled sshd 2>&1)
                     printf '%s' "$sshd_state" | grep -qx enabled
017/setup.sh:98-99   sshd_state=$(systemctl is-enabled sshd 2>&1)
                     printf '%s' "$sshd_state" | grep -qx enabled \
```

Setup accepts exactly the set the grader passes and refuses exactly the set it fails. **Exact
in both directions.** **Measured** for the comparison; **reasoned** for which states a real
`systemctl` produces.

**The sweep's completeness claim holds.** All eight `is-enabled` sites — four graders, four
setup preconditions — verified individually:

```
019/grade.sh:15-17   state=... ; printf '%s' "$state"      | grep -qx enabled   (httpd-enabled)
017/grade.sh:14-16   state=... ; printf '%s' "$state"      | grep -qx enabled   (stamp-enabled)
017/grade.sh:42-44   sshd_state=... ; printf '%s' "$sshd_state" | grep -qx enabled (sshd-intact)
028/grade.sh:17-19   state=... ; printf '%s' "$state"      | grep -qx enabled   (sshd-enabled)
019/setup.sh:81-84   state=... ; if printf '%s' "$state"   | grep -qx enabled; then fail
017/setup.sh:65-68   state=... ; if printf '%s' "$state"   | grep -qx enabled; then fail
017/setup.sh:98-100  sshd_state=... ; printf '%s' "$sshd_state" | grep -qx enabled || fail
028/setup.sh:84-86   if printf '%s' "$(systemctl is-enabled sshd 2>&1)" | grep -qx enabled; then fail
```

Non-comment `grep -qx enabled` lines under `content/tasks`: **8**, i.e. one per site, no more
and no fewer. Zero `is-enabled … &>/dev/null` outside comments. Zero `!= "enabled"` outside
comments — the only two occurrences are the explanatory comments at `019/setup.sh:77` and
`017/setup.sh:62`. **Measured.**

## 7. R5 — the two report rows

`task-22-report.md:118` (`carol-expiry`) and `:174` (`firewall-ssh`) both carry the corrected
text in place, each ending in a parenthetical naming the round-1 finding — F7 and F13
respectively — and stating what the row originally said and why it was wrong. **Measured by
reading.** CLOSED. Documentation only, no code effect.

## 8. No checkpoint drift

Standing scope, computed with my own extractor over every `.sh` under `content/tasks`:

```
files with headers:  21
header lines total:  26     (baseline-fail 5, expect-fail 16, unprobed-invariant 5)

header TEXT, md5 of the whole "path<TAB>header" inventory:
  9d2dc22  26 lines  eb04073d58da9b1f59845d11fe717c47
  decf75d  26 lines  eb04073d58da9b1f59845d11fe717c47
  9300d2b  26 lines  eb04073d58da9b1f59845d11fe717c47
  -> DRIFT 0, all 26 header lines byte-identical to 9d2dc22
```

**Measured.** One note on method: I first compared `path:lineno:text` and saw four "differences"
that were purely positional — the headers moved down because comments were added above them.
Within `decf75d..9300d2b` exactly one header changed *position*
(`006/grade.sh:56` → `:71`, the 15 comment lines R2 added). Content drift is zero either way,
and content is what the constraint is about; I record the distinction so the next pass does not
mistake a shifted header for a changed one.

`sshd-intact` is **absent from every `# baseline-fail:`** header. **Measured.**
`# unprobed-invariant: sshd-intact` is intact at **`017/grade.sh:36`**. **Measured.**

**Declared vs emitted, my own extractor, covering `ck`, `ck_pass`, `ck_fail` and `ck_skip`,
splitting `# baseline-fail:` on commas:**

```
selinux/019-httpd-alt-port                     emitted=8  goal=7  hdrs=1
storage/014-grow-home-lv                       emitted=5  goal=2  hdrs=1
systemd/017-boot-time-service                  emitted=5  goal=3  hdrs=1
troubleshooting/028-restore-remote-access      emitted=5  goal=4  hdrs=1
users/006-team-provisioning                    emitted=8  goal=7  hdrs=1
```

All five pairs match. **Zero UNPROBED-GOAL.** **Measured.** In the other direction, every
emitted id is either a declared goal or a declared unprobed invariant, except three which are
*probed* invariants and need no header: `017`'s `default-target` (setup proves it at
`017/setup.sh:90-92`) and `014`'s `home-from-lv` and `persist-config`. My first pass flagged
those three; the rule I applied was stricter than the project's, and the tree is right.

## 9. New findings, both out of scope

### 9.1 `lo` is still reachable through the *route* path (NEW, out of scope, narrow)

Neither file excludes `lo` from the route-derived `$dev`; `019` excludes it only from the
`nmcli` fallback, and `028` excludes it nowhere. So on a guest whose default route points at
loopback:

```
route: default dev lo scope link                              028 NEW picks: lo
route: default via 127.0.0.1 dev lo proto static metric 100   028 NEW picks: lo
route: default dev lo scope link                              019 NEW dev  = lo
```

**Measured.** This is the exact hazard R1 and R6 exist to prevent — `028` would set
`autoconnect no` on loopback, record `lo`, and every fixture would pass — reached by a different
path than the one the rulings named. It requires a pathological route table (`ip route add
default dev lo`), which is far less likely than the NM ordering R6 was about, and a guest in
that state has no working network anyway.

**Scope: new, and out of scope for these two commits.** The rulings asked for route-primary
derivation and that is what shipped; the `head -1` sorting hazard they named is closed. I am not
withholding approval over this. It is a one-line close (`[ "$dev" = "lo" ] && dev=""` after the
route derivation, in both files, which would also make the two files symmetric) and it belongs
in the whole-branch review or a fifth round, whichever the lead prefers.

### 9.2 The goal-id count is 23, not 22 (NEW, a number in the paperwork)

`task-22-fix-1-report.md` §9.4 says the whitespace-split bug "printed `UNPROBED-GOAL` for all 22
goal ids across all five tasks", and the verification context asks me to confirm 22. Measured:

```
total goal ids (comma-aware):          23      (019 7 + 006 7 + 028 4 + 017 3 + 014 2)
whitespace tokens ending in a comma:   18      <- these are what would have mis-reported
whitespace tokens with no comma:        5      <- the last id in each of the 5 headers, still matched
```

**Measured.** So 22 is wrong twice: the total is 23, and the number the bug would actually have
broken is 18, because the last id in each header carries no trailing comma. This changes nothing
about the substance — the clean re-run's five pairs and zero `UNPROBED-GOAL` both reproduce
independently — but it is a fourth arithmetic slip, inside a disclosure whose whole subject is
arithmetic slips, and the context propagated it unchecked.

## 10. Gates, all re-run here

```
$ npm run typecheck                    exit 0
$ npx vitest run                       Test Files 23 passed (23) / Tests 246 passed (246)
$ node src/cli/index.ts coverage       exit 0
                                       problem: lines = 0
                                       tasks 5 | concepts 10 | objectives 68
                                       uncovered 58 | untaught concepts 0
$ bash -n, the 5 files in the diff     all OK
$ bash -n, every .sh in content/+scripts/   41 checked, 0 errors
$ out-of-scope, decf75d..9300d2b       EMPTY
$ git status --porcelain               empty before and after
```

The five files touched over `decf75d..9300d2b` are exactly:

```
content/tasks/selinux/019-httpd-alt-port/setup.sh
content/tasks/systemd/017-boot-time-service/setup.sh
content/tasks/troubleshooting/028-restore-remote-access/setup.sh
content/tasks/troubleshooting/028-restore-remote-access/solutions/02-by-port-and-keyfile.sh
content/tasks/users/006-team-provisioning/grade.sh
```

Nothing in `src/`, `test/`, `scripts/`, `package.json`, `content/objectives.yaml`,
`content/lib/assert.sh`, `docs/`, or `content/tasks/storage/014-grow-home-lv/`. `scripts/guest-provision.sh`
does not appear — it belongs to `85bf671`, outside this range, exactly as the implementer's
correction #2 says. **Measured.**

The repo was not mutated. All measurement ran in `/tmp/t22v/` against stubs and git-extracted
excerpts; `.superpowers/` is gitignored (`.gitignore:7`), so this report cannot dirty the tree.

`npm run validate` was not run (no VM, no ISO), which is not a finding. No VM operation, no
`vmrun`, no `provision.sh`, no `ssh-keygen`, nothing written to `~/.ssh/`, no `.env.local`, no
`shellcheck`, no subagents.

## 11. Should the three disclosed tooling errors reduce trust in the reported numbers?

**No — and I would say the opposite, with one caveat that is not about trust.**

The reason is not that self-disclosure is virtuous. It is what the three errors have in common
as *failures*. All three broke in the direction that makes noise: the `ck `-only extractor
under-counted against a declaration that did not move, the whitespace split printed
`UNPROBED-GOAL` for a set so large it could not be believed, and the wrong-base out-of-scope
check named a file with an obvious owner. None of them produced a quiet green. The defect class
this project keeps producing is a tool reporting success when it did not do what was asked, and
these three are the complement of that class — tools reporting failure they had not earned.
A measurement apparatus whose failures are loud is exactly the apparatus you can trust the
green readings from, because a green reading is the one state it has never been observed to
fabricate.

The stronger argument is that I did not inherit any of the numbers. I rebuilt the R6 table, the
R1 table, the R2 reproduction, the R3 measurement, the R4/R4b/R4c comparisons, the header
inventory, the declared/emitted extractor and all six gates from scratch, with the code under
test extracted from git rather than retyped. Every reported figure came back identical except
the one in §9.2. Three independently written extractors converging on 8/7, 5/2, 5/3, 5/4, 8/7
and on 21 files / 26 header lines is a much better reason to trust those numbers than any
error-free record would have been.

**The caveat, and it is about method rather than trust.** The pattern is not random: all three
errors were in checks *re-written inline* instead of reused, and §9.4 says so of the second one
explicitly. The lesson is not "distrust the numbers" but "stop re-typing the checker" — these
five extractors should be one committed script that the next round runs rather than rewrites.
Until they are, the same class will recur, and it will recur loudly, which is affordable but
wasteful.

One asymmetry is worth stating plainly. The three disclosed errors were all in the *checking*.
The four wrong rationales this task produced — including the F15 `state`-clobbering claim and
the R4 "cosmetic" ruling, both of which I have now independently confirmed were wrong — were in
the *reasoning*, and none of them failed loudly; each was caught by someone else measuring.
That is the asymmetry that should govern how this task's remaining claims are read: the
measured numbers here have survived independent reconstruction, and the unmeasured ones
(everything depending on real `nmcli`, `firewalld` or `systemd` output) have not been checked by
anyone yet and cannot be on this host. §1's B3, §2's `GENERAL.CONNECTION` format, §5's `nmcli`
lookup failure and §6's `systemd` state strings are all in that second category and are labelled
so above. The real gate for those remains a guest boot, and Steps 9 and 10 are still deferred.
