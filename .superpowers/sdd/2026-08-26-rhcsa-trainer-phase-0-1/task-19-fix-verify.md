# Task 19 fix-round verification (145c344, 17b8cd4)

Read-only verification. `git status --porcelain` confirmed empty before and after this review.
No commands from `scripts/provision.sh` were executed; no `ssh-keygen`; no `.env.local` created,
read, or modified; no VM operations; no `sudo`.

## Scope confirmed

`git show --stat` for both commits: only `scripts/provision.sh` changed in either commit (10 lines
touched in 145c344, 9 in 17b8cd4). No separate docs file was touched by these two commits — the
"documentation" in question is the inline `.env.local` template comments the script heredocs out
(`scripts/provision.sh:19-39`), not a `.md` file.

## Q1 — Did round 2 revert exactly the inventions, and only the inventions?

**Verified, with one factual correction to the round-2 commit message.**

Net diff (145c344 + 17b8cd4 vs. before 145c344), from `git show` on both commits:

- `RHCSA_SSH_KEY`: `#RHCSA_SSH_KEY=` → (145c344) `#RHCSA_SSH_KEY="/home/user/.ssh/id_ed25519"` →
  (17b8cd4) back to `#RHCSA_SSH_KEY=`. Fully reverted.
- `RHCSA_ISO`: `#RHCSA_ISO=` → (145c344) `#RHCSA_ISO="/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso"` →
  (17b8cd4) back to `#RHCSA_ISO=`. Fully reverted.
- `RHCSA_VMRUN`: unquoted `#RHCSA_VMRUN=/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`
  → (145c344) quoted → (17b8cd4) still quoted, with the comment reworded from a `VMRUN`-scoped
  "paths with spaces must be quoted" to a general "Quote any value containing a space." line placed
  above it. Quoting fix retained, not reverted. This is the one net *change* left standing after
  both commits — by design, per both commit messages.

`git grep` for residue of the invented strings across all tracked files:
- `id_ed25519` — 0 hits.
- `/home/user` — 0 hits.
- `rhel-9.6-x86_64-dvd` — 2 hits, **neither is residue**: `scripts/provision.sh:61`
  (`ISO=${RHCSA_ISO:-/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso}`, the script's actual hardcoded default,
  untouched by either commit) and `docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md:5816`
  (the design plan specifying that same default). Both predate 145c344 and were never part of the
  template lines these commits edited.

So: no leftover invented text anywhere in the tree, and the quoting guidance survived. Net effect
matches the stated intent.

**Correction to the round-2 commit message's characterization:** it calls the `RHCSA_ISO` example
"an unmotivated filename/version." That's not accurate — `/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso` is
*exactly* the script's own hardcoded default (`scripts/provision.sh:61`) and exactly what the phase
plan specifies (`docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md:5816`). It is grounded,
not invented. The decision to revert it to blank is still correct on separate, valid grounds — it
matches the template's actual convention of leaving optional-override keys blank so the code-level
default silently applies (see `RHCSA_SSH_PORT`, `RHCSA_TRANSPORT`, and now `RHCSA_SSH_KEY`, all
blank) — but the *reason given* overstates the problem for this one key.

By contrast, the `RHCSA_SSH_KEY` revert is fully justified as stated: the real default is
`$HOME/.ssh/rhcsa_lab` (`scripts/provision.sh:60`, matched by `src/engine/vm/config.ts:51`,
`docs/superpowers/specs/2026-08-26-rhcsa-lab-trainer-design.md:272`, and the test suite). The
invented example `/home/user/.ssh/id_ed25519` matches none of that — wrong username convention,
wrong filename, wrong key type — and reads exactly like a generic personal key, which is the
footgun the commit message describes. That one is genuinely ungrounded.

## Q2 — Is the net quoting guidance correct on its own terms?

**Verified.** Traced how a value from `.env.local` reaches the shell: `scripts/provision.sh:52`
sources the file with `. <(grep -vE '^[[:space:]]*#|^[[:space:]]*$|=[[:space:]]*$' .env.local)` —
i.e., surviving lines are parsed as literal bash statements, not read as inert key=value pairs.
That means the real host path `/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe`
(the actual location on this host) will hit bash's own tokenizer, where unquoted parentheses are
group-command syntax.

Confirmed empirically in an isolated `/tmp` scratch dir (no repo files, no VM, no ssh-keygen),
reproducing only the sourcing line from `provision.sh:52` against synthetic content:

- Unquoted `RHCSA_VMRUN=/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe` →
  `syntax error near unexpected token '('`, and the variable ends up empty.
- Quoted `RHCSA_VMRUN="/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe"` →
  sources cleanly, variable holds the full path with the embedded space intact.

This matches round 1's stated rationale precisely (a raw syntax error instead of a guard message)
and confirms the template as it stands after 17b8cd4 (`scripts/provision.sh:36`,
`#RHCSA_VMRUN="/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe"`) produces a correct
invocation if a user literally uncomments and edits only the path inside the existing quotes.
Downstream, `VMRUN` is always used double-quoted (`"$VMRUN"`, lines 69, 84, 90, ...), so once the
sourcing step succeeds the rest of the script handles the embedded space correctly regardless of
how the value got there.

One placement nit, not a defect in the reverted content itself: the general "Quote any value
containing a space." comment (`scripts/provision.sh:34`) sits between the `RHCSA_TRANSPORT` line and
the `RHCSA_VMRUN` line, immediately above the one line it has a worked example for. A reader could
plausibly take it as scoped to `RHCSA_VMRUN` only, rather than a house rule that also covers
`RHCSA_SSH_KEY` or `RHCSA_ISO` if *their* values ever contain a space (e.g. an ISO path under a
Windows profile with a space in the username). Worth a follow-up nit, not a re-open of these two
commits — no example values were reintroduced for those two keys, so there is nothing currently in
the file for the ambiguity to affect.

## Q3 — Are the script's `:?` guards and ISO-present check consistent with the docs these commits touched?

**Verified consistent.** The two commits only ever touched the "Optional overrides" block
(`scripts/provision.sh:29-38`), never the two mandatory keys or their guards.

- `scripts/provision.sh:56-57` — `:?` guards fire only for `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD`.
  Those are documented separately, above the touched block, as "Only you can supply these two"
  (`scripts/provision.sh:22-24`), untouched by 145c344/17b8cd4. Correct — the touched block's own
  heading, "Optional overrides; the defaults are usually right" (`scripts/provision.sh:29`), matches
  the fact that `RHCSA_SSH_KEY`, `RHCSA_VMRUN`, `RHCSA_ISO`, `RHCSA_SSH_PORT`, and `RHCSA_TRANSPORT`
  all resolve via `${VAR:-default}` (lines 58-61), not `:?`, so leaving them blank is always safe.
- ISO comment (`scripts/provision.sh:37`, unchanged by these two commits beyond wording): "Read by
  this script only, never by the app itself." Verified with `git grep -n "RHCSA_ISO" -- src/ test/`
  → zero hits. `RHCSA_SSH_KEY` and `RHCSA_VMRUN`, by contrast, *are* read by the app
  (`src/engine/vm/config.ts:51-52`), but the template makes no exclusivity claim for those two, so
  there's no contradiction.
- ISO-already-present check (`scripts/provision.sh:105-124`): guarded by `[[ -f $ISO ]]`, then a
  guest-side `test -f /var/lib/rhcsa-dvd.iso` to decide whether to skip the ~10 GB copy. The touched
  comment line doesn't describe this behavior (it only states who reads the *path*, not the
  skip-if-present logic) — but it also doesn't contradict it. No inconsistency, just a comment that
  is silent on a mechanism it was never claiming to describe.

`docs/vm-build-checklist.md:185` independently uses the same VMRUN value, already single-quoted,
pre-existing and untouched by either commit — consistent with, though not created by, the guidance
these commits added.

## Summary

| Question | Result |
|---|---|
| 1. Round 2 reverted exactly the inventions | Verified — full revert, no residue, quoting kept. One correction: the `RHCSA_ISO` value round 2's message calls "unmotivated" was in fact the script's own real default and the plan's specified value, not invented; `RHCSA_SSH_KEY`'s invented value genuinely was ungrounded as described. |
| 2. Net quoting guidance is correct on its own terms | Verified — empirically confirmed unquoted breaks with a bash syntax error, quoted works, matches the real host path. Minor: the general quoting reminder's placement could be misread as VMRUN-specific rather than a house rule. |
| 3. `:?` guards / ISO-present check vs. touched docs | Verified consistent — no contradiction found between script behavior and the touched template comments. |

No blockers. No defects found in the reverted state; one factual overstatement in the 17b8cd4 commit
message (the ISO value's "unmotivated" characterization) that doesn't affect correctness of the
resulting file, only the accuracy of the stated reasoning.
