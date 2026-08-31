# Task 22 review

Range reviewed: `aae2dca..85bf671` (`9d2dc22` Task 22, 42 files; `85bf671` the
one-line `libselinux-utils` fix). Reviewed on 2026-08-30. No VM exists, so
nothing in `content/` was executed against a guest.

## Verdicts

**Spec compliance: PASS.** The delivered content matches the brief as amended by
all nine mandates. Every mandate was checked against the tree rather than taken
from the report, and every one is applied. Details in section 2.

**Task quality: APPROVE WITH CHANGES.** Fourteen findings. One (F1) is a real
defect that will fail four of the six `users/006` fixtures on a guest built in
this project's own timezone, and mandate 7 explicitly told the implementer not
to look at it. Four more are medium. None of them produces a false *pass* inside
`validate`; F4 is the only finding that can make a *student's* failure look like
a pass.

Findings by severity: **1 high, 4 medium, 5 low, 4 nits.**

Must-fix before the next task builds on this content: **none.** Task 23's
`countCheckpoints` derives its masked total by static inspection of `ck` call
sites, and I verified that every `ck` id in the four new graders is a literal —
no variables, no interpolation, no loops. Task 23 is unblocked as delivered.

Must-fix before **Step 9** (the deferred VM acceptance run): **F1.** Left in
place it produces four failures that mandate 7 has pre-labelled as "measured
clean, leave it", which is the worst possible combination.

## 1. What I measured, and how

Everything in this section I ran in this session. `git status --porcelain` was
empty before and after; nothing in the repo was mutated.

| check | command | result |
| --- | --- | --- |
| typecheck | `npx tsc --noEmit` | clean, exit 0 |
| tests | `npm test` | `23 files passed`, `246 tests passed` |
| coverage | `node src/cli/index.ts coverage` | `tasks: 5`, `concepts: 10`, `objectives: 68`, `uncovered: 58`, `untaught concepts: 0`, exit 0, **zero** `problem:` lines |
| shell syntax | `bash -n` over every `content/**/*.sh` | 37 fixture scripts, 0 errors |
| modes | `find content -name '*.sh' ! -perm 755` | one hit, `content/lib/assert.sh` (644, correct — it is concatenated by `loadTaskScripts`, never executed) |
| objective ids | per-id lookup of every `task.yaml` and card `objectives:` entry against the 68 `- id:` lines in `content/objectives.yaml` | all resolve; **zero** typos |
| declared vs emitted | both directions, all five tasks | no declared id is unemitted; the only emitted-and-never-declared ids are the intended invariants |
| `ck_pass` in comments | `grep -rn 'ck_pass [A-Za-z]' content/` | 17 hits, all genuine emitter calls in `storage/014/grade.sh`; **zero** inside any Task 22 comment |
| literal `ck` ids | grep of every `ck`/`ck_pass`/`ck_fail` call line for `$` or `{` in argument 1 | all literal |
| `$?` positional safety | reproduced the call-site shape in `bash` | measured: `false; ck x "d" $? "extra=$(true; echo hello)"` reports `status=1`. Argument 3 is expanded before argument 4's command substitution runs, so no `ck` call site can report a pass for a failed probe |
| mandate-3 antisolutions | `diff` against `solutions/01`, comments stripped | `04` differs by exactly one line (`enable --now httpd` → `start httpd`); `05` differs by exactly one deleted line (`restorecon -Rv /srv/web`) |
| timezone mechanism (F1) | `date -d` vs `date -u -d` on this host | `TZ` reports offset **UTC+8**. `date -d 2027-06-30 +%s` = 1814284800 → `/86400` = **20998**. `date -u -d 2027-06-30 +%s` = 1814313600 → `/86400` = **20999** |

Not measured, and not measurable here: anything requiring RHEL 9 — SELinux
labels, `semanage`, `firewalld`, `nmcli`, `systemd-analyze verify`, `chage`,
`sudo -l`, `httpd`. Report section 9 lists these and is correctly long. Per the
review context, `shellcheck` was not run and its absence is not reported.

### Fixture arithmetic (corrected and confirmed by file count)

| task | solutions | antisolutions | fixtures | transport |
| --- | --- | --- | --- | --- |
| `users/006-team-provisioning` | 3 | 2 | 6 | ssh |
| `selinux/019-httpd-alt-port` | 2 | 5 | **8** | ssh |
| `systemd/017-boot-time-service` | 2 | 3 | 6 | ssh |
| `troubleshooting/028-restore-remote-access` | 2 | 3 | 6 | vmrun |

The `selinux/019` count is 8, not 6, because mandate 3 added two antisolutions.
Task 22's three ssh tasks total **20** fixtures; with `028` the batch is **26**.
`storage/014`'s 6 fixtures are excluded from both numbers, matching mandate 3's
arithmetic. The npm script is `rhcsa`, not `validate`, so the deferred steps are:

- **Step 9:** `npm run rhcsa -- validate users/006-team-provisioning selinux/019-httpd-alt-port systemd/017-boot-time-service` should print `transport: ssh` and end `20/20 fixtures ok`.
- **Step 10:** `npm run rhcsa -- validate troubleshooting/028-restore-remote-access` should print `transport: vmrun` **on its first line** — `src/cli/index.ts:188` sets `require: 'vmrun'` when any task in the set asks for it — and end `6/6 fixtures ok`.

Both are deliberately deferred by mandate 8. Neither has been run, and their
absence is not a finding.

## 2. Mandate compliance, verified

| # | mandate | verified how | verdict |
| --- | --- | --- | --- |
| 1 | substitute 12 real objective ids for 11 nonexistent ones; `systemd/017` drops to two objectives | all four `task.yaml` objective lists and all eight card `objectives:` lists compared line by line against the mandate's tables, then every id resolved against `objectives.yaml` | applied |
| 2 | add a `need()` wrapper, never `set -e` | `need`/`fail` present in all four `setup.sh`; no `set -e` anywhere in them; every command on the mandate's wrap list is guarded — `019/setup.sh:31,34,35,38`, `017/setup.sh:23-31,38,39`, `028/setup.sh:35,38,45`, `006/setup.sh:27` | applied |
| 3 | add `antisolutions/04` and `05` to `selinux/019`, closing `httpd-enabled` and `context-now` | both present; goal-coverage union recomputed as 7/7 | applied |
| 4 | four `# unprobed-invariant:` headers | `006/grade.sh`, `019/grade.sh`, `017/grade.sh`, `028/grade.sh` — one each | applied |
| 5 | renumber `users/006` antisolutions to `01`/`02` | filenames and `# expect-fail:` headers checked | applied |
| 6 | no added objectives, no added checkpoints | checkpoint id sets match the brief exactly: `006` 8, `019` 8, `017` 5, `028` 5 | applied |
| 7 | nine measured clean negatives, do not re-derive | honoured, with one exception: **item 5 is wrong** — see F1 | applied, but see F1 |
| 8 | defer Steps 9 and 10; no `vmrun`, no VM operations | no VM operation attempted; no `vmrun`, no `ssh-keygen`, no `.env.local`, no `provision.sh` | honoured |
| 9 | `setup.sh` verifies every precondition its goal checkpoints depend on; prefer absolute arguments; rank "guest not built to spec" ahead of over-fitting | precondition tables re-derived from scratch below; two gaps found (F4, F7) | substantially applied |

On **absolute over relative arguments** (mandate 9, review-context item 8): every
path in every solution and antisolution is absolute — `/etc/httpd/conf/httpd.conf`,
`/srv/web`, `/etc/systemd/system/rhcsa-stamp.service`, `/usr/local/bin/rhcsa-stamp`,
`/etc/sudoers.d/devops`, `/etc/rhcsa-conn`. The only non-absolute references are
unit *names* (`rhcsa-stamp.service`, `sshd`) and service names (`ssh`), which are
identifiers rather than paths. Clean.

On **`85bf671`**: correct. `libselinux-utils` provides `matchpathcon`, used at
`019/grade.sh:31` (`context-permanent`) and guarded at `019/setup.sh:52`, and
`getenforce`, used at `019/grade.sh:47`, `019/setup.sh:63` and
`scripts/guest-provision.sh:118`. The added comment accurately names both.

## 3. Mandate-9 precondition tables, re-derived

I worked from each grader's goal checkpoints back to the state they assume, then
looked for the check, rather than reading the report's table. Rows marked **GAP**
are findings.

### `users/006-team-provisioning`

| goal checkpoint | assumed starting state | verified at |
| --- | --- | --- |
| `group-gid` | `devops` absent **and GID 5000 free** | `setup.sh:39`, `:40-42` |
| `alice-in-devops` / `bob-` / `carol-` | the three accounts absent | `setup.sh:46-48` |
| `carol-expiry` | carol absent; **`EXPIRE=` in `/etc/default/useradd` is not already 2027-06-30** | `setup.sh:46-48` only — **GAP, F7** |
| `alice-maxdays` | alice absent **and `/etc/login.defs` does not already set `PASS_MAX_DAYS 30`** | `setup.sh:54-57` |
| `sudo-devops` | no `%devops` rule anywhere, and the sudoers files parse | `setup.sh:62-67` |
| `student-intact` (invariant) | student in wheel before the fixture | `setup.sh:71-72` |

The `PASS_MAX_DAYS` guard is the best precondition in the batch: it is exactly
the class mandate 9 exists for, and it was not in the brief.

### `selinux/019-httpd-alt-port`

| goal checkpoint | assumed starting state | verified at |
| --- | --- | --- |
| `httpd-enabled` | httpd not enabled | `setup.sh:75-76` |
| `page-served` | nothing listening on 82; the marker really is in the staged file; `curl` exists | `setup.sh:80-82`, `:91-92`, `:54` |
| `port-labeled` | 82/tcp not already `http_port_t`; `semanage` exists | `setup.sh:86-88`, `:50-51` |
| `context-now` | the file is not already `httpd_sys_content_t` | `setup.sh:97-101` |
| `context-permanent` | policy does not already label `/srv/web`; `matchpathcon` exists | `setup.sh:104-108`, `:52-53` |
| `firewall-runtime` / `firewall-permanent` | firewalld running; 82/tcp closed in both configs; **the interface is in the default zone** | `setup.sh:58-59`, `:111-114` — zone unverified, **GAP, F4** |
| `selinux-enforcing` (invariant) | enforcing | `setup.sh:63-65` |

Also checked and present: a dnf repository exists (`setup.sh:70-72`), without
which `dnf -y install httpd` in every fixture fails for a reason that has
nothing to do with the student.

### `systemd/017-boot-time-service`

| goal checkpoint | assumed starting state | verified at |
| --- | --- | --- |
| `unit-verifies` | no unit at either path, and `systemd-analyze verify` rejects the name | `setup.sh:52-58` |
| `stamp-enabled` | the unit is not enabled | `setup.sh:61-62` |
| `stamp-effect` | `/run` is tmpfs; the helper works; `/run/rhcsa-stamp` absent | `setup.sh:68-70`, `:76-80` |
| `default-target` (invariant) | `get-default` is `multi-user.target` | `setup.sh:84-86` |
| `sshd-intact` (invariant) | sshd enabled | `setup.sh:87-88` |

The `/run`-is-tmpfs check is the second-best precondition in the batch: without
it `stamp-effect` cannot distinguish "enabled" from "started", which is the whole
point of the task. Nothing in `docs/vm-build-checklist.md` pins it, so checking
it was the right call.

### `troubleshooting/028-restore-remote-access`

| goal checkpoint | assumed starting state | verified at |
| --- | --- | --- |
| `sshd-enabled` | sshd not enabled | `setup.sh:57-58` |
| `sshd-listening` | nothing on 22 — catches an enabled `sshd.socket` | `setup.sh:63-65` |
| `firewall-ssh` | firewalld running; permanent config permits neither spelling; **the interface is in the default zone** | `setup.sh:70-75` — zone unverified, **GAP, F4** |
| `net-autoconnect` | `/etc/rhcsa-conn` holds the right name, is world-readable, and that connection reports `autoconnect=no` | `setup.sh:79-83`, `:35` |
| `student-intact` (invariant) | student in wheel | `setup.sh:89-90` |

`setup.sh:79-83` re-reads `/etc/rhcsa-conn` and probes the recorded name rather
than the local `$conn` variable, so it verifies the same string the grader will
read. That is the right shape and worth keeping.

## 4. `# baseline-fail:` and `# expect-fail:`

**`# baseline-fail:`** — exactly one header per grader, every listed id emitted,
no invariant listed anywhere:

| grader | goals listed | invariants emitted and correctly absent |
| --- | --- | --- |
| `006/grade.sh` | 7 | `student-intact` |
| `019/grade.sh` | 7 | `selinux-enforcing` |
| `017/grade.sh` | 3 | `sshd-intact` |
| `028/grade.sh` | 4 | `student-intact` |

`systemd/017`'s `default-target` correctly gets **no** `# unprobed-invariant:`
header: it is an invariant, so it is absent from `# baseline-fail:`, but it *is*
probed — `antisolutions/03-broke-the-target.sh:10` declares it, so the fixture
set proves the checkpoint is evaluated. The four headers that do exist are on the
four invariants nothing can probe (`student-intact` twice, `sshd-intact`,
`selinux-enforcing`). Nothing in the engine parses `# unprobed-invariant:` yet;
enforcement stays forwarded, as Task 21 left it.

**`# expect-fail:`** — I traced all thirteen antisolutions against
`expectedStatus` in `src/engine/validate/expectations.ts:90-105` (a bare
declaration means fail in both verdicts; `@post` means pass in A, fail in B) and
found every declaration honest, including both `@post` ones:

- `019/antisolutions/04` declares `httpd-enabled, page-served@post`. It runs
  `systemctl start httpd` without `enable`, so the page is served in verdict A
  and gone in verdict B. Correct.
- `019/antisolutions/05` declares `context-now, page-served` bare. `semanage
  fcontext -a` without `restorecon` leaves the file `var_t`, so httpd returns
  403 in both phases. Correct — and note that `welcome.conf`'s
  `ErrorDocument 403 /.noindex.html` substitutes the stock "Testing 123" page,
  which does not contain the marker, so `page-served` still fails rather than
  accidentally passing.
- `017/antisolutions/01` and `02`, `028/antisolutions/01`: the three
  `@post` persistence cases, all correct.
- `019/antisolutions/01-chcon-only.sh` declares only `context-permanent`, and its
  comment that the fixture *passes* the reboot check is right: `chcon` writes the
  inode label, which survives a reboot. This is the fixture that proves verdict B
  is not the only kind of durability.

**Mandate 3's draft bodies were wrong, and D6's correction is right.** As drafted,
`04` and `05` omitted both the `DocumentRoot` rewrite and the
`<Directory "/srv/web">` block. Apache would then have served `/var/www/html` on
port 82, so `page-served` would have failed in verdict **A** — contradicting
`04`'s own `page-served@post`. Replacing the drafts with verbatim copies of
`solutions/01` differing by one line was the correct call, and the one-line-diff
discipline is now stated in both files' headers.

## 5. Findings

### F1 — HIGH. `carol-expiry` is off by one day on any guest ahead of UTC, and mandate 7 item 5's rationale is wrong

**Where.** `content/tasks/users/006-team-provisioning/grade.sh:26-29`. Writers at
`solutions/01-useradd-usermod-chage.sh:10` (`chage -E 2027-06-30 carol`),
`solutions/02-groupmembers-at-creation.sh:10` (`useradd -e 2027-06-30`),
`solutions/03-primary-group-only.sh:13` (`useradd -e 2027-06-30`),
`antisolutions/01-no-group-no-sudo.sh:11` (`chage -E`). Guest timezone left free
at `docs/vm-build-checklist.md:63`.

**What it is.** The grader reads shadow field 8 (a day count), multiplies it back
to a timestamp, and compares it to `date -u -d 2027-06-30 +%s`:

```
want=$(date -u -d 2027-06-30 +%s)
days=$(sudo getent shadow carol | cut -d: -f8)
got=$([ -n "$days" ] && echo $((days * 86400)) || echo "")
[ -n "$got" ] && [ "$got" = "$want" ]
```

The value in field 8 was produced by shadow-utils' `strtoday()`, which parses a
bare `YYYY-MM-DD` through GNU `get_date()` — **local** time when the string
carries no zone — and then integer-divides by 86400. `chage -E` and `useradd -e`
both go through it. So on a guest ahead of UTC, the writer stores the day index
of 2027-06-**29** while the grader demands the day index of 2027-06-30.

**How I measured it.** The arithmetic, on this host, whose `TZ` offset is UTC+8:
`date -d 2027-06-30 +%s` = 1814284800, `/86400` = **20998**;
`date -u -d 2027-06-30 +%s` = 1814313600, `/86400` = **20999**. So `days` =
20998, `got` = 1814227200, `want` = 1814313600, and the comparison fails. And
`docs/vm-build-checklist.md:63` reads `1. **Language**: English. **Time**: your
zone.` — measured, the checklist does **not** pin the guest to UTC. The
`strtoday`→local-time step is reasoned from shadow-utils' behaviour, not measured
on a guest; no guest exists.

**Direction and blast radius.** False *fail*, not false pass. The check is
correct for offsets at or behind UTC and off by one for every offset ahead of it —
that is all of Europe east of Greenwich, Africa east of Greenwich, Asia and
Australia, including the UTC+8 host this project is being built on. Predicted
Step 9 symptom: `users/006` fails **4 of 6** fixtures —
`solution/01`, `solution/02` and `solution/03` report
`carol-expiry: expected pass, got fail`, and `antisolution/01-no-group-no-sudo`
reports an *undeclared* `carol-expiry` failure. `baseline` and `antisolution/02`
pass, because both already expect `carol-expiry` to fail.

**Fix.** Compare day counts, not timestamps, using the same local interpretation
the writer used:

```bash
want=$(( $(date -d 2027-06-30 +%s) / 86400 ))
days=$(sudo getent shadow carol | cut -d: -f8)
[ -n "$days" ] && [ "$days" = "$want" ]
```

Verified arithmetically for both signs: at UTC+8, `1814284800/86400` = 20998 =
what `strtoday` stores; at UTC−8, `1814342400/86400` = 20999 = what `strtoday`
stores. Note that merely dropping the `-u` is **not** sufficient — `days * 86400`
is always a multiple of 86400 and a non-UTC local midnight never is, so the
comparison would fail everywhere.

**Mandate 7 item 5 is wrong.** It states that field 8 is "days since the epoch in
UTC", that the grader's `-u` is "load-bearing and present", and that "without it
the check would fail for any guest not on UTC". The dependency is backwards. The
`-u` is what *creates* the timezone dependency, because the number it is compared
against was produced by a local-time parse. Item 5 verified the reading side and
never looked at the writing side, and it instructed the implementer not to
re-derive it — so this would have shipped into Step 9 as an unexplained
four-fixture failure with a note attached saying it had been measured clean.

**Must fix before Step 9.** Not a blocker for Task 23.

### F2 — MEDIUM. `stamp-effect` means two different things in the two verdicts, and the prompt never asks for what it measures in verdict A

**Where.** `content/tasks/systemd/017-boot-time-service/grade.sh:21-22`; prompt at
`task.yaml:19-28`.

**What it is.** `stamp-effect` is `[ -f /run/rhcsa-stamp ]` and is a *goal*, so it
must pass in both verdicts. In verdict B that means "it ran at boot", which is the
task. In verdict A, with `/run` being tmpfs and setup having removed the file, it
means "you also started it by hand" — which the prompt never asks for. The prompt
says: create the unit, "The service must start automatically. Nobody is going to
run it by hand." A student who writes the unit and runs
`systemctl enable rhcsa-stamp.service` has done exactly that and fails verdict A.

`validate` will not catch this, because both shipped solutions start it —
`solutions/01:16` uses `enable --now`, `solutions/02:23-24` uses `enable` then
`start`.

`028/grade.sh:5-9` declines to add a checkpoint for precisely this reason: *"a
checkpoint whose meaning changes between the two verdicts is a checkpoint nobody
can interpret."* `017` ships the checkpoint `028` refused to write.

**How I measured it.** Reading the prompt, the grader and the fixture set. Not
measured on a guest.

**Fix.** No new checkpoint, so mandate 6 holds: add a prompt bullet — "Make sure
it has already run, not just that it will run at the next boot." One line in
`task.yaml`. Forwardable, but it is cheap and it is a content-correctness issue
that reaches students.

### F3 — MEDIUM. `solutions/03-primary-group-only.sh` contradicts `users/006`'s own prompt for alice and bob

**Where.** `content/tasks/users/006-team-provisioning/task.yaml:25-26` versus
`solutions/03-primary-group-only.sh:11-12`.

**What it is.** The prompt says "Create users alice and bob. Both must be members
of devops **in addition to their own primary groups**." `solutions/03` does
`useradd -g devops alice` and `useradd -g devops bob`, so neither has their own
primary group. The fixture is a correct answer to a task the prompt did not set.
(For carol the prompt bullet says only "a member of devops", so `-g devops` is
fine there.)

**Review-context item 6, answered.** The grader *does* count primary membership,
so the fixture is not mis-filed relative to the grader and `validate` will pass
it. `grade.sh:14` is
`id -nG "$1" 2>/dev/null | tr ' ' '\n' | grep -qx devops`, and `id -nG` lists the
primary group; `grade.sh:38`'s `sudo -l -U alice` resolves `%devops` through
alice's full group list, which includes her primary GID. The mis-filing is
relative to the *prompt*, not the grader.

**How I measured it.** Reading. The `sudo -l` half is reasoned from how sudo
resolves group membership; not measured (no `sudo` on this host).

**Fix.** Delete "in addition to their own primary groups" from the prompt — no
checkpoint measures it, and the clause is what makes `solutions/03` illegal. The
alternative, restricting `-g devops` to carol, destroys the fixture's whole
purpose, which is to prove the membership checkpoints test the end state rather
than the mechanism. Forwardable; recommend the prompt edit.

### F4 — MEDIUM. Every firewall checkpoint in the batch silently means "the default zone", and no setup verifies the interface is in it

**Where.** `selinux/019/grade.sh:35,38` and `selinux/019/setup.sh:111,113`;
`troubleshooting/028/grade.sh:27` and `028/setup.sh:72`.

**What it is.** `firewall-cmd` with no `--zone` operates on the default zone. If
the guest's NIC is bound to a non-default zone, a student who runs the canonical
`firewall-cmd --permanent --add-service=ssh` writes the default zone, the
checkpoint goes green, and the traffic is still dropped by the zone that actually
handles the interface. `019`'s prompt (`task.yaml:31`) promises "Port 82/tcp must
be reachable from other machines, permanently", and nothing in the batch measures
reachability from anywhere but `localhost` (`019/grade.sh:17`).

This is the only finding in this review that can make a student's failure look
like a pass, and it is the same shape as mandate 9's motivating example: nobody
checked a property of the guest that a goal checkpoint depends on.
`docs/vm-build-checklist.md` pins no firewalld zone — checked, the word does not
appear.

**How I measured it.** Reading the graders, the setups and the checklist.
Reasoned, not measured; a fresh RHEL 9 install puts the NIC in the default zone,
so the exposure is a mis-built guest rather than a likely one.

**Fix.** One precondition per task: assert that the zone of the active interface
equals `firewall-cmd --get-default-zone`, and fail with the batch's existing
"this guest was not built to `docs/vm-build-checklist.md`" wording. Forwardable.

### F5 — MEDIUM. `028/solutions/02-by-port-and-keyfile.sh` can exit 0 without doing anything

**Where.** `content/tasks/troubleshooting/028-restore-remote-access/solutions/02-by-port-and-keyfile.sh:20-23`.

**What it is.**
`sudo sed -i "/^\[connection\]/a autoconnect=true" "$file"` inserts nothing at
all if `$file` is an ifcfg-format profile, which has no `[connection]` section —
its spelling is `ONBOOT=yes`. `sed` exits 0, `set -euo pipefail` sees nothing
wrong, `nmcli connection reload` succeeds, and `net-autoconnect` fails. The
preceding `sed -i '/^autoconnect=/d'` is a no-op on ifcfg too, so the profile is
left exactly as `setup.sh:45` broke it. This is the project's named defect class —
a tool reporting success without doing what was asked — inside a solution
fixture, and it would present as "the grader over-fits" when it is the fixture.

Line 20 has a smaller variant: `awk -F:` over
`nmcli -g NAME,FILENAME connection show` mis-splits any connection name
containing a colon (nmcli escapes it as `\:`, so `$1==c` will not match either).
`$file` then comes out empty and `sed -i ... ""` fails loudly, which is at least
not silent.

**How I measured it.** Reading. Reasoned, not measured. RHEL 9's installer writes
keyfiles by default, so on a guest built to the checklist this should not fire.

**Fix.** Assert the end state at the end of the script:
`[ "$(nmcli -g connection.autoconnect connection show "$conn")" = "yes" ]`. Under
`set -e` that converts a silent no-op into an immediate, attributable failure.

### F6 — LOW. The D8 idempotency class recurs twice, unfixed, and two file headers claim otherwise

**Where.** (a) `users/006/setup.sh:23` and `solutions/02-groupmembers-at-creation.sh:15-18`.
(b) `028/setup.sh:40` and `solutions/02-by-port-and-keyfile.sh:12`.

**What it is.** (a) Setup removes only `/etc/sudoers.d/devops`, but `solutions/02`
appends `%devops ALL=(ALL) ALL` into `/etc/sudoers` via
`install -m 0440 /tmp/sudoers.new /etc/sudoers`. A second setup run then trips its
own precondition at `setup.sh:63-65` —
`sudo grep -rqs '^[[:space:]]*%devops' /etc/sudoers /etc/sudoers.d` → *"a %devops
sudoers rule is already present"* → `exit 1`. The file header at `setup.sh:2-3`
says "Remove any prior attempt so the task is repeatable."

(b) Setup does `--permanent --remove-service=ssh` but never
`--permanent --remove-port=22/tcp`, while `solutions/02` adds the port. A second
setup run trips `setup.sh:73-75`. The header at `setup.sh:3-4` says "Idempotent:
every step is already the desired end state on a second run."

Precisely: both setups are idempotent with respect to *themselves* and not with
respect to a prior *solution* — which is the case D8 fixed at
`019/setup.sh:27`, in this same commit.

**How I measured it.** Reading. Both failures are loud (`exit 1` with a message),
never silent.

**Why it is low.** It cannot happen inside `validate`: `runFixture` in
`src/engine/validate/harness.ts` calls `deps.reset()` — a snapshot revert, wired
at `src/cli/index.ts:201` — before every fixture, and runs setup once per fixture.
No student-facing lab command exists yet; `src/cli/index.ts:17-26` offers only
`coverage` and `validate`.

**Fix.** `sudo sed -i '/^[[:space:]]*%devops/d' /etc/sudoers` before the `visudo`
precondition, and `sudo firewall-cmd --permanent --remove-port=22/tcp &>/dev/null`
beside `028/setup.sh:40`. Forwardable — but whoever picks up the forwarded item
should fix the two headers in the same pass.

### F7 — LOW. `carol-expiry`'s precondition is asymmetric with `alice-maxdays`'s

**Where.** `users/006/setup.sh:46-57`; report section 2's `carol-expiry` row.

**What it is.** `alice-maxdays` gets an explicit guard against `/etc/login.defs`
already setting `PASS_MAX_DAYS 30`, because that would satisfy the checkpoint from
a bare `useradd`. `carol-expiry`'s exact analogue — `EXPIRE=` in
`/etc/default/useradd` — is unchecked, and the report's table claims the row is
"covered by carol's absence". It is not: with `EXPIRE=2027-06-30`, `useradd carol`
alone satisfies the checkpoint.

**How I measured it.** Reading. `EXPIRE=` holding exactly that date is wildly
implausible, hence low; the finding is that mandate 9's rule is applied unevenly
inside one file.

**Fix.** `awk -F= '$1=="EXPIRE"{print $2}' /etc/default/useradd` guard next to the
`PASS_MAX_DAYS` one. Forwardable.

### F8 — LOW. `sudo-devops` grades the spelling of the runas spec

**Where.** `users/006/grade.sh:38`.

**What it is.** The regex is
`\(ALL(:ALL)?\)[[:space:]]+(NOPASSWD:[[:space:]]*)?ALL`. `%devops ALL=ALL` is
valid sudoers, grants every command as root, and satisfies the prompt's "run any
command with sudo" — but `sudo -l -U alice` renders a rule with no explicit runas
spec using the default, `(root) ALL`, which the regex rejects. Using `sudo -l`
rather than grepping files was the right choice; the pattern it is matched
against is one notch too narrow.

**How I measured it.** Reasoned from sudo's short-listing format. Not measured —
`sudo` cannot authenticate on this host.

**Fix.** Widen to `\((ALL|root)(:(ALL|root))?\)`. Forwardable; `(ALL) ALL` is the
form every text teaches and the form `content/concepts/users/sudoers-and-wheel.md`
teaches, so a real student failing this is unlikely.

### F9 — LOW. Two spellings of "is it enabled", and the loose one accepts states that are not "enabled"

**Where.** `selinux/019/grade.sh:11` and `028/grade.sh:13` use the exit status of
`systemctl is-enabled` alone, which is 0 for `static`, `indirect`, `generated`,
`alias` and `enabled-runtime`. `systemd/017/grade.sh:14-15` uses the strict
`printf '%s' "$state" | grep -qx enabled`, and both setups compare the string
(`019/setup.sh:75-76`, `017/setup.sh:61-62`).

**What it is.** Three checkpoints for the same concept, two of them written two
ways. Not exploitable here: neither `httpd.service` nor `sshd.service` is static
or aliased, and `systemctl enable --runtime` is caught in verdict B —
`page-served@post` for `019`, `sshd-listening` for `028`. Reasoned, not measured.

**Fix.** Use `017`'s strict form in all three. Forwardable.

### F10 — LOW. `pipefail` plus `grep -q` can report a failure for state that is correct

**Where.** `users/006/grade.sh:14`, `019/grade.sh:18,21,25,32`, `028/grade.sh:18`,
and the mirrored preconditions at `019/setup.sh:80,86` and `028/setup.sh:63`.

**What it is.** Under `set -uo pipefail`, `producer | grep -q PATTERN` returns the
*producer's* status if the producer dies of `SIGPIPE` (141) after `grep -q` exits
early on its first match. `ck` then receives 141 and reports a fail for a probe
that matched.

**How I measured it.** Reading; reasoned. Every producer here emits at most a few
hundred bytes, which fits the 64 KiB pipe buffer, so it finishes writing and exits
0 before `grep` can close the pipe. Genuinely low.

**Fix.** Use the here-string form `028/grade.sh:28` already uses —
`grep -qE ... <<<"$var"` — or move the test into `awk`'s `END { exit !found }`.
Forwardable.

### F11 — NOTE, engine, forwarded. Verdict B is graded against a partially booted guest

**Where.** `src/engine/vm/vmrun.ts:252-261` and `:286-292`. Not Task 22's code and
not Task 22's defect.

**What it is.** `guestUp()` is "VMware Tools can run `echo up`". `reboot()` sends
`systemctl reboot`, waits 2 s, then polls that. Nothing waits for
`multi-user.target`. So verdict B can be taken while services are still starting,
and three Task 22 checkpoints are exposed: `019 page-served` (httpd must have
bound 82), `028 sshd-listening` (sshd must have bound 22) and, more weakly,
`017 stamp-effect`. Task 22 is the first content with three reboot-checking tasks,
so it is the first to be exposed at scale.

**How I measured it.** Reading the engine. Not observable without a guest.

**Fix.** Poll `systemctl is-system-running` until it reports `running` or
`degraded` before grading verdict B. Forward to the engine backlog. Until then it
belongs at the top of the verdict-B half of the failure table, below.

### F12 — NIT. `users/006/antisolutions/01`'s comment misstates why `sudo-devops` fails

`antisolutions/01-no-group-no-sudo.sh:2-4` says the `sudo-devops` failure is "a
consequence of the missing membership, not on its own — which is worth seeing,
because it shows the checkpoints are not independent of each other." The script
also never creates any `%devops` rule, so `sudo-devops` fails for two independent
reasons and the fixture does not demonstrate the coupling the comment claims.
These files are teaching material. Measured by reading. Fix: add the sudoers rule
so the failure really is a consequence of the missing membership, or reword.
Forwardable.

### F13 — NIT. One row of the report's precondition table describes something the code does better

Report section 2's `firewall-ssh` row describes
`firewall-cmd --permanent --list-services` and `--permanent --list-ports`. The
code (`028/setup.sh:72-75`) uses `--permanent --list-all` and greps both
spellings — which is *better*, because it is byte-for-byte the grader's probe at
`028/grade.sh:27-28`. Measured by reading. No code change needed; the report is
what is inaccurate.

### F14 — NIT. Two of mandate 8's own numbers

Mandate 8 says "(23 scripts after mandates 3 and 5)". The count is **30** —
4 `setup.sh` + 4 `grade.sh` + 9 solutions + 13 antisolutions across the four
tasks; 37 fixture scripts in the tree once `storage/014`'s are included, all mode
755, plus `content/lib/assert.sh` at 644. The implementer's report says 30 and is
right. Mandate 8's "203 tests / 20 files" baseline also predates Task 21: the tree
is at **246 tests / 23 files**, and the diff contains no test files, so that was
already the count at `aae2dca`. Neither is a Task 22 defect; recording them so the
next reviewer does not treat the mandate's numbers as a baseline.

## 6. Failure table for Steps 9 and 10

Ordered by likelihood, per mandate 9: a mis-built guest before grader
over-fitting.

| symptom | look here first | then | why this order |
| --- | --- | --- | --- |
| `users/006`: 3 solutions plus `antisolution/01` all report `carol-expiry` | **guest timezone is ahead of UTC** — F1. `date +%z` on the guest | the writer/reader mismatch in `grade.sh:26-29` | measured mechanism, and the checklist leaves the zone free |
| `019` or `028`: firewall checkpoints green but nothing reachable from another host | **guest built with a non-default firewalld zone** — F4. `firewall-cmd --get-zone-of-interface=<dev>` vs `--get-default-zone` | the graders' implicit default zone | mandate 9's own defect class |
| `017`: `stamp-effect` fails at baseline, or cannot distinguish enabled from started | **`/run` is not tmpfs** — `setup.sh:68-70` already fails loudly for this | the unit | the setup already tells you |
| `019`: `dnf -y install httpd` fails in every fixture | **no dnf repository configured** — `setup.sh:70-72` fails loudly | — | offline ISO repo is a build-checklist step |
| `019`: `context-permanent` or `selinux-enforcing` errors with "command not found" | **`libselinux-utils` not installed** — `setup.sh:52-53` fails loudly; `85bf671` fixes the provisioner | — | this is what `85bf671` was for |
| `019` `page-served` or `028` `sshd-listening` fails **in verdict B only, intermittently** | **the reboot race** — F11, `vmrun.ts:252-261`; verdict B can run before `multi-user.target` | the fixture | an intermittent verdict-B-only failure is almost never content |
| `028`: `net-autoconnect` fails for `solution/02` but passes for `solution/01` | **the profile is ifcfg-format, not keyfile** — F5, the `sed` no-ops | — | the fixture, not the grader |
| `017`: `unit-verifies` fails for `solution/02` only | `systemd-analyze verify` returning non-zero on an unrelated warning about `DefaultDependencies=no` / `Requires=local-fs.target` (`solutions/02:11-13`) | the unit | reasoned, not measured; `019`-style string comparison would be more robust |
| a single checkpoint fails for exactly one solution and passes for the other | grader over-fitting — F8, F9 | — | ranked last on purpose |

## 7. Scope notes

- `# unprobed-invariant:` is a Task 21 convention that nothing in the engine
  parses. The four headers Task 22 adds are correct and correctly placed;
  enforcement stays **forwarded**.
- `checkCoverage` validates task objective ids but not concept-card ones, so a
  card typo is silent. That gap stays **forwarded**. I checked all ten cards by
  hand against `objectives.yaml`: **no typo is present**.
- `npm run validate` cannot run — no VM, no ISO. Not a finding. Steps 9 and 10 are
  deferred by mandate 8 and their absence is deliberate; report section 9's long
  unverified list is correct for this task.
- `shellcheck` is not installed on this host; not run, nothing reported.
- No `vmrun`, no VM operation, no `ssh-keygen`, no write to `~/.ssh`, no read or
  write of `.env.local`, no `scripts/provision.sh`. `git status --porcelain`
  stayed empty throughout; the repo was not mutated.
