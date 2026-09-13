# Coverage after Phase 2 batch D

Twenty-seven tasks and seventy concept cards. The original five
(`storage/014`, `systemd/017`, `users/006`, `troubleshooting/028`,
`selinux/019`) were a scaffolding sample chosen to stress-test the content
conventions across four shapes of question. Phase 2 has since added twenty-two
more in four batches:

- **Batch A** — `containers/030`, `containers/031`, `selinux/032`, `files/033`,
  `storage/034`, `sys/035` — brought the uncovered list down to 35.
- **Batch B** — `files/036`, `tools/037`, `tools/038`, `sys/039`, `sys/040`,
  `users/041` — took it from 35 to 20, and is the batch that closed the whole
  `tools.*` scripting and text group plus `sys.proc.*`, `sys.time.chrony` and
  `sys.tuned.profiles`.
- **Batch C** — `storage/042`, `storage/043`, `net/044`, `net/045`, `net/046` —
  took it from 20 to 12. It closed the entire remaining `storage.*` group
  (`partitions.mbr-gpt`, `lvm.pv`, `lvm.vg`, `nfs.mount`, `autofs.configure`)
  and every `net.*` objective the rig can reach (`hostname.resolution`,
  `firewall.restrict-access`, `ssh.key-auth`).
- **Batch D** — `tools/047`, `systemd/048`, `pkg/049`, `selinux/050`,
  `tools/051` — took it from 12 to 3, which is the floor. It closed all nine
  authorable ids at once, and it closed them in exactly the pairings the
  previous revision of this document predicted: `tools/047` took
  `tools.archive.tar`, `tools.ssh.client` and `tools.ssh.transfer` together,
  `selinux/050` took `selinux.ports.labels` and
  `selinux.modes.enforcing-permissive` together, `systemd/048` took
  `boot.targets.manual` with `boot.lifecycle.shutdown`, and `pkg/049` and
  `tools/051` took the remaining one each. Everything still on the uncovered
  list is excluded by the lab rig.

## The Phase 2 tasks have now been run against the guest

The previous revision of this document said, in bold, that none of them had.
That warning has been replaced by a measurement, which is the only thing that
should ever replace it. Every Phase 2 task has been through `npm run validate`
against the real RHEL 9 VMware guest — every solution executed, every
anti-solution shown to fail, and for `reboot_check` tasks a genuine reboot per
fixture rather than a simulated one:

| batch | tasks | fixtures | result |
| --- | --- | --- | --- |
| A + B | 12 | 101 | 101/101 |
| C | 5 | 39 | 32/39 |
| D | 5 | 41 | 38/41 |

Those are the **first** runs, kept as measured. The re-runs after each fix are
reported further down, and they are a separate claim: **every batch now stands at
its full count** — C at 39/39 and D at 41/41, with A + B unchanged at 101/101. No
fixture in the bank is failing and none is unmeasured.

The failures are the point of the exercise, and all three groups of them were
one defect each — not a scatter:

- **`tools/037`** failed all ten of its own fixtures in the A+B leg. Its
  `setup.sh` passed a GECOS string containing a colon to `useradd -c`, and
  `useradd` refuses the whole invocation: `VALID(s)` is
  `strcspn (s, ":\n") == strlen (s)` (shadow-utils 4.9, `src/useradd.c:114`),
  because a colon is the field separator of the `/etc/passwd` line the comment
  is about to become. Quoting cannot help — it is a well-formed single argument
  refused on its merits. The three strings were cosmetic, so the fix cost
  nothing; the table's 101/101 is the run after it.
- **`net/046`** failed all seven of its fixtures in batch C, on a *healthy*
  account. Its precondition demanded that `passwd -S` report `P`, which is
  what shadow-utils' own `passwd` prints — but RHEL 9 ships the libuser-based
  `passwd`, whose `pwdb_display_status` emits exactly `PS`, `NP` or `LK`
  (`libuser.c:281-311`) and never a bare `P`. The same wrong token had been
  *taught* in `content/concepts/users/shell-field-and-locked-accounts.md`,
  which is the more expensive half of the bug: a task that fails loudly gets
  fixed, and a card that is quietly wrong gets believed. Both are corrected.
- **`systemd/048`** failed the three fixtures that pin a kernel argument, and
  failed them *only in verdict B* — the phase the task exists to grade. After
  the reboot the pinned argument is finally on the kernel commandline, and
  `systemctl get-default` then prepends `Note: found "systemd.unit" on the
  kernel commandline, which overrides the default unit.` before the answer.
  The default target was still `multi-user.target` in all three runs; only the
  reading was wrong. Verdict A passes, because there the argument is written to
  the boot loader and not yet active — so a whole-capture comparison looks
  correct right up until the reboot it is supposed to survive. The unit name is
  now extracted by line shape, in the grader and in the precondition both, and
  the same reader was applied to `systemd/017`, which shares the parser and
  had no such note to trip over.

Those three are the argument for guest validation as a distinct gate, because
no static check and no path-rewritten simulation can reach any of them. The
colon needs a real `useradd`, the `PS` token needs a real `passwd`, and the
advisory note needs a real kernel commandline after a real reboot. The
`systemd/048` case is the sharpest: a run that stops at verdict A reports it
green.

Both re-validations were run against frozen copies of the bank, because their
graders had changed and a changed grader's green has to be re-earned rather than
inherited — including for `selinux/032` and `systemd/017`, which were green
before and whose new readers are behaviour-identical on a stock system. That is
deliberate: "the parser agrees on this input" is a claim, and this document's
whole premise is that claims about the guest get measured on the guest.

The first came back **15 of 16**. `net/046` went from 0/7 to 6/7 — the `PS` fix
worked, and the baseline, both solutions and anti-solutions 01 through 03 are
all green — and `selinux/032` re-earned 9/9 with the new config-file reader.

The single failure is worth the space, because re-validation is exactly what it
is for: it is a defect no fixture could reach before, since every one of them
used to die at the `passwd -S` precondition.
`net/046 antisolutions/04` reported `verdict A selinux-enforcing: expected fail,
got pass` and `verdict B deploy-key-login: expected fail, got pass`, and it took
two independent bugs to produce that pair:

- **The fixture stopped half way and reported success.** `sudo ausearch` was
  written without `< /dev/null`. ausearch reads its events from stdin whenever
  stdin is not a terminal, and a fixture arrives *on* bash's stdin — ssh.ts pipes
  it to `bash -s` — so ausearch consumed every remaining line and bash exited 0
  at end-of-input. `sudo setenforce 0` never ran, which is why SELinux was still
  Enforcing when the grader asked. Note the shape of this failure: no non-zero
  exit, no error text, a fixture that "passed" its own run and left the grader to
  be blamed for reading the machine correctly. Reproduced on the host, away from
  the guest, by running the same heredoc with and without the redirect.
- **The lesson it taught was false.** The fixture staged the key in `/tmp`, on the
  oldest SELinux story there is: a file moved in from `/tmp` keeps `user_tmp_t`
  and sshd cannot read it. On RHEL 9 it can. Queried against the guest's own
  policy build, `selinux-policy-targeted-38.1.75-2.el9_8`,
  `allow domain tmpfile:file { … read }` and
  `allow sshd_t user_tmp_type:file { … open … }` between them hand sshd
  open + read + getattr, so there was never a denial for the reboot to bring
  back and `deploy-key-login@post` could not fail however correct the grader was.
  The fixture now stages in `/root`: `sesearch -A -s sshd_t -t admin_home_t -c
  file -p read,open` returns nothing at all, and the only thing sshd may do with
  the type is traverse it. The three declared expectations are unchanged, which
  is the tell that the grader was right all along and the fixture was wrong.

That second one is the more valuable finding, and it did not come from the guest
alone: the guest said "this passed when it should not have", and the *shipped
policy* said why. Both halves were needed, and the policy half needs no VM —
`dnf download selinux-policy-targeted setools-console` and a `sesearch` against
`policy.33` answers it on any RHEL 9 machine. Wherever this bank asserts that
some label stops a service reading a file, that is the cheap way to check it
before writing it down. The same false claim had reached four other files in the
task and, worse, `content/concepts/net/ssh-permissions-and-strictmodes.md` — the
card the student actually reads. All are corrected, and the card now carries the
distinction the folklore hides: a label being wrong and a login being refused are
two different findings.

**The corrected fixture was then re-run against the guest, and `net/046` came back
7 of 7.** All three of its declared expectations landed exactly as declared —
`deploy-key-context` red in both verdicts, `selinux-enforcing` red in A and green in
B, `deploy-key-login` green in A and **red in B** — so the task once again delivers
the single `@post` regression that `grade.sh:443-444` calls the reason its second
verdict is worth collecting at all. Batch C is 39/39 and nothing in the bank is
outstanding.

The shape of that result is the point worth keeping. Not one declared expectation
was edited across either fix: the header still reads
`# expect-fail: deploy-key-context, selinux-enforcing@pre, deploy-key-login@post`,
byte-for-byte what it read when the run was red. A red run that goes green without
its expectations moving is a fixture that was wrong; a red run that only goes green
once the expectations are rewritten is usually a grader being taught to accept
whatever the machine happened to do. Keeping the header fixed is what made the two
outcomes distinguishable, and it is worth doing on purpose next time.

**Batch D's own re-validation came back 13 of 13**, which closes its defect
outright: `systemd/048` 7/7 and `systemd/017` 6/6. The three fixtures that pinned a
kernel argument now pass in verdict B — the phase they failed in and the phase the
task exists to grade — so reading the default target by line shape instead of by
whole-capture comparison was the right fix rather than merely a passing one. That
`systemd/017` also came back green is the part worth keeping: it shares the parser,
it was green before the change, and it had no advisory note to trip over, so its
6/6 is the evidence that the new reader is behaviour-identical on the input that was
already working. A fix to a parser that is only exercised on the input that used to
break it has been half tested.

The review pass that preceded validation is still worth trusting, for one
measurable reason: it found task-breaking defects the static gate cannot see.
`storage/043` asserted an NFS filesystem type on a mount that RHEL 9's
`automount` turns into a bind mount when the server is the local machine, which
would have failed 7 of 8 fixtures on *correct* answers; `net/045`'s setup
reloaded firewalld before proving ssh survived the reload; `net/044`'s setup
refused to run on exactly the machine it existed to repair, leaving
`/etc/hosts` with no localhost entries for the next fixture to be graded
against. A batch that has only been linted should be read as unreviewed — and
a batch that has only been reviewed should be read as unvalidated, which is
what the table above is for.

## The three that stay uncovered

All three are excluded by the lab rig rather than by the taxonomy or by
authoring debt, and this is now the entire uncovered list. `boot.grub.modify`
and `boot.rescue.interrupt` need the boot-time console — the student has to
interrupt GRUB and type at a prompt no transport in this repo can reach, so no
grader can observe the work. `net.addressing.ipv4-ipv6` would have the student
renumber the only NIC, which kills the control channel the grader arrives on:
unlike `storage/014`'s `/home` case, which the post-reboot fallback in
`GradeOptions.fallback` recovers, an unreachable *and* renumbered guest has no
second address for vmrun to find either.

They are listed here so nobody spends a batch rediscovering it. Closing any of
them is a change to the rig — a serial console, or a second NIC — and not a
content task. `objectives never taught and never demonstrated` is now the same
three ids, which is the expected result: nothing that a task could reach is
still unauthored.

`selinux/019-httpd-alt-port` no longer matters to this list. It is
`scope: instrumental` and so cannot confer coverage
(`src/engine/content/bank.ts:218-220`), and the two ids it used to exercise
without covering — `pkg.dnf.install` and `selinux.ports.labels` — are now
covered outright by `pkg/049` and `selinux/050`. The question of whether to
promote it is therefore moot.

**`unreachable concepts` is 0, and that took a task rather than a metadata
edit.** The story is worth keeping because it is the shape of a mistake this
report exists to catch. Twelve cards were once authored to close `objectives
with no concept card`, which they did — it went from 4 to 0 — but authoring a
card does not deliver it. A card reaches a student only if some task's
`requires_concepts:` names it, or if a card that a task does require lists it
as a prerequisite; all twelve initially satisfied neither, so `unreachable
concepts` was 12. Eleven were then wired to tasks whose declared objectives
already demanded them — `systemd.targets-and-default` to `systemd/017`
(`boot.targets.default`), `pkg.repos-and-dnf` to `selinux/019`
(`pkg.dnf.install`), `net.service-reachability` and `net.firewalld-zones` to
`troubleshooting/028`, and so on — plus two reached as prerequisites of cards
that tasks already require (`selinux.modes-now-and-at-next-boot` under
`selinux.reading-avc-denials`, `users.primary-vs-supplementary-groups` under
`files.setgid-on-directories`, both edges the cards' own prose already
implied).

The twelfth, `files.hard-vs-symbolic-links`, stayed unreachable for a batch and
was *left* that way deliberately: no task in the bank exercised links at all,
so there was nothing truthful to attach it to, and naming it in some adjacent
task's `requires_concepts:` would have cleared the count by making that task's
metadata lie about what it needs. It came off the list when
`files/036-links-and-relocation` made it true. That is the only correct way to
clear this list.

Batches C and D added fourteen cards between them and kept the count at 0 by
the same rule: each was named by the task that made it true, and none was
authored to close a gap. It is worth saying that the count staying at 0 across
fourteen cards is the cheapest evidence available that the metadata is honest,
because the one way to add an unreachable card is to write it for a task that
does not need it.

`untaught concepts: 1` is `users.primary-vs-supplementary-groups`, reached as a
prerequisite of `files.setgid-on-directories` but named by no task, and it
stays there deliberately: that list asks which cards no task *names*, a
stricter question than whether a student can get to them. Its former companion,
`selinux.modes-now-and-at-next-boot`, came off exactly as predicted — the
previous revision noted that it would the moment a task taught
`selinux.modes.enforcing-permissive`, since such a task must name it, and
`selinux/050` does. The two gaps really were the same gap seen from the card
side and the objective side.

Three of the four gap lists after the uncovered one are newer than the rest of
this document. `objectives with no concept card` is the other half of spec 6.2's
safety net — the uncovered list catches material that is never practised, this
catches material that is practised and never explained, and it counts tasks of
*any* scope, because an instrumental task still puts the objective in front of
the student. `objectives never taught and never demonstrated` is 6.2's own
phrase and is a subset of the uncovered list, so it is reported and not gated
on. `unreachable concepts` is stricter than `untaught concepts`: a card no task
names is still deliverable if a task-required card needs it first, which is how
`selinux.labels-now-vs-policy` reaches a student.

The generated block is generated, never hand-edited. Regenerate with
`npm run --silent coverage` and paste the output back into the block below —
the `--silent` is what keeps npm's own two banner lines out of the file. A
short uncovered list here would mean the objective taxonomy is incomplete, not
that the content is done; it is short now, so the taxonomy is the thing to
grow next.

<!-- the generated report follows -->

```
content root: content
tasks: 27
concepts: 70
objectives: 68
uncovered objectives: 3
  - boot.grub.modify
  - boot.rescue.interrupt
  - net.addressing.ipv4-ipv6
objectives with no concept card: 0
objectives never taught and never demonstrated: 3
  - boot.grub.modify
  - boot.rescue.interrupt
  - net.addressing.ipv4-ipv6
untaught concepts: 1
  - users.primary-vs-supplementary-groups
unreachable concepts: 0
```
