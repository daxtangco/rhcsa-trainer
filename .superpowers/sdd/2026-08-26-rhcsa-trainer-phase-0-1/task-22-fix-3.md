# Task 22 — fix round 3, one item

Round 2 (`850c567`) is accepted in full, including both scope extensions. This round
is **one item**, and it is the one you flagged and left alone.

---

## Accepted, no change needed

**Your scope extension was right and I am not sending it back.** You asked whether
this round should have touched only the site R4 names. No — R4c is not a uniformity
nit, it is a mirror the F15 commit broke, and your sentence for it is the correct
standard: *fixing one of two instances of the same fail-open in the same block is how
the second survives review.* The same goes for R1's permanent half. Both stay.

**And the F15 sweep is the most valuable thing in this round.** My retraction was
about whether a variable name was safe; the actual hole was one check over, in the
setup mirror neither of us re-read, introduced by that same commit and absent from its
report. You found it by sweeping instead of spot-fixing. That is a better lesson than
the retraction was, and it is now the rule for this kind of change: **when a commit
changes a grader's spelling, the sweep covers the setups that mirror it, not just the
other graders.** Mandate 9 already implied it — a precondition must be the exact
negation of what the grader accepts — and neither of us read it that way until you
measured it.

Two of your measurements this round found things reading would not have, and both are
worth naming because they are the same class:

- **R2's first fix was still wrong**, and you caught it yourself: a `want=unavailable`
  sentinel meant a shadow field 8 literally reading `unavailable` would have *passed*.
  A false pass reachable from data is strictly worse than the crash it replaced, and
  guarding on `want_epoch` directly is the right shape.
- **R4 is not cosmetic.** `!=` and `grep -qx` are identical on one line, and you
  checked anyway — `state` captures stderr, so on a two-line capture beginning with
  `enabled` the `!=` form stops matching, setup proceeds believing httpd is disabled,
  and `httpd-enabled` passes at baseline. Fail-open. I had ruled that one as a
  three-line consistency edit; it was a bug.

---

## R6 — `028/setup.sh:21`. Fix it, using the machinery you built for R1.

I am overriding your recommendation to forward this, and the reason is your own
description of it: if `lo` sorts first, setup sets `autoconnect no` on loopback,
records `lo` in `/etc/rhcsa-conn`, and the break lands on the wrong interface — so the
task's premise never happens, `net-autoconnect` measures `lo`, and **every fixture
passes**. That is a silent false pass across a whole task, in content Task 22 authored,
in the task whose entire subject is restoring remote access. It is the project's named
defect class at task scale rather than checkpoint scale, and the existing guard catches
only an empty `conn`.

Forwarding it would park a known whole-task fail-open in a content bank that Tasks 23,
24 and 25 build on, to be reviewed after they do. One more commit now is cheaper than
that, and the risk is lower than when you flagged it, because **you already wrote the
missing piece this round**.

Your objection is correct as stated — line 21 needs a connection *name* and the
hardened R1 form yields a *device*, so it is not a drop-in — but that is a two-step
resolution, not a dead end, and it is exactly the pair R1's permanent half already
does:

1. Derive the device from the default route (`ip -o route show default`), as R1 does.
2. Ask which profile owns that device — `nmcli -g GENERAL.CONNECTION device show
   "$dev"`, testing for `--` — as R1's permanent half now does.

That yields a connection name, which is what line 21 wants, and it selects the profile
that actually carries remote access rather than whichever one sorts first. It preserves
the file's intent more faithfully than `head -1` did: the task means to break *the
network the student reaches the box over*, and the default route is the definition of
that.

Reuse the R1 code path rather than writing a second one. If the two blocks want a
small shared helper in the file, add one — but do not touch `content/lib/assert.sh`,
which is out of scope for this task.

Keep the existing empty-`conn` guard and make the new failure loud in the same shape:
if no default route exists, or no profile owns the device, `fail` with the batch's
"this guest was not built to `docs/vm-build-checklist.md`" wording rather than falling
through. Setup failing loudly on a guest that cannot run the task is the correct
outcome; setup breaking loopback and reporting success is not.

**Do not change which checkpoints exist, what `/etc/rhcsa-conn` is for, or how the
solutions read it.** If closing this cleanly turns out to require changing the
solutions or the grader, stop and tell me instead — that would mean the finding is
bigger than I have judged it and it should go to the whole-branch review after all.

Measure what you can in synthetic form, as you did for R1's 8 shapes: at minimum, the
"only `lo` managed" case and a normal case, and say plainly that whether NM can order
`lo` first is reasoned rather than measured. You were right not to rely on
`ens160` < `lo`.

---

## Gates

As before, all re-run with real output: tsc exit 0; vitest **246 passing / 23 files**;
`bash -n` on what you touch; coverage exit 0, no `problem:` lines; declared-vs-emitted
both directions with the five pairs unchanged; and the header check at the **26-line /
21-file scope you widened to** — that scope is now the standard for this task, not the
5-file one. `git status --porcelain` empty. Out-of-scope check as before.

No checkpoint added, removed or renamed. One commit, identity inline. Append as section
9 of `task-22-fix-1-report.md`.

## Prohibitions, unchanged

No VM operation, no `vmrun`, no `provision.sh`, no `ssh-keygen`, nothing written into
`/home/daxtangco/.ssh/`, no `.env.local`, no `shellcheck`, no subagents.

## Report

Return only: the commit sha, whether R6 is fixed and measured or reasoned, the gate
results, and anything you disagree with — including if you conclude mid-way that this
should have been forwarded after all. That conclusion is a legitimate outcome and I
would rather hear it than have you force the fix.
