# RHCSA Lab Trainer — Design

**Date:** 2026-08-26
**Status:** Approved design, pending implementation plan
**Target:** Red Hat Certified System Administrator (EX200), RHEL 9

---

## 1. Purpose

A single-user local web application that trains and verifies hands-on RHCSA
skill against a real RHEL 9 virtual machine.

The application owns the entire experience — curriculum, task prompts, an
in-browser terminal, grading, and progress tracking. A VMware Workstation VM
executes the commands. The user never leaves the browser except for labs that
deliberately require console access.

The design goal is not "a study app." It is a grader whose verdict predicts the
real exam's verdict.

### Non-goals

- **Not a Linux simulator.** No pattern-matching of typed commands. All
  commands execute on a real kernel.
- **Not multi-user.** No accounts, no auth, no server, no instructor view. One
  user, one VM, localhost.
- **Not a content library.** Conceptual teaching is deferred to the Cert Guide.
  The app produces practice and measurement.
- **Not automated OS installation.** The VM is built once by hand from a
  checklist; snapshots are the reset mechanism thereafter.

---

## 2. Context and prior decisions

Established during design and treated as fixed:

| Decision | Value | Rationale |
|---|---|---|
| Lab target | VMware Workstation 25.0.1 VM, local | Only option with full objective coverage (LVM, GPT, boot, GRUB, networking) |
| Guest OS | RHEL 9, free Developer Subscription | Matches the Cert Guide and the user's stated exam version |
| Control plane | SSH primary, `vmrun` fallback | Neither channel alone covers the objective list |
| Scope | Single user | Explicitly chosen; no multi-user affordances anywhere |
| Curriculum spine | The 28-chapter, 4-phase program table | Externally supplied; app mirrors it |
| Timeline | 3+ months, no exam date booked | Permits full coverage and troubleshooting depth |

### Host environment (verified 2026-08-26)

- Windows host: 15 GB RAM, 16 logical CPUs, 647 GB free on `C:`
- WSL2: Linux 6.18, Node 22.23.2, npm 10.9.8
- `vmrun.exe` present and responding at
  `/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`
- `vmware-vdiskmanager.exe` present at the same path
- Existing VMs: `Ubuntu 64-bit`, `Windows 11 x64`. No RHEL ISO yet.
- **Not installed:** `docker`, `podman`, `qemu`, `virsh`
- `poppler` 26.01.0 installed **rootless** at `~/.local/opt/poppler` with wrappers
  in `~/.local/bin` (`sudo` cannot authenticate from a non-TTY context;
  `apt-get download` + `dpkg -x` of 20 packages sidesteps it entirely)

### Source corpus (verified 2026-08-26)

The Cert Guide, 944 pages, contains substantially more usable material than
assumed during design:

| Item | Count | Use |
|---|---|---|
| Chapters | 28, in 5 parts | Matches the supplied program table **exactly**, chapter for chapter |
| End-of-Chapter Labs | 53 | Unguided "do this" prompts → convert directly to graded tasks |
| Guided Exercises (`Exercise N-M`) | 108 | Step-by-step walkthroughs → primary source for `solutions/` scripts |
| Practice exams | 4 (A, B, C, D) | Matches the four Practice Test rows in the table |

The 108 guided exercises are the significant find: they contain canonical command
sequences, which means `solutions/` files are largely transcription rather than
authorship. This materially reduces the authoring cost that `solutions/` +
`antisolutions/` would otherwise impose, and is the strongest mitigation for
risk R5.

Chapter 28 is a *theoretical* pre-assessment (knowledge questions, not tasks) and
therefore produces no graded tasks. The four practice exams do.

### Assumption carrying material risk

**The user will sit the RHEL 9 revision of EX200.**

Red Hat's currently published EX200 objectives include Flatpak repository and
package management, and promote "Manage software" to its own category. Neither
appears in RHCSA 9 or in the Cert Guide. This indicates the live exam has been
revised to RHEL 10, which also ships dnf5 — a graded objective whose behavior
differs from RHEL 9's dnf4.

This was raised during design and the user elected to target RHEL 9 and the
book. That decision stands and drives this design.

**Mitigation:** every `task.yaml` carries `rhel: 9`. The field is unused by the
initial implementation. If the exam version turns out to be RHEL 10, version
filtering becomes an additive change rather than a restructuring. The cost today
is one line of YAML per task.

**Trigger to revisit:** the moment an exam is booked and its version confirmed.

---

## 3. Architecture

```
┌─────────────────────────── WSL2 ───────────────────────────┐
│                                                            │
│  Browser (localhost:5173)                                  │
│    React + Tailwind + xterm.js                             │
│         │ HTTP (REST)          │ WebSocket (pty stream)     │
│  ┌──────▼──────────────────────▼──────────────────────┐    │
│  │  Hono API server (Node 22 / TypeScript)            │    │
│  ├────────────────────────────────────────────────────┤    │
│  │  engine/   (library — no HTTP awareness)           │    │
│  │    tasks/       load + validate task definitions   │    │
│  │    grading/     run graders, parse JSONL verdicts  │    │
│  │    scheduler/   FSRS over objectives               │    │
│  │    exam/        mock-exam composition              │    │
│  │    vm/          LabTransport ×2, lifecycle ops     │    │
│  ├────────────────────────────────────────────────────┤    │
│  │  SQLite (better-sqlite3) — user history only       │    │
│  └───────┬──────────────────────────┬─────────────────┘    │
│          │ ssh / node-pty           │ vmrun.exe            │
└──────────┼──────────────────────────┼──────────────────────┘
           │                          │
      ┌────▼──────────────────────────▼────┐
      │   RHEL 9 VM  (VMware Workstation)  │
      │   sda 40G  ·  sdb 2G sdc 2G sdd 8G │
      │   SELinux enforcing                │
      └────────────────────────────────────┘
```

`engine/` is a plain library with a thin CLI wrapper. The web app is a *client*
of the engine, not a container for it. This keeps graders and the validation
harness testable without a browser, and it is what makes CI possible.

---

## 4. VM provisioning

### 4.1 One-time manual install

Delivered as a checklist document, not code. The VM is built once; automating a
20-minute interactive install has near-zero payoff, and building a kickstart ISO
under WSL is obstructed by the absence of `genisoimage`.

**VM specification**

| Setting | Value | Reason |
|---|---|---|
| vCPU / RAM | 2 vCPU / 4 GB | Host has 15 GB; WSL is capped to 4 GB via `.wslconfig` |
| Disk 0 | 40 GB, LVM | System. Sized to leave free extents in the VG for resize labs |
| Disks 1–3 | 2 GB, 2 GB, 8 GB | Spares for partitioning, PV/VG/LV, swap, and multi-disk VG labs |
| Firmware | BIOS | Simpler GRUB labs. `rd.break` and `init=/bin/bash` procedures are identical under UEFI, so nothing exam-relevant is lost |
| Network | NAT (VMnet8) | See risk R1 |
| Guest tools | `open-vm-tools` | Mandatory — `runProgramInGuest` depends on it |
| SELinux | `enforcing` | Exam default. Never relaxed |

Spare disks are created with `vmware-vdiskmanager.exe` and attached by editing
the `.vmx` file.

### 4.2 `provision.sh` — idempotent, run once

1. Create the study user; install a sudo rule.
2. Install the SSH public key from `~/.ssh/rhcsa_lab`.
3. Install every package the task bank needs, up front: `open-vm-tools`,
   `podman`, `nfs-utils`, `autofs`, `tuned`, `policycoreutils-python-utils`,
   `setroubleshoot-server`, `chrony`, `firewalld`, `httpd`.
4. Configure a local dnf repository backed by the mounted install ISO. This
   serves two purposes: labs function with no internet, and it mirrors the
   "configure repository access" objective.
5. Zero the spare disks.
6. Enable `sshd`.

### 4.3 Snapshot ladder

| Snapshot | Role |
|---|---|
| `golden` | Taken immediately after provisioning. Never modified. Rebuild point |
| `clean` | Per-lab reset target. **Taken powered-on, with memory included** |

Reverting to a live snapshot restores an already-booted machine in roughly 5
seconds, versus 30+ for a cold boot. Cheap resets matter more than they sound:
they are what makes repeating the same LVM task six times tolerable rather than
something the user avoids.

Labs that assert persistence still perform a genuine reboot — that is their
entire point.

**Reset sequence:** `vmrun revertToSnapshot clean` → wait for SSH → run the
task's `setup.sh`.

---

## 5. Control plane

### 5.1 Transport interface

```ts
interface LabTransport {
  exec(script: string): Promise<{ stdout: string; stderr: string; code: number }>
  isAvailable(): Promise<boolean>
}
```

**`SshTransport`** — `ssh -i ~/.ssh/rhcsa_lab -o BatchMode=yes root@$IP bash -s`
with the script piped to stdin. Sub-second. Default for all operations.

**`VmrunTransport`** — `copyFileFromHostToGuest` → `runProgramInGuest
/bin/bash /tmp/g.sh` → copy output back. Two to five seconds. Requires
`open-vm-tools` to be running, but survives a destroyed network stack.

**Selection:** attempt SSH with a 3-second timeout; on failure fall back to
`vmrun`. If both are unavailable, surface an actionable message — *"VM
unreachable; it is probably sitting at a boot prompt, switch to the VMware
console"* — not a stack trace.

**Forced transport:** `task.yaml` may set `transport: vmrun`. Required for labs
where the user is *expected* to break networking (firewalld tasks), which would
otherwise produce spurious grading failures. This is the reason the interface
exists rather than a bare try/catch.

### 5.2 Lifecycle operations (`vmrun` only)

`power(on|off|reset|suspend)`, `snapshot(name)`, `revert(name)`,
`listSnapshots()`.

`reboot()` prefers in-guest `systemctl reboot` and then polls for SSH to return,
with a 120-second timeout and `vmrun reset` as an escape hatch.

### 5.3 Terminal channel

Independent of `exec`. `node-pty` spawns `ssh -t`, streamed over a WebSocket to
xterm.js. Multiple concurrent terminals are permitted — the real exam provides a
full desktop and two shells is realistic.

### 5.4 Grading sequence

1. Run `grade.sh` → **verdict A** ("works now").
2. If `reboot_check` is set and verdict A contains at least one pass: reboot,
   poll for SSH, 120-second timeout.
3. Run `grade.sh` again → **verdict B** ("survives reboot").
4. Report both. Any checkpoint transitioning **pass → fail** is flagged
   prominently as a persistence failure, naming the configuration file the
   change belonged in.
5. If the VM never returns, that is itself a result — the user broke boot. Show
   console instructions and offer a revert to `clean`.

Step 4 is the highest-value output in the system. The most common way competent
candidates fail EX200 is completing a task in the running system without
persisting it: a `mount` absent from `/etc/fstab`, a `sysctl` not written to
`/etc/sysctl.d/`, a working-but-not-`enable`d service, a `firewall-cmd` without
`--permanent`. The real exam reboots before grading.

### 5.5 Stale-state guard

SQLite records which task's `setup.sh` is currently applied to the VM. Grading
task X while task Y's setup is live is refused, with an offer to reset. Without
this guard the user receives pages of inexplicable failures on correct work and
loses confidence in the grader.

---

## 6. Task bank

### 6.1 Layout

One directory per task. All content is files — git-diffable and reviewable.

```
tasks/storage/014-shrink-home-grow-var/
  task.yaml
  setup.sh
  grade.sh
  solutions/
    01-lvextend-xfs_growfs.sh
    02-systemd-mount-unit.sh
  antisolutions/
    01-forgot-growfs.sh
    02-no-fstab-entry.sh
    03-chcon-not-semanage.sh
  explanation.md
```

### 6.2 `task.yaml`

```yaml
id: storage/014-shrink-home-grow-var
title: Reclaim space from /home and give it to /var
chapter: 15                    # drives the linear track view
scope: exam-objective          # exam-objective | instrumental
rhel: 9
objectives: [storage.lvm.resize, storage.fs.xfs]
difficulty: 3                  # 1-5
time_budget: 480               # seconds, exam-realistic
weight: high                   # observed exam frequency
reboot_check: true
requires_disks: 0              # grows from free extents already in the VG
claims: [vg:rhel, lv:var]      # resources owned; used by exam composer
transport: ssh                 # or vmrun
prompt: |
  /var is nearly full while /home is mostly empty. Grow the var
  logical volume to at least 6 GB. All filesystems must mount
  correctly on boot.
hints:                         # progressive; each costs points
  - "Check which filesystem type each LV uses before planning."
  - "XFS cannot be shrunk."
```

### 6.3 Task scope categories

| `scope` | Meaning | Action |
|---|---|---|
| `exam-objective` | Maps to a published EX200 objective | Include |
| `instrumental` | Teaches an objective through a non-objective service | Include, exclude from coverage math |
| — | Maps to no objective | Do not author |

`instrumental` exists because of Chapter 21 (Apache). `httpd` is not an EX200
objective, but the Cert Guide uses it as a vehicle for SELinux contexts,
firewalld, and systemd units — all of which are. A rule that deleted every task
without an objective mapping would wrongly cut it.

### 6.4 Grader contract

`grade.sh` runs as root in the guest and emits one JSON object per line to
stdout:

```
{"id":"lv-var-size","desc":"var LV is >= 6G","status":"pass"}
{"id":"fstab-persist","desc":"/var mounts from fstab","status":"fail","detail":"no entry found"}
```

`status` is one of `pass` | `fail` | `skip`. `detail` and `weight` are optional.

Four rules:

1. **Grade end state, never commands.** Bash history is never inspected. The
   exam does not care whether the user chose `nmcli`, `nmtui`, or a hand-written
   keyfile, and neither does this grader. This rule is what makes the grader
   accept every valid path instead of training one brittle habit.
2. **Read-only.** Graders inspect; they never repair.
3. **Exit code ignored.** One failing check must not abort the remainder — the
   full checkpoint list is required on every run.
4. **Idempotent.** Grading is repeatable mid-work.

Graders also verify the *full* correct end state, not merely the literal ask.
"Grow /var" additionally confirms `/home` still mounts and no orphaned `fstab`
entries were left behind. The real exam has no obligation to look only where the
candidate was working.

### 6.5 Assertion library

`lib/assert.sh`, sourced by every grader. Approximately 30 helpers covering an
estimated 90% of checkpoints: `check_lv_size`, `check_fs_type`,
`check_mount_persistent`, `check_selinux_fcontext`, `check_selinux_boolean`,
`check_service_enabled`, `check_service_active`, `check_firewall_service`,
`check_user_attr`, `check_password_aging`, `check_group_member`,
`check_sudo_rule`, `check_cron_entry`, `check_at_job`, `check_acl`,
`check_tuned_profile`, `check_repo_enabled`, `check_package_installed`,
`check_container_running`, `check_nfs_export`, `check_autofs_map`,
`check_hostname`, `check_ip_persistent`, `check_ssh_key_auth`,
`check_sysctl_persistent`, `check_default_target`, `check_swap_active`,
`check_partition_type`, `check_file_mode`, `check_link_type`.

This library is the leverage in the whole project. With it, authoring task #40
takes ten minutes rather than an hour.

### 6.6 Fault-injection tasks

`setup.sh` may deliberately break the system: a bad UUID in `/etc/fstab`, the
wrong SELinux context on `/var/www/html`, a masked service, a `sudoers` typo, a
firewall rule blocking a required port.

These troubleshooting scenarios are the highest-value tasks in the bank and are
only practical because reset is cheap.

---

## 7. Validation harness

`rhcsa validate` proves the grader is correct before the user ever trusts it.

For each task, for each of pre-reboot and post-reboot:

| Fixture | Required result |
|---|---|
| No action taken | all checkpoints fail |
| Each file in `solutions/` | **all** checkpoints pass |
| Each file in `antisolutions/` | **exactly** its declared checkpoint IDs fail |

Anti-solutions declare which checkpoint IDs they expect to fail, so the harness
asserts *the correct check caught the error*. A grader that fails for the wrong
reason is still broken.

**Why multiple solutions.** If solution 02 fails, the grader is over-fitted to
one author's habits. The exam accepts any correct path; a grader that does not
would quietly train the user into a single brittle approach.

**Why anti-solutions matter more.** A false negative is an annoyance. A false
positive — reporting pass on incorrect work — is how a candidate walks into the
exam confident and fails. Every row in the table below is a documented way to
lose points:

| Near-miss | Must be caught by |
|---|---|
| Resized the LV, did not grow the filesystem | `fs-size` |
| Mounted it, no `fstab` entry | `persist` (post-reboot only) |
| `firewall-cmd` without `--permanent` | `persist` |
| `chcon` instead of `semanage fcontext` + `restorecon` | `selinux-survives-relabel` |
| `systemctl start` without `enable` | `service-enabled` |
| Correct work, wrong disk | `target-device` |

The harness runs in CI over the entire bank so a broken checkpoint cannot rot
silently.

---

## 8. Study engine

### 8.1 Modes

**Practice** — untimed, hints available, solutions viewable, unlimited grading.

**Drill** — spaced repetition. **FSRS schedules at the level of objective, not
task.** Scheduling tasks would let the user re-see task 014 and recall the
answer, which is memorisation rather than learning. Instead the scheduler
selects a due *objective*, then samples a task tagged with it that has not been
seen recently. Same skill, unfamiliar wrapper.

FSRS ratings are **derived from grading, never self-reported** — self-rating is
unreliable and invites gaming:

| Outcome | Rating |
|---|---|
| All pass, no hints, within time budget | Easy |
| All pass, over budget or one hint used | Good |
| Partial pass | Hard |
| Mostly failed, **or any reboot-check regression** | Again |

**Mock exam** — no hints, no solutions, no per-task grading, one timer for the
session. Composes a task set matching the objective distribution by weight and
fitting the time budget, runs all `setup.sh` scripts up front (the real exam
hands over one pre-configured machine), then performs a single reboot and grades
everything at the end.

**Composition constraint:** two tasks cannot both claim `/dev/sdb` or both
create user `alice`. The `claims` field prevents the composer from generating
impossible sessions.

### 8.2 Readiness reporting

Per objective: attempts, pass rate, mean time against budget, hint dependency,
and **persistence-failure rate** (frequency of pass → fail after reboot).

Readiness is reported as a defensible statement, not a manufactured percentage:

> Objectives at passing confidence: 14/22.
> Weakest: SELinux contexts (2/6 clean), autofs (never attempted).

It reports bluntly when the user is not ready. A study tool that flatters is
worse than no study tool.

### 8.3 Data model (SQLite)

- `attempts` — task id, started, finished, checkpoint results (JSON), hints
  used, verdict A, verdict B
- `objective_state` — FSRS parameters, due date, per objective
- `exam_sessions` — composition, timings, final report
- `vm_state` — currently applied task, current snapshot

No `user_id` anywhere. Tasks live on disk; the database holds only history. This
split allows the entire task bank to be rewritten, renumbered, or regenerated
without a migration, while the user's history survives.

---

## 9. User interface

Four screens. Navigation: **Dashboard · Lab · Track · Exams**.

Task authoring stays in the CLI (`rhcsa new-task`, `rhcsa validate`). It does
not need a UI.

**Dashboard** — readiness statement, today's drill queue, weakest objectives,
sealed-holdout status, VM status.

**Track** — the 28-chapter program table in its four phases. Ticks are
**derived** from task results and are not clickable. The Duration column is
auto-filled from summed `time_budget` values.

**Exams** — the four practice tests with their assigned roles, plus past session
reports.

**Lab** — the primary workspace. Approved layout:

```
Lab 014                    6:12   * VM: clean
----------------------------------------------
 /var is nearly full while /home is mostly
 empty. Grow var to >= 6G. All filesystems
 must mount correctly on boot.
---------------------------+------------------
 [root@labvm ~]# lvs       | 4 checkpoints
   LV   VG   Size          | #### hidden
   home rhel 8.00g         |
   root rhel 12.0g         | reboot-check: ON
   var  rhel 2.00g         |
 [root@labvm ~]# _         | [Grade]  ^G
                           | [Reset]  ^R
----------------------------------------------
```

Full prompt text remains visible above the terminal. Exam tasks are multi-part
and a frequent way to lose points is answering two of three parts.

### Three UI rules

1. **VM state is always visible** — current snapshot, power state, applied task.
   Confusion about machine state is the largest time-waster in any lab setup.
2. **Checkpoint details are hidden until grading.** Displaying "filesystem
   grown / persists across reboot" beforehand hands over the solution outline.
   Pre-grade the user sees only a count.
3. **Keyboard-first; the terminal is never modal.** `^G` grade, `^R` reset, `^H`
   hint (confirmed, since it costs points). Grading runs in the background and
   the shell stays live.

Visual treatment: dark, monospace-dominant, low chrome. It should read as a
terminal tool, not a SaaS dashboard.

---

## 10. Curriculum mapping

The supplied program table maps directly onto the design:

| Table column | Design element |
|---|---|
| Coverage (Chapter N) | `chapter:` field → linear track view |
| Learning Focus | objective tags |
| Expected Outcome | the checkpoint list |
| Duration (hrs) | computed from summed `time_budget` |
| Per-person checkbox | derived mastery, not clickable |
| Practice Test ×4 | mock exam sessions |

**Practice test allocation** — the four tests are assigned distinct roles rather
than all being saved for the end:

| Test | Role |
|---|---|
| Practice Exam A | **Diagnostic baseline, taken before study begins.** Expected to go badly; that is the point. Calibrates the readiness model against reality on day one and identifies chapters that can be moved through quickly |
| Practice Exams B, C | Mid-program checkpoints |
| Practice Exam D | **Sealed holdout.** Not opened, and not mined for tasks, until the readiness report claims readiness |

Reserving all four for the end discards four tests' worth of calibration.

**Linear and non-linear views coexist.** The Track view is strictly sequential
(Chapter 1 → 28). The drill queue is deliberately not — it resurfaces Chapter 6
sudo while the user works through Chapter 15 LVM. Both are needed.

---

## 11. Validity strategy

Three distinct questions. Two are fully solvable; the third is only partially.

### Is the grader correct? (solvable)

Section 7. Multiple independent solutions plus declared-failure anti-solutions,
run pre- and post-reboot, in CI.

### Are the tasks faithful? (solvable via proxies)

The real exam items are confidential. Anchors, in priority order:

1. **Red Hat's published EX200 objectives** for RHEL 9 — the contractual
   statement of what is testable. Every task maps to at least one objective ID.
2. **The Cert Guide** — end-of-chapter labs, closest public match to real
   phrasing and scope. Primary source for the initial bank.
3. **RH124 / RH134 course outlines** — define the expected *depth* per
   objective, which the objective list alone does not.
4. **Offline-solvability rule.** The exam provides only `man`, `--help`, and
   installed documentation. For every task, the author must be able to name the
   man page that leads from prompt to solution. If they cannot, the task is
   mis-scoped and is rewritten or cut. This catches tasks that silently require
   having read an external article.

### Does passing predict passing? (partially solvable)

**The sealed holdout is the mechanism.** Practice test 4 is not mined for tasks
and not opened until the app reports readiness. If the app claims 18/22
objectives and the holdout is failed, the calibration is wrong and the app is
lying to the user — which is far better discovered weeks early than on exam day.

Supporting checks:

- **Time calibration.** EX200 runs approximately 2.5 hours. If a full-coverage
  task set sums to four hours of `time_budget`, difficulty estimates are
  systematically wrong. One-line sanity check across the bank.
- **Self-correcting weights.** First-try passes across an entire objective
  indicate its weight was set too high. Attempt data adjusts the estimates.
- **Checkpoint disputes.** A one-click action dumps relevant system state when
  the user believes a `fail` verdict is wrong. These are the bug reports that
  find over-fitted graders — and the user is the only tester this system will
  ever have.

### Stated limits

1. The item pool cannot be guaranteed to match. Only objective coverage and
   end-state grading methodology can be.
2. Graders are stricter in one direction (reboot-checking everything) and
   possibly looser in another (the exam may verify something unanticipated).
   Section 6.4's full-end-state rule is the mitigation.
3. No grader tests judgment under time pressure. Timed mock exams are an
   imperfect proxy.
4. Difficulty weights begin as estimates. Early readiness figures deserve less
   trust than later ones.

---

## 12. Technology

| Concern | Choice |
|---|---|
| Runtime | Node 22, TypeScript |
| API | Hono |
| Front end | Vite, React, Tailwind |
| Terminal | xterm.js, `ws`, `node-pty` |
| Storage | `better-sqlite3` |
| Task definitions | YAML (`js-yaml`) |
| Graders | Bash, JSONL output — deliberately language-agnostic |
| Tests | Vitest for the engine; `rhcsa validate` for the task bank |

---

## 13. Phased delivery

The design describes the full system. Implementation is deliberately phased so
real graded practice begins on day one rather than in week three — a study tool
under construction is a comfortable way to avoid studying.

**Phase 0 — Foundations**
- ~~Install poppler and confirm the Cert Guide's structure~~ **done 2026-08-26**
  — 28 chapters matching the program table, 53 labs, 108 exercises, 4 practice
  exams. See §2 source corpus.
- `objectives.yaml`: the full RHEL 9 EX200 objective taxonomy with stable IDs,
  pinned from Red Hat's published RHEL 9 objective list and cross-referenced to
  the Cert Guide's 28 chapters.
- Extract the 53 labs and 108 exercises to a structured intermediate file
  (`corpus/`) as raw input for task authoring.
- VM build checklist and `provision.sh`; `golden` and `clean` snapshots.
- Verify WSL2 → VMnet8 reachability (risk R1).

**Phase 1 — Thin vertical slice**
- `engine/vm`: both transports, fallback selection, lifecycle, reset.
- `engine/tasks` + `engine/grading`: loader, JSONL parser, `lib/assert.sh`.
- Five real tasks with full `solutions/` and `antisolutions/`, spanning storage,
  users, SELinux, systemd, and one fault-injection scenario.
- `rhcsa validate` and the CLI.
- Lab screen: prompt, terminal, grade, reset, reboot-check.

**Exit criterion:** the user completes a real graded LVM lab, including the
reboot check, end to end.

**Phase 2 — Study engine**
- SQLite schema, attempt recording, stale-state guard.
- FSRS scheduler over objectives; drill mode.
- Dashboard and Track screens.
- Diagnostic baseline exam (practice test 1).

**Phase 3 — Task bank build-out**
- Grow toward roughly 120 tasks, authored chapter by chapter alongside study.
  Authoring a grader's checkpoint list requires knowing precisely what correct
  looks like, so this work is itself studying.
- Mock exam composer with `claims` collision avoidance.
- Exams screen and reporting.

**Phase 4 — Calibration**
- Practice tests 2 and 3 as checkpoints; weight self-correction.
- Sealed holdout when readiness is claimed.

---

## 14. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | WSL2 cannot reach the VM on VMnet8 | Blocks SSH transport and the terminal | Verify in Phase 0. Fallbacks: bridged networking, VMware NAT port-forward, or `vmrun`-only operation |
| R2 | Exam is actually the RHEL 10 revision | ~10–15% of the bank is stale; Flatpak entirely absent; dnf5 differences | `rhel: 9` field present from day one makes version filtering additive. Revisit on booking |
| R3 | Host memory pressure (15 GB total) | Sluggish VM or WSL | Cap WSL at 4 GB via `.wslconfig`; VM at 4 GB |
| R4 | Graders over-fitted to one solution | Trains brittle habits | Multiple `solutions/` required per task; enforced by `validate` |
| R5 | Task-bank authoring becomes procrastination | No actual studying happens | Phase 1 exit criterion is a working graded lab. Authoring is paced alongside chapter study, not front-loaded. The book's 108 guided exercises supply canonical command sequences, so `solutions/` files are largely transcription |
| R6 | `open-vm-tools` down in boot-level labs | Neither transport available | Expected and handled: the app directs the user to the VMware console and offers a revert |

---

## 15. Open items

None blocking. Two items are Phase 0 deliverables rather than unresolved design
questions:

- The objective taxonomy is specified as a Phase 0 artifact (`objectives.yaml`)
  because it must be transcribed from an authoritative source rather than
  recalled.
- Exam duration and passing score are believed to be 150 minutes and 210/300,
  but were not present on the pages fetched during design. To be confirmed in
  Phase 0 and used only for time calibration.
