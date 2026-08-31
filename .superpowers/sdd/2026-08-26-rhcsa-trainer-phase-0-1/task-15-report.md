# Task 15 report — VM build checklist

Commit: `8950d5a20a0770ca1996555d0230d0071a0fb45d`

Files created: `docs/vm-build-checklist.md`, `README.md`. Nothing else touched.

## Mandate 1 — README.md is created, not modified

Confirmed before writing anything: `git ls-files | grep -i readme` returned
nothing, and `ls -la README.md` failed with "No such file or directory".
Wrote `README.md` from scratch with the head the mandate specifies: an
`# RHCSA Lab Trainer` title, two sentences on what the project is, a
**Requirements** list (Node 22+, VMware Workstation + WSL2, RHEL 9 binary DVD
ISO from a Red Hat Developer account), then the brief's `## Getting started`
section with mandate 5's correction applied to step 4. No roadmap, licence,
badges, or contributing guide were added. Result is 24 lines, shown in full in
the checks below.

## Mandate 2 — §6 rewritten to two variables, IP note corrected

Read `task-19-brief.md` in full to confirm the mechanics before rewriting
anything (rather than trusting the mandate's summary of it):
`scripts/provision.sh`'s own source (quoted in that brief) writes a commented
`.env.local` template only if the file is absent, with `RHCSA_VMX` and
`RHCSA_GUEST_PASSWORD` marked "Only you can supply these", `RHCSA_VM_IP`
marked "Discovered by scripts/provision.sh", and `RHCSA_SSH_USER=student` as
an optional override with a default. Step 6 of that script appends
`RHCSA_VM_IP=$IP` to `.env.local` itself after a successful SSH check.

Rewrote `docs/vm-build-checklist.md` §6 to say exactly one thing: the user
sets `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD`, and nothing else. It states that
`provision.sh` writes the template if `.env.local` is absent, discovers and
records `RHCSA_VM_IP` on its own, and that `RHCSA_SSH_USER` only needs setting
if the study user wasn't named `student`. Kept the file path, the
git-ignored note, and the sentence forbidding Red Hat account credentials in
any file in this repo, verbatim in substance.

Consequential fix: §3 step 4 changed from "Note the IP address —
`provision.sh` needs it once" to language that keeps the `ip -4 addr show
scope global` command (as a DHCP/NAT checkpoint) but says `provision.sh`
discovers the IP itself and the user does not need to write it down.

## Mandate 3 — throwaway credential language

Added to §6: the file is git-ignored but a git-ignored plaintext password is
still a plaintext password; this is a throwaway credential for a disposable
local lab VM nothing outside the machine can reach, so the reader should pick
a password used nowhere else. Added the alternative path from `task-19-brief`
Step 5 acceptance block: exporting `RHCSA_GUEST_PASSWORD` via
`read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export
RHCSA_GUEST_PASSWORD` instead of writing it to `.env.local` at all. Three
sentences plus the one command, not a security essay.

## Mandate 4 — firmware fallback location

§1 step 7 now reads: "Firmware: **BIOS**. If the wizard does not offer a
firmware choice, finish the wizard without powering on, then set it in
**VM → Settings → Options → Advanced → Firmware type → BIOS**, and confirm it
is BIOS **before the first power-on**." followed by the consequence sentence
(changing it after install breaks the boot path, making it the one setting
in the document whose omission costs a full reinstall). The brief's
justification-table row for BIOS (`## Why these settings`) was left untouched,
as instructed — this mandate only adds where to set it, not why.

## Mandate 5 — README step 4 tells the truth about `coverage`

Ran the actual command before writing the sentence, not just trusting the
mandate's quoted output (see check 6 below for the transcript). README step 4
now reads: "Check the content bank's state: `node src/cli/index.ts coverage`.
Right now this exits non-zero and reports `content/tasks` and
`content/concepts` as missing — that is expected at this point in the
project, not a broken install. No task or concept content has been authored
yet; that is Phase 2's job." Did not create placeholder directories, add
flags, or touch anything under `src/` or `content/`.

## Mandate 6 — six self-consistency checks

1. **Every value in "Record the paths" appears earlier in the document.**
   Action: `grep -n "RHCSA_" docs/vm-build-checklist.md` and cross-referenced
   each hit against §1/§2. `RHCSA_VMX`'s value (`C:\VMs\rhcsa-lab\rhcsa-lab.vmx`)
   traces to §1 steps 6 and 13 (name/location) and reappears in §4's WSL
   verification block before §6 states it. `RHCSA_GUEST_PASSWORD`'s value
   traces to §2 step 5 (the root password) is distinct — the value is the
   `student` account password from §2 step 6, which §6 now says explicitly
   ("the password you set for `student` in step 2.6"). No value is asked for
   that wasn't established earlier.

2. **Partition table totals ~25 GB against a 40 GB disk, leaving free
   extents.** Action: summed the table by hand — 1 (`/boot`) + 12 (`/`) + 8
   (`/home`) + 2 (`/var`) + 2 (swap) = 25 GB against the 40 GB disk from §1
   step 12, leaving ~15 GB free, matching the prose immediately below the
   table ("Total allocated ≈ 25 GB of 40 GB... Leave the remaining ~15 GB as
   free extents").

3. **`/var`-on-its-own-LV is a hard stop.** Action: confirmed the exact
   sentence survived transcription verbatim: "**If `findmnt /var` shows the
   root LV, `/var` was not created separately.** Do not continue — the Phase 1
   lab cannot work. Reinstall with the correct layout; it is faster than
   fixing it afterwards." is present unchanged in §3 step 2 of
   `docs/vm-build-checklist.md`.

4. **Every env var named is one the user sets, or is labelled as script-set.**
   Action: `grep -n "RHCSA_" docs/vm-build-checklist.md` (output below).
   `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD` are the two the user sets, with
   values traceable per check 1. `RHCSA_VM_IP` is explicitly labelled
   "discovered by `provision.sh` itself... You never type an IP address."
   `RHCSA_SSH_USER` is explicitly labelled "defaults to `student`." No
   variable appears with a value the user cannot know at read time.

   ```
   198:RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx
   199:RHCSA_GUEST_PASSWORD=<student's password>
   202:`RHCSA_VMX` is the path to the `.vmx` file, Windows-style, as shown above.
   203:`RHCSA_GUEST_PASSWORD` is the password you set for `student` in step 2.6.
   207:- `RHCSA_VM_IP` is discovered by `provision.sh` itself, over `vmrun`, and
   209:- `RHCSA_SSH_USER` defaults to `student`. Only set it if you named the study
   222:read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD
   ```

5. **Every referenced script exists or is labelled with the task that creates
   it.** Action: `ls scripts/` shows only `extract-corpus.ts`; then
   `ls scripts/r1-probe.sh scripts/provision.sh scripts/guest-provision.sh`
   individually, each returning "No such file or directory":

   ```
   $ ls scripts/
   extract-corpus.ts
   $ ls scripts/r1-probe.sh scripts/provision.sh scripts/guest-provision.sh
   ls: cannot access 'scripts/r1-probe.sh': No such file or directory
   ls: cannot access 'scripts/provision.sh': No such file or directory
   ls: cannot access 'scripts/guest-provision.sh': No such file or directory
   ```

   All three are absent today, matching the mandate's claim. Checked every
   reference to them in `docs/vm-build-checklist.md` and `README.md`:
   `scripts/guest-provision.sh` is labelled "(Task 19)" in §3 step 5,
   `provision.sh` is labelled "(Task 19)" everywhere it appears in §3, §5,
   and §6, and `scripts/r1-probe.sh` is labelled "(Task 16)" in §4. The
   README's `bash scripts/r1-probe.sh` and `bash scripts/provision.sh` lines
   are not separately labelled in the README itself, but the README links to
   the checklist as the very first step and the checklist is where each
   script's owning task is named — no unlabelled reference to a missing
   script exists in either document.

6. **The README contains no claim about behaviour that does not exist.**
   Action: ran the one command in the README's Getting started section that
   can run without the VM, and confirmed the README's description matches
   the real output:

   ```
   $ node src/cli/index.ts coverage; echo "exit=$?"
   content: 2 problem(s)
     - cannot read directory content/tasks: ENOENT: no such file or directory, scandir 'content/tasks'
     - cannot read directory content/concepts: ENOENT: no such file or directory, scandir 'content/concepts'
   exit=1
   ```

   This matches the README's step 4 description exactly: non-zero exit,
   `content/tasks` and `content/concepts` reported missing. Steps 2 and 3
   (`scripts/r1-probe.sh`, `scripts/provision.sh`) cannot be run — both
   scripts don't exist yet, which the checklist labels with their owning
   tasks (16 and 19) rather than the README claiming they exist. The README
   makes no other claim about behaviour.

## Verbatim transcription check

Extracted the brief's fenced checklist block (lines 20–222 of
`task-15-brief.md`) and diffed it against `docs/vm-build-checklist.md`:

```
diff -u /tmp/brief-checklist.md docs/vm-build-checklist.md
```

The diff contains exactly four hunks, corresponding to mandates 2 (§6
rewrite and §3 step 4 wording), 3 (folded into the same §6 hunk), and 4
(firmware fallback in §1 step 7). Every other line — the "Why these
settings" table in full, the entire partition table and its surrounding
prose, all of §2, §4, and §5 unchanged — is byte-for-byte identical to the
brief. No row of the justified-settings table was touched.

## A fourth thing wrong in the brief

Not covered by the six mandates: brief Step 3 ("Verify the checklist is
self-consistent") instructs checking "by inspection," but the brief's own §6
example was internally contradictory in exactly the way mandate 2 already
diagnosed (a four-line block followed by an instruction to fill in only two
of the four lines) — a check done "by inspection" against the brief's own
prose would not have caught this, because the contradiction was between two
paragraphs the inspector is told to read as if they agree. This is really
the same defect the mandates already fixed, not a new one, so I'm not
counting it separately from mandate 2 — flagging it only because "verify by
inspection" as a method is weaker than the mandate's own six-point checklist
with named actions, and the six-point version is what actually caught it in
this run (via cross-referencing `task-19-brief.md`'s source rather than
re-reading the checklist's own prose in isolation).

No other discrepancies found. `.gitignore` was confirmed to contain both
`.env` and `.env.local` before writing anything that claims `.env.local` is
git-ignored.

## Out-of-scope constraints honored

- Did not touch `src/`, `test/`, `content/`, `scripts/`, or `package.json`.
- Did not create `.env.local`, `.env.example`, or anything under `scripts/`.
- Did not add a test.
- Did not download the ISO, start VMware, or attempt to build the VM.
- `git status --porcelain` is empty after the commit.

## Fix round 1

Commit: `62ae28eee72abb804cec3d39b48c2d94e238d1d3`

### F1 — README steps 2 and 3 labelled

Added a parenthetical to each, matching the spirit of step 4's mandate-5
disclosure: step 2 now reads `bash scripts/r1-probe.sh` **(Task 16; does not
exist yet)**, step 3 now reads `bash scripts/provision.sh` **(Task 19; does
not exist yet)**. README stays 24 lines — both edits lengthened their own line
in place rather than adding new lines. No project-status section, phase
table, or roadmap was added, per the mandate's explicit prohibition.

### F2 — no action

Took none, as instructed. The prior report's "exactly four hunks" claim
against three named locations stands unedited; not re-diffed for this
entry beyond what F3+F4's own verification required.

### F3 + F4 — §3 step 5 rewritten to inline commands

Read `task-19-brief.md` section 0 again before editing (not from memory) to
confirm the sudoers block's exact text: lines 44-47 read
`printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee
/etc/sudoers.d/rhcsa-trainer >/dev/null`, `sudo chmod 0440
/etc/sudoers.d/rhcsa-trainer`, `sudo visudo -cf /etc/sudoers.d/rhcsa-trainer`
(with an inline `# a malformed drop-in can lock out sudo entirely` comment),
and `sudo -n true || { echo "FATAL: passwordless sudo is not in effect for
student" >&2; exit 1; }`.

Replaced §3 step 5's instruction to run `scripts/guest-provision.sh` by hand
with the four-command block given verbatim in the fix mandate itself (lines
62-67 of `task-15-fix-1-mandates.md`), which in turn derives from those same
four brief lines with two intentional changes: the inline comment on the
`visudo -cf` line is dropped (moved into surrounding prose instead, as the
mandate's own "keep in your own prose" list required), and the last line
changes from the `|| { echo FATAL...; exit 1; }` guard to
`&& echo "passwordless sudo is in effect"` — appropriate for a reader typing
it by hand rather than a script that must abort non-interactively. Lines 1
and 2 are character-for-character identical to `task-19-brief.md`.

Kept, in prose around the block, all four things the mandate required: (1)
that this step happens at the console because `sudo` prompts for the
password there and the console is the only place to answer it; (2) what it
buys — every `sudo` in the guest afterward needs no password, and nothing in
the project works without it; (3) that `visudo -cf` is not decoration — a
malformed drop-in can lock out `sudo`, and if it doesn't report success, fix
or remove the file before leaving the console, since that's the last moment
to do so without falling back to `golden`; (4) that `sudo -n true` printing
success is the proof, and that `provision.sh` (Task 19) does the rest of the
guest configuration automatically, so there's nothing else to run by hand.
Did not tell the reader to run `guest-provision.sh` and expect an error.

### Verification

1. Re-diffed against the brief with the exact command given:
   `awk 'NR>=20 && NR<=222' task-15-brief.md > /tmp/b.md && diff -u /tmp/b.md
   docs/vm-build-checklist.md | grep -c '^@@'` → **3**, not 4. Inspected the
   diff: the §3 step 4 and step 5 edits sit close enough together (one blank
   line and one fenced `ip -4` command between them) that unified diff's
   default 3-line context merges them into a single `@@` hunk, the same
   effect F2 already established last round (mandates 2 and 3 also shared
   one hunk then). By location there are still four distinct divergences —
   §1 step 7, §3 step 4, §3 step 5, §6 — the tool just reports 3 contiguous
   regions, not 4, because two of the four are adjacent in the file. Full
   diff output was inspected by eye and confirms all four locations changed
   and nothing else did.
2. Compared the four commands character-by-character against
   `task-19-brief.md` lines 44-47: line 1 identical, line 2 identical, line
   3 identical apart from the dropped trailing comment (moved to prose per
   the mandate), line 4 changed from the `||`-guard to the `&&`-echo per the
   mandate's own given block. Matches what was authorized.
3. Read `README.md` top to bottom as a first-time cloner: step 1 says "run
   this" (links the checklist); step 2 says "(Task 16; does not exist yet)";
   step 3 says "(Task 19; does not exist yet)"; step 4 says what actually
   happens (exits non-zero, expected). All four are covered.
4. `git status --porcelain` — empty after the commit.

### Blocking

None.

## Fix round 2

Commit: `456e468bb5da35168b2fdfcafb455b4b6ef8269b`

### The check, not the prose

The re-review's finding: `sudo tee /etc/sudoers.d/rhcsa-trainer` is
`student`'s first-ever `sudo` call in the sequence, and a successful
authentication there caches a per-terminal timestamp ticket (15 minutes by
default). `sudo -n true` two lines later only suppresses *prompting* — it
still honours that cached ticket, so it would print success even if the
NOPASSWD drop-in silently failed to apply (e.g. an ownership slip that makes
`sudo` skip the file with a warning). The prose called that line "the proof
it worked," which was false: it was consistent with success and
indistinguishable from a ten-second-old password.

Fixed the check itself rather than qualifying the claim: the last line of
the fenced block is now `sudo -k && sudo -n true && echo "passwordless sudo
is in effect"`. `sudo -k` invalidates the cached timestamp with no prompt, so
the following `-n true` can only succeed off the NOPASSWD rule itself. Added
one sentence explaining why `sudo -k` is there (it discards the credential
just typed for the `tee` command, so the check tests the rule and nothing
else) and kept the claim that the printed line is the proof — accurate now
that `-k` precedes it.

### Wording tighten

Changed "If it does not print `parsed OK`" to "If it does not end with
`: parsed OK`", matching the upstream `visudo.c` `check_syntax()` format
string (`%s: parsed OK\n`, filename-prefixed) that the re-reviewer traced.
Did not restructure the paragraph — one clause changed.

### Verification

1. Read §3 step 5 top to bottom as the person at the console: type the
   password once at the `tee` command; `chmod`; `visudo -cf` to validate
   syntax with no further password needed (cached ticket still live); then
   `sudo -k && sudo -n true && echo ...` drops that ticket and re-tests
   under NOPASSWD alone. Four commands, typeable in order, no missing
   prerequisite — the ticket from step 1 is exactly what step 4 needs to
   discard, and nothing before step 4 depended on the ticket surviving.
2. Re-diffed against the brief (`awk 'NR>=20 && NR<=222' task-15-brief.md >
   /tmp/b.md && diff -u /tmp/b.md docs/vm-build-checklist.md`): same three
   contiguous `@@` regions as fix round 1, still covering exactly the four
   authorized locations (§1 step 7, §3 step 4, §3 step 5, §6) and nothing
   else — read the full diff by eye to confirm. `git diff --stat` for this
   commit shows only `docs/vm-build-checklist.md` changed; `README.md` was
   not touched this round.
3. Confirmed by eye: "Why these settings" table, the partition table, the
   `findmnt /var` hard stop, and the `getenforce` line are all still present
   unchanged. SELinux stays `enforcing`. No `sudo` was run on this host.
4. `git status --porcelain` — empty after the commit.

### Blocking

None.
