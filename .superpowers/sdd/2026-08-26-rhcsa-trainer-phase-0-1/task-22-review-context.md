# Task 22 review context

## What Task 22 is

Task 22 of the RHCSA Lab Trainer Phase 0 + Phase 1 plan. It authors **four graded
lab tasks and eight concept cards** into `content/`. It is a content task: it adds
no engine code. The engine it targets was built and reviewed in Tasks 1-21.

The four tasks:

| path | scope | transport | `reboot_check` |
| --- | --- | --- | --- |
| `content/tasks/users/006-team-provisioning/` | exam-objective | ssh | false |
| `content/tasks/selinux/019-httpd-alt-port/` | instrumental | ssh | true |
| `content/tasks/systemd/017-boot-time-service/` | exam-objective | ssh | true |
| `content/tasks/troubleshooting/028-restore-remote-access/` | exam-objective | vmrun | true |

## Your inputs

Read these, in this order:

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-brief.md` — the
   requirements. Exact values in it are authoritative **except where a mandate
   overrides**, see 2.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-mandates.md` —
   nine mandates I issued with the dispatch. **Mandates supersede the brief.**
   Where the brief and a mandate disagree, the mandate is the requirement and the
   brief is wrong. Do not report brief-vs-mandate divergence as a finding.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-report.md` — the
   implementer's report. Its section 2 is the mandate-9 precondition table, its
   section 6 the deviations, section 7 the judgement calls, section 9 what it did
   **not** verify.
4. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-aae2dca..85bf671.diff`
   — commit list, stat, and full diff with context.

## The commit range contains two commits, not one

- `9d2dc22` — Task 22 proper: 42 files, 1462 insertions, all additions.
- `85bf671` — a **one-line fix to `scripts/guest-provision.sh` that I made, not
  the implementer**, adding `libselinux-utils` to the guest package list. It is in
  your range because it was committed after Task 22 and before the package was
  cut. It is in scope for you to check for correctness, but it is not the
  implementer's work and its absence from the brief is not a finding.

## Verdicts required

Your report must contain **both**, each stated explicitly:

1. **Spec compliance** — PASS or FAIL. Does the delivered content match the brief
   as amended by the mandates?
2. **Task quality** — APPROVE / APPROVE WITH CHANGES / REQUEST CHANGES.

A report missing either verdict will be rejected and re-dispatched.

## Global constraints that bind this task

- **Node 22 native TS stripping, no build step.** `erasableSyntaxOnly`,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. ESM with `.ts` import
  extensions. No `enum`, parameter properties, namespaces, or decorators. No
  non-null `!`. No `as` casts. (Mostly moot here — this task adds no TS — but a
  test or script change is bound by it.)
- **Graders grade end state, not commands.** A grader must never read shell
  history, and must never infer intent from *how* the student got there. Two
  different correct routes must both pass.
- **Graders are read-only and idempotent.** Running a grader must not change the
  state it is grading, and running it twice must give the same answer.
- **Verdict A is "works now"; verdict B is "survives reboot."** A checkpoint that
  passes in A and fails in B is a persistence failure. `@post` in an
  `# expect-fail:` line means "breaks only after reboot".
- **`# baseline-fail:` in `grade.sh` declares the task's goal checkpoints.**
  Invariant checkpoints are emitted but deliberately **absent** from that line,
  because the `kind: 'none'` baseline fixture asserts that everything unlisted
  passes untouched.
- **Every task ships at least 2 solutions and at least 1 antisolution.**
- **SELinux stays `enforcing` in the VM.** No script may set permissive, disable
  SELinux, or relabel its way around policy to make a task pass.
- **Both transports connect as `student`**, and `/etc/sudoers.d/rhcsa-trainer`
  grants `student` passwordless sudo. Every privileged guest-side command is
  written with an explicit, non-interactive `sudo`. No script may assume root.
- **`ck_pass` followed by a word must not appear inside a grader comment** — it
  collides with the grep that inventories checkpoint ids.
- **Objective ids are permanent FSRS scheduling keys.** A task may only reference
  ids that already exist in `content/objectives.yaml`. Adding an objective is
  out of scope for a content task.
- **124 means "timed out"** project-wide.

## Specific things to check

1. **The mandate-9 precondition table (report section 2).** Mandate 9 says: *a
   task's `setup.sh` must verify every precondition its goal checkpoints depend
   on, not only the ones its own commands need in order to run.* For each of the
   four tasks, work from the `grade.sh` goal checkpoints back to the state they
   assume, and check the `setup.sh` actually verifies it. The report's table is a
   claim; verify it rather than accepting it. This mandate exists because
   `storage/014`'s original `setup.sh` did not check that `rhel/home` was the size
   the checklist specifies, so a wrongly-built guest would have produced a
   green-looking pass.
2. **Grader over-fitting.** For each goal checkpoint, ask whether a *different
   correct* route to the same end state passes it. Rank this **below** "the guest
   was not built to `docs/vm-build-checklist.md`" when writing a failure table:
   a mis-built guest is the likelier cause of a surprising result.
3. **`# baseline-fail:` completeness and correctness** for each `grade.sh`: every
   goal listed, no invariant listed, and every listed id actually emitted.
4. **`# expect-fail:` honesty** for each antisolution: does the fixture really
   break exactly the checkpoints it declares, and only those? Pay attention to
   the `@post` ones — an antisolution that fails in verdict A while declaring
   `@post` is a wrong declaration, and that is precisely the bug the implementer
   found in my own draft (deviation D6).
5. **Idempotency of each `setup.sh`.** Deviation D8 exists because a prior
   `solutions/02` run left a `semanage fcontext -e` equivalence rule that made
   `context-permanent` start green. Look for the same class elsewhere.
6. **`solutions/03-primary-group-only.sh`** in `users/006` is filed as a
   *solution*, not an antisolution, on the argument that a primary group is a
   legitimate way to be "in devops". Check the grader really counts primary
   membership. If it does not, the fixture is mis-filed and validate will fail.
7. **Concept cards:** each card's `objectives:` ids must exist in
   `objectives.yaml`. **`checkCoverage` does not check this** — it validates task
   objective ids but not card ones, so a typo is silent. That gap is known and
   forwarded; your job is to catch any typo that is actually present now. The
   implementer says it hand-checked all eight.
8. **Preferring absolute over relative arguments in solutions**, per the mandates.

## Do not

- **Do not run `scripts/provision.sh`.** It powers on a VM and copies 10 GB.
- **Do not run `ssh-keygen` or write anything into `/home/daxtangco/.ssh/`.**
  `provision.sh` resolves `RHCSA_SSH_KEY` against the real `$HOME`, so testing
  past its `:?` guards escapes `/tmp`. A previous reviewer created a real keypair
  there.
- **Do not create or read `.env.local`.** It is git-ignored and may hold the
  user's real VM password.
- **Do not attempt any VM operation.** No VM exists — the RHEL 9 ISO is not
  downloaded. `npm run validate` cannot run and its absence is not a finding;
  Steps 9 and 10 are deliberately deferred by mandate 8. Report section 9 lists
  everything unverified, and that list being long is *correct* for this task.
- **Do not report `shellcheck` findings.** `shellcheck` is not installed on this
  host and five prior tasks have confirmed it. Do not chase it.
- **Do not dispatch subagents.** Do all the work yourself.

## Environment facts you will need

- The Bash tool runs **zsh**. Unquoted `$var` does not word-split. `bash -s <<'EOF'`
  when you need bash semantics. `grep --include='*.ts'` needs the quotes.
- `ls` is aliased to **eza**; use `/bin/ls`.
- npm scripts run under `/bin/sh -> dash`.
- `set -o pipefail` is POSIX-2024 and works in bash and zsh. `${PIPESTATUS[0]}` is
  bash-only and indexes differently in zsh.
- **`sudo` cannot authenticate here — there is no TTY.** Never rely on host root.
- **Mutation testing is this project's standard reviewer technique**, and it is how
  you turn a suspicion into a measurement. Copy the tree to `/tmp` with
  `node_modules` symlinked back, mutate the copy, and run there. The real
  `git status --porcelain` must stay empty. Do not mutate the repo.

## The defect class this project keeps producing

**A tool reporting success when it did not do what was asked.** An assertion that
passes on empty content. A `$?` that reads a `tail`'s status. A grader whose goal
checkpoint was already green before the student touched anything. A precondition
nobody checked. When you are deciding whether something is worth a finding, ask
whether it could make a failure look like a pass — that is the bar.

## Report

Write your full report to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-22-review.md`.

Return to me only: the two verdicts, a count of findings by severity, and any
finding you consider a must-fix before the next task builds on this content.
Everything else goes in the file.

Number your findings `F1`, `F2`, … For each: what it is, where (file:line), how
you measured it — or that you did not measure it and are reasoning — and whether
it must be fixed now or can be forwarded. **If you find that one of my mandates
was wrong, say so directly.** Two of my Task 21 mandates had wrong rationales and
the reviewer catching them was worth more than the mandates were.
