# Task 15 — mandated changes to the brief

Six **required** changes. They override `task-15-brief.md` wherever they conflict;
everything else in the brief stands, including the entire checklist body, its
table of justified settings, and its partition layout — transcribe those verbatim.

This task produces no code and no tests. Its deliverable is a document a human
executes by hand, on a machine that does not exist yet. **So the review gate is
not "does it run" — it is "can a person follow this without getting stuck, and
does every claim it makes about this repo's own scripts happen to be true."**
Two of the mandates below exist because the brief makes claims about
`provision.sh` that the plan's own Task 19 contradicts.

Environment facts, already verified — do not re-establish them:

- `.gitignore` already contains `.env.local`, so the checklist's "(git-ignored)"
  claim is true as written. Leave it.
- `docs/` exists but contains only `superpowers/`. `docs/vm-build-checklist.md`
  is a new file.
- `node src/cli/index.ts coverage` currently **exits 1**, printing:
  ```
  content: 2 problem(s)
    - cannot read directory content/tasks: ENOENT: no such file or directory, scandir 'content/tasks'
    - cannot read directory content/concepts: ENOENT: no such file or directory, scandir 'content/concepts'
  ```
  This is correct and expected — `content/objectives.yaml` exists but no tasks or
  concepts have been authored yet. Mandate 5 covers what the README must say
  about it.

## 1. `README.md` does not exist — you are creating it, not appending to it

The brief's **Files** block says `Modify: README.md` and Step 2 says
`Append to README.md`. **There is no `README.md` in this repo.** I checked:
`git ls-files | grep -i readme` finds nothing and the file is absent from the
working tree. I also grepped every `README` mention in the plan: Task 15 and
Task 25 are the only two, Task 25 opens with *"The README from Task 15 covers
building the VM"* and appends after it, and the plan's own file tree at line 55
labels the file `T15 + T25`. So the plan intends Task 15 to own its creation and
simply mis-states the verb.

**Ruling, already made — implement it, do not re-litigate:** Task 15 creates
`README.md`. Write a short head above the brief's `## Getting started` section so
that Task 25's later append lands in a real document rather than after an orphan
heading. The head is yours to write; keep it to roughly this much and no more:

- an `# RHCSA Lab Trainer` title
- one or two sentences on what the project is: a hands-on trainer for the Red
  Hat RHCSA (EX200) exam that runs graded labs against a local RHEL 9 VM, built
  to be the learning surface itself rather than a quiz bolted onto a book
- a short **Requirements** list: Node 22 or newer (the project uses Node's
  native TypeScript stripping, so there is no build step), VMware Workstation on
  Windows, WSL2, and a RHEL 9 binary DVD ISO from your own Red Hat Developer
  account
- then the brief's `## Getting started` section, with mandate 5's correction

Do not invent features, a roadmap, a licence section, badges, or a contributing
guide. Nothing in the README may describe behaviour that does not exist yet.

## 2. §6 conflicts with Task 19 — the user hand-writes two variables, not four

This is the most important change, and the brief gets it wrong twice.

The brief's §6 shows a four-line `.env.local` block (`RHCSA_VMX`,
`RHCSA_VM_IP`, `RHCSA_SSH_USER`, `RHCSA_GUEST_PASSWORD`) and then, in the very
next paragraph, tells the user to fill in only two of them. Both statements
cannot be the instruction. Worse, the four-line block asks for a value the user
cannot know yet and does not need to supply. From the plan's Task 19
(`scripts/provision.sh`), which is the script that actually consumes this file:

- It **writes a commented `.env.local` template itself if the file is absent**,
  then stops and tells the user to fill in `RHCSA_VMX` and
  `RHCSA_GUEST_PASSWORD` and re-run. Its own comment reads: *"Nothing earlier in
  the plan can create .env.local usefully: RHCSA_VM_IP is discovered by
  provisioning."*
- It **discovers the guest IP** with `vmrun getGuestIPAddress ... -wait` and
  **appends `RHCSA_VM_IP=$IP` to `.env.local` itself**, printing
  `recorded RHCSA_VM_IP in .env.local`.
- `RHCSA_SSH_USER` **defaults to `student`** in the loader
  (`env.RHCSA_SSH_USER ?? 'student'`), so setting it is pointless unless the user
  deviated from the checklist's own instruction to create `student`.

So rewrite §6 to say exactly one thing: the user sets **`RHCSA_VMX` and
`RHCSA_GUEST_PASSWORD`, and nothing else**. State that `provision.sh` creates the
template for them if the file is absent, and that it discovers and records
`RHCSA_VM_IP` on its own, so they never type an IP address. Note that
`RHCSA_SSH_USER` only needs setting if they did not name the study user
`student`. Keep the file path, the git-ignored note, and the sentence forbidding
Red Hat account credentials in any file in this repo — that last one is
non-negotiable and must survive verbatim in substance.

Consequential fix in the same spirit: **§3 step 4 currently says "Note the IP
address — `provision.sh` needs it once."** It does not; it finds it. Keep the
`ip -4 addr show scope global` command, because seeing a NAT address confirms
DHCP worked and is a genuine checkpoint, but change the reason to that. Do not
tell the user to write it down.

## 3. State that the guest password is a throwaway lab credential

§6 has the user put `student`'s password in a plaintext file at the repo root.
That is a reasonable trade for a disposable local lab and it stays — but the
document must say so out loud rather than leaving the reader to wonder, and it
must give them the alternative the plan already supports.

Add, in §6: this is a throwaway credential for a local lab VM that nothing
outside your machine can reach, so choose a password you use nowhere else and
never reuse it. The file is git-ignored, but a git-ignored plaintext password is
still a plaintext password. Mention that `provision.sh` can instead read it from
an exported shell variable, so a reader who prefers not to write it down at all
can `read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export
RHCSA_GUEST_PASSWORD` before running it. Two or three sentences; do not turn this
into a security essay.

## 4. Give the firmware setting a fallback location

§1 step 7 says `Firmware: **BIOS**` as if it were a page in the New Virtual
Machine wizard. Depending on the Workstation version and the guest OS selected,
that page may not appear — and firmware type **cannot be changed after the guest
is installed** without breaking the boot path, which makes this the one setting
in the whole document whose omission costs a full reinstall.

Add a fallback sentence: if the wizard does not offer a firmware choice, finish
the wizard without powering on, then set it in **VM → Settings → Options →
Advanced → Firmware type → BIOS**, and confirm it is BIOS **before the first
power-on**. Point out the consequence — that changing it after installation
breaks the boot path — so a reader understands why this one is worth checking
rather than assuming.

The brief's justification table already explains *why* BIOS ("GRUB recovery and
`grub2-install` behave the way the exam objectives describe"). Leave that row
exactly as written; this mandate only adds *where to set it*.

## 5. The README's step 4 command exits 1 today — say what it really does

The brief's Getting started step 4 is `node src/cli/index.ts coverage`. That
command exits **1** right now with the two ENOENT problems quoted at the top of
this file, because no task or concept content has been authored yet. A README
that hands a reader a failing command teaches them to distrust the README.

Rewrite that step to be honest: the command reports the content bank's state,
and until Phase 2 authors `content/tasks/` and `content/concepts/` it reports
those two directories as missing and exits non-zero. That is the expected
result at this point in the project, not a broken install.

Do not "fix" this by creating placeholder directories, by adding flags, or by
touching anything under `src/` or `content/`. Task 13 already considered and
rejected placeholder directories, and this task creates two documents and
nothing else.

## 6. Extend the Step 3 self-consistency check

The brief's Step 3 asks you to confirm three things by inspection. Confirm those
three, and add these, since they are the ones the mandates above put at risk:

4. Every environment variable named anywhere in the document is one the user is
   actually told to set, or is explicitly identified as one a script sets for
   them. No variable appears with a value the user cannot know at the moment
   they read it.
5. Every script the document tells the user to run is either committed in this
   repo today or is labelled with the task that creates it. Check each path with
   `ls`. `scripts/guest-provision.sh`, `scripts/provision.sh` and
   `scripts/r1-probe.sh` do **not** exist yet — the brief already labels them
   with their task numbers, and forward references are fine in a document that
   is blocked on hardware, but an unlabelled reference to a missing script is a
   defect.
6. The README contains no claim about behaviour that does not exist. Run every
   command the README's Getting started section names that can be run without
   the VM, and confirm the README's description of what it does matches what it
   actually printed. Paste the real output into your report.

Record the outcome of all six checks in your report as six lines, each naming
what you actually did to check it. "Verified by inspection" for all six is not a
check I can review.

## Out of scope

- Do not touch `src/`, `test/`, `content/`, `scripts/`, or `package.json`.
- Do not create `.env.local`, `.env.example`, or any file under `scripts/`.
  Task 19 owns `.env.local`'s template; creating it here would make
  `provision.sh`'s "template if absent" branch dead on the user's first run and
  silently change which of its two documented stop points they hit.
- Do not add a test. There is nothing here a test can assert that a careful read
  cannot, and a test asserting on this document's prose would lock its wording
  against every future edit for no benefit. Your report is the evidence.
- Do not download the ISO, start VMware, or attempt to build the VM. The ISO is
  a user-owned blocker and this task is explicitly written to be completed
  before it lands.
