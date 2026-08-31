# Task 22 — required changes to the brief

Eight mandates. **These override `task-22-brief.md` wherever they conflict.**
Everything the brief specifies and a mandate does not mention stays exactly as
written — in particular every `grade.sh` body, every solution, and all eight card
bodies below their frontmatter.

Order matters for one thing only: Task 22 writes into `content/concepts/`, which
**does not exist until Task 21 lands**. Task 21 also owns `content/lib/assert.sh`
(with Task 20). Do not create `content/lib/` or edit `assert.sh`.

---

## 1. Eleven of the thirteen objective ids in this brief do not exist

This is the largest defect in the brief and the one with the longest tail.
`content/objectives.yaml`'s own header states the rule:

> THE IDS IN THIS FILE ARE PERMANENT … renaming one orphans a user's entire
> review history. Add new ids; never rename or reuse an existing one for a
> different objective.

The ids are FSRS scheduling keys. A `task.yaml` referencing an id that does not
exist is not a typo that degrades gracefully — it either fails
`content/objectives.ts`'s cross-check or silently schedules against nothing.
I verified each of the 13 individually by name against `content/objectives.yaml`
(68 ids) — not by a set operation; two earlier attempts at a `comm`-style diff in
this project produced wrong answers, so per-id lookup is the method.

**Substitute exactly these. Do not invent, do not add ids beyond the lists
below, and do not "improve" the mapping.**

### `content/tasks/users/006-team-provisioning/task.yaml` (brief lines 35-39)

| brief says | use | why |
|---|---|---|
| `users.accounts.manage` | `users.accounts.manage` | already correct |
| `users.groups.manage` | `users.groups.manage` | already correct |
| `users.password.aging` | **`users.passwords.aging`** | plural — "Change passwords and adjust password aging for local user accounts" |
| `users.sudo.configure` | **`users.sudo.superuser`** | "Configure superuser access" |

### `content/tasks/selinux/019-httpd-alt-port/task.yaml` (brief lines 265-269)

| brief says | use | why |
|---|---|---|
| `selinux.context.manage` | **`selinux.contexts.restore`** | "Restore default file contexts" |
| `selinux.port.manage` | **`selinux.ports.labels`** | "Manage SELinux port labels" |
| `net.firewall.configure` | **`net.firewall.settings`** | "Configure firewall settings using firewall-cmd/firewalld" |
| `pkg.install` | **`pkg.dnf.install`** | "Install and update software packages…" |

`selinux.contexts.identify` ("List and identify SELinux file and process
context") also exists and is arguably exercised. **Do not add it.** The grader
checks the end state of a label, never the act of listing one. Recorded as the
alternative if a later pass disagrees.

### `content/tasks/systemd/017-boot-time-service/task.yaml` (brief lines 529-532)

| brief says | use | why |
|---|---|---|
| `systemd.units.manage` | **`systemd.services.enable`** | "Start and stop services and configure services to start automatically at boot" |
| `systemd.units.create` | **remove — no equivalent exists** | see below |
| `boot.target.set` | **`boot.targets.default`** | "Configure systems to boot into a specific target automatically" |

**This task's list becomes two ids, not three.** "Create a systemd unit file" is
not a published RHCSA 9 objective. Writing the unit is the *means* by which this
task reaches "configure a service to start automatically at boot", so it
collapses into `systemd.services.enable`. Inventing a `systemd.units.create` id
to preserve the count would put a permanent scheduling key in the taxonomy for
something the exam does not test.

### `content/tasks/troubleshooting/028-restore-remote-access/task.yaml` (brief lines 744-748)

| brief says | use | why |
|---|---|---|
| `net.ssh.configure` | **`net.services.status`** | "Start, stop, and check the status of network services" |
| `net.firewall.configure` | **`net.firewall.settings`** | as above |
| `net.nm.configure` | **`net.services.autostart`** | "Configure network services to start automatically at boot" |
| `systemd.units.manage` | **`systemd.services.enable`** | as above |

Two of these need a recorded reason, because the obvious-looking choice is wrong:

- **`net.ssh.key-auth` is the wrong target for `net.ssh.configure`.** It exists,
  and it is tempting because the task is about SSH. But this task's grader checks
  `sshd-enabled`, `sshd-listening`, `firewall-ssh` and `net-autoconnect` — it
  never touches a key, an `authorized_keys` file, or `PubkeyAuthentication`.
  Claiming key-based authentication would credit the user with an objective they
  did not practise, then schedule it for review as though they had. Over-claiming
  an objective is its own defect (parked finding F9 from Task 14).
- **`net.addressing.ipv4-ipv6` is the wrong target for `net.nm.configure`.** The
  fixture sets `connection.autoconnect no`; no address is configured anywhere in
  this task. `net.services.autostart` is the textual match — the machine's
  network must come up on its own at boot.

`net.services.autostart` and `systemd.services.enable` overlap on the
`sshd-enabled` checkpoint. That is fine and intended: both are separately
published objectives, both are genuinely exercised, and crediting both is
accurate.

### All eight concept cards

Same substitutions, in the frontmatter `objectives:` inline list. The card `id:`
values are all correctly shaped and every `requires_concepts:` entry matches one
of them — **verified, change none of them.**

| card (brief line) | `objectives:` becomes |
|---|---|
| `users.shadow-aging-fields` (947) | `[users.passwords.aging, users.accounts.manage]` |
| `users.sudoers-and-wheel` (1000) | `[users.sudo.superuser]` |
| `selinux.labels-now-vs-policy` (1047) | `[selinux.contexts.restore]` |
| `selinux.ports-are-labeled-too` (1096) | `[selinux.ports.labels]` |
| `net.firewalld-runtime-vs-permanent` (1146) | `[net.firewall.settings]` |
| `systemd.enabled-vs-started` (1201) | `[systemd.services.enable]` |
| `systemd.unit-file-anatomy` (1246) | **`[systemd.services.enable]`** |
| `net.nm-connections-are-the-config` (1306) | `[net.services.autostart]` |

`systemd.unit-file-anatomy` is the card whose only objective was the id that does
not exist. `src/engine/content/concept.ts:72` requires at least one objective, so
it cannot be left empty; `systemd.services.enable` is the only defensible real
id, for the same reason the task drops to two.

**Verify before committing** with the `coverage` command at Step 7 of the brief.
It loads the bank and cross-checks every referenced objective id, which is the
only check that covers both the `task.yaml` files and the cards in one pass.
**If it reports an unknown objective id, the mapping above was applied wrong —
fix the reference, never `content/objectives.yaml`.**

Do not hand-roll a grep-based set comparison to double-check it. Two attempts at
one during this pre-flight produced wrong answers — the first returned an empty
"committed ids" side, making the whole diff void, and the second contaminated the
referenced set with concept-card slugs because a `sed` range spanned from
`objectives:` into `requires_concepts:`. Per-id lookup by name is the method that
worked, and `coverage` does it properly.

---

## 2. `setup.sh` cannot report failure, and three of the four stage load-bearing state

All four `setup.sh` files use `set -uo pipefail` — no `-e`. Exit status is
therefore whatever the *last* command returned, and every earlier failure is
swallowed. `src/engine/validate/harness.ts` checks `setupResult.code !== 0` and
refuses to grade a fixture whose setup failed, with the comment "A setup script
that fails leaves the fixture measuring the wrong machine, so every downstream
failure would be a red herring." **For these four tasks that check can never
fire.**

**Do not fix this by adding `set -e`.** These scripts are full of commands that
legitimately fail on a first run — `semanage port -d … 82`, `semanage fcontext
-d`, `dnf -y remove httpd`, `systemctl disable --now httpd`, `firewall-cmd
--permanent --remove-port=82/tcp`, `firewall-cmd --permanent
--remove-service=ssh` — every one of which returns non-zero when the thing it
removes is not there. `set -e` would abort setup partway on a clean machine,
which is worse than the current state. (This is why these diverge from Task 21's
`storage/014/setup.sh`, which does use `set -euo pipefail` and has no such
commands. Note that divergence in a comment so the next author does not
"harmonise" it.)

Fix it by making required-vs-optional legible. Add this to each of the four,
directly below `set -uo pipefail`:

```bash
# No `set -e`: the cleanup commands above/below legitimately fail on a first run
# (removing a port label, an fcontext rule or a package that is not there).
# So the commands that MUST work are wrapped instead - a silent failure here
# stages the wrong machine and every checkpoint result afterwards is a lie.
need() { "$@" || { printf 'setup.sh: FAILED: %s\n' "$*" >&2; exit 1; }; }
```

Then wrap exactly these — the commands that stage state a checkpoint depends on.
Leave every cleanup/removal command unwrapped.

- **users/006:** `need sudo usermod -aG wheel student`
  (the `student-intact` invariant is only meaningful if this succeeded)
- **selinux/019:** `need sudo mkdir -p /srv/web`; the
  `printf … | sudo tee /srv/web/index.html` pipeline; `need sudo chmod 0755
  /srv/web`; `need sudo chmod 0644 /srv/web/index.html`; `need sudo restorecon -R
  /srv/web`. For the pipeline, `need` cannot wrap a pipe — use
  `printf 'RHCSA-MARKER-8842\n' | sudo tee /srv/web/index.html >/dev/null ||
  { printf 'setup.sh: FAILED: staging index.html\n' >&2; exit 1; }`.
- **systemd/017:** the `sudo tee /usr/local/bin/rhcsa-stamp` heredoc (same
  pipeline treatment); `need sudo chmod 0755 /usr/local/bin/rhcsa-stamp`;
  `need sudo restorecon /usr/local/bin/rhcsa-stamp`; **`need sudo systemctl
  set-default multi-user.target`** and **`need sudo systemctl enable sshd`** —
  these two stage the `default-target` and `sshd-intact` invariants, so a silent
  failure reports the student broke something setup never set up. Drop the
  `&>/dev/null` on these two; if they fail the reason should be visible.
- **troubleshooting/028:** `need sudo systemctl disable --now sshd`;
  the `printf … | sudo tee /etc/rhcsa-conn` pipeline;
  **`need sudo nmcli connection modify "$conn" connection.autoconnect no`** with
  the `&>/dev/null` removed.

And close the hole above it. `conn` is derived from two `nmcli` calls, either of
which can yield nothing:

```bash
conn=$(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)
if [ -z "$conn" ]; then
  conn=$(nmcli -t -f NAME connection show 2>/dev/null | head -1)
fi
if [ -z "$conn" ]; then
  printf 'setup.sh: FAILED: no NetworkManager connection found; cannot stage the break\n' >&2
  exit 1
fi
```

Without that guard an empty `conn` writes a blank `/etc/rhcsa-conn`, `nmcli
connection modify "" …` fails into `&>/dev/null`, the machine is **not broken**,
and `grade.sh:884`'s `awk` lookup returns nothing. The baseline fixture then
reports `net-autoconnect passed at baseline, expected fail` and the author spends
the evening reading the grader. **The failure is real but it is reported as the
wrong thing** — the same defect class as Task 21 mandate 2.

Severity note for the reviewer: the harness's `kind: 'none'` baseline fixture
(`harness.ts:208-228`) *does* assert that exactly the `# baseline-fail:` ids fail,
so a setup that failed to break the machine is caught rather than passed. This is
a diagnostic-quality defect, not a false-pass. It is still worth the fix: nobody
can run `validate` until the VM exists, and when they finally do, a misdirected
error costs a whole debugging session.

---

## 3. Two of `selinux/019`'s seven goal checkpoints have no anti-solution

Measured union of `# expect-fail:` declarations against the ids each grader
emits:

| task | goal ids | covered by an anti-solution | gap |
|---|---|---|---|
| users/006 | 7 | 7 | — |
| selinux/019 | 7 | 5 | **`httpd-enabled`, `context-now`** |
| systemd/017 | 3 | 3 | — |
| troubleshooting/028 | 4 | 4 | — |

A goal checkpoint no anti-solution fails is only ever exercised by fixtures that
require it to pass. Replace its logic with an unconditional `ck_pass` and every
fixture still validates green — this is Task 11's F1 false-pass shape, and for a
*goal* checkpoint (unlike an invariant) it is cheap to close. Add two
anti-solutions to `selinux/019`. Both model errors the task's own concept cards
are about, so they earn their place pedagogically as well as structurally.

`antisolutions/04-started-not-enabled.sh`:

```bash
#!/usr/bin/env bash
# Did everything, then used `systemctl start` where the task said the service
# must come back on its own. Passes completely until the reboot, which is the
# entire point of the verdict-B check - and of the enabled-vs-started card.
# expect-fail: httpd-enabled, page-served@post
set -euo pipefail
sudo dnf -y install httpd
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo semanage port -a -t http_port_t -p tcp 82
sudo sed -i 's/^Listen 80$/Listen 82/' /etc/httpd/conf/httpd.conf
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl start httpd
```

`antisolutions/05-fcontext-without-restorecon.sh`:

```bash
#!/usr/bin/env bash
# Told the policy what the label should be and never applied it. The exact
# inverse of 01-chcon-only.sh: there the label was right and the policy wrong,
# here the policy is right and the label wrong. Both fail, for opposite reasons,
# and neither recovers on its own - `semanage fcontext -a` does not relabel
# anything that already exists.
# expect-fail: context-now, page-served
set -euo pipefail
sudo dnf -y install httpd
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo semanage port -a -t http_port_t -p tcp 82
sudo sed -i 's/^Listen 80$/Listen 82/' /etc/httpd/conf/httpd.conf
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable --now httpd
```

Match the two existing solutions' actual commands where these overlap — read
`solutions/01-semanage-fcontext-type.sh` and copy its `dnf`, `sed` and
`firewall-cmd` lines verbatim rather than trusting mine. If the brief's solutions
configure the port some other way (a drop-in rather than `sed`, as
`solutions/02-drop-in-and-equivalence.sh` suggests), use whichever form
`solutions/01` uses, so the only difference between fixture and solution is the
single mistake being modelled.

**`page-served@post` in `04` and bare `page-served` in `05` are both
deliberate.** `04` serves the page fine until the reboot wipes the un-enabled
service; `05` never serves it at all, before or after. Getting these backwards
would make the fixtures assert the opposite of what they demonstrate.

**This changes the fixture arithmetic.** `selinux/019` goes from 6 fixtures to 8
(2 solutions + 5 anti-solutions + 1 baseline). The brief is a read-only extract of
the plan — **do not edit it.** These are simply the numbers that supersede it, and
they matter because they are what the deferred acceptance steps will be checked
against:

| brief says | actually expect |
|---|---|
| `selinux/019` has 2 antisolutions, 6 fixtures | **5 antisolutions, 8 fixtures** |
| "Eighteen fixtures" over ssh (line 1395) | **twenty** |
| `18/18 fixtures ok` (line 1406) | **`20/20 fixtures ok`** |
| "all 24 fixtures" (line 1418) | **26** |
| 35-45 minute budget for the ssh run (line 1395) | **45-55 minutes** |

The `6/6` at line 1427 does not change — that is `troubleshooting/028` on its own
transport. Put this corrected table in your report so the deferred Step 9/10
acceptance is measured against the right numbers.

I checked the rest of the arithmetic and it was right before this change:
6+6+6+6 = 24 total, 18 over ssh, 6 over vmrun, and `users/006` really does
contribute 6 despite having only 2 anti-solutions, because
`solutions/03-primary-group-only.sh` is a solution. Do not "fix" anything else.

---

## 4. Every unprobed invariant needs the `# unprobed-invariant:` header

Four invariant checkpoints have no anti-solution and, unlike the two in mandate
3, cannot safely get one. Task 21 established the header for exactly this case
(`storage/014`'s `var-intact`); Task 22 must carry it too, so that when the
coverage-union check lands there is nothing to retrofit. Nothing parses this
header yet — it is a deadline, not decoration. State in your report that
enforcement is forwarded.

Put the block immediately above the checkpoint it describes, matching Task 21's
style: prose `#` lines giving the reason and naming the risk being accepted, then
the machine-readable line last.

**`users/006/grade.sh`**, above `ck student-intact`:

```bash
# Knowingly unprobed: an anti-solution that damages the student account destroys
# the account both transports log in as, so the harness would lose the guest
# mid-fixture and could not tell "correctly broken" from "unreachable".
# Replacing this check with an unconditional ck_pass would validate green across
# all six fixtures; that is the risk being accepted here, not overlooked.
# unprobed-invariant: student-intact
```

**`selinux/019/grade.sh`**, above `ck selinux-enforcing`:

```bash
# Knowingly unprobed: the only way to fail this is to put SELinux in permissive
# or disabled mode, which the project forbids outright, and returning from
# disabled requires a full relabel and a reboot the harness does not control.
# unprobed-invariant: selinux-enforcing
```

**`systemd/017/grade.sh`**, above `ck sshd-intact`:

```bash
# Knowingly unprobed: breaking sshd is breaking the ssh control plane this task
# is graded over (transport: ssh), so the fixture would take the grader down
# with it. troubleshooting/028 probes exactly this failure, deliberately, over
# vmrun - which is why that task exists.
# unprobed-invariant: sshd-intact
```

**`troubleshooting/028/grade.sh`**, above `ck student-intact`: same reason as
`users/006` — `vmrun` authenticates to the guest as `student` too.

**`systemd/017`'s `default-target` gets no header.** It is an invariant that *is*
probed, by `antisolutions/03-broke-the-target.sh`. That is the pattern the other
four would follow if they could; say so in one line of the report, because it is
the thing a reviewer will otherwise flag as an inconsistency.

---

## 5. Renumber `users/006`'s anti-solutions to `01` and `02`

The brief defines `antisolutions/02-no-group-no-sudo.sh` and
`antisolutions/03-aging-skipped.sh` — with no `01`. The gap is an editing
artifact of promoting the original `01` to `solutions/03-primary-group-only.sh`,
and the brief's Files note explains the count but not the numbering. Anyone who
runs `ls antisolutions/` will wonder which file went missing.

Create them as `antisolutions/01-no-group-no-sudo.sh` and
`antisolutions/02-aging-skipped.sh`. Contents unchanged, including both
`# expect-fail:` headers exactly as written. Nothing else in the brief references
these filenames.

---

## 6. Do not add objectives, and do not add checkpoints

Two prohibitions, because both failures are invisible in review if nobody names
them up front:

- **The objective lists in mandate 1 are exhaustive.** Not floors. A `task.yaml`
  claiming an objective its grader does not measure schedules FSRS reviews for
  practice the user never did — the same defect as F9, where a worked example
  paired `tools.shell.essentials` with an objective from a different chapter.
  Same for the cards.
- **Do not add, rename, remove or merge any checkpoint id** beyond the two new
  anti-solutions in mandate 3, which add no ids. Every `ck` id must stay a
  literal — no variables, no interpolation, no loops — because Task 23's
  `countCheckpoints` derives the masked total by static inspection and a wrong
  total is worse than none. The brief already says this at lines 140-149; it is
  repeated here because mandate 3 has you writing new fixtures, which is exactly
  when a new id gets invented.

---

## 7. Measured clean negatives — do not re-derive these

Recorded so no implementer or reviewer spends a turn on them. Each was checked
against the brief's actual text this pre-flight.

1. **Task 21 mandate 1's empty-target false-pass class does not apply here.**
   That defect was `[[ $n -ge "$TARGET" ]]` passing when `TARGET` is empty —
   measured: `[[ 5 -ge "" ]]` returns rc=0, quoted or not. **None of these four
   graders contains a single numeric comparison** (`-ge -gt -le -lt -eq -ne`):
   grep across the whole brief returns nothing. Every comparison is a string
   compare against a non-empty literal, which fails correctly on an empty left
   side. No fix needed.
2. **All four `grade.sh` correctly omit `set -e`** (`set -uo pipefail`). This is
   required by the `ck <id> "<desc>" $?` idiom — with `-e` the first failing
   probe would abort the grader and the remaining checkpoints would silently
   vanish from the JSONL, which is the measured path by which `allPassed` can
   return true for a run that never finished. Do not "harmonise" this with the
   solutions, which correctly *do* use `set -euo pipefail`.
3. **`users/006`'s membership check is end-state based and `solutions/03` will
   pass it.** `in_devops()` uses `id -nG`, which lists primary and secondary
   groups alike, so making `devops` a primary group satisfies it. A grader
   reading `/etc/group`'s member list would have failed that fixture, since
   primary membership is not recorded there. That is the trap `solutions/03`
   exists to catch, and the grader as written does not fall into it.
4. **`antisolutions/03-aging-skipped.sh`'s `group-gid` declaration is accurate.**
   It looked like an over-declaration for a fixture named "aging skipped", but it
   calls `sudo groupadd devops` with no `-g 5000`, so `group-gid` genuinely
   fails, and its comment says so.
5. ~~**`users/006`'s expiry comparison is timezone-correct.** Field 8 of
   `/etc/shadow` is days since the epoch in UTC and the grader compares against
   `date -u -d 2027-06-30 +%s`. The `-u` is load-bearing and present; without it
   the check would fail for any guest not on UTC. Leave it.~~

   **RETRACTED — this item was wrong, and it was the most harmful thing in this
   file.** The Task 22 reviewer measured it: the dependency runs the other way.
   The `-u` is what *creates* the timezone dependency, because the number it is
   compared against was written by `chage -E` / `useradd -e` → shadow-utils
   `strtoday()` → GNU `get_date()`, which parses a bare `YYYY-MM-DD` in **local**
   time. On this UTC+8 host, `date -d 2027-06-30 +%s`/86400 = 20998 while
   `date -u -d …`/86400 = 20999, and `docs/vm-build-checklist.md:63` leaves the
   guest zone free. Predicted symptom had it shipped: `users/006` fails 4 of 6
   fixtures at Step 9, direction false-fail.

   Item 5 verified the reading side, never the writing side, and then told the
   implementer not to re-derive it. **That is the failure mode: a "measured clean"
   label on a check I had only half traced.** It is the same error class as Task
   21's mandate 3 and mandate 12.3 — a rationale written for a path I did not
   execute. The standing rule stands and is now non-negotiable: *do not write a
   rationale for a failure mode I have not executed, and never tell an implementer
   to stop looking at something I only half checked.*

   Fixed in fix round 1 as F1. The correct grader compares day counts under the
   writer's own local interpretation:
   `want=$(( $(date -d 2027-06-30 +%s) / 86400 ))`. Dropping the `-u` alone does
   **not** work — `days * 86400` is always a multiple of 86400 and a non-UTC local
   midnight never is.
6. **`sudo sudo -l -U alice` is deliberate, not a typo.** `-U` requires root, and
   asking the real sudoers parser is what makes the check indifferent to whether
   the rule lives in `/etc/sudoers` or a drop-in.
7. **All eight card `id:` values are explicitly declared in frontmatter and
   correctly shaped** (dotted lowercase, matching `CONCEPT_ID_RE`), and every
   `requires_concepts:` entry in all four `task.yaml` files matches one of them.
   Concept ids come from the frontmatter `id:` field, not from the file path.
8. **`scope: instrumental` on `selinux/019` is a valid value.**
   `TaskScope = 'exam-objective' | 'instrumental'`.
9. **The Step 8 cross-check script the brief supplies (line 1383) works.** Its
   `grep -oE '^[[:space:]]*ck(_pass|_fail|_skip)? [a-z0-9][a-z0-9-]*'` is anchored
   at line start, so unlike a naive `\bck ` pattern it does not match the prose
   phrase "every ck call" at line 105. Use it as given.

---

## 8. Steps 9 and 10 are deferred; say so explicitly

The RHEL 9 ISO is a user-owned blocker and no VM exists, so **Step 9 and Step 10
cannot run.** Do not attempt any VM operation — no `vmrun`, no start, stop,
snapshot, revert or delete, on this project's VM or the user's unrelated Ubuntu
and Windows 11 guests.

Everything else is runnable and none of it is optional:

- **Step 7** (`coverage`) — this is the mandate-1 gate. It must report no unknown
  objective id.
- **Step 8** — `bash -n` on all four `grade.sh`, all four `setup.sh`, and every
  solution and anti-solution (~~23~~ **30** scripts after mandates 3 and 5), plus
  the declared-id cross-check. *(Corrected after the review: 4 `setup.sh` + 4
  `grade.sh` + 9 solutions + 13 antisolutions = 30, or 37 fixture scripts in the
  tree once `storage/014`'s are counted. The implementer's report said 30 and was
  right; my 23 was another unmeasured number — see the retraction in mandate 7
  item 5.)*
- `npm run typecheck` and `npx vitest run`. The branch is at ~~**203 passing / 20
  files**~~ **246 passing / 23 files** — that was already the count at `aae2dca`,
  so my figure was stale, not a change this task caused. This task adds content,
  not code; if the total changes, that is a finding. Task 20 and Task 21 may land
  while you work — read `git log` before concluding anything from a mismatch.
- `chmod +x` every `.sh` you create, and confirm it.

In your report, state for Steps 9 and 10 what they would prove rather than
marking them done: that `validate` reports `transport: ssh` then `20/20 fixtures
ok` for the three SSH tasks, and — the one that matters — that `028` reports
**`transport: vmrun`** on its first line and `6/6`. If `028` says `ssh`, the
`require` derivation from `task.transport` in Task 21's `validate` command is not
working and that run proves nothing. `028` is the only Phase 1 task that
exercises the fallback control plane under the conditions it was designed for, so
its deferred acceptance is the most valuable of the two.

---

## Mandate 9 (addendum, from the Task 21 review — F1)

Task 21's reviewer found a missing-precondition hole in
`content/tasks/storage/014-grow-home-lv/setup.sh` and named the generalisable
rule. Task 22 clones that directory four times, so the rule binds you:

> **A task's `setup.sh` must verify every precondition its goal checkpoints
> depend on, not only the ones its own commands need in order to run.**

The concrete failure it came from: `setup.sh` checked that `/home` was its own LV
and that VG `rhel` had free space, but not `/home`'s *current size* — the one
thing both goal checkpoints measure. A guest built with `/home` already at 12 GiB
therefore produced a student-facing false pass: the prompt says "/home is almost
full, make at least 12 GiB available", the student does nothing, every checkpoint
passes. Task 21's fix round adds the guard.

For each of your four tasks, before you write `setup.sh`, list its goal
checkpoints (the ids in `# baseline-fail:`) and for each one write down the
starting-state property it measures. Every one of those properties needs a
precondition check. Put that list in your report so the reviewer can check it
against what you wrote.

Two related rules from the same finding:

- **Prefer absolute arguments over relative ones in solution scripts.** Solution
  02 used `lvextend -L +4G`, which reaches the target only from exactly the
  documented starting size; solution 01's `-L 12G` is immune. A relative argument
  makes a solution silently depend on a precondition, which is how the hole above
  stayed invisible. Use the relative form only when the relative-ness is the
  point, and say so in a comment when you do.
- **A solution failing its own checkpoint is not automatically grader
  over-fitting.** Task 21's Step 12 failure table routes
  `solution/NN: <id>: expected pass, got fail` straight to "grader over-fitting —
  make the checkpoint mechanism-agnostic; do not change the solution to suit the
  grader." That routing is wrong when the real cause is a guest built outside its
  documented spec, and it is the same red-herring shape mandate 2 of Task 21
  exists to eliminate, reappearing on the content side where the exit-code check
  cannot catch it because the command *succeeds*. If you write a failure table,
  put "guest not built to `docs/vm-build-checklist.md`" ahead of over-fitting as
  a cause to rule out.
