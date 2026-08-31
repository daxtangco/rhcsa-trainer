# Task 15 review — VM build checklist (`docs/vm-build-checklist.md`, `README.md`)

Commit reviewed: `8950d5a`. Reviewed by reading both delivered documents top to bottom
as the person who has to execute them, and by verifying every checkable claim with a
command rather than by inspection. `git status --porcelain` is empty; no files were
edited, no subagents dispatched, no `sudo` run, nothing downloaded, no VM started.

## Verdict 1 — spec compliance

All six mandates are satisfied. The brief's checklist body survives verbatim outside
exactly **three** hunks (not four — see F2), which map to mandates 2+3 (folded
together in the §6 rewrite) and mandate 4 (§1 step 7 firmware fallback), plus the
consequential §3-step-4 wording fix that mandate 2 also required. Confirmed with:

```
$ awk 'NR>=20 && NR<=222' task-15-brief.md > /tmp/b.md
$ diff -u /tmp/b.md docs/vm-build-checklist.md | grep -c '^@@'
3
```

Everything outside those three hunks — the full "Why these settings" table, the
entire partition table and its surrounding prose, all of §2, §4, and §5, the
`findmnt /var` hard stop, and `getenforce`/SELinux-enforcing language — is
byte-for-byte identical to the brief. SELinux stays enforcing; nothing about the
partition layout or the hard stops was softened.

Per-mandate:

1. **README created, not appended** — confirmed (`git ls-files | grep -i readme`
   found nothing before this commit; README.md is 24 lines, matches the specified
   head: title, two sentences, Requirements list, then Getting Started). Satisfied.
2. **§6 rewritten to two variables; §3 step 4 corrected** — confirmed against
   `task-19-brief.md`'s actual `provision.sh` source: the template really is written
   only if `.env.local` is absent with only `RHCSA_VMX`/`RHCSA_GUEST_PASSWORD`
   required, `RHCSA_VM_IP` really is discovered and appended by the script itself,
   `RHCSA_SSH_USER` really does default to `student`. §3 step 4 no longer tells the
   reader to write the IP down. Satisfied.
3. **Throwaway-credential language** — present in §6, three sentences plus the
   `read -rsp`/`export` command, matches `task-19-brief.md`'s acceptance-step
   alternative exactly. Satisfied.
4. **Firmware fallback location** — present in §1 step 7 exactly as specified
   (Settings → Options → Advanced → Firmware type → BIOS, checked before first
   power-on, consequence stated); the justified-settings table's BIOS row is
   untouched. Satisfied.
5. **README step 4 tells the truth about `coverage`** — I ran it myself:
   ```
   $ node src/cli/index.ts coverage; echo exit=$?
   content: 2 problem(s)
     - cannot read directory content/tasks: ENOENT: ...
     - cannot read directory content/concepts: ENOENT: ...
   exit=1
   ```
   matches README step 4's description exactly (non-zero exit, both directories
   named as missing, framed as expected not broken). Satisfied.
6. **Six self-consistency checks with named actions** — the report ran real
   commands for all six (grep cross-referencing, hand-summed arithmetic, `ls` on
   each script path, running `coverage`), not "verified by inspection." Satisfied
   as a process; see F1 and F3 for substantive gaps the checks didn't quite catch.

## Verdict 2 — task quality

The document is executable and mostly trustworthy, but it is not yet safe to hand to
someone who has never done this before, for two concrete reasons (F1, F3 below) that
are both instances of the project's recurring defect: **a confident sentence about
what the reader will see, where what they will actually see is an unexplained
error.** Neither breaks the two things that matter most — the partition layout and
the SELinux/`findmnt` hard stops both survive intact and correctly — but both would
strand a careful reader with no diagnostic trail back to "this is expected." The
arithmetic (1+12+8+2+2=25 of 40 GB, ~15 GB free) is correct. Every cross-reference I
checked resolves to a real, earlier antecedent (`student`'s password really is set
in §2 step 6; the `.vmx` path really is established, in full, in §4 before §6 uses
it). `.env.local` really is git-ignored. `Node >=22.18.0` in `package.json` backs the
README's Requirements claim, and there genuinely is no build step. Two findings are
new (not previously identified); one confirms the finding already reported to me.

## Findings

**F1 — must fix now.** `README.md:18-19`. Steps 2 and 3 tell the reader to run
`bash scripts/r1-probe.sh` and `bash scripts/provision.sh`. Neither file exists yet
(confirmed: `ls scripts/` shows only `extract-corpus.ts`), and unlike step 4 (fixed by
mandate 5), neither line carries a task label or caveat. A reader following the
README start to finish gets:
```
$ bash scripts/r1-probe.sh; echo exit=$?
bash: scripts/r1-probe.sh: No such file or directory
exit=127
```
with zero warning that this is expected at this point in the project. The report's
own check 5 notices this and defends it by pointing to the linked checklist, where
the same scripts *are* labelled "(Task 16)" / "(Task 19)" — a weak defence, because
mandate 1 makes the README the project's own front door, not a pointer that assumes
the reader has already memorised the checklist's task numbers. Fix: label steps 2
and 3 the same way step 4 now is, e.g. "2. Check that WSL can reach it (Task 16):
`bash scripts/r1-probe.sh`" — mirroring the fix mandate 5 already applied one line
down.

**F2 — observation (affects the report, not the deliverable).**
`task-15-report.md:174`. The report claims "The diff contains exactly four hunks,"
then names three locations (§6, §3 step 4, §1 step 7) and folds the fourth into the
first, contradicting its own count. Measured directly: `diff -u /tmp/b.md
docs/vm-build-checklist.md | grep -c '^@@'` → `3`. The substance is fine — three
hunks is correct, everything else is verbatim — but the report's own evidence
sentence is a small instance of the exact "confident but false" pattern this
project keeps producing, this time in the audit trail rather than the document. No
action needed on the committed files; noting it because the review brief asked me
to check which number was right.

**F3 — forward to a later task (Task 19, or a follow-up mandate on Task 15 §3 step
5).** `docs/vm-build-checklist.md`, §3 step 5 (unchanged from the brief, one of the
three verbatim-outside-hunks sections). The text: *"Run `scripts/guest-provision.sh`
(Task 19) from the VM console... it will ask for `student`'s password once and
never again."* This is only partially true and doesn't disclose the part that
isn't. Per `task-19-brief.md`'s own script text (lines 27-64): the script's section
0 (install `/etc/sudoers.d/rhcsa-trainer` via `sudo tee`) really does prompt once at
a real console TTY, exactly as promised — but the very next section requires
`RHCSA_PUBKEY`, guarded by a bash `:?` that aborts the script if it's unset:
```
$ bash -c 'PUBKEY=${RHCSA_PUBKEY:?RHCSA_PUBKEY must be passed in}; echo "continued: $PUBKEY"'
bash: line 1: RHCSA_PUBKEY: RHCSA_PUBKEY must be passed in
```
`RHCSA_PUBKEY` is generated by `scripts/provision.sh`'s own Step 1
(`PUBKEY=$(cat "$KEY.pub")`) and only ever supplied when `provision.sh` drives
`guest-provision.sh` itself over `vmrun` (`RHCSA_PUBKEY='$PUBKEY' bash
/tmp/guest-provision.sh`). A reader manually running the script at the console — the
only way the checklist tells them to run it, and the only way the sudo bootstrap
*can* be answered per `task-19-brief.md`'s own comment ("the console is where a
password prompt is answerable") — has no way to supply that variable. So the actual
sequence a reader sees is: type the sudo password → success → a hard
`RHCSA_PUBKEY must be passed in` error and a non-zero exit, having skipped the
ssh-key, repo, and package sections entirely. Functionally this is *fine* — the
script is idempotent and `provision.sh`'s later automated run (which does supply
`RHCSA_PUBKEY`) finishes the rest — but nothing in the checklist says so, and a
reader who has just watched a script they were told would "never [prompt] again"
die with an unfamiliar env-var error has every reason to think the build is broken
and start troubleshooting or reinstalling. Recommended fix (one or two sentences,
not a rewrite): after the existing text, add something like "After you enter the
password, expect the script to stop with a `RHCSA_PUBKEY must be passed in` error —
that's expected here; it only needed to install the sudoers rule. `provision.sh`
(Task 19) will finish the rest of guest provisioning for you automatically on its
first real run." This predates Task 15's implementation (present verbatim in the
original brief, untouched by any of the six mandates and outside the three
authorized hunks), so it is not a defect the implementer introduced — but it is a
real defect in the document as delivered.

## Nothing blocking

No `sudo` was run, no VM was started, nothing was downloaded, and no file under
`docs/` or `README.md` was edited. Tree is clean.

## Re-review — fix round 1

Scope: F1, F3, F4 only, plus an independent fact-check of the four inlined
console commands. Read `62ae28e`'s full diff, `task-15-fix-1-mandates.md`,
`task-15-report.md`'s "Fix round 1" section, `task-19-brief.md` §0 of
`guest-provision.sh`, and the local `visudo`/`sudoers`/`sudo` man pages. No file
was edited; no `sudo` was run; no VM was touched. `git status --porcelain` is
empty.

**F1 — closed.** README steps 2 and 3 now read `bash scripts/r1-probe.sh` (Task
16; does not exist yet) and `bash scripts/provision.sh` (Task 19; does not exist
yet). Read the whole README as a fresh clone: step 1 says "run this" (links the
checklist, which exists); steps 2 and 3 now say "this does not exist yet, Task N
makes it"; step 4 says what the command actually does today (exits non-zero,
expected). All four covered, exactly per mandate. File is still 24 lines.

**F3 + F4 — closed.** §3 step 5 no longer names `scripts/guest-provision.sh`;
it now inlines the four commands. Verified against `task-19-brief.md` §0
character-by-character: line 1 (`printf ... | sudo tee ...`) identical; line 2
(`sudo chmod 0440 ...`) identical; line 3 differs only by the trailing `#
comment` being dropped from the command and folded into the surrounding prose
("The `visudo -cf` check is not decoration...") — authorized; line 4 changed
from the script's `|| { echo FATAL...; exit 1; }` guard to `&& echo "passwordless
sudo is in effect"` — authorized, and appropriate for a human typing at a
console rather than a script that must abort non-interactively. The prose keeps
all four required elements: console-not-ssh and why, what it buys, that
`visudo -cf` failing means fix-or-remove before logging out, and that
`provision.sh` (Task 19) does the rest automatically. No instruction to run
`guest-provision.sh` by hand remains anywhere in the document.

**Nothing else changed — confirmed.** Ran the exact command from the mandate:
`awk 'NR>=20 && NR<=222' task-15-brief.md > /tmp/b.md && diff -u /tmp/b.md
docs/vm-build-checklist.md`. `grep -c '^@@'` reports `3`. Read the hunk: it is
the four authorized locations, with §3 step 4 and step 5 merged into one hunk
because they sit within diff's 3-line context window of each other (one blank
line and one fenced `ip -4` block apart) — confirmed by eye, matches the
report's own explanation exactly. The other three hunks are §1 step 7, the
merged §3 step 4+5, and §6. Everything outside those hunks is byte-identical to
the brief, including — checked individually — the full "Why these settings"
table, the entire partition table and its "leave ~15 GB free" prose, the
`findmnt /var` hard-stop paragraph verbatim, and line 103's `getenforce #
must print Enforcing`. **SELinux is still `enforcing`**; nothing in this fix
round touches it.

### Fact-check of the four console commands (the thing nobody had verified)

Environment note first: this host's `man visudo`/`man sudoers`/`man sudo` are
present but are `sudo-rs` 0.2.13 (the Rust reimplementation, `sudo-rs
0.2.13-0ubuntu1`), not the classic Todd-Miller `sudo` RHEL 9 actually ships.
`sudoers(5)` here states its own format is "a subset of the one used by the
sudo-project... but syntax-compatible," which is enough to check syntax
validity, but not enough on its own for exact program output or the
permission-enforcement internals, so those two points are checked against the
actual `sudo-project/sudo` source on GitHub instead of local memory.

1. **`sudo visudo -cf /etc/sudoers.d/rhcsa-trainer` — does it print bare `parsed
   OK`?** No. Checked `sudo-project/sudo`'s `visudo.c`, function
   `check_syntax()`: the success line is `printf(_("%s: parsed OK\n"), fname)`
   — i.e. the real output is `/etc/sudoers.d/rhcsa-trainer: parsed OK`, with the
   filename prefixed, not bare `parsed OK`. The checklist's prose says "If it
   does not print `parsed OK`" — read as a substring check rather than an
   exact-match claim, this is true: the phrase `parsed OK` is literally present
   in the real success line, and no error path prints that phrase. So a reader
   scanning for the substring will not be misled. It would read better as
   "...ends with `: parsed OK`" to remove any doubt for someone expecting an
   exact match, but as written it is not a false claim — **not a must-fix**,
   worth a one-word tighten if the implementer is touching this paragraph again
   anyway.

2. **Is `student ALL=(ALL) NOPASSWD: ALL` valid syntax that grants what the
   prose claims?** Yes. It matches the `sudoers(5)` grammar exactly (`User_List
   Host_List = Tag_Spec Cmnd`, with `NOPASSWD:` a defined `Tag_Spec` and `ALL`
   a valid `Cmnd`), confirmed against both the local `sudoers(5)` and the
   real project's grammar (same rule, standard idiom). It grants `student`
   command-any-command-as-any-user sudo with no password prompt, matching "every
   `sudo` in the guest... needs no password."

3. **Is `0440` a mode sudo *requires*, and does it refuse other modes?** Not as
   stated. Checked `sudo-project/sudo`'s `sudoers.c`/`check.c`: the file-security
   check (`sudo_secure_fd`, called from `open_sudoers()`) rejects a sudoers file
   only for being **world-writable, group-writable, or wrong-owner** — there is
   no check that demands exactly `0440`. `0440` is the conventional default
   (`sudoers_mode` in `sudo.conf` defaults to `0440`) set by `visudo`, not a
   value sudo enforces on drop-ins; a `0400` or `0640`-root:root file would be
   honored identically. This doesn't make the checklist wrong (chmod 0440 is
   the right thing to type) but "the mode sudo requires" would overstate it if
   said that way — the checklist doesn't actually make that claim, it just
   tells the reader to run the chmod, so no fix needed here either.

4. **Does `sudo -n true` printing the success line actually *prove* NOPASSWD is
   in effect?** **This is a real finding.** `sudo`/`sudo-rs` cache a successful
   authentication as a per-terminal timestamp for a window (`timestamp_timeout`,
   default 15 minutes) — stated explicitly in this host's own `sudoers(5)`:
   "the user may then use sudo without a password for a short period of time
   (15 minutes unless overridden)." The first command in this same four-line
   block, `sudo tee ...`, is the first `sudo` call `student` has ever made and
   necessarily prompts for and validates the console password interactively
   (the checklist says so itself). That successful authentication caches a
   timestamp ticket for the console's TTY. `sudo -n true` two lines later does
   not clear that cache — `-n` only suppresses *prompting*, it still honors a
   valid cached ticket. So if the sudoers drop-in silently failed to take effect
   (say, an ownership slip that made `sudo` skip the file with a warning rather
   than apply it — a real, documented failure mode, not hypothetical), `sudo -n
   true` would **still print `passwordless sudo is in effect`**, because the
   cached ticket from typing the password 10 seconds earlier is doing the work,
   not the NOPASSWD rule. The checklist's claim that this line is "the proof it
   worked" overstates what was actually demonstrated — it is consistent with
   success, but does not distinguish success from "you typed your password
   within the last 15 minutes." A tighter check would run `sudo -k` (drop the
   cached ticket) immediately before `sudo -n true`, or the prose should say
   this confirms the rule is *parseable*, with the real proof deferred to Task
   19's own acceptance check (`ssh ... sudo -n id -u`), which runs over a fresh
   SSH connection with no console ticket to borrow from and would catch a
   silently-unapplied rule. Blast radius is bounded — Task 19 §5's acceptance
   step re-verifies exactly this over SSH and would catch a genuinely broken
   install before anything is built on top of it — but the sentence itself, as
   written, is not accurate and this is exactly the kind of "confident sentence
   that is false" this review was asked to hunt for.

5. **Ordering: is the window between `sudo tee` (implicit mode, typically
   `0644` under RHEL 9's default `umask 022`) and `sudo chmod 0440` a lockout or
   silent-failure risk?** No, given finding 3 above: `sudo`'s actual check cares
   about group/world **writability** and ownership, not read permission for
   other, and a `tee`-created file at `0644` owned by `root` (it runs as root,
   under `sudo`) is already not group- or world-writable, so it would be
   accepted and applied by `sudo` even before the `chmod` runs. The `chmod 0440`
   is about *read* hygiene (stopping other local users from reading the rule),
   not about satisfying `sudo`'s own acceptance check. This also exactly mirrors
   `guest-provision.sh`'s own tee-then-chmod-then-check-then-verify order in
   `task-19-brief.md` §0, so whatever risk exists here already exists in that
   already-drafted script and is not a new risk introduced by inlining it into
   the checklist. (Caveat, not a finding: an unusually permissive `umask`, e.g.
   `0002` or `0000`, would make the file group- or world-writable during that
   window, which `sudo` would then refuse — but that is not RHEL 9's default
   posture and the checklist has no obligation to hedge against a non-default
   umask.)

### New finding

**Finding 4 above (`sudo -n true` is not proof of NOPASSWD, only of a valid
cached ticket or NOPASSWD) is a must-fix.** Suggested fix, one line: either add
`sudo -k && ` before `sudo -n true` in the fenced block (forces a real,
uncached check) and note that this discards the cached ticket, or soften the
prose from "is the proof it worked" to something like "is a good sign, though
the real proof is Task 19's own automated check over SSH, which cannot reuse
this console session's cached credential." I have not applied either fix —
scope for this pass was review, not edit.

### Nothing else blocking

No `sudo` was run, no VM was started, nothing was downloaded, no man page or
source file was fetched from anywhere but public upstream docs/source, and no
file in this repo was edited. `git status --porcelain` is empty.
