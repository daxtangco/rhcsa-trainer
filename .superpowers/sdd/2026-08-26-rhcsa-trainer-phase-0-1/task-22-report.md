# Task 22 report — four graded lab tasks and eight concept cards

Branch `phase-0-1`, BASE `aae2dca`. Brief: `task-22-brief.md`. Mandates: `task-22-mandates.md`
(mandates override the brief where they disagree; all nine applied).

## Headline

42 new content files written, 0 existing files modified. All locally runnable gates pass.

**No VM exists and no script in this task has ever been executed against a real machine.**
Steps 9 and 10 (the VM acceptance runs) are deferred per mandate 8 and were not attempted.
Every claim below is either a pasted local command output or is explicitly labelled unverifiable.

---

## 1. What was created

### `content/tasks/users/006-team-provisioning/` — scope `exam-objective`, transport `ssh`, `reboot_check: false`

| File | Notes |
| --- | --- |
| `task.yaml` | objectives `users.accounts.manage`, `users.groups.manage`, `users.passwords.aging`, `users.sudo.superuser`; difficulty 2; time_budget 600; weight high; chapter 6 |
| `setup.sh` | brief body + mandate-2 `need()` + mandate-9 precondition block |
| `grade.sh` | 8 checkpoints; goal set of 7; `student-intact` invariant |
| `solutions/01-useradd-usermod-chage.sh` | |
| `solutions/02-groupmembers-at-creation.sh` | |
| `solutions/03-primary-group-only.sh` | devops as primary group; a **solution**, not an antisolution — every checkpoint must still pass |
| `antisolutions/01-no-group-no-sudo.sh` | `# expect-fail: alice-in-devops, bob-in-devops, carol-in-devops, sudo-devops` |
| `antisolutions/02-aging-skipped.sh` | `# expect-fail: group-gid, carol-expiry, alice-maxdays` |

Fixtures: 1 baseline + 3 solutions + 2 antisolutions = **6**.
Antisolutions renumbered to `01`/`02` per mandate 5.

### `content/tasks/selinux/019-httpd-alt-port/` — scope `instrumental`, transport `ssh`, `reboot_check: true`

| File | Notes |
| --- | --- |
| `task.yaml` | objectives `selinux.contexts.restore`, `selinux.ports.labels`, `net.firewall.settings`, `pkg.dnf.install`; difficulty 4; time_budget 900; chapter 22 |
| `setup.sh` | brief body + `need`/pipeline guards + `semanage fcontext -d -e` cleanup + large mandate-9 block |
| `grade.sh` | 8 checkpoints; goal set of 7; `selinux-enforcing` invariant |
| `solutions/01-semanage-fcontext-type.sh` | |
| `solutions/02-drop-in-and-equivalence.sh` | uses `semanage fcontext -a -e /var/www/html /srv/web` |
| `antisolutions/01-chcon-only.sh` | `# expect-fail: context-permanent` |
| `antisolutions/02-runtime-firewall-only.sh` | `# expect-fail: firewall-permanent, firewall-runtime@post` |
| `antisolutions/03-forgot-port-label.sh` | `# expect-fail: port-labeled, page-served` |
| `antisolutions/04-started-not-enabled.sh` | mandate 3; `# expect-fail: httpd-enabled, page-served@post` |
| `antisolutions/05-fcontext-without-restorecon.sh` | mandate 3; `# expect-fail: context-now, page-served` |

Fixtures: 1 + 2 + 5 = **8**.

### `content/tasks/systemd/017-boot-time-service/` — scope `exam-objective`, transport `ssh`, `reboot_check: true`

| File | Notes |
| --- | --- |
| `task.yaml` | objectives `systemd.services.enable`, `boot.targets.default` (two, not three — see Judgement calls); difficulty 3; weight medium; chapter 11 |
| `setup.sh` | brief body + `need` + explicit `if ! sudo tee … <<'EOF'` heredoc + mandate-9 block |
| `grade.sh` | 5 checkpoints; goal set of 3; `sshd-intact` invariant; `default-target` invariant **is** probed |
| `solutions/01-oneshot-multiuser.sh` | |
| `solutions/02-simple-sysinit.sh` | |
| `antisolutions/01-started-not-enabled.sh` | `# expect-fail: stamp-enabled, stamp-effect@post` |
| `antisolutions/02-faked-the-end-state.sh` | `# expect-fail: unit-verifies, stamp-enabled, stamp-effect@post` |
| `antisolutions/03-broke-the-target.sh` | `# expect-fail: default-target` |

Fixtures: 1 + 2 + 3 = **6**.

### `content/tasks/troubleshooting/028-restore-remote-access/` — scope `exam-objective`, transport `vmrun`, `reboot_check: true`

| File | Notes |
| --- | --- |
| `task.yaml` | objectives `net.services.status`, `net.firewall.settings`, `net.services.autostart`, `systemd.services.enable`; difficulty 4; chapter 26 |
| `setup.sh` | mandate-2 empty-`conn` guard + `chmod 0644 /etc/rhcsa-conn` + `usermod -aG wheel student` + mandate-9 block |
| `grade.sh` | 5 checkpoints; goal set of 4; `student-intact` invariant |
| `solutions/01-systemctl-firewallcmd-nmcli.sh` | |
| `solutions/02-by-port-and-keyfile.sh` | |
| `antisolutions/01-started-not-enabled.sh` | `# expect-fail: sshd-enabled, sshd-listening@post` |
| `antisolutions/02-runtime-firewall-only.sh` | `# expect-fail: firewall-ssh` |
| `antisolutions/03-network-left-manual.sh` | `# expect-fail: net-autoconnect` |

Fixtures: 1 + 2 + 3 = **6**.

This is the only task in the set that requires `transport: vmrun`, because the setup deliberately
removes the SSH control plane it would otherwise be graded over.

### Eight concept cards

Bodies are the brief's prose verbatim. Frontmatter `objectives:` substituted per mandate 1.

| Card | `objectives:` | `prerequisites:` |
| --- | --- | --- |
| `content/concepts/users/shadow-aging-fields.md` | `users.passwords.aging`, `users.accounts.manage` | — |
| `content/concepts/users/sudoers-and-wheel.md` | `users.sudo.superuser` | — |
| `content/concepts/selinux/labels-now-vs-policy.md` | `selinux.contexts.restore` | — |
| `content/concepts/selinux/ports-are-labeled-too.md` | `selinux.ports.labels` | `selinux.labels-now-vs-policy` |
| `content/concepts/net/firewalld-runtime-vs-permanent.md` | `net.firewall.settings` | — |
| `content/concepts/systemd/enabled-vs-started.md` | `systemd.services.enable` | — |
| `content/concepts/systemd/unit-file-anatomy.md` | `systemd.services.enable` | `systemd.enabled-vs-started` |
| `content/concepts/net/nm-connections-are-the-config.md` | `net.services.autostart` | — |

### Totals

4 `task.yaml`, 4 `setup.sh`, 4 `grade.sh`, 9 solutions, 13 antisolutions, 8 concept cards = **42 files**.
All 30 new shell scripts are mode `-rwxr-xr-x`.

---

## 2. Mandate-9 precondition table

Mandate 9: *setup must verify every precondition the goal checkpoints depend on, not only the ones
its own commands need.* One row per goal checkpoint.

### users/006-team-provisioning

| Goal checkpoint | Starting-state property it depends on | Setup check |
| --- | --- | --- |
| `group-gid` | group `devops` absent **and** GID 5000 unclaimed by any other group | `! getent group devops`; `getent group 5000` → fail naming the squatter |
| `alice-in-devops`, `bob-in-devops`, `carol-in-devops` | users `alice`/`bob`/`carol` absent | loop: `! id "$u"` for each |
| `alice-maxdays` | `/etc/login.defs` does not already set `PASS_MAX_DAYS 30` | `awk '$1=="PASS_MAX_DAYS"{print $2}' … | tail -n1` ≠ `30` |
| `carol-expiry` | carol absent, **and** `/etc/default/useradd` does not already set `EXPIRE=` to the date the prompt asks for | the `id carol` loop, plus `awk -F= '$1=="EXPIRE"{print $2}' /etc/default/useradd` converted to a local day count and compared to the same `want` the grader computes *(corrected in fix round 1, finding F7 — this row originally read "covered by carol's absence above", which was wrong: with `EXPIRE=2027-06-30` set, a bare `useradd carol` satisfies the checkpoint)* |
| `sudo-devops` | `/etc/sudoers.d/devops` absent **and** no `%devops` rule anywhere in the sudoers tree | `[ ! -e /etc/sudoers.d/devops ]`; `sudo grep -rqs '^[[:space:]]*%devops' /etc/sudoers /etc/sudoers.d` must not match |
| (solution 02 rewrites `/etc/sudoers`) | the sudoers tree already parses | `sudo visudo -c >/dev/null 2>&1` |
| `student-intact` (invariant) | `student` is in `wheel` | `id -nG student | tr ' ' '\n' | grep -qx wheel` |

The `PASS_MAX_DAYS` check is the one that closes a real false-pass hole: on a host whose
`login.defs` already says 30, `useradd alice` alone would satisfy `alice-maxdays` and the student
would never need to type `chage -M 30`.

The GID-5000 check closes a misdirected-failure hole: if another group owns 5000, `groupadd -g 5000`
fails and the student is shown a grader failure caused by the image, not by their answer.

### selinux/019-httpd-alt-port

| Goal checkpoint | Starting-state property | Setup check |
| --- | --- | --- |
| all seven | `semanage`, `matchpathcon`, `curl` present | `command -v` each |
| `httpd-enabled` | `systemctl is-enabled httpd` ≠ `enabled` | `is-enabled` output compared |
| `page-served` | nothing listening on TCP 82; the marker string is in the page | `ss -ltn` has no `:82`; `grep` the marker in `index.html` |
| `port-labeled` | 82/tcp not already in `http_port_t` | `semanage port -l | awk '$1=="http_port_t" && $2=="tcp"' | grep -qw 82` must not match |
| `context-now` | on-disk label of `/srv/web` is not `httpd_sys_content_t` | `stat -c %C` |
| `context-permanent` | the label the **policy** wants for `/srv/web` is not `httpd_sys_content_t` | `matchpathcon -n` |
| `firewall-runtime` | 82/tcp absent from the runtime zone | `firewall-cmd --list-ports` |
| `firewall-permanent` | 82/tcp absent from the permanent zone | `firewall-cmd --permanent --list-ports` |
| `pkg.dnf.install` path | a dnf repo is configured | bash array glob `repos=(/etc/yum.repos.d/*.repo); [ -e "${repos[0]}" ]` |
| — | firewalld active | `systemctl is-active firewalld` |
| `selinux-enforcing` (invariant) | SELinux is `Enforcing` | `getenforce` = `Enforcing` |

The separated `stat -c %C` / `matchpathcon -n` pair is the important one: it is the only way to be
sure that `context-now` and `context-permanent` both start red, which is what makes
`antisolutions/01-chcon-only.sh` a meaningful discriminator rather than an accident.

Setup also runs `sudo semanage fcontext -d -e /var/www/html /srv/web` so a previous run of
`solutions/02` cannot leave an equivalence rule behind that would make `context-permanent` start green.

### systemd/017-boot-time-service

| Goal checkpoint | Starting-state property | Setup check |
| --- | --- | --- |
| `unit-verifies` | the unit file exists in **neither** `/etc/systemd/system` nor `/usr/lib/systemd/system`, and `systemd-analyze verify` currently fails | both paths absent; `systemd-analyze verify` non-zero |
| `stamp-enabled` | `systemctl is-enabled` ≠ `enabled` | `is-enabled` output compared |
| `stamp-effect` | `/run` is a tmpfs, the helper is executable and actually produces `/run/rhcsa-stamp`, and the marker is then removed | `findmnt -no FSTYPE /run` = `tmpfs`; run helper; confirm stamp created; remove it; confirm gone |
| `default-target` (invariant) | default target is `multi-user.target` | `systemctl get-default` |
| `sshd-intact` (invariant) | `sshd` is enabled | `systemctl is-enabled sshd` |

The `/run`-is-tmpfs check is load-bearing. `stamp-effect` proves the unit ran *at boot* only because
`/run` is cleared on every boot. On a host where `/run` were persistent, a stamp left over from a
manual `systemctl start` would satisfy the checkpoint after a reboot and the task would silently stop
distinguishing enabled from started — which is the entire point of the task.

### troubleshooting/028-restore-remote-access

| Goal checkpoint | Starting-state property | Setup check |
| --- | --- | --- |
| `sshd-enabled` | `systemctl is-enabled sshd` is not `enabled` | `is-enabled` compared |
| `sshd-listening` | nothing is listening on TCP 22 | `ss -ltn` has no `:22` — this is what catches an enabled `sshd.socket`, which would keep 22 open even with `sshd.service` disabled |
| `firewall-ssh` | the **permanent** config permits neither the `ssh` service nor `22/tcp`, **and** the interface is in the default zone | `perm=$(sudo firewall-cmd --permanent --list-all)` once, then `grep -qw ssh` / `grep -qw 22/tcp` against it — byte-for-byte the grader's own probe, so it cannot drift from the grader; plus the default-zone checks added in fix round 1, runtime and permanent *(corrected in fix round 1, finding F13 — this row originally described `--permanent --list-services` and `--permanent --list-ports`, which the code never ran)* |
| `net-autoconnect` | the recorded profile name is readable and its `connection.autoconnect` reads `no` | `/etc/rhcsa-conn` content equals `$conn`; `nmcli -g connection.autoconnect` = `no` |
| — | firewalld active | `systemctl is-active firewalld` |
| `student-intact` (invariant) | `student` is in `wheel` | `id -nG student` |

The `ss -ltn` check on port 22 is the false-pass closer here: `systemctl disable --now sshd` does not
touch `sshd.socket`, and on an image with socket activation enabled the machine would still accept
SSH, so `sshd-listening` would start green and the task's premise would be false.

`chmod 0644 /etc/rhcsa-conn` is required because the grader runs as `student` and must read the file
without sudo.

---

## 3. Step 7 — `node src/cli/index.ts coverage`

```
content root: content
tasks: 5
concepts: 10
objectives: 68
uncovered objectives: 58
  - boot.grub.modify
  - boot.lifecycle.shutdown
  - boot.rescue.interrupt
  - boot.targets.manual
  - containers.build.containerfile
  - containers.images.inspect
  - containers.images.registry
  - containers.lifecycle.run
  - containers.podman.manage
  - containers.service.run
  - containers.storage.persistent
  - containers.systemd.autostart
  - files.links.create
  - files.manage.copy-move
  - files.permissions.set-gid
  - files.permissions.troubleshoot
  - files.permissions.ugo-rwx
  - files.permissions.umask
  - net.addressing.ipv4-ipv6
  - net.firewall.restrict-access
  - net.hostname.resolution
  - net.ssh.key-auth
  - pkg.dnf.install
  - selinux.booleans.modify
  - selinux.contexts.identify
  - selinux.contexts.restore
  - selinux.modes.enforcing-permissive
  - selinux.ports.labels
  - selinux.troubleshoot.violations
  - storage.autofs.configure
  - storage.filesystems.create-mount
  - storage.fstab.uuid-label
  - storage.lvm.lv
  - storage.lvm.pv
  - storage.lvm.vg
  - storage.nfs.mount
  - storage.partitions.mbr-gpt
  - storage.swap.nondestructive
  - sys.cron.schedule
  - sys.logs.journal
  - sys.logs.persistent-journal
  - sys.proc.kill
  - sys.proc.scheduling
  - sys.time.chrony
  - sys.tuned.profiles
  - tools.archive.tar
  - tools.editor.text-files
  - tools.man.documentation
  - tools.script.command-output
  - tools.script.conditionals
  - tools.script.inputs
  - tools.script.loops
  - tools.shell.prompt
  - tools.shell.redirection
  - tools.ssh.client
  - tools.ssh.transfer
  - tools.text.grep
  - users.login.switch
untaught concepts: 0
exit=0
```

No `problem:` lines. `tasks: 5` and `concepts: 10` are the expected new totals (1 + 4, 2 + 8).

`selinux.contexts.restore`, `selinux.ports.labels` and `pkg.dnf.install` remain in the uncovered list.
This is correct, not a defect: `selinux/019` is `scope: instrumental`, and `bank.ts:188` deliberately
excludes instrumental tasks from `coveredObjectives`. Those three objectives will be credited when an
`exam-objective` task claims them.

## 4. Step 8 — syntax and checkpoint-id cross-check

### 8a — `bash -n` over every task script

```
syntax pass complete
```

No `SYNTAX ERROR` lines. Run as `for f in $(find content/tasks -name '*.sh' | sort); do bash -n "$f" …`
inside `bash -s` (the Bash tool's shell is zsh).

### 8b — declared ids vs emitted ids

```
id cross-check complete
```

No `UNDECLARED-ID` lines. Every id named in a `# baseline-fail:` or `# expect-fail:` header is
actually emitted by the corresponding `grade.sh`.

### 8c — additional audit I ran beyond the brief

The brief's 8b check only catches *declared but not emitted*. I ran the inverse and the bookkeeping
in both directions:

| Task | emitted | goal (`baseline-fail`) | invariants | goal ids with no antisolution | `unprobed-invariant` header |
| --- | --- | --- | --- | --- | --- |
| `users/006` | 8 | 7 | `student-intact` | none | `student-intact` |
| `selinux/019` | 8 | 7 | `selinux-enforcing` | none | `selinux-enforcing` |
| `systemd/017` | 5 | 3 | `default-target`, `sshd-intact` | none | `sshd-intact` |
| `troubleshooting/028` | 5 | 4 | `student-intact` | none | `student-intact` |
| `storage/014` (reference, unchanged) | 5 | 2 | 3 | none | `var-intact` |

Every goal checkpoint is probed by at least one antisolution. Exactly one `# baseline-fail:` header
per grader. Every antisolution carries an `# expect-fail:` header. `content/lib/assert.sh` contains
no occurrence of the header literal.

`systemd/017`'s `default-target` is the one invariant with no `# unprobed-invariant:` header, because
it is not unprobed: `antisolutions/03-broke-the-target.sh` declares `# expect-fail: default-target`.

### 8d — concept graph cross-check

Required by the team lead: every `requires_concepts` id resolves to a written card, and every card is
reachable from some task.

```
DANGLING requires_concepts (no card): []
UNREACHABLE cards (no task requires): []

content/tasks/selinux/019-httpd-alt-port -> selinux.labels-now-vs-policy selinux.ports-are-labeled-too net.firewalld-runtime-vs-permanent
content/tasks/storage/014-grow-home-lv -> storage.lvm-abstraction-stack storage.why-xfs-cannot-shrink
content/tasks/systemd/017-boot-time-service -> systemd.enabled-vs-started systemd.unit-file-anatomy
content/tasks/troubleshooting/028-restore-remote-access -> systemd.enabled-vs-started net.firewalld-runtime-vs-permanent net.nm-connections-are-the-config
content/tasks/users/006-team-provisioning -> users.shadow-aging-fields users.sudoers-and-wheel
```

10 cards written, 10 distinct cards required — a perfect bijection, consistent with the CLI's
`untaught concepts: 0`. All `prerequisites:` ids also resolve to written cards.

## 5. Tests and typecheck

```
 Test Files  23 passed (23)
      Tests  246 passed (246)
```

Exactly the required baseline of 246 passing / 23 files. No test was edited, added, or removed.

```
> tsc --noEmit
typecheck exit=0
```

No TypeScript source was touched in this task, so the typecheck result is a regression guard rather
than evidence about new code.

`git diff --stat HEAD` is empty and `git status --porcelain content/tasks/storage content/lib` is
empty: `content/tasks/storage/014-grow-home-lv/` and `content/lib/assert.sh` are provably unmodified.
Every file in this task is a new untracked file.

---

## 6. Deviations from the brief, with reasons

All nine mandates are deviations the mandates themselves ordered; they are listed for completeness,
then the deviations I introduced on my own judgement.

| # | Deviation | Reason |
| --- | --- | --- |
| M1 | 11 of the 13 objective ids the brief names do not exist in `content/objectives.yaml`; substituted the 12 mandate-1 ids | mandate 1. I verified each of the 12 by individual lookup in `objectives.yaml` rather than by a set diff, because mandate 1 records that two earlier `comm`-style diffs gave wrong answers |
| M2 | Added a `need()` wrapper to each `setup.sh`; did **not** add `set -e` | mandate 2. The `setupResult.code !== 0` gate in `harness.ts` cannot fire under the brief's `set -uo pipefail`, so a failed setup command would otherwise be invisible |
| M3 | Added `antisolutions/04-started-not-enabled.sh` and `05-fcontext-without-restorecon.sh` to `selinux/019` | mandate 3 |
| M4 | Added `# unprobed-invariant:` headers for 4 checkpoints | mandate 4 |
| M5 | `users/006` antisolutions numbered `01`/`02` | mandate 5 |
| M6 | Added no objectives and no checkpoints beyond the brief's | mandate 6 |
| M7 | Recorded measured clean negatives rather than asserted ones | mandate 7 |
| M8 | Steps 9 and 10 not attempted; no VM operation of any kind | mandate 8 |
| M9 | Large precondition blocks in all four `setup.sh` files (section 2) | mandate 9 |
| D1 | `sudo visudo -c -q` replaced with `sudo visudo -c >/dev/null 2>&1 \|\| fail …` | `need` cannot redirect output, and `-q` support is not guaranteed across `sudo` versions. Same effect, no dependency on a flag I cannot test |
| D2 | `compgen -G '/etc/yum.repos.d/*.repo'` replaced with a plain array glob `repos=(…); [ -e "${repos[0]}" ]` | `compgen` is a completion builtin; the glob test is the ordinary idiom and behaves identically for this purpose |
| D3 | `systemd/017`'s helper heredoc rewritten as an explicit `if ! sudo tee … <<'EOF' … EOF then … fi` | my first version put `\|\|` on the `tee` line ahead of the heredoc body, which parses in a way that is easy to misread. `need` cannot wrap a pipeline or a heredoc, so an explicit `if` is the correct shape; a comment in the file says so |
| D4 | Mandate 4's draft wording "would validate green" kept, but its `ck_pass` mention dropped | the team lead forbids `ck_pass` followed by a word inside a grader comment (it collides with the grep that inventories checkpoints). `storage/014` avoids the same collision the same way |
| D5 | The brief's grader comment "because every `ck` call must have a literal id" reworded to "because every checkpoint id must be a literal" | same grep-collision class as D4 |
| D6 | Mandate 3's draft `04`/`05` bodies replaced with verbatim copies of `solutions/01` differing by exactly one line each | see Judgement calls |
| D7 | `troubleshooting/028` setup adds `usermod -aG wheel student`, which is beyond mandate 2's enumerated list | the grader's `student-intact` invariant and the solutions' `sudo` use both require it; flagged in a comment in the file |
| D8 | `selinux/019` setup adds `semanage fcontext -d -e /var/www/html /srv/web` | idempotency: without it, a previous `solutions/02` run leaves an equivalence rule that makes `context-permanent` start green, breaking the `kind: 'none'` baseline's assertion |
| D9 | `systemd/017` `task.yaml` lists two objectives, not three | see Judgement calls |
| D10 | `selinux/019` fixture arithmetic corrected throughout | see section 8 |

---

## 7. Judgement calls

**`systemd.units.create` does not exist, and I did not invent a replacement.**
The brief gives `systemd/017` three objectives. Mandate 1 maps two of them to real ids and leaves the
third, "create a unit file", with no counterpart in `objectives.yaml`. Mandate 6 forbids adding
objectives. `systemd.services.enable` is the closest real id and is already claimed. Rather than
stretch an unrelated id to cover unit authoring, I left the task with two objectives — the schema
requires at least one, so this is valid. The unit-authoring skill is still taught, by
`content/concepts/systemd/unit-file-anatomy.md`. **If the taxonomy should have an id for authoring a
unit file, that is a change to `objectives.yaml` and a decision for the team lead, not for this task.**

**Mandate 3's draft antisolutions were functionally wrong and I corrected them.**
As drafted, `04` and `05` applied only `sed -i 's/^Listen 80$/Listen 82/'` and omitted the
`DocumentRoot` change and the `<Directory "/srv/web">` block. Without those, `page-served` fails in
verdict A, which contradicts `04`'s own `# expect-fail: … page-served@post` declaration. I followed
mandate 3's own instruction to copy `solutions/01` verbatim, so each of `04` and `05` now differs from
the solution by exactly one line — `start` instead of `enable --now` for `04`, and a missing
`restorecon -Rv /srv/web` for `05`. That one-line difference is what makes them honest discriminators.

**`solutions/03-primary-group-only.sh` is a solution, not an antisolution.**
Making `devops` a user's primary group is a legitimate way to satisfy "is in devops", and the grader
reads group membership via a method that counts primary membership. Filing it as an antisolution would
teach that a correct answer is wrong.

**`scope: instrumental` on `selinux/019`.**
The task chains four skills (install, label a file, label a port, open a firewall port) rather than
testing one objective cleanly, so it should not claim exam-objective coverage credit. The visible
consequence is the three objectives still listed as uncovered in Step 7. That is the intended
trade-off, and it means an exam-objective task for SELinux contexts and ports is still owed.

**Guest-side `sudo` in every script.**
Both transports connect as `student`, and `/etc/sudoers.d/rhcsa-trainer` grants passwordless sudo, so
every privileged command is written with an explicit non-interactive `sudo`. No script assumes root.

**SELinux is never weakened.** No script sets permissive, disables SELinux, or relabels its way around
policy. `selinux/019` teaches `semanage` precisely so the student does not learn to reach for
`setenforce 0`; the `selinux-enforcing` invariant fails the task if they do.

---

## 8. Corrected fixture arithmetic (for the deferred acceptance steps)

The brief's fixture counts predate mandate 3's two extra antisolutions. Corrected:

| | Brief said | Actual |
| --- | --- | --- |
| `selinux/019` antisolutions | 2 | **5** |
| `selinux/019` fixtures | 6 | **8** |
| `transport: ssh` run total | `18/18 fixtures ok` | **`20/20 fixtures ok`** |
| `transport: vmrun` run (`028`) | `6/6` | `6/6` (unchanged) |
| Both transports combined | 24 | **26** |
| ssh run wall-clock budget | 35–45 min | **45–55 min** |

The ssh total of 20 is `users/006` 6 + `selinux/019` 8 + `systemd/017` 6. `storage/014` is not in that
figure; it is a separate already-reviewed task.

---

## 9. Not verified, and why

This is the section that matters most. **Nothing in this task has been executed against a RHEL 9
machine.**

| Claim | Status |
| --- | --- |
| Any `setup.sh` runs to completion on a real guest | **Unverified.** No VM exists; the RHEL 9 ISO is not downloaded |
| Any `grade.sh` emits the checkpoints it is declared to emit, at runtime | **Unverified.** Verified only by static grep of the source |
| Any goal checkpoint actually fails at baseline | **Unverified.** Asserted by `# baseline-fail:` and reasoned about by hand; never measured |
| Any invariant actually passes at baseline | **Unverified.** Same |
| Any `# expect-fail:` declaration matches what the fixture produces | **Unverified.** Traced by hand against `expectations.ts`, `grader.ts` and `harness.ts` semantics; never executed |
| Any solution actually solves the task | **Unverified** |
| Verdict B (survives reboot) behaves as declared for the four `reboot_check: true` tasks | **Unverified.** Reboot behaviour cannot be reasoned about with confidence; it is exactly what Steps 9/10 exist to measure |
| `npm run validate` output | **Never run.** It requires a VM |
| `shellcheck` clean | **Not run.** `shellcheck` is not installed on this host; four prior tasks confirmed this |
| Guest package availability (`matchpathcon` from `libselinux-utils`, `httpd`) | **Unverified, and a live risk.** See below |

**Step 9 and Step 10 are deferred and were not attempted.** When a VM exists they would prove:

- Step 9: `transport: ssh` over `users/006`, `selinux/019`, `systemd/017` → expect **`20/20 fixtures ok`**.
- Step 10: `transport: vmrun` on `troubleshooting/028` (it must be the first line of the run, since the
  task's setup removes SSH) → expect **`6/6`**.

**Two open risks I could not close from this host:**

1. `scripts/guest-provision.sh`'s `PKGS` list includes `policycoreutils-python-utils` (which provides
   `semanage`) but does **not** list `libselinux-utils` (which provides `matchpathcon`) or `httpd`.
   `selinux/019`'s setup fails closed with a clear diagnostic if `matchpathcon` is missing, and its
   `pkg.dnf.install` objective intends the student to install `httpd` themselves — so neither is a
   silent failure. But the first VM run of `selinux/019` may stop at the `matchpathcon` precondition
   until `libselinux-utils` is added to `PKGS`. **Flagging this as a probable one-line change to
   `scripts/guest-provision.sh`, which is outside this task's scope.**
2. `# unprobed-invariant:` enforcement is **forwarded, not implemented**. Nothing in the codebase
   parses that header today. The four headers are an honest, machine-readable record of a known gap,
   not a check that runs. A future task should teach the validator to read them.

**`checkCoverage` does not validate concept-card `objectives:`.**
`bank.ts`'s `checkCoverage` cross-checks *task* objectives against `objectives.yaml`, but not the
`objectives:` in concept-card frontmatter. So mandate 1's card substitutions are **not** machine-
verified by Step 7. I verified all eight cards' objective ids by individual lookup in
`objectives.yaml` by hand. Worth a validator improvement, since a typo in a card's `objectives:` is
currently silent.
