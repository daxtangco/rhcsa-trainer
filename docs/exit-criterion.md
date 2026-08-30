# Phase 1 exit criterion

> The user completes a real graded LVM lab end to end including the reboot
> check, having learned the concept from a concept card rather than a book.

> **Status: NOT YET RUN.** The manual half below is a blank form. Nothing in it
> has been filled in, because the VM does not exist yet — the RHEL 9 DVD ISO is
> not downloaded. Phase 1's exit criterion is therefore **not met** as of this
> commit. When you run it, fill the form in yourself; if you find it already
> filled in, something wrote answers it did not earn and you should distrust
> the file.

Two halves. The automated half is `test/vm/e2e-exit-criterion.vm.test.ts`,
run with `npm run test:vm`. It proves the spine works: bank, session,
guest, grader, verdict A, reboot, verdict B, rating. It also checks that the
rung-2 nudge names the objective and both card titles without naming a single
command, and that rung 3 renders both cards in full. That is evidence the cards
were *shown*, and it is the closest a test can get. Whether they *taught* is the
"from the cards alone" question in "The run" below — referred to by name and not
by number, because the numbers move — and only you can answer it.

The manual half is below, and it is the half that matters. Fill in the
dates and the answers the first time you run it, and again whenever the
disclosure ladder or the content conventions change.

## The run

- Date:
- Mode: practice
- Task: `storage/014-grow-home-lv`
- Transport reported at startup:

1. Opened the picker. Every task lists a chapter number — `ch15` on
   `Grow /home to 12 GiB`, `ch22` on `Serve a directory on a non-standard port` —
   and **`Serve a directory on a non-standard port` is the one task carrying a
   `supporting` badge**: yes / no
   - It is the only `scope: instrumental` task in the bank, so it is the only
     badge that can render. If every task shows it, or none does, `scope` has
     stopped reaching the picker.
   - Nothing automated references `supporting` or asserts on a chapter number, so
     this line is the only check that exists on
     `src/web/components/TaskPicker.tsx:63-65`. It is a checklist item and not a
     test, which is precisely why it must not be dropped again.
2. Started the lab. The prompt was on screen the whole time: yes / no
3. `df -h /home` in the terminal showed a nearly full 8 GiB filesystem: yes / no
4. Pressed F2 twice and read both concept cards.
5. **Could you solve the task from the cards alone, with no other reference open?** yes / no
   - If no: what was missing from the cards?
6. Solved it. Commands used:
7. Pressed F4. Reboot check ran: yes / no. Result: __ / 5
8. Pressed F8. Rating:
   - The screen also states that the rating is **derived**: *"derived from the
     grade, the rung you needed and the time you took — nothing here is
     self-reported"*. Is that sentence present? yes / no
   - Not decoration. A student who thinks the rating is self-reported treats it as
     an opinion to argue with rather than a measurement, and the scheduler rests
     on it being the latter. The copy is at `src/web/App.tsx:281`, `App.tsx` has
     no test, so this line is its only check.

## The question the whole project turns on

> Was there any moment in that run where you wanted to open the book?

Answer honestly, and write down what you would have looked up. That
sentence is the first item of Phase 2's content backlog — a card that
should exist and does not is a more useful finding than any passing test.

## Second manual scenario, not yet run

**Status: NOT YET RUN.** Blank, under the same discipline as the form above.

Two things the Lab screen does that the run above never exercises, and that
have no automated coverage anywhere. Task 24 flagged both as the checks most
likely to rot unnoticed, because nothing fails when they break.

### Exam-mode masking

- Date:

1. Exam mode, `storage/014-grow-home-lv`, press F4 immediately without solving
   anything. A partial tally appears, the screen says *which ones is not shown
   in this mode*, and **no checkpoint name appears anywhere**: yes / no
   - The tally number is a prediction, not the assertion. "No names on screen"
     is the assertion. If a name appears, stop — that is the masking failing.
2. Press F2 twice in exam mode. The second is refused with `rung 2 is the
   maximum in exam mode`: yes / no
3. Press F8. The names now appear, with the rating: yes / no

### The persistence message on the reboot verdict

- Date:

4. Practice mode, solve the task, then comment `/home` out of `/etc/fstab` and
   press F4. The report says *"passed before the reboot and failed after it.
   That is a persistence failure"*: yes / no
   - Record the wording verbatim, including what it says about which checkpoint:
   - This is the output the whole design exists to produce. A run that reports a
     plain failure here, with no mention of persistence, is a defect and not a
     wording preference.

## Third: the foreign-origin refusal check, not yet run

**Status: NOT YET RUN.** Needs a real browser, which this host does not have.

This one stays manual on purpose. The automated arm cannot set a foreign
`Origin` header the way a browser does, so a unit test of it would be a test of
the test. Do not simplify it away.

- Date:

1. In an empty directory, `python3 -m http.server 8123`, and open
   `http://localhost:8123` in a browser.
2. In that page's console: `new WebSocket('ws://localhost:5175/ws/terminal')`
3. Expect a failure and **no** terminal. Console text, verbatim:

A **successful** connection here is a stop-the-line finding, not a note. The
`Origin` allowlist is the only thing between any page the student happens to
visit and a shell in a guest where `student` has passwordless sudo.

## Where Task 24's fifteen checks live now

Task 24 deferred fifteen browser/VM checks on two blockers — no ISO and no
browser — and handed them here rather than dropping them. This is the single
checklist; there is no parallel one. Every check has a home above.

| Task 24 check | Covered by |
|---|---|
| 1 picker lists chapter numbers and the `supporting` badge | "The run" item 1 |
| 2 start → prompt above a live shell | "The run" item 2 |
| 3 `df -h /home` shows a full 8 GiB | "The run" item 3 |
| 4 F2 → rung-2 nudge, no commands | "The run" item 4, and asserted by the e2e test † |
| 5 F2 again → both cards in full | "The run" items 4-5, and asserted by the e2e test † |
| 6 solve it in the terminal | "The run" item 6 |
| 7 F4 → reboot wait, then 5/5 named | "The run" item 7, and asserted by the e2e test † |
| 8 F8 → rating, derived not self-reported | "The run" item 8 (both halves), and the rating asserted by the e2e test † |
| 9-11 exam-mode masking | "Second manual scenario", exam-mode masking |
| 12-13 the persistence message | "Second manual scenario", persistence |
| 14 reset lab reverts machine and clock but not disclosure | "Fourth: reset", below |
| 15 foreign-origin WebSocket refusal | "Third", above |

**† The assertion exists; it has never executed.** `test/vm/e2e-exit-criterion.vm.test.ts`
is excluded unless `RHCSA_VM=1`, and no VM exists, so a `†` row has a *written*
assertion rather than a passing one. Read those four rows as "there is a test
waiting to run", not as coverage. The e2e suite has to run green once before any
`†` means what a "Covered by" column normally means.

Checks 1, 7, 8 and 9 carry predictions rather than assertions: check 1's task
count, check 7's `5 / 5`, check 9's partial `3 / 5` tally in exam mode, and check
8's specific rating all depend on the content and on the rung reached. Do not
treat a different number as a failure; treat a different *shape* as one — a
missing badge, an unnamed checkpoint, a rating that was asked for rather than
derived.

## Fourth: reset, not yet run

**Status: NOT YET RUN.**

- Date:

1. Mid-lab, reset the lab. A confirmation names both consequences: yes / no
2. About 15 s of `reverting...`, then the timer reads `00:00`, `df -h /home` is
   back to 8 GiB, the rung is **unchanged**, hints already open stay open, and
   the terminal is dropped: yes / no
   - The rung not rolling back is the design, not a bug. Otherwise reset is a
     way to launder hints out of the derived rating.

## The two full-bank validate runs

Also NOT YET RUN, for the same reason. The exit criterion is about one task, but
shipping a broken sibling is not a thing to discover in month three.

**Two runs, not one.** `npm run validate` with no arguments loads the whole bank,
and the transport is chosen once for the whole run — derived as `vmrun` if *any*
task asks for it — so a single full-bank run would push all thirty-two fixtures
through the slow transport and take most of a day.

```bash
cd /home/daxtangco/rhcsa-trainer
# The commands below redirect to a log and check the status before tailing, so
# `$?` is the validator's. pipefail is here for anything you add: after a
# pipeline `$?` is the *last* command's status, and `tail` succeeds
# unconditionally, so `… | tail -40` then `echo "exit=$?"` prints exit=0 whether
# the run passed or failed every fixture.
set -o pipefail

# the four ssh tasks: 26 fixtures, 45-60 minutes
npm run validate -- \
  storage/014-grow-home-lv \
  users/006-team-provisioning \
  selinux/019-httpd-alt-port \
  systemd/017-boot-time-service > /tmp/validate-ssh.log 2>&1
echo "exit=$?"
tail -40 /tmp/validate-ssh.log

# the vmrun task on its own: 6 fixtures, 15-20 minutes
read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD
npm run validate -- troubleshooting/028-restore-remote-access > /tmp/validate-vmrun.log 2>&1
echo "exit=$?"
tail -20 /tmp/validate-vmrun.log
```

The `read -rsp` form keeps the password out of your shell history. Do not paste
the password into the command line, and do not add it to `.env.local` unless you
want it on disk — `scripts/provision.sh` writes that key blank on purpose.

Expected: `transport: ssh` and **`26/26 fixtures ok`** from the first run,
`transport: vmrun` and **`6/6 fixtures ok`** from the second. Thirty-two
fixtures, `exit=0` both times.

A run's fixture count is **not** the number of files under `solutions/` and
`antisolutions/`. Each task also gets a synthetic empty `no-action` baseline
fixture, and the `fixture-inventory` gate enters the results **only when it
fails**, so a healthy bank contributes none. Per task that is
`1 + solutions + antisolutions`: 019 is 8, and 014, 017, 006 and 028 are 6 each.
The four ssh tasks are 26, `028` alone is 6, and the bank is 32. Recounting from
the file tree alone gives 22 and 5 and makes a correct run look wrong.

- ssh run: date, transport, fixtures ok:
- vmrun run: date, transport, fixtures ok:

If a fixture fails, fix the content, not the assertion.

## Known limits at this point

- One task per exam area at most; four areas of eleven have any content.
- FSRS is implemented and rated but nothing schedules from it yet: there
  is no "what should I practice today" screen.
- Sessions live in memory. Restarting the server loses history, so the
  ratings recorded above are not yet stored anywhere.
- The troubleshooting task (`028-restore-remote-access`) is graded through
  `rhcsa validate`, not the Lab screen: the server picks one transport at
  startup and that task needs `vmrun`.
- During a `vmrun` validate run the guest password appears in this host's
  process list, because `vmrun` takes it as a `-gp` argument and offers no
  file-based alternative for guest auth. This is a local-only, single-user
  tool and the limit is documented rather than fixed.
- The terminal is a fixed 100x30 and does not reflow.
- Teaching after a failed attempt is the rung-3 concept cards and nothing
  more. There is no per-task post-mortem written for the case where you got
  it wrong; spec §7.1's second half is Phase 2, and it needs a loader field
  and a slot in the session view before it needs prose.
- The UI shows which transport is live, not the VM's power state. Spec §11
  rule 1 is only partly met; a polled state indicator is Phase 2.
- `weight` is authored and validated but no selection logic reads it — spec
  §14.4 scheduling is Phase 2.
- The exam duration and passing score in `src/engine/exam/limits.ts` — 150
  minutes, 210 of 300 — are **UNCONFIRMED against Red Hat's published
  policy** and are marked as such in the source. Nothing gates on them yet.
- The RHEL 9 versus RHEL 10 taxonomy decision is **open**. Both objective
  files ship (`content/objectives.yaml`, `content/objectives-rhel10.yaml`)
  and tasks carry `editions:`, but which edition drives bulk Phase 2
  authoring is not decided.
- R1 — can WSL2 reach a VMnet8 guest over TCP/22 — remains **INCONCLUSIVE**.
  The guest half was never run, because there is no guest. See
  `docs/r1-findings.md`. A related sharp edge in `scripts/r1-probe.sh`: the
  summary's catch-all `*)` arm prints "R1 CONFIRMED AS A PROBLEM" for the
  `unknown` outcome as well as for `dropped`, so a failure the probe could
  not classify reads as a confirmed firewall problem. The classification
  itself is sound — a 5-second TCP timeout is `rc=124` and is handled
  explicitly, not swept into `unknown`.
- Nothing in Task 25's checklist above has been run. See the banner at the
  top: no VM exists on this machine yet.

Those limits are the Phase 2 backlog stated as facts rather than promises. Do
not soften them; a limit you can read is a limit you can plan around.

## What has to happen before Phase 1 can be called done

In this order. Only the last step makes the `phase-1` tag's message true.

1. Download the RHEL 9 binary DVD ISO from your own Red Hat Developer account
   and run `bash scripts/provision.sh`.
2. `npm run test:vm` — the automated half.
3. Both `npm run validate` runs above — 26/26 then 6/6.
4. The manual run at the top of this file, filled in by hand, including the
   book question.
5. `git tag -a phase-1 -m "Phase 1: five tasks, ten cards, graded end to end
   with the reboot check"` — **after** step 4, because only then is that
   message true.

`npm test`, `npm run typecheck` and `npm run lint:content` are green now and
need no VM. They are not the exit criterion.
