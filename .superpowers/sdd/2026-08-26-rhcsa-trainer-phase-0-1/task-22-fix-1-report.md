# Task 22 — fix round 1 report

Base for this round: `85bf671` (`fix(vm): declare libselinux-utils in the guest package list` — see
note below).
Ruling: `task-22-fix-1.md`. Review: `task-22-review.md`.

**One round, two commits.** Sections 1-6 cover the first (`1ac01f2`): eleven findings fixed, three left
alone per the ruling, 10 files changed, 191 insertions, 29 deletions. Section 7 covers the second: F15,
the fourth `is-enabled` site, which I flagged at the end of the first commit and the lead then ruled in
scope — 1 file, 8 insertions, 2 deletions. Everything in both commits is under `content/tasks/`, and no
checkpoint was added, removed or renamed in either.

**Note on the base commit.** The ruling asked for `git diff --stat` against `9d2dc22`. HEAD had
already moved to `85bf671`: the team lead landed the `libselinux-utils` line in
`scripts/guest-provision.sh` that my Task 22 report flagged. That is the only difference between
`9d2dc22` and my base, it is the lead's commit and not mine, and I have not touched that file. Both
diffstats are in section 3 so the one extra line is visible rather than buried.

---

## 1. The eleven, one line each

| # | What I did | Measured or reasoned |
| --- | --- | --- |
| F1 | Replaced the timestamp comparison in `users/006/grade.sh` with a local-time **day count** comparison, and left a comment naming `strtoday` so nobody re-adds `-u` | **Measured** on this host, three ways — see section 2 |
| F2 | Added the prompt bullet *"Make sure it has already run, not just that it will run at the next boot."* to `systemd/017/task.yaml`. No checkpoint touched | **Reasoned** — needs a guest to observe the verdict-A behaviour it describes |
| F3 | Deleted *"in addition to their own primary groups"* from `users/006/task.yaml`. `solutions/03` stays a solution | **Reasoned** (a prompt wording change; nothing to measure) |
| F4 | Added a default-zone precondition to `selinux/019/setup.sh` and `troubleshooting/028/setup.sh`, runtime **and** permanent halves, device derived not hardcoded | **Partly measured**: the zone parser is measured against six synthetic `--get-active-zones` shapes and the route parser against four `ip -o route` shapes. Whether a real guest's NIC is in the default zone is **unmeasurable** here |
| F5 | Added the end-state assertion to `028/solutions/02`, with an attributable message. Also fixed the `awk -F:` mis-split by keying on **UUID** instead of name | **Measured** for the field-splitting fix (section 2). The ifcfg no-op it guards is **reasoned** |
| F6 | Added `sed -i '/^[[:space:]]*%devops/d' /etc/sudoers` to `users/006/setup.sh` and `--permanent --remove-port=22/tcp` to `028/setup.sh`; rewrote **both** file headers to say what is actually true | **Reasoned** |
| F7 | Added the `EXPIRE=` guard to `users/006/setup.sh`, mirroring the `PASS_MAX_DAYS` one, compared as a local day count for the same reason as F1 | **Reasoned**. Report row corrected in section 5 |
| F8 | Widened the `sudo -l` runas pattern | **Measured** against twelve renderings — and widened one notch further than the ruling; see "Deviations" |
| F9 | Adopted `017`'s strict `grep -qx enabled` form in `selinux/019/grade.sh` and `028/grade.sh`, and kept `028/setup.sh`'s mirroring precondition in step with it | **Reasoned** |
| F12 | Reworded `users/006/antisolutions/01`'s comment to say what the fixture actually does. Fixture unchanged, `# expect-fail:` unchanged | **Measured by reading** the fixture against the grader |
| F13 | Corrected the `firewall-ssh` row of the Task 22 report's precondition table. No code change | **Measured by reading** |

Not fixed, per the ruling: **F10** (SIGPIPE, forwarded to the whole-branch review), **F11** (engine
backlog, `vmrun.ts` `guestUp()`), **F14** (already corrected by the team lead in
`task-22-mandates.md`). I agree with all three calls and did not touch them.

---

## 2. F1 — measured, not transcribed

`content/tasks/users/006-team-provisioning/grade.sh:23-31`.

**Measurement 1 — the two day counts differ by exactly one, as the ruling predicted.**

```
TZ offset: +0800
TZ name:   Asia/Manila
local: $(( $(date -d 2027-06-30 +%s) / 86400 )) = 20998
utc:   $(( $(date -u -d 2027-06-30 +%s) / 86400 )) = 20999
difference = 1
--- raw epochs:
date -d 2027-06-30 +%s    = 1814284800
date -u -d 2027-06-30 +%s = 1814313600
--- is local epoch a multiple of 86400? 57600 (0 = yes)
--- is utc epoch a multiple of 86400?   0 (0 = yes)
```

Both numbers, as asked: **20998** local, **20999** UTC. The last two lines are the ruling's second
point measured directly — the local midnight epoch is **not** a multiple of 86400 (remainder 57600),
which is why dropping `-u` while keeping the `days * 86400` form would have broken the check
everywhere instead of fixing it in one hemisphere.

**Measurement 2 — the old check fails a correct answer on this host; the new one passes it and still
rejects every wrong one.** Running the grader's comparison logic against a stubbed shadow field 8
holding what `strtoday()` would store here:

```
what strtoday stores for 2027-06-30 on this host (UTC+8): 20998

correct answer (chage -E 2027-06-30 -> field8=20998):
  new grader: PASS (days=20998 want=20998)
  old grader: FAIL (got=1814227200 want=1814313600)

wrong answer (a day early, field8=20997):
  new grader: FAIL (days=20997 want=20998)
wrong answer (a day late, field8=20999):
  new grader: FAIL (days=20999 want=20998)
no expiry set (field8 empty):
  new grader: FAIL (days=empty want=20998)
```

The last row is the fail-closed property: an empty field 8 fails rather than emitting nothing.

**What is still reasoned, not measured.** That `chage -E` and `useradd -e` route through
`strtoday()`, and that `strtoday()` parses a bare `YYYY-MM-DD` as **local** midnight, is read from
shadow-utils' documented behaviour — not observed on a guest, because no guest exists. The stub above
encodes that assumption; it does not prove it. If it is wrong, the fix is wrong in the same direction
the old code was, and Step 9 will say so on the first run.

The fix as shipped, with the comment that exists to stop the next reader "correcting" it back:

```bash
# Field 8 of /etc/shadow is the expiry date as a day count, not a timestamp, so
# compare day counts. `date -d` is deliberately LOCAL, with no -u: shadow-utils
# writes this field through strtoday(), which parses a bare YYYY-MM-DD as local
# midnight and integer-divides by 86400, and both `chage -E` and `useradd -e`
# go through it. Comparing against a UTC midnight instead is off by one day on
# every guest ahead of UTC. Do not add -u here.
want=$(( $(date -d 2027-06-30 +%s) / 86400 ))
days=$(sudo getent shadow carol | cut -d: -f8)
[ -n "$days" ] && [ "$days" = "$want" ]
ck carol-expiry "carol's account expires 2027-06-30" $? "shadow field 8=${days:-empty}, want=$want"
```

`want=` is now in the detail string too, so a future timezone surprise is diagnosable from the
fixture output instead of requiring someone to re-derive this.

### F8 — measured, twelve renderings

```
INPUT                        NEW      OLD      LABEL
    (ALL) ALL                YES      YES      match
    (ALL:ALL) ALL            YES      YES      match
    (root) ALL               YES      no       match
    (root:root) ALL          YES      no       match
    (ALL) NOPASSWD: ALL      YES      YES      match
    (ALL:ALL) NOPASSWD: ALL  YES      YES      match
    (root) NOPASSWD: ALL     YES      no       match
    (ALL) /usr/bin/less      no       no       MUST-NOT
    (root) /bin/ls           no       no       MUST-NOT
    (bob) ALL                no       no       MUST-NOT
    (ALL:bob) ALL            no       no       MUST-NOT
```

All four must-not cases still fail. A narrower grant is still a failure, which is the point.

### F5 — measured, the field-splitting half

Keyed on UUID, taking everything after the first colon:

```
000000000001   -> [/etc/NetworkManager/system-connections/ens160.nmconnection]
000000000002   -> [/etc/NetworkManager/system-connections/Wired connection 1.nmconnection]
000000000003   -> [/etc/sysconfig/network-scripts/ifcfg-ens160]
000000000004   -> [/etc/NetworkManager/system-connections/odd:name.nmconnection]
--- old -F: '$1==c{print $2}' keyed on NAME, name containing a colon:
    (old produced nothing = the mis-split the review described)
```

Handles spaces in the name, a colon in the **path**, and ifcfg paths. The old form returned empty for
a colon-containing name.

### F4 — measured, the parsing halves only

Zone parser, six synthetic `firewall-cmd --get-active-zones` shapes:

```
NIC in default zone                      -> (no output)          correct
NIC in trusted, default public           -> OTHER-ZONE: trusted  correct
NIC in non-default named zone            -> FedoraWorkstation    correct
NIC absent, sources: only                -> (no output)          correct (implicit default)
NIC second in a multi-iface default zone -> (no output)          correct
NIC in a zone that IS the default        -> (no output)          correct
```

Route parser, four `ip -o route show default` shapes: `ens160`, `enp0s3`, a multi-line nexthop form,
and empty input — all correct.

---

## 3. Gates

```
$ npx vitest run
 Test Files  23 passed (23)
      Tests  246 passed (246)

$ npm run typecheck
> tsc --noEmit
typecheck exit=0

$ node src/cli/index.ts coverage
coverage exit=0
problem: lines = 0
content root: content
tasks: 5
concepts: 10
objectives: 68
uncovered objectives: 58
untaught concepts: 0

$ bash -n on every task script
syntax pass complete          (no SYNTAX ERROR lines)
```

246 / 23 unchanged, as required. No TypeScript was touched.

**Declared-vs-emitted id cross-check, both directions** — no `UNDECLARED-ID` and no `UNPROBED-GOAL`
lines, and the per-task counts are identical to before this round, which is the proof that F1, F8 and
F9 changed probe bodies and not the checkpoint set:

```
selinux/019-httpd-alt-port                     emitted=8 goal=7 hdrs=1
storage/014-grow-home-lv                       emitted=5 goal=2 hdrs=1
systemd/017-boot-time-service                  emitted=5 goal=3 hdrs=1
troubleshooting/028-restore-remote-access       emitted=5 goal=4 hdrs=1
users/006-team-provisioning                    emitted=8 goal=7 hdrs=1
id cross-check complete
```

**Checkpoint-declaration headers byte-identical to `9d2dc22`** — diffed the
`# baseline-fail:` / `# expect-fail:` / `# unprobed-invariant:` lines of all four changed
grader/antisolution files:

```
files compared: 4
all checkpoint-declaration headers byte-identical to 9d2dc22
```

Full inventory, unchanged:

```
selinux/019:        httpd-enabled, page-served, port-labeled, context-now, context-permanent, firewall-runtime, firewall-permanent
storage/014:        lv-home-size, fs-home-size
systemd/017:        unit-verifies, stamp-enabled, stamp-effect
troubleshooting/028: sshd-enabled, sshd-listening, firewall-ssh, net-autoconnect
users/006:          group-gid, alice-in-devops, bob-in-devops, carol-in-devops, carol-expiry, alice-maxdays, sudo-devops
```

**Convention prohibitions re-checked** — exactly one `# baseline-fail:` header per grader, no grader
comment containing `ck_pass`/`ck_fail`/`ck_skip` followed by a word, no grader reading shell history,
and no state-changing command in any grader I touched (the only near-hits are two comment mentions of
`chage`/`chcon` and `semanage port -l`, a read-only listing).

**Scope.**

```
$ git diff --stat HEAD          # HEAD = 85bf671
 content/tasks/selinux/019-httpd-alt-port/grade.sh  |  9 +++-
 content/tasks/selinux/019-httpd-alt-port/setup.sh  | 41 ++++++++++++++
 .../tasks/systemd/017-boot-time-service/task.yaml  |  1 +
 .../028-restore-remote-access/grade.sh             |  9 +++-
 .../028-restore-remote-access/setup.sh             | 62 +++++++++++++++++++---
 .../solutions/02-by-port-and-keyfile.sh            | 23 ++++++--
 .../antisolutions/01-no-group-no-sudo.sh           |  8 +--
 content/tasks/users/006-team-provisioning/grade.sh | 26 ++++++---
 content/tasks/users/006-team-provisioning/setup.sh | 38 +++++++++++--
 .../tasks/users/006-team-provisioning/task.yaml    |  3 +-
 10 files changed, 191 insertions(+), 29 deletions(-)
```

Against `9d2dc22` the same ten files appear plus `scripts/guest-provision.sh | 1 +`, which is the team
lead's `85bf671`, not mine.

Verified empty: nothing under `src/`, no test, not `content/objectives.yaml`, not
`content/lib/assert.sh`, nothing under `content/tasks/storage/014-grow-home-lv/`, not `package.json`.

---

## 4. Deviations from the ruling

**F8 — widened one notch further than the ruling's pattern, deliberately.** The ruling specified
`\((ALL|root)(:(ALL|root))?\)`. I shipped
`\((ALL|root)([[:space:]]*:[[:space:]]*(ALL|root))?\)`.

Reason: `sudo -l` renders a runas spec that names both a user and a group with spaces around the
colon — `(ALL : ALL) ALL` — so `%devops ALL=(ALL:ALL) ALL`, which is valid sudoers granting
everything and is the idiom Ubuntu ships as its default, would still have been a false fail under the
ruled pattern. Measured: the ruled pattern rejects `(ALL : ALL) ALL`, the tolerant one accepts it and
still rejects `(ALL : bob) ALL` and `(bob : ALL) ALL`.

That `sudo -l` uses the spaced form is **reasoned** from sudo's listing format, not measured — no
`sudo` on this host. I shipped the tolerant pattern precisely because it is correct under **either**
rendering, so the uncertainty costs nothing: it is a strict superset of the ruled pattern.

**Accepted.** The team lead confirmed the wider pattern stands, no revert: `(ALL : ALL)` is exactly the
rendering the ruled pattern would have false-failed, and a strict superset that still rejects
`(ALL : bob)` and `(bob : ALL)` is correct whether or not sudo spaces the spec.

**F5 — also fixed the `awk -F:` mis-split, and added a message to the assertion.** The ruling left
the colon fix to my judgement ("fix it if it is cheap and you are confident"). It was cheap: key on
`connection.uuid`, which cannot contain a colon, and take everything after the first colon so a colon
in the path is safe too. Measured above. I also gave the end-state assertion an explicit
`printf … >&2; exit 1` rather than the bare `[ … ]`, because the ruling's stated purpose was an
*attributable* failure and a bare test under `set -e` aborts with exit 1 and no message.

**F4 — added a permanent half the ruling did not ask for, and chose "no zone is fine" semantics.**
The ruling asked for one precondition asserting the active interface's zone equals the default zone.
I split it in two:

- *runtime*: the interface must not appear under a **non-default** zone in `--get-active-zones`. An
  interface appearing under **no** zone is treated as **fine**, because firewalld handles it via the
  default zone — which is exactly what the checkpoints assume. Asserting positive membership instead
  would have produced false setup failures on correctly built guests, and I could not describe that
  failure mode honestly, which is the bar the ruling set.
- *permanent*: `nmcli -g connection.zone` must be empty or equal the default zone. Both
  `firewall-ssh` and `firewall-permanent` are permanent checks, and `connection.zone` re-binds the
  interface at every boot, so a profile pinning a non-default zone is the same hazard in the phase
  that actually matters and survives a `--reload` that would hide the runtime symptom.

Where the interface genuinely cannot be derived, both files `fail` with a message saying which
property could not be proven, rather than warning and continuing.

**F9 — also updated `028/setup.sh`'s mirroring precondition.** Its comment said "exactly the grader's
probe"; making the grader strict would have made that comment false, and mandate 9 depends on setup
proving the exact negation of what the checkpoint measures. Now both anchor on the string.

**F6 — rewrote both headers rather than qualifying them minimally.** Per the ruling's instruction to
say what is true: each now states that idempotency holds with respect to a previous run of the script
*and* of any shipped solution, and explicitly disclaims being a promise about arbitrary hand edits,
pointing at the preconditions as the thing that catches those.

---

## 5. Report corrections carried over from Task 22

**F13 — `troubleshooting/028`'s `firewall-ssh` row.** The Task 22 report described the setup probe as
`firewall-cmd --permanent --list-services` and `--permanent --list-ports`. The code does not do that.
It runs `sudo firewall-cmd --permanent --list-all` once into `$perm` and greps both `ssh` and
`22/tcp` out of it — byte-for-byte the grader's own probe at `028/grade.sh:27-28`, which is better
than what I wrote, because it cannot drift from the grader. Corrected row:

| Goal checkpoint | Starting-state property | Setup check |
| --- | --- | --- |
| `firewall-ssh` | the permanent config permits neither spelling of ssh, **and** the interface is in the default zone | `perm=$(sudo firewall-cmd --permanent --list-all)` then `grep -qw ssh` / `grep -qw 22/tcp`; plus the F4 default-zone checks, runtime and permanent |

**F7 — `users/006`'s `carol-expiry` row.** The Task 22 report said this row was "covered by carol's
absence above". That was wrong: with `EXPIRE=2027-06-30` in `/etc/default/useradd`, a bare
`useradd carol` satisfies the checkpoint and the expiry half of the task grades as done when nobody
set an expiry. Corrected row:

| Goal checkpoint | Starting-state property | Setup check |
| --- | --- | --- |
| `carol-expiry` | carol absent, **and** `/etc/default/useradd` does not already set `EXPIRE=` to the date the prompt asks for | the `id carol` loop, plus `awk -F= '$1=="EXPIRE"{print $2}' /etc/default/useradd` converted to a local day count and compared to the same `want` the grader computes |

Any other `EXPIRE=` date is deliberately allowed: `carol-expiry` still starts red and the student
still has to set the right date.

---

## 6. Still unverified, and one thing I want on the record

**Nothing in this round ran against a RHEL 9 guest.** No VM exists. Everything measured above was
measured against synthetic input or arithmetic on this WSL host. In particular:

- F2's verdict-A behaviour, F3's effect on how the prompt reads to a student, F6's second-run
  idempotency, F7's guard firing, F9's strictness and F12's wording are all **reasoned**.
- F4's central question — whether a given guest's NIC is in the default zone — is exactly the thing
  that cannot be measured without a guest. What I measured is that the parsers correctly classify
  the shapes `firewall-cmd` and `ip` produce.
- F5's ifcfg no-op cannot fire on a keyfile guest, so the assertion I added may never trip. That is
  the intended outcome; it is a tripwire, not a fix.

**One item I flagged rather than changed in the first commit.** F9 named two loose `is-enabled` sites
and I fixed both. There is a **third**: `systemd/017/grade.sh`'s `sshd-intact` invariant, which still
used the bare exit status. It was outside the ruling's scope and outside F9's "three checkpoints for
one concept", so I left it rather than widening a grader edit on my own initiative, and flagged it per
your instruction to stop and ask rather than drift the checkpoint surface.

**Ruled in scope and fixed — see section 7.** The team lead ruled it F15 and in scope for this round,
as a second commit. Section 7 below covers it.

**And one confirmation of your standing rule.** F1 is the case that rule exists for. Mandate 7 item 5
told me the `-u` was load-bearing and measured clean and instructed me not to re-derive it; my Task 22
report listed `carol-expiry`'s row as covered when it was not. Both of those were wrong in the same
direction — a "verified" label on something nobody had measured. The only reason it is fixed now is
that the reviewer looked at the writing side. I have kept the fix's justification in a code comment
rather than only in this report, so the next reader cannot undo it without reading the reason.

---

## 7. F15 — the fourth `is-enabled` site (second commit of this round)

One round, two commits. This section covers the second one; sections 1-6 cover `1ac01f2`.

**Finding.** F9 unified three of the four `systemctl is-enabled` checkpoints in this batch on the
strict string form. The fourth, `systemd/017/grade.sh`'s `sshd-intact`, still used the bare exit
status. I flagged it at the end of the first commit rather than changing it; the ruling was that it is
in scope, because leaving one of four sites loose after deliberately unifying the other three
guarantees the next reader reopens the question and cannot tell whether the odd one out was a decision
or an oversight — and an invariant is the checkpoint nobody looks at until the day it lies, so the
loose spelling is worse there than in a goal.

**Change.** One file, 8 insertions, 2 deletions.

```bash
# unprobed-invariant: sshd-intact
# Anchored on the exact string, the same spelling as stamp-enabled above and as
# selinux/019 and troubleshooting/028 use. is-enabled's exit status is also 0 for
# static, indirect, generated, alias and enabled-runtime, and this is an
# invariant - nobody reads it until the day it lies, so the loose form is worse
# here than in a goal checkpoint.
sshd_state=$(systemctl is-enabled sshd 2>&1)
printf '%s' "$sshd_state" | grep -qx enabled
ck sshd-intact "sshd is still enabled" $? "is-enabled=$sshd_state"
```

Three details worth naming:

- The variable is `sshd_state`, **not** `state`. `state` is already live in this file at line 14 for
  `stamp-enabled`; reusing it would have clobbered the value the `stamp-enabled` detail string reads
  and produced a misleading diagnostic on an unrelated checkpoint. This is the one thing in the change
  that is a real hazard rather than a spelling, and it is why the fix is not a literal copy of F9's.
- A detail string was added (`"is-enabled=$sshd_state"`), matching the shape of the other three sites.
  The old form emitted no detail at all, so an `sshd-intact` failure said nothing about *why*.
- `# unprobed-invariant: sshd-intact` is untouched, and `sshd-intact` remains **absent** from the
  `# baseline-fail:` header. The id, the description text and the checkpoint's status as a knowingly
  unprobed invariant are all unchanged. No checkpoint added, removed or renamed.

**Measured or reasoned: reasoned.** The same answer F9 got, for the same reason. That
`systemctl is-enabled` exits 0 for `static`, `indirect`, `generated`, `alias` and `enabled-runtime` is
read from systemd's documented exit-status table, not observed — there is no systemd on this host to
observe it on, and no guest. What I *did* verify locally is mechanical: `bash -n` parses it, the
checkpoint id set is byte-identical, and `printf '%s' … | grep -qx enabled` is the same construction
already shipped and reviewed at three other sites in this batch. The behavioural claim — that a
`static` sshd now fails this invariant where it previously passed — will first be observable on Step 9.

**Gates, re-run against this second change.** All identical to the first commit.

```
$ bash -n on every task script
scripts checked: 37
syntax pass complete                 (no SYNTAX ERROR lines)

$ npm run typecheck
typecheck exit=0

$ npx vitest run
 Test Files  23 passed (23)
      Tests  246 passed (246)

$ node src/cli/index.ts coverage
coverage exit=0
problem: lines = 0
tasks: 5   concepts: 10   objectives: 68   uncovered: 58   untaught concepts: 0
```

Declared-vs-emitted cross-check, both directions — no `UNPROBED-GOAL`, no `UNDECLARED-ID`, and the
per-task counts are **identical to before this commit**, which is the proof that F15 changed a probe
body and not the checkpoint set:

```
selinux/019-httpd-alt-port                     emitted=8 goal=7 hdrs=1
storage/014-grow-home-lv                       emitted=5 goal=2 hdrs=1
systemd/017-boot-time-service                  emitted=5 goal=3 hdrs=1
troubleshooting/028-restore-remote-access      emitted=5 goal=4 hdrs=1
users/006-team-provisioning                    emitted=8 goal=7 hdrs=1
id cross-check complete
```

`sshd-intact` absent from every `# baseline-fail:` header: confirmed, `grep -c` = 0 across
`content/tasks`. Checkpoint-declaration headers byte-identical to `9d2dc22`: 5 files compared, no
drift. Exactly one `# baseline-fail:` header in the edited file, and no grader comment containing
`ck_pass`/`ck_fail`/`ck_skip` followed by a word.

**One correction to my own cross-check tooling, not to the content.** On the first run of the
cross-check this round my inline id extractor matched only the `ck ` wrapper form, and reported
`storage/014` as `emitted=0 goal=2` with two spurious `UNPROBED-GOAL` lines. That was the extractor,
not the content: `storage/014/grade.sh` calls `ck_pass`/`ck_fail` directly rather than through the `ck`
wrapper, and that file is untouched by this round. Re-ran with an extractor covering both call forms
and got the 5/2 above, matching the first commit. Recording it because a measurement tool that
silently under-counts is the same defect class as everything else in this file, and the numbers in
this section are only worth anything if the tool that produced them is stated.

**Scope.**

```
$ git diff --stat HEAD          # HEAD = 1ac01f2
 content/tasks/systemd/017-boot-time-service/grade.sh | 10 ++++++++--
 1 file changed, 8 insertions(+), 2 deletions(-)
```

Verified empty for this commit: nothing under `src/`, no test, not `content/objectives.yaml`, not
`content/lib/assert.sh`, nothing under `content/tasks/storage/014-grow-home-lv/`, nothing under
`scripts/`, not `package.json`.

**Still not verified against a guest.** Unchanged from section 6, and it applies to this commit too:
no VM exists, Steps 9 and 10 are deferred, and nothing here ran against RHEL 9.

---

## 8. Fix round 2 — the five the re-review found underneath (third commit)

Ruling: `task-22-fix-2.md`. Re-review: `task-22-rereview.md`, verdict APPROVED, every round-1 finding
CLOSED. This round is five items it found beneath the fixes, plus two more that my own sweep for the
same defect class turned up. 4 files changed, 70 insertions, 18 deletions, all under `content/tasks/`.
No checkpoint added, removed or renamed.

| # | What I did | Measured or reasoned |
| --- | --- | --- |
| R1 | `019/setup.sh`: made `ip -o route show default` the **primary** device source with the `nmcli` form as fallback, and excluded `lo` from it. Also re-derived the permanent half's connection from that device instead of from the first active row | **Measured** — 8 synthetic shapes, section 8.1 |
| R2 | `users/006/grade.sh`: split the epoch read from the arithmetic, and guarded on `want_epoch` **directly** rather than on the value derived from it | **Measured** — the vanished checkpoints reproduced and closed, section 8.2 |
| R3 | `028/solutions/02`: replaced the false clause with what the code actually does, including that an escaped colon in the path fails loudly | **Measured** — the backslash survives and `sed` exits 2, section 8.3 |
| R4 | `019/setup.sh`: `httpd-enabled`'s precondition to `grep -qx enabled` | **Measured** — and it is not cosmetic; section 8.4 |
| R5 | `task-22-report.md`: corrected the `carol-expiry` and `firewall-ssh` rows in place, each with a parenthetical naming the round-1 finding | **Measured by reading** |
| R4b (mine) | `017/setup.sh`: the same `!= "enabled"` form at `stamp-enabled`'s precondition, whose comment claimed it was "exactly the grader's probe, anchored the same way" while using a different comparison | **Measured** (same divergence as R4) |
| R4c (mine) | `017/setup.sh`: `sshd-intact`'s precondition, still on the bare exit status — **a mirror my own F15 commit broke**. See 8.5; this is the one I would most want looked at | **Reasoned** for the guest behaviour, **measured** for the comparison |

`028/setup.sh:21` left alone and flagged instead — see 8.6, and it is the one place I did not do what
might have been wanted.

### 8.1 R1 — measured, and it was worse than one shape

The old order asked `nmcli` first and fell back to the route. Both halves swapped, and `lo` filtered
out of the `nmcli` half. Old form against new, across eight shapes:

```
NM 1.42+ lists lo first (the R1 hazard)          old=lo       new=ens160
NM lists the NIC first                           old=ens160   new=ens160
only lo is managed                               old=lo       new=ens160
no default route, nmcli lists lo first           old=lo       new=ens160
nmcli silent                                     old=ens160   new=ens160
both silent (must be <none> so setup fails loud) old=<none>   new=<none>
only lo, no route (must be <none>)               old=lo       new=<none>
two default routes, lo first in nmcli            old=lo       new=enp0s3
```

The old form returns `lo` in **five of eight**, not one. The row that matters most is the second to
last: with only `lo` managed and no default route, the old form returned `lo` and the check passed
silently, while the new form returns nothing and setup takes the loud `fail` branch — a guest whose
primary interface cannot be determined is now refused rather than waved through.

**Also changed, and this is an extension of the ruling rather than the ruling.** The permanent half
three lines below had the identical fail-open: `aconn=$(nmcli -g NAME connection show --active | head -1)`
can name the `lo` profile, whose `connection.zone` says nothing about the interface carrying port 82,
and an empty or irrelevant zone means no `fail` — so the permanent half would pass for the same wrong
reason the runtime half did. It now asks which profile owns `$dev`:

```bash
aconn=$(nmcli -g GENERAL.CONNECTION device show "$dev" 2>/dev/null | head -1)
if [ -n "$aconn" ] && [ "$aconn" != "--" ]; then
```

`device show` prints `--` for a device with no profile, which is why that is tested explicitly rather
than only for emptiness. I did this rather than flagging it because it is the same defect, in the same
block, three lines from the line the ruling names, and fixing one of two instances of a fail-open is
how the second one survives review. That `nmcli -g GENERAL.CONNECTION device show` returns the profile
name and `--` for none is **reasoned** from nmcli's output format; there is no nmcli on this host.

### 8.2 R2 — measured, and the sentinel had a collision I had to close

Reproduced first. Stubbing `date` to emit nothing and running the four checkpoints that follow:

```
=== old form ===
bash: line 9: / 86400 : arithmetic syntax error: operand expected (error token is "/ 86400 ")
bash: line 16: want: unbound variable
checkpoints emitted: 0 of 4

=== new form ===
EMITTED carol-expiry     result=1
EMITTED alice-maxdays    result=1
EMITTED sudo-devops      result=1
EMITTED student-intact   result=0
checkpoints emitted: 4 of 4
```

Confirms the re-reviewer exactly: the old form kills the grader and the checkpoints **vanish**; the new
one emits all four, with `carol-expiry` failing and the rest unaffected.

**My first version of this fix was still wrong and I caught it while measuring.** I used a
`want=unavailable` sentinel and compared `[ -n "$days" ] && [ "$days" = "$want" ]` — which means a
shadow field 8 containing the literal string `unavailable` would have **passed**:

```
want=unavailable
  field8=unavailable  -> result=0 (0=pass)      <- the collision
```

Unreachable, but it is a false pass reachable from data, which is the wrong kind of unreachable. The
shipped form tests the epoch read itself, so no field value can pass when `date` produced nothing:

```bash
[ -n "$want_epoch" ] && [ -n "$days" ] && [ "$days" = "$want" ]
```

```
date broken, field8=20998        -> result=1        date broken, field8=unavailable  -> result=1
date broken, field8=0            -> result=1        date broken, field8=99999        -> result=1
date broken, field8=empty        -> result=1
```

And the normal path is unchanged — `want=20998` at `+0800`, passing `20998`, rejecting `20997`, `20999`,
empty, `0` and the sentinel string. The sentinel now only ever appears in the detail string, where it
is a diagnostic rather than an operand.

### 8.3 R3 — measured, the comment was false in the direction the re-review said

```
extracted: [/etc/NetworkManager/system-connections/odd\:name.nmconnection]
backslash present: YES
path exists: no
sed: FAILED loudly (exit 2)
```

The `sub()` does not un-escape `\:`, so the claim "a colon in the path is safe too" was false. The
comment now says what is true: keyed on UUID, names with spaces are fine because nothing splits on
whitespace, and an escaped colon in the path **fails loudly** rather than silently — still an
improvement on the name-keyed form, which returned empty and edited nothing. I kept the note that a
keyfile path is derived from the profile name, so reaching this needs a profile named with a colon.

Worth accepting the framing plainly: I labelled that clause "measured" in round 1 on a synthetic
fixture that did not reproduce nmcli's own escaping. A real measurement against the wrong input is
still the F1 defect class, and it is the one item in this round I would not have found by re-reading.

### 8.4 R4 — measured, and it is a fail-open rather than a spelling preference

`[ "$state" != "enabled" ]` and `grep -qx enabled` are identical on single-line output, so I checked
whether R4 was purely cosmetic. It is not, because `state` captures stderr through `2>&1`:

```
CAPTURED VALUE (2>&1)                                  OLD-fails  NEW-fails
enabled                                                YES        YES
disabled                                               no         no
static                                                 no         no
enabled-runtime                                        no         no
enabled\nThe unit files have no installation config    no         YES
Warning: unit is masked\ndisabled                      no         no
```

(*fails* = the precondition correctly refuses to stage.) On a two-line capture whose first line is
`enabled`, the `!=` form compares the whole blob, silently stops matching, and setup proceeds having
concluded httpd is disabled while `httpd-enabled` would pass at baseline. The `grep -qx` form still
finds the line. That systemd ever emits such a hint on this path is **reasoned**; the divergence in the
comparison, given the capture, is measured.

### 8.5 R4b and R4c — two more sites, one of them a mirror my own F15 commit broke

R4 names `019/setup.sh`. Sweeping every `is-enabled` site rather than only the named one found two more
in `017/setup.sh`:

- **`stamp-enabled`'s precondition** used the `!=` form under a comment reading *"exactly the grader's
  probe, anchored the same way"*. The grader uses `grep -qx`. Same fail-open as R4, plus a comment
  asserting a sameness that was not there.
- **`sshd-intact`'s precondition** used the bare exit status: `systemctl is-enabled sshd &>/dev/null`.
  **F15 made that checkpoint's grader strict and left its mirror loose.** So setup accepted `static`,
  `indirect`, `generated`, `alias` and `enabled-runtime` while the grader now rejects them, and on such
  a guest the invariant would fail for every fixture — which is verbatim the outcome the precondition's
  own comment says it exists to rule out, and mandate 9's requirement that setup prove the exact
  negation of what the checkpoint measures. My F15 commit introduced this and my F15 report did not
  mention it, because I checked the other three *graders* for uniformity and never checked the *setups*
  that mirror them.

Both fixed in the same shape. All eight sites — four graders and four setup preconditions — now use one
spelling, verified by sweep: zero remaining `is-enabled ... &>/dev/null` and zero remaining
`!= "enabled"` outside comments.

I judged these in scope rather than flagging them because R4's stated rationale is that one site left
in the old spelling cannot be told apart from an oversight, and R4c is not a uniformity nit at all — it
is a mirror broken by the commit the ruling was written about. If you would rather round 2 had touched
only the site named, this is the part to send back.

### 8.6 `028/setup.sh:21` — left alone and flagged, per the ruling's instruction

The ruling said to apply the hardened form there if it is a clean drop-in and otherwise flag it. **It is
not a clean drop-in, and I left it.** Line 21 needs a connection *name* — the profile the task stages
its break against and records in `/etc/rhcsa-conn` — whereas the hardened form yields a *device*.
Substituting it would change which profile the task breaks, which is a behavioural change to the
fixture in a file this round has no finding against, immediately before a re-review.

The hazard is real and worth recording rather than closing: if `nmcli -t -f NAME connection show --active`
lists `lo` first, `028/setup.sh` would set `autoconnect no` on **loopback**, record `lo`, and the whole
task would stage against the wrong interface — and unlike R1 this is not a precondition failing open, it
is the break itself landing in the wrong place. The existing guard only catches an *empty* `conn`, and
`lo` is not empty. `net-autoconnect` would then measure `lo` and the fixtures would still pass, so
nothing downstream would notice. Whether `lo` can sort first in that output is **reasoned** and I could
not measure it here; NM's ordering is not documented as alphabetical, which is exactly why I would not
want to rely on `ens160` < `lo` either. Recommend it as its own finding in the whole-branch review,
where changing what `028` stages against can be done deliberately with the fixtures re-run.

### 8.7 Gates

```
$ bash -n on every task script
scripts checked: 37
syntax pass complete                 (no SYNTAX ERROR lines)

$ npm run typecheck
typecheck exit=0

$ npx vitest run
 Test Files  23 passed (23)
      Tests  246 passed (246)

$ node src/cli/index.ts coverage
coverage exit=0
problem: lines = 0
tasks: 5   concepts: 10   objectives: 68   uncovered: 58   untaught concepts: 0
```

Declared-vs-emitted, both directions, no `UNPROBED-GOAL` and no `UNDECLARED-ID`, five pairs unchanged:

```
selinux/019-httpd-alt-port                     emitted=8 goal=7 hdrs=1
storage/014-grow-home-lv                       emitted=5 goal=2 hdrs=1
systemd/017-boot-time-service                  emitted=5 goal=3 hdrs=1
troubleshooting/028-restore-remote-access      emitted=5 goal=4 hdrs=1
users/006-team-provisioning                    emitted=8 goal=7 hdrs=1
```

Declaration headers: I widened this to the re-reviewer's scope rather than my earlier 5 files —
**every** `.sh` under `content/tasks` carrying a header, 21 files and **26 header lines**
(5 `baseline-fail`, 16 `expect-fail`, 5 `unprobed-invariant`), all byte-identical to `9d2dc22`. The 26
reconciles with the re-review's count exactly. Grader prohibitions clean: one `# baseline-fail:` per
grader, no `ck_pass`/`ck_fail`/`ck_skip` followed by a word in any grader comment.

```
$ git diff --stat HEAD          # HEAD = decf75d
 content/tasks/selinux/019-httpd-alt-port/setup.sh  | 35 ++++++++++++++++------
 .../tasks/systemd/017-boot-time-service/setup.sh   | 20 ++++++++++---
 .../solutions/02-by-port-and-keyfile.sh            | 14 +++++++--
 content/tasks/users/006-team-provisioning/grade.sh | 19 ++++++++++--
 4 files changed, 70 insertions(+), 18 deletions(-)
```

Out-of-scope check empty for `src`, tests, `content/objectives.yaml`, `content/lib/assert.sh`,
`content/tasks/storage/014-grow-home-lv/`, `scripts/`, `docs/`, `package.json`. `git status --porcelain`
lists only the four files above; `task-22-report.md`'s R5 edits do not appear because `.superpowers` is
gitignored.

### 8.8 On the F15 ruling being wrong

Noted, and it changes something for me rather than nothing. The `state`-clobbering rationale was mine
before it was yours — I wrote it, you endorsed it, and neither of us executed the file. What makes it
worth more than an apology is 8.5: while sweeping for R4 I found that the same F15 commit left
`sshd-intact`'s setup mirror loose, which is a real defect, in the same file, from the same change, that
the confident wrong rationale drew attention away from. The rationale was about the safety of a variable
name; the actual hole was one check over, in a file nobody re-read. That is the more useful lesson than
the correction itself, and it is why 8.5 is a sweep rather than a spot fix.

**Still not verified against a guest.** No VM exists, Steps 9 and 10 remain deferred, and nothing in
this round ran against RHEL 9. Everything above was measured against synthetic input, stubbed commands,
or arithmetic on this WSL host, or is labelled reasoned.

---

## 9. Fix round 3 — R6, the item I recommended forwarding (fourth commit)

Ruling: `task-22-fix-3.md`. One item. The lead overrode my recommendation to forward
`028/setup.sh:21` to the whole-branch review, on the strength of my own description of it, and directed
me to close it with the two-step machinery R1 produced. **R6 is fixed and measured.** 1 file, 37
insertions, 14 deletions. No checkpoint added, removed or renamed. No solution, antisolution, grader or
`task.yaml` touched — so the escalation clause the ruling offered did not need to be used.

**I agree with the override.** My reason for forwarding was that the hardened form yields a device while
line 21 needs a name, and that substituting it changes which profile the task breaks. The first half was
a real obstacle; the second half was me treating a behavioural change as automatically out of scope when
the behaviour being changed *was the defect*. The task means to break the network the student reaches the
box over, and `head -1` on a sorted list was never a way of saying that. The missing piece was
`nmcli -g GENERAL.CONNECTION device show`, which I had written earlier in the same round for R1's
permanent half and did not connect to this.

### 9.1 The change

Selection is now two steps, reusing R1's path rather than a second one:

```bash
dev=$(ip -o route show default 2>/dev/null | awk '{for (n=1; n<NF; n++) if ($n == "dev") { print $(n+1); exit }}')
conn=""
if [ -n "$dev" ]; then
  conn=$(nmcli -g GENERAL.CONNECTION device show "$dev" 2>/dev/null | head -1)
  [ "$conn" = "--" ] && conn=""
fi
```

The `ip -o route` line is **byte-identical** to `019/setup.sh`'s, verified by comparing the two strings
rather than by eye, so a reader can diff them and a future edit to one is visibly an edit to only one.
No shared helper was added: after this change each file has exactly one call site, and a helper wrapping
a single call in each of two files would be indirection rather than reuse.

Three things kept or made loud, per the ruling:

- **The empty-`conn` guard is kept**, and now also covers "no default route" and "no profile owns that
  device". Its comment still explains the original hazard it was written for — a blank
  `/etc/rhcsa-conn`, a modify that fails into nothing, `net-autoconnect passed at baseline`.
- **It fails loudly in the batch's shape**, with the `docs/vm-build-checklist.md` wording, naming the
  route device it could not resolve. The old second lookup —
  `nmcli -t -f NAME connection show | head -1`, the *inactive* fallback — is **gone**: falling back to
  whichever profile sorts first is the same defect one level down.
- **`/etc/rhcsa-conn` is unchanged** in purpose, format and permissions. Verified by grep that its other
  readers — `grade.sh`, both solutions, all three antisolutions — take it as a profile name and are
  untouched.

**One removal worth calling out explicitly.** The zone block further down used to re-derive `dev` from
`$conn` via `GENERAL.DEVICES`. With `conn` now derived *from* `dev`, that was a second derivation of the
same fact by a different route, and if the two ever disagreed the zone check would have measured one
interface while the break landed on another. Derived once, at the top. The `if [ -n "$dev" ]` guard
around the zone check is now unreachable and I kept it deliberately, with a comment saying why it is not
decoration: on an empty `$dev` the awk compares every interface against `""`, matches nothing, finds no
other zone and **passes**. It is what stops a future reordering from quietly turning that check off.

### 9.2 Measured — the old form chose `lo` in six of eight shapes

Modelling `nmcli connection show --active`, the all-profiles listing, `ip -o route show default` and a
device→profile map, and asking only "which profile does setup stage the break against":

```
lo sorts first (the R6 hazard)                old=lo        new=ens160
NIC sorts first                               old=ens160    new=ens160
lo first, profile name has spaces             old=lo        new=Wired connection 1
only lo ACTIVE, NIC route exists              old=lo        new=ens160
only lo managed, no default route             old=lo        new=LOUD-FAIL
nothing at all                                old=LOUD-FAIL new=LOUD-FAIL
route device owned by NO profile              old=lo        new=LOUD-FAIL
two default routes                            old=lo        new=primary
```

`new` never selects `lo`. The two rows where it reads `LOUD-FAIL` while `old` read `lo` are the ones that
matter most: on a guest with no usable default route the script now stops with a checklist message
instead of breaking loopback and reporting success. Row 3 confirms a profile name containing spaces
survives — nothing in the new path splits on whitespace. Row 8 shows the multi-route case resolving to
the first default route's profile rather than to `lo`.

**What is reasoned, not measured, and it is the pivot of the whole finding:** whether NetworkManager can
order `lo` first in `connection show --active`. There is no nmcli on this host, NM's ordering is not
documented as alphabetical, and that is exactly why I would not rely on `ens160` < `lo` in the other
direction either. The fix does not depend on the answer — it stops asking the question. Also reasoned:
that `nmcli -g GENERAL.CONNECTION device show` prints the owning profile's name, and `--` for none.

**One honest limit, and it is R3's lesson applied to my own new code.** If the route-carrying profile's
name contains a colon, `-g` terse output escapes it as `\:` and `$conn` keeps the backslash. That is not
handled and I am not claiming it is. It is fail-closed rather than fail-open:
`need sudo nmcli connection modify "$conn" …` fails and `need` exits loudly, and the `net-autoconnect`
precondition compares `nmcli -g connection.autoconnect connection show "$recorded"` against `no` and
fails when that comes back empty. Read from the code, not measured — there is no nmcli here. The old form
had the identical exposure, so this is unchanged rather than introduced, but after R3 I would rather
write the limit down than let the next reader infer it was considered.

### 9.3 Gates

```
$ bash -n on every task script
scripts checked: 37
syntax pass complete                 (no SYNTAX ERROR lines)

$ npm run typecheck
typecheck exit=0

$ npx vitest run
 Test Files  23 passed (23)
      Tests  246 passed (246)

$ node src/cli/index.ts coverage
coverage exit=0
problem: lines = 0
tasks: 5   concepts: 10   objectives: 68   uncovered: 58   untaught concepts: 0
```

Declared-vs-emitted, both directions, no `UNPROBED-GOAL` and no `UNDECLARED-ID`, five pairs unchanged
(8/7, 5/2, 5/3, 5/4, 8/7). Declaration headers at the standing scope — **21 files, 26 header lines**,
drift 0, all byte-identical to `9d2dc22`; the file and line counts are asserted inside the check rather
than eyeballed, so a header appearing or vanishing would fail it too. Grader prohibitions clean.

```
$ git diff --stat HEAD          # HEAD = 850c567
 .../028-restore-remote-access/setup.sh             | 51 ++++++++++++++++------
 1 file changed, 37 insertions(+), 14 deletions(-)
```

Out-of-scope check empty for `src`, tests, `content/objectives.yaml`, `content/lib/assert.sh`,
`content/tasks/storage/014-grow-home-lv/`, `scripts/`, `docs/`, `package.json`. Within `028`, the only
changed file is `setup.sh`. `git status --porcelain` empty after the commit.

**Still not verified against a guest.** Fourth round, same sentence: no VM exists, Steps 9 and 10 remain
deferred, nothing here ran against RHEL 9. R6 in particular is the item whose real proof is a guest boot
— what is measured is which profile the selection logic picks given the shapes `ip` and `nmcli` produce,
not that a RHEL 9 guest produces those shapes.

### 9.4 The commit, and every gate re-run after it

`9300d2b`, one file, 37 insertions / 14 deletions. `git status --porcelain` empty. The gates above were
run pre-commit; all were re-run against the committed tree at `9300d2b` and are unchanged: tsc exit 0,
vitest 23 files / 246 tests, coverage exit 0 with 0 `problem:` lines and 5/10/68/58/0, headers 21 files /
26 lines / drift 0 against `9d2dc22`, `sshd-intact` still absent from every `# baseline-fail:` and its
`# unprobed-invariant:` intact at `017/grade.sh:36`, no duplicate `# baseline-fail:` and no `ck_*` in any
grader comment. `bash -n` reads 41 rather than 37 in the re-run because the re-run covered `scripts/` as
well as `content/`; 0 errors either way.

**Two corrections to my own checking, both in the check and neither in the tree.** Disclosed for the same
reason the `storage/014` under-count was disclosed in section 7 — a measurement tool that quietly gets it
wrong is the defect class this whole round is about.

1. The post-commit cross-check, which I re-wrote inline instead of reusing, split `# baseline-fail:` on
   whitespace. The headers are **comma-separated**, so every goal id carried a trailing comma, matched no
   emitted id, and the run printed `UNPROBED-GOAL` for all 22 goal ids across all five tasks. The per-task
   counts in that same run were right (8/7, 5/2, 5/3, 5/4, 8/7), which is what made it obvious. Re-run
   with `tr ',' '\n'`: **0 unprobed goals, 0 undeclared emitted ids**, five pairs unchanged. The
   pre-commit run, which used the four-call-form extractor from section 7, was already clean — this was a
   fresh transcription error, not a re-finding.
2. The out-of-scope check was first run over `9d2dc22..HEAD` and flagged `scripts/guest-provision.sh`.
   That file is not mine: it is the team lead's own `85bf671` provisioner commit, which sits inside that
   range and which the re-review's framing excludes from this task's diff. Re-run over `85bf671..HEAD`,
   the correct base: **empty**. Across all four commits the touched set is exactly 12 files, all under
   `content/tasks/`, none in `storage/014`.

Both failed in the cheap direction — the tool reported a violation that was not there — but they are the
same shape as the mistake this round exists to punish, and the run that under-reports is the one that
looks like success.
