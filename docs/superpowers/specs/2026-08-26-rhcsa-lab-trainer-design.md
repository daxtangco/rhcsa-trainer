# RHCSA Lab Trainer — Design

**Date:** 2026-08-26
**Status:** Approved design, pending implementation plan
**Target:** Red Hat Certified System Administrator (EX200), RHEL 9

---

## 1. Purpose

A single-user local web application that **teaches and verifies** hands-on RHCSA
skill against a real RHEL 9 virtual machine.

The application owns the entire experience — teaching, practice, grading, exam
craft, and progress tracking. A VMware Workstation VM executes the commands. The
user never leaves the browser except for labs that deliberately require console
access.

Two goals, in priority order:

1. **Be the user's only study surface.** The user's explicit intent is to learn
   RHCSA hands-on without reading a reference book. The app must therefore teach,
   not merely assess. Teaching is delivered **at the moment of need** rather than
   in advance — the user attempts, hits a wall, receives exactly the missing
   concept, and finishes. This is deliberately chosen over the read-then-practice
   model: it yields better retention and it is what the user asked for.
2. **Be a grader whose verdict predicts the real exam's verdict.**

### Design tension, resolved explicitly

Pure discovery learning cannot teach vocabulary. A user will never derive from
first principles that `semanage fcontext` exists, will never guess that XFS
cannot be shrunk, and cannot infer the PV → VG → LV abstraction — it is a model,
not a discoverable fact. An app offering only trial and error leaves the user
stuck at a prompt with no path forward, which is the worst possible study
experience.

The resolution is the **disclosure ladder** (§7): the user always has a way
forward, and always pays for how far down it they go. Conceptual teaching exists
as first-class content (§6.1) but is pulled rather than pushed.

Approximate balance: **60% practice, 40% teaching.**

### Non-goals

- **Not a Linux simulator.** No pattern-matching of typed commands. All commands
  execute on a real kernel.
- **Not multi-user.** No accounts, no auth, no server, no instructor view. One
  user, one VM, localhost.
- **Not a flashcard app.** Concepts are reinforced by scheduling *hands-on tasks*
  that require them, never by recall prompts. Considered and rejected — it would
  contradict the entire premise.
- **Not comprehensive Linux education.** Scope is bounded by the EX200
  objectives. No kernel internals, no full boot-chain theory.
- **Not automated OS installation.** The VM is built once by hand from a
  checklist; snapshots are the reset mechanism thereafter.

---

## 2. Context and prior decisions

Established during design and treated as fixed:

| Decision | Value | Rationale |
|---|---|---|
| Lab target | VMware Workstation 25.0.1 VM, local | Only option with full objective coverage (LVM, GPT, boot, GRUB, networking) |
| Guest OS | RHEL 9, free Developer Subscription | Matches the targeted exam version |
| Control plane | SSH primary, `vmrun` fallback | Neither channel alone covers the objective list |
| Scope | Single user | Explicitly chosen; no multi-user affordances anywhere |
| Curriculum spine | The 28-chapter, 4-phase program table | Externally supplied; app mirrors it |
| Timeline | 3+ months, no exam date booked | Permits full coverage and troubleshooting depth |
| Role of the books | **Reference and source corpus only** | The app, not the book, is the study surface |

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

Two Cert Guide editions are available. Both are **reference material to be mined**
— neither is assigned reading.

| Item | RHCSA 9 | RHCSA 10 |
|---|---|---|
| Pages | 944 | 990 |
| Chapters | 28, in 5 parts | 27, in 5 parts |
| Unique labs (`Lab N.M`) | 30 | 28 |
| Unique exercises (`Exercise N-M`) | 95 | 85 |
| Practice exams | 4 (A–D) | 4 (A–D) |
| Objective→chapter mapping table | p. 38 | p. 42 |

Chapters 1–25 align 1:1. The lab delta is **exactly −2**, and both absent labs are
precisely the removed content: RHCSA 9's `Lab 15.2` (Stratis) and `Lab 26.1`
(containers). Every other lab ID appears in both editions. This is independent
structural confirmation of the term-frequency delta measured below.

Exercise IDs also overlap heavily: **84 appear in both editions**, 11 are RHCSA 9
only, 1 is RHCSA 10 only — 96 distinct slots, 180 total instances. Those 84
overlapping IDs are the corpus's single most valuable asset (§14.4). Caveat:
1:1 chapter alignment makes a shared ID a strong signal of a shared topic, not a
guarantee of identical content; each pair is confirmed at transcription time.

**RHCSA 9 is primary** — it matches the program table and the targeted exam
version. RHCSA 10 is exploited four ways (§14.4).

**Caveat on the RHCSA 10 edition:** it is an *Early Release* — unedited
prepublication text. Its table of contents is reliable for structural questions;
its prose is not authoritative. The validation harness (§8) mitigates this: bad
source material fails loudly against a real VM rather than propagating silently.

**Corpus role assignment:**

| Source | Becomes |
|---|---|
| End-of-chapter labs (58 instances, 30 slots) | Graded task prompts |
| Guided exercises (180 instances, 96 slots) | Guided-mode walkthroughs **and** `solutions/` sources |
| Chapter prose | Compressed into concept cards (§6.1) |
| Objective→chapter tables | `objectives.yaml` |
| Practice exams (8 across editions) | Mock exams, incl. two sealed holdouts |

RHCSA 9 Chapter 28 is a *theoretical* pre-assessment (knowledge questions, not
tasks) and produces no graded tasks.

### Assumption carrying material risk

**The user will sit the RHEL 9 revision of EX200.**

Raised twice during design; the user elected RHEL 9 both times. That decision
stands and drives this design.

With both editions available, the RHEL 9 → 10 delta is **measured rather than
inferred** (term frequency across full-text extraction, 2026-08-26):

| Topic | RHCSA 9 | RHCSA 10 | Change |
|---|---|---|---|
| `podman` | 215 | 4 | **Containers objective removed** |
| `container` | 265 | 17 | removed |
| `Flatpak` | 0 | 57 | **added** |
| `stratis` | 143 | 1 | **removed** |
| `vdo` | 2 | 0 | already absent |
| `autofs` | 28 | 61 | **expanded** |
| `GPT` | 65 | 45 | retained |

Structural confirmation: RHCSA 10 has 27 chapters. "Managing Containers" is gone;
Ch 15 is retitled from "Managing Advanced Storage" to "Managing Logical Volumes".

**Consequence, quantified.** Containers is a full chapter with 215 `podman`
references — a graded objective under RHEL 9, worthless under RHEL 10. Flatpak
runs the other way, with zero RHCSA 9 coverage. The version question governs
roughly a chapter of effort in each direction.

**Mitigation:** every `task.yaml` and concept carries `rhel: 9`. Unused by the
initial implementation. If the version flips, container tasks are re-tagged
`out-of-scope` and Flatpak content is authored from the RHCSA 10 edition and Red
Hat documentation — additive, not a restructuring.

**Trigger to revisit:** the moment an exam is booked and its version confirmed.
This remains the project's highest-value unknown.

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
│  │    content/     tasks + concepts, loading, linking │    │
│  │    grading/     run graders, parse JSONL verdicts  │    │
│  │    disclosure/  ladder state, rung accounting      │    │
│  │    scheduler/   FSRS over objectives + concepts    │    │
│  │    exam/        mock-exam composition, triage      │    │
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
harness testable without a browser, and is what makes CI possible.

---

## 4. VM provisioning

### 4.1 One-time manual install

Delivered as a checklist document, not code. The VM is built once; automating a
20-minute interactive install has near-zero payoff, and building a kickstart ISO
under WSL is obstructed by the absence of `genisoimage`.

| Setting | Value | Reason |
|---|---|---|
| vCPU / RAM | 2 vCPU / 4 GB | Host has 15 GB; WSL capped to 4 GB via `.wslconfig` |
| Disk 0 | 40 GB, LVM | System. Sized to leave free extents in the VG for resize labs |
| Disks 1–3 | 2 GB, 2 GB, 8 GB | Spares for partitioning, PV/VG/LV, swap, multi-disk VG labs |
| Firmware | BIOS | Simpler GRUB labs. `rd.break` and `init=/bin/bash` procedures are identical under UEFI, so nothing exam-relevant is lost |
| Network | NAT (VMnet8) | See risk R1 |
| Guest tools | `open-vm-tools` | Mandatory — `runProgramInGuest` depends on it |
| SELinux | `enforcing` | Exam default. Never relaxed |

Spare disks are created with `vmware-vdiskmanager.exe` and attached by editing
the `.vmx`.

### 4.2 `provision.sh` — idempotent, run once

1. Create the study user; install a sudo rule.
2. Install the SSH public key from `~/.ssh/rhcsa_lab`.
3. Install every package the task bank needs, up front: `open-vm-tools`,
   `podman`, `nfs-utils`, `autofs`, `tuned`, `policycoreutils-python-utils`,
   `setroubleshoot-server`, `chrony`, `firewalld`, `httpd`.
4. Configure a local dnf repository backed by the mounted install ISO. Serves
   three purposes: labs work with no internet, it mirrors the "configure
   repository access" objective, and it is what makes offline mode (§10.3)
   possible without breaking package tasks.
5. Zero the spare disks.
6. Enable `sshd`.

### 4.3 Snapshot ladder

| Snapshot | Role |
|---|---|
| `golden` | Taken immediately after provisioning. Never modified. Rebuild point |
| `clean` | Per-lab reset target. **Taken powered-on, with memory included** |

Reverting to a live snapshot restores an already-booted machine in roughly 5
seconds versus 30+ for a cold boot. Cheap resets are what make repeating the same
LVM task six times tolerable rather than avoided.

Labs asserting persistence still perform a genuine reboot — that is their point.

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
`open-vm-tools` running, but survives a destroyed network stack.

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

`reboot()` prefers in-guest `systemctl reboot` and polls for SSH to return, with
a 120-second timeout and `vmrun reset` as an escape hatch.

### 5.3 Terminal channel

Independent of `exec`. `node-pty` spawns `ssh -t`, streamed over a WebSocket to
xterm.js. Multiple concurrent terminals permitted — the real exam provides a full
desktop and two shells is realistic.

### 5.4 Grading sequence

1. Run `grade.sh` → **verdict A** ("works now").
2. If `reboot_check` is set and verdict A contains at least one pass: reboot,
   poll for SSH, 120-second timeout.
3. Run `grade.sh` again → **verdict B** ("survives reboot").
4. Report both. Any checkpoint transitioning **pass → fail** is flagged
   prominently as a persistence failure, naming the configuration file the change
   belonged in.
5. If the VM never returns, that is itself a result — the user broke boot. Show
   console instructions and offer a revert to `clean`.

Step 4 is the highest-value output in the system. The most common way competent
candidates fail EX200 is completing a task in the running system without
persisting it: a `mount` absent from `/etc/fstab`, a `sysctl` not written to
`/etc/sysctl.d/`, a working-but-not-`enable`d service, a `firewall-cmd` without
`--permanent`. The real exam reboots before grading.

### 5.5 Stale-state guard

SQLite records which task's `setup.sh` is currently applied. Grading task X while
task Y's setup is live is refused, with an offer to reset. Without this guard the
user receives pages of inexplicable failures on correct work and loses confidence
in the grader.

---

## 6. Content model

Two first-class content types, both files on disk, both git-diffable.

### 6.1 Concepts

Conceptual teaching is a **reusable content type, not per-task prose.** If
teaching lived inside each task, "what is a logical volume" would be written
fifteen times and rot in fifteen places.

```
concepts/storage/lvm-abstraction-stack.md
concepts/storage/why-xfs-cannot-shrink.md
concepts/selinux/file-contexts-vs-labels.md
concepts/systemd/enabled-versus-started.md
```

```yaml
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.create, storage.lvm.resize]
sources: [r9:ch15, r10:ch15]      # provenance, for revision
prerequisites: [storage.partitions]
---
200-300 words. The mental model, not the command reference.
```

Target: **40–60 cards.** Authored by compressing chapter prose — extracting the
250 words that matter from a 30-page chapter. This is the artifact that replaces
reading the book.

Three properties follow from concepts being first-class:

- the app knows which concepts the user was **told** versus **solved cold**
- a repeatedly-needed concept raises the scheduling priority of *tasks requiring
  it* (§9.2) — reinforced by hands-on work, never by recall prompts
- a **concept graph** gives a live map of what is not yet understood, derived from
  actual failures rather than a book's table of contents

### 6.2 Concept coverage — the safety net

Abandoning the book costs one thing: its linear structure guaranteed every topic
was *encountered*. A pure task bank can silently skip material.

First-class concepts close this. The app can assert: **"you have never been
taught, and never demonstrated, autofs."** Coverage becomes checkable rather than
assumed — replicating the only real advantage a linear book had.

### 6.3 Tasks

```
tasks/storage/014-shrink-home-grow-var/
  task.yaml
  setup.sh
  grade.sh
  solutions/
    01-lvextend-xfs_growfs.sh      # from r9:Exercise 15-3
    02-systemd-mount-unit.sh       # from r10:Exercise 15-2
  antisolutions/
    01-forgot-growfs.sh            # expect fail: fs-size
    02-no-fstab-entry.sh           # expect fail: persist (post-reboot only)
    03-chcon-not-semanage.sh       # expect fail: selinux-survives-relabel
  explanation.md                   # task-specific narration only
```

```yaml
id: storage/014-shrink-home-grow-var
title: Reclaim space from /home and give it to /var
chapter: 15
scope: exam-objective              # exam-objective | instrumental
rhel: 9
objectives: [storage.lvm.resize, storage.fs.xfs]
requires_concepts:
  - storage.lvm-abstraction-stack
  - storage.why-xfs-cannot-shrink
difficulty: 3                      # 1-5
time_budget: 480                   # seconds, exam-realistic
weight: high                       # see §14.4 for how this is derived
editions: [r9, r10]                # presence in each edition
reboot_check: true
requires_disks: 0                  # grows from free extents already in the VG
claims: [vg:rhel, lv:var]          # resources owned; used by exam composer
transport: ssh
prompt: |
  /var is nearly full while /home is mostly empty. Grow the var
  logical volume to at least 6 GB. All filesystems must mount
  correctly on boot.
```

### 6.4 Task scope categories

| `scope` | Meaning | Action |
|---|---|---|
| `exam-objective` | Maps to a published EX200 objective | Include |
| `instrumental` | Teaches an objective through a non-objective service | Include, exclude from coverage math |
| — | Maps to no objective | Do not author |

`instrumental` exists because of Chapter 21 (Apache). `httpd` is not an EX200
objective, but both editions use it as a vehicle for SELinux contexts, firewalld,
and systemd units — all of which are. A rule deleting every task without an
objective mapping would wrongly cut it.

### 6.5 Grader contract

`grade.sh` runs as root in the guest and emits one JSON object per line:

```
{"id":"lv-var-size","desc":"var LV is >= 6G","status":"pass"}
{"id":"fstab-persist","desc":"/var mounts from fstab","status":"fail","detail":"no entry found"}
```

`status` is one of `pass` | `fail` | `skip`. `detail` and `weight` optional.

Four rules:

1. **Grade end state, never commands.** Bash history is never inspected *for
   grading*. The exam does not care whether the user chose `nmcli`, `nmtui`, or a
   hand-written keyfile, and neither does this grader. This rule is what makes the
   grader accept every valid path instead of training one brittle habit. See
   §10.5 for the strictly separated coaching exception.
2. **Read-only.** Graders inspect; they never repair.
3. **Exit code ignored.** One failing check must not abort the remainder.
4. **Idempotent.** Grading is repeatable mid-work.

Graders verify the *full* correct end state, not merely the literal ask. "Grow
/var" additionally confirms `/home` still mounts and no orphaned `fstab` entries
were left behind. The real exam has no obligation to look only where the
candidate was working.

### 6.6 Assertion library

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

This library is the project's main leverage. With it, authoring task #40 takes ten
minutes rather than an hour.

### 6.7 Fault-injection tasks

`setup.sh` may deliberately break the system: a bad UUID in `/etc/fstab`, the
wrong SELinux context on `/var/www/html`, a masked service, a `sudoers` typo, a
firewall rule blocking a required port.

These troubleshooting scenarios are the highest-value tasks in the bank and are
only practical because reset is cheap.

---

## 7. The disclosure ladder

The mechanism that makes book-free learning viable. The user always has a way
forward, and always pays for how far down they go.

| Rung | Content | Cost |
|---|---|---|
| 1 | The task, cold | none |
| 2 | **Nudge** — *"this is an LVM problem; the relevant tools start with `lv`"*. Orientation, no method | small |
| 3 | **Concept card** — the linked `requires_concepts` content. The book replacement | moderate |
| 4 | **Command sketch** — tools involved, no arguments | large |
| 5 | **Full solution**, narrated | full |

The rung reached is recorded on the attempt and drives the FSRS rating (§9.2),
which is strictly better data than a hint counter: it distinguishes *"needed
orientation"* from *"did not have the concept"* from *"could not assemble the
commands."* Those are three different deficits with three different remedies.

Rung availability is per mode:

| Mode | Max rung | Reason |
|---|---|---|
| Guided | n/a | Guided mode *is* full disclosure by construction |
| Practice | 5 | Learning mode; getting unstuck matters more than the score |
| Drill | 3 | Concept cards stay available — a forgotten concept is exactly what drill exists to catch — but assembling the commands must be unaided, or the recall being tested is not happening |
| Mock exam | 2 | The real exam offers orientation from `man` and nothing else |

### 7.1 Post-attempt teaching is mandatory

After every attempt — pass or fail — the user receives the explanation, the
linked concept cards, and the alternative solution paths from `solutions/`. This
is not optional and not skippable, because it is the primary teaching moment.

### 7.2 Anti-solutions as live demonstrations

`antisolutions/` are built to validate graders (§8). They double as the best
teaching asset in the system at **zero additional authoring cost**.

After a task completes, the app can *execute* the wrong approach on the VM and
show it break:

> Here is `chcon` instead of `semanage fcontext`. It works now. Now watch a
> relabel. Now it is broken.

A book can only assert this. Demonstrating it on a real machine is the single
strongest argument that the app can replace reading.

Implementation: revert to `clean`, run `setup.sh`, run the anti-solution, grade
(showing passes), reboot or relabel, grade again (showing the failure). Reuses
existing machinery entirely.

---

## 8. Validation harness

`rhcsa validate` proves the grader is correct before the user trusts it.

For each task, for each of pre-reboot and post-reboot:

| Fixture | Required result |
|---|---|
| No action taken | all checkpoints fail |
| Each file in `solutions/` | **all** checkpoints pass |
| Each file in `antisolutions/` | **exactly** its declared checkpoint IDs fail |

Anti-solutions declare which checkpoint IDs they expect to fail, so the harness
asserts *the correct check caught the error*. A grader failing for the wrong
reason is still broken.

**Why multiple solutions.** If solution 02 fails, the grader is over-fitted to one
author's habits. The exam accepts any correct path; a grader that does not would
quietly train the user into a single brittle approach. Having two editions makes
these second paths *authoritative transcriptions* rather than inventions (§14.4).

**Why anti-solutions matter more.** A false negative is an annoyance. A false
positive — reporting pass on incorrect work — is how a candidate walks into the
exam confident and fails. Every row below is a documented way to lose points:

| Near-miss | Must be caught by |
|---|---|
| Resized the LV, did not grow the filesystem | `fs-size` |
| Mounted it, no `fstab` entry | `persist` (post-reboot only) |
| `firewall-cmd` without `--permanent` | `persist` |
| `chcon` instead of `semanage fcontext` + `restorecon` | `selinux-survives-relabel` |
| `systemctl start` without `enable` | `service-enabled` |
| Correct work, wrong disk | `target-device` |

Additional coverage assertions:

- every concept in `concepts/` is referenced by at least one task
- every `requires_concepts` entry resolves to an existing concept
- every published objective has at least one `exam-objective` task

The harness runs in CI over the entire bank so a broken checkpoint cannot rot
silently. It also insulates the project from the RHCSA 10 Early Release's
unreliability: bad source material fails against a real VM rather than
propagating.

---

## 9. Study engine

### 9.1 Modes

**Guided** — first contact with an objective. Sourced from the 180 guided exercise
instances across both editions. The app shows a command, **the user types it**
(typing, not clicking — muscle memory is the point), and each step is verified
before advancing. The unguided lab follows days later via drill.

**Practice** — untimed, full disclosure ladder available, unlimited grading.

**Drill** — spaced repetition. **FSRS schedules at the level of objective, not
task.** Scheduling tasks would let the user re-see task 014 and recall the answer,
which is memorisation. Instead the scheduler selects a due *objective*, then
samples a task tagged with it that has not been seen recently. Same skill,
unfamiliar wrapper.

**Mock exam** — no ladder above rung 2, no per-task grading, one timer. §9.3.

### 9.2 Scheduling

FSRS ratings are **derived from grading and rung reached, never self-reported** —
self-rating is unreliable and invites gaming:

| Outcome | Rating |
|---|---|
| Solved cold (rung 1), within time budget | Easy |
| Solved cold but over budget, or needed rung 2 | Good |
| Needed rung 3, or partial pass | Hard |
| Needed rung 4–5, mostly failed, **or any reboot-check regression** | Again |

**Concept reinforcement.** A concept needed at rung 3 more than once raises the
scheduling priority of tasks that require it. Concepts are never drilled as recall
prompts — they are reinforced by doing work that depends on them.

### 9.3 Mock exams

Composes a task set matching the objective distribution by weight and fitting the
time budget, runs all `setup.sh` scripts up front (the real exam hands over one
pre-configured machine), then performs a single reboot and grades everything at
the end.

**Composition constraint:** two tasks cannot both claim `/dev/sdb` or both create
user `alice`. The `claims` field prevents impossible sessions.

### 9.4 Readiness reporting

Per objective: attempts, pass rate, mean time against budget, rung dependency, and
**persistence-failure rate**.

Reported as a defensible statement, not a manufactured percentage:

> Objectives at passing confidence: 14/22.
> Weakest: SELinux contexts (2/6 clean), autofs (never attempted).
> Concepts never taught or demonstrated: 3.

It reports bluntly when the user is not ready. A study tool that flatters is worse
than no study tool.

**Calibration gates the readiness claim itself** (§10.2). If the user is badly
calibrated, their self-assessment is noise and the app discounts its own readiness
estimate and says why. An instrument that reports its own error bars is worth more
than one that does not.

**When to stop.** If readiness holds across both sealed holdouts, the app says
*book the exam.* Over-preparation has a real cost, and a study tool that never says
"you are done" will happily consume months.

---

## 10. Exam-craft training

Almost nobody fails EX200 for lack of knowing a command. They fail because they
over-invested in one task, were certain they had finished when they had not, had
never worked without a browser, or half-finished many tasks when half-credit does
not exist. None of these is addressed by any book. All are trainable.

### 10.1 Time triage drills

**Does not touch the VM** — a paper exercise, so a session costs seconds.

The app presents ~18 task prompts weighted to resemble a real exam, allows 90
seconds, and asks for an ordering plus a per-task time estimate. Scored against
three things:

| Scored against | Catches |
|---|---|
| The user's own historical times per objective | Systematic underestimation — a specific, correctable bias |
| Feasibility against 150 minutes | If estimates sum to 210, a *skip plan* was required; the drill identifies which |
| Ordering quality vs. optimal | Expected points under the user's ordering, using real pass rates and times, against the best ordering of the same set |

Output: *"Your ordering yields 240/300 expected. Optimal is 285. You placed three
low-confidence, high-cost tasks in the first third."*

**This feature compounds** — worthless in week one, sharp by week six, because it
runs on accumulated history. It therefore lands in Phase 3, after attempt
recording exists.

### 10.2 Confidence calibration

One click before grading: confident pass / unsure / fail. Stored on the attempt.

|  | actually passed | actually failed |
|---|---|---|
| **predicted pass** | calibrated | **overconfident** |
| **predicted fail** | underconfident | calibrated |

Each quadrant implies a different remedy, which is the point:

- **Overconfident** → a *verification* problem, not a knowledge problem. Remedy is
  habit drills, not more study. Studying harder would waste weeks.
- **Underconfident** → knows more than they think, burning exam time
  double-checking correct work. Remedy is to move faster. Feeds triage.

**Cross-referenced with the reboot check:** if overconfident failures cluster on
persistence checkpoints, the diagnosis is not "verify more" but *"you believe you
are finished before you have made it permanent"* — one specific habit, one
specific fix.

Nearly free to build and the sharpest diagnostic in the system.

### 10.3 Enforced offline mode

In drill and exam modes the VM's default route is dropped. Package tasks continue
to work because §4.2 configures a local ISO-backed dnf repository.

**Honest limit:** this cannot stop the user opening a browser on the host. It is a
habit device, not a cage. What it does is kill the reflex — `curl`, internet
`dnf`, and pasting URLs all fail, making `man` and `/usr/share/doc` the path of
least resistance. The habit is the thing being trained.

Enables a specific drill: *here is a task; find the answer using only `man` and
`/usr/share/doc`.* Locating information under exam constraints is a distinct skill
from knowing the answer.

### 10.4 Partial-credit feedback

RHCSA scores per task, essentially all-or-nothing: a half-finished task is worth
zero, so finishing 12 completely beats starting 18. Mock exam reports state it in
those terms:

> You left 4 tasks partially complete, worth 0 points. Fully finishing 2 of them
> instead of starting 4 would have scored higher.

Pure report computation, no new machinery. One line of the user's own data
reframes exam strategy more effectively than advice.

### 10.5 Verification-behaviour coaching (Phase 4)

Detect whether verification commands (`mount -a`, `systemctl is-enabled`,
`firewall-cmd --list-all`) were run before grading, and whether logs were
consulted before guessing on troubleshooting tasks.

**Boundary, enforced in code:** §6.5 forbids graders from reading shell history,
and that stands — grading from history is what makes a grader accept only one
path. Reading history to *coach behaviour* is a different question with a
different answer. The grader never sees history; the coach never affects the
score. Separate modules, no shared surface, so the rule cannot erode.

### 10.6 Interacting task pairs (Phase 4)

Books present isolated labs. On the real exam a firewall change in task 7 breaks
an NFS mount in task 12. Mock exams already share one machine so interaction
occurs incidentally; a subset of tasks will be authored to interact
*deliberately*. This is a fidelity gain no book can offer, because a book cannot
give the reader one shared machine.

### 10.7 Considered and rejected

**Chaos mode** — sabotaging the VM mid-task. Cut: the exam does not sabotage the
candidate, their own earlier task does, which §10.6 models honestly.

---

## 11. User interface

Six screens. Navigation: **Dashboard · Learn · Lab · Track · Exams · Concepts**.

Task and concept authoring stays in the CLI (`rhcsa new-task`, `rhcsa new-concept`,
`rhcsa validate`).

**Dashboard** — readiness statement, today's drill queue, weakest objectives,
untaught concepts, sealed-holdout status, VM status.

**Learn** — guided mode (§9.1): step, command, type it, verified.

**Track** — the 28-chapter program table in four phases. Ticks are **derived** from
task results and are not clickable. Duration auto-filled from summed
`time_budget`.

**Concepts** — the concept graph: taught, needed-again, demonstrated-cold, never
encountered. The personalised replacement for a book's table of contents.

**Exams** — eight practice exams with assigned roles, triage drills, past reports.

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
   var  rhel 2.00g         | rung 1 of 5
 [root@labvm ~]# _         | [Grade]  ^G
                           | [Hint]   ^H
                           | [Reset]  ^R
----------------------------------------------
```

Full prompt text remains visible above the terminal. Exam tasks are multi-part and
a frequent way to lose points is answering two of three parts.

### Four UI rules

1. **VM state is always visible** — snapshot, power state, applied task. Confusion
   about machine state is the largest time-waster in any lab setup.
2. **Checkpoint details are hidden until grading.** Displaying "filesystem grown /
   persists across reboot" beforehand hands over the solution outline. Pre-grade
   the user sees only a count.
3. **Current rung is always visible**, so the cost of asking for help is never a
   surprise.
4. **Keyboard-first; the terminal is never modal.** `^G` grade, `^H` next rung
   (confirmed), `^R` reset. Grading runs in the background and the shell stays
   live.

Visual treatment: dark, monospace-dominant, low chrome. It should read as a
terminal tool, not a SaaS dashboard.

---

## 12. Data model (SQLite)

Holds only user history. Content lives on disk. This split allows the entire task
and concept bank to be rewritten, renumbered, or regenerated without a migration,
while history survives.

| Table | Columns of note |
|---|---|
| `attempts` | task_id, mode, started_at, finished_at, duration_s, **rung_used**, **predicted_outcome**, verdict_a (JSON), verdict_b (JSON) |
| `objective_state` | objective_id, FSRS params, due_at |
| `concept_state` | concept_id, first_shown_at, times_needed, last_needed_at, demonstrated_cold |
| `triage_sessions` | task_ids (JSON), user_order (JSON), user_estimates (JSON), scores (JSON) |
| `exam_sessions` | source (e.g. `r9-A`), role, started_at, finished_at, composition (JSON), report (JSON) |
| `vm_state` | current_task, current_snapshot, applied_at |

No `user_id` anywhere.

---

## 13. Curriculum mapping

The supplied program table maps directly onto the design:

| Table column | Design element |
|---|---|
| Coverage (Chapter N) | `chapter:` field → linear track view |
| Learning Focus | objective tags + `requires_concepts` |
| Expected Outcome | the checkpoint list |
| Duration (hrs) | computed from summed `time_budget` |
| Per-person checkbox | derived mastery, not clickable |
| Practice Test ×4 | mock exam sessions |

**Practice exam allocation.** Eight exams are available across the two editions,
so roles are assigned rather than all being saved for the end:

| Exam | Role |
|---|---|
| R9-A | **Diagnostic baseline, before study begins.** Expected to go badly; that is the point. Calibrates the readiness model on day one and identifies chapters that can be moved through quickly |
| R9-B, R9-C, R10-A, R10-B | Mid-program checkpoints |
| R10-C | Reserve |
| **R9-D, R10-D** | **Two sealed holdouts.** Neither opened nor mined for tasks until readiness is claimed |

Two independent holdouts rather than one is the material improvement: one holdout
yields a single pass/fail signal on whether the app's readiness claim is honest;
two distinguish a fluke from a real result.

R10 exams require filtering — they contain Flatpak tasks (skip under RHEL 9) and
no container tasks (supplement from R9).

**Linear and non-linear views coexist.** Track is strictly sequential (Chapter 1 →
28). The drill queue is deliberately not — it resurfaces Chapter 6 sudo while the
user works through Chapter 15 LVM. Both are needed.

---

## 14. Validity strategy

### 14.1 Is the grader correct? (solvable)

§8. Multiple independent solutions plus declared-failure anti-solutions, run pre-
and post-reboot, in CI.

### 14.2 Are the tasks faithful? (solvable via proxies)

Real exam items are confidential. Anchors, in priority order:

1. **Red Hat's published EX200 objectives** for RHEL 9 — the contractual statement
   of what is testable. Every task maps to at least one objective ID.
2. **Both Cert Guide editions** — end-of-chapter labs, closest public match to
   real phrasing and scope.
3. **RH124 / RH134 course outlines** — define expected *depth* per objective.
4. **Offline-solvability rule.** The exam provides only `man`, `--help`, and
   installed documentation. For every task the author must be able to name the man
   page leading from prompt to solution. If they cannot, the task is mis-scoped
   and is rewritten or cut. This catches tasks that silently require an external
   article. §10.3 trains the same constraint.

### 14.3 Does passing predict passing? (partially solvable)

**The two sealed holdouts are the mechanism.** If the app claims 18/22 objectives
and a holdout is failed, the calibration is wrong and the app is lying to the
user — far better discovered weeks early than on exam day.

Supporting checks:

- **Time calibration.** EX200 runs approximately 2.5 hours. If a full-coverage
  task set sums to four hours of `time_budget`, difficulty estimates are
  systematically wrong.
- **Self-correcting weights.** First-try passes across an entire objective indicate
  its weight was too high. Attempt data adjusts estimates.
- **Confidence calibration** (§10.2) bounds how much the readiness figure should
  be trusted at all.
- **Checkpoint disputes.** A one-click action dumps relevant system state when the
  user believes a `fail` verdict is wrong. These are the bug reports that find
  over-fitted graders — and the user is the only tester this system will have.

### 14.4 Exploiting both editions

Chapters 1–25 align 1:1, giving two independently-authored treatments of the same
material. Four uses:

1. **Cross-edition presence as a weight signal.** Content in *both* editions is
   durable core RHCSA material; content in one is version-specific. Recorded as
   `editions: [r9, r10]` and used to seed `weight`. This replaces guesswork in the
   part of the system that estimates readiness, at near-zero cost — it is computed
   once during Phase 0 corpus extraction.
2. **The other edition's exercise becomes an additional `solutions/` file.**
   Second paths become authoritative transcriptions rather than inventions,
   directly strengthening the anti-over-fitting mechanism of §8. The **84
   exercise IDs present in both editions** (§2) are the supply, and they are why
   the multiple-solutions requirement of §8 is affordable rather than aspirational.
3. **Eight practice exams**, enabling two sealed holdouts (§13).
4. **Dual labs for high-weight objectives only.** Doubling every task doubles
   authoring for no benefit on low-weight material. Applied selectively where
   drill mode genuinely needs variety.

### 14.5 Stated limits

1. The item pool cannot be guaranteed to match. Only objective coverage and
   end-state grading methodology can be.
2. Graders are stricter in one direction (reboot-checking everything) and possibly
   looser in another (the exam may verify something unanticipated). §6.5's
   full-end-state rule is the mitigation.
3. No grader tests judgment under time pressure. Timed mock exams and §10.1 are
   imperfect proxies.
4. Difficulty weights begin as estimates, now seeded by §14.4's edition signal.
5. The app teaches only what EX200 examines. It is not a Linux education.

---

## 15. Technology

| Concern | Choice |
|---|---|
| Runtime | Node 22, TypeScript |
| API | Hono |
| Front end | Vite, React, Tailwind |
| Terminal | xterm.js, `ws`, `node-pty` |
| Storage | `better-sqlite3` |
| Content | YAML front matter + Markdown (`js-yaml`, `gray-matter`) |
| Graders | Bash, JSONL output — deliberately language-agnostic |
| Scheduling | FSRS |
| Tests | Vitest for the engine; `rhcsa validate` for the content bank |

---

## 16. Phased delivery

The design describes the full system. Implementation is deliberately phased so
real graded practice begins on day one rather than in week three — a study tool
under construction is a comfortable way to avoid studying.

**Phase 0 — Foundations**
- ~~Install poppler and confirm both editions' structure~~ **done 2026-08-26**.
  See §2 source corpus.
- `objectives.yaml`: the full RHEL 9 EX200 objective taxonomy with stable IDs,
  transcribed visually from the RHCSA 9 mapping table (p. 38), cross-checked
  against Red Hat's published RHEL 9 list. Also transcribe the RHCSA 10 table
  (p. 42) into `objectives-rhel10.yaml` so the R2 delta is enumerated.
- Extract the 58 lab instances and 180 exercise instances to `corpus/` as
  structured raw input, tagged by edition and keyed by ID so the 84 cross-edition
  exercise pairs are linked — this also produces the §14.4 weight signal.
- VM build checklist and `provision.sh`; `golden` and `clean` snapshots.
- Verify WSL2 → VMnet8 reachability (risk R1).

**Phase 1 — Thin vertical slice**
- `engine/vm`: both transports, fallback selection, lifecycle, reset.
- `engine/content` + `engine/grading`: loaders, JSONL parser, `lib/assert.sh`.
- `engine/disclosure`: the five-rung ladder.
- Five real tasks with full `solutions/` and `antisolutions/`, plus their concept
  cards — spanning storage, users, SELinux, systemd, and one fault-injection
  scenario.
- `rhcsa validate` and the CLI.
- Lab screen: prompt, terminal, ladder, grade, reset, reboot-check.

**Exit criterion:** the user completes a real graded LVM lab end to end, including
the reboot check, having learned the concept from a concept card rather than a
book.

**Phase 2 — Learning surface**
- SQLite schema, attempt recording, stale-state guard.
- Guided mode from the exercise corpus.
- Concept cards to ~40, with the concept graph and coverage assertions.
- Anti-solution demonstrations (§7.2).
- Offline mode (§10.3); confidence-calibration capture (§10.2).
- Dashboard, Learn, Concepts screens.

**Phase 3 — Study engine and bank build-out**
- FSRS scheduler over objectives, with concept-driven priority; drill mode.
- Grow toward ~120 tasks, authored chapter by chapter alongside study. Authoring a
  grader's checkpoint list requires knowing precisely what correct looks like, so
  this work is itself studying.
- Mock exam composer with `claims` collision avoidance.
- Partial-credit feedback (§10.4); triage drills (§10.1); calibration reporting.
- Track and Exams screens.
- Diagnostic baseline exam (R9-A).

**Phase 4 — Calibration and craft**
- Mid-program checkpoint exams; weight self-correction.
- Verification-behaviour coaching (§10.5).
- Interacting task pairs (§10.6).
- Sealed holdouts (R9-D, R10-D) when readiness is claimed.

---

## 17. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | WSL2 cannot reach the VM on VMnet8 | Blocks SSH transport and the terminal | Verify in Phase 0. Fallbacks: bridged networking, VMware NAT port-forward, or `vmrun`-only operation |
| R2 | Exam is actually the RHEL 10 revision | ~1 chapter stale in each direction; Flatpak absent; dnf5 differences | `rhel: 9` field from day one makes version filtering additive. RHCSA 10 edition on hand as the Flatpak source. Revisit on booking |
| R3 | Host memory pressure (15 GB total) | Sluggish VM or WSL | Cap WSL at 4 GB via `.wslconfig`; VM at 4 GB |
| R4 | Graders over-fitted to one solution | Trains brittle habits | Multiple `solutions/` required per task, sourced from both editions; enforced by `validate` |
| R5 | Authoring becomes procrastination | No actual studying happens | Phase 1 exit criterion is a working graded lab. Authoring paced alongside chapter study. The 180 exercises make `solutions/` transcription; concept cards are compression of existing prose |
| R6 | `open-vm-tools` down in boot-level labs | Neither transport available | Expected and handled: app directs the user to the VMware console and offers a revert |
| R7 | Concept cards under-written, leaving the user stuck with no book | The core promise fails | Coverage assertions in `validate`: every task's `requires_concepts` must resolve, and untaught concepts appear on the Dashboard. A missing card is visible, not silent |
| R8 | RHCSA 10 Early Release contains errors | Bad tasks or solutions | `validate` runs every solution against a real VM; functional errors fail loudly. R10 prose is not treated as authoritative |

---

## 18. Open items

None blocking. Two items are Phase 0 deliverables rather than unresolved design
questions:

- The objective taxonomy is a Phase 0 artifact (`objectives.yaml`), transcribed
  from the editions' mapping tables rather than recalled.
- Exam duration and passing score are believed to be 150 minutes and 210/300 but
  were not present on the pages fetched during design. To be confirmed in Phase 0
  and used only for time calibration and §10.1 feasibility scoring.
