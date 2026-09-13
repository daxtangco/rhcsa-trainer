# RHCSA Lab Trainer

A hands-on trainer for the Red Hat RHCSA (EX200) exam. It runs graded labs
against a local RHEL 9 VM, built to be the learning surface itself rather than
a quiz bolted onto a book.

## Requirements

- Node 22 or newer. The project uses Node's native TypeScript stripping, so
  there is no build step.
- VMware Workstation on Windows, plus WSL2.
- A RHEL 9 binary DVD ISO from your own Red Hat Developer account.

## Getting started

0. `npm install`.
1. Build the lab VM once by hand: [`docs/vm-build-checklist.md`](docs/vm-build-checklist.md).
   You need a RHEL 9 binary DVD ISO from your own Red Hat Developer account.
2. Check that WSL can reach it: `bash scripts/r1-probe.sh`.
3. Configure it: `bash scripts/provision.sh`.
4. Check the content bank's state: `npm run coverage`. It prints the task,
   concept and objective counts and the gap lists, and exits 0. A long
   `uncovered objectives` list is the expected reading, not a broken install:
   the objective taxonomy is the whole RHCSA and the bank is being authored
   against it. `docs/coverage-phase-1.md` is the same report with the reasons
   written down, and is the file to compare against.

### Before you have a VM

Step 1 needs an ISO you have to download yourself, and the two steps after it
need the VM that ISO builds. That is most of a day before anything runs, so it
is worth knowing what does not wait for it. These three work on a fresh
checkout with no ISO, no VM and no `.env.local`:

```bash
npm run coverage       # what the content bank covers
npm run lint:content   # static checks on grader headers and checkpoint ids
npm test               # the unit suite
```

Everything else needs the guest. `npm run validate` and `npm run test:vm` both
exit with an error naming `RHCSA_VMX` if it is not there — that is the missing
VM, not a bad install. [`docs/exit-criterion.md`](docs/exit-criterion.md) is the
checklist for the first real run, and it is deliberately still blank.

## Running the trainer

Two processes. The API talks to the VM; Vite serves the UI and proxies to the API.

```bash
# terminal 1 - the API
npm run dev:server

# terminal 2 - the UI
npm run dev:web
```

Then open http://localhost:5173.

The API prints the transport it chose at startup. `ssh` is the normal case.
`vmrun` means SSH could not reach the guest — usable, but slow, and the
terminal pane will not work. Check that the VM is running, then re-read
`docs/r1-findings.md`: a Windows update can undo the change recorded there.

### Environment

These live in `.env.local` at the repo root, which is git-ignored.
`provision.sh` writes `RHCSA_VM_IP` into it for you; the rest come from
`docs/vm-build-checklist.md` section 6.

| Variable | Meaning | Default |
|---|---|---|
| `RHCSA_VMX` | absolute WSL path to the `.vmx` under `/mnt/c/...` | none — required |
| `RHCSA_VM_IP` | guest IP on VMnet8 | none — SSH is skipped without it |
| `RHCSA_SSH_USER` | guest account used for grading | `student` |
| `RHCSA_SSH_PORT` | guest SSH port | `22` |
| `RHCSA_SSH_KEY` | private key for that account | `~/.ssh/rhcsa_lab` |
| `RHCSA_VMRUN` | path to `vmrun.exe` | the VMware default install path |
| `RHCSA_TRANSPORT` | force `ssh`, `vmrun` or `fake` and skip probing | unset — probe |
| `RHCSA_GUEST_PASSWORD` | guest password, needed only by the `vmrun` transport | unset |
| `RHCSA_SNAPSHOT` | snapshot to revert to | `clean` |
| `RHCSA_PORT` | API port | `5175` |
| `RHCSA_CONTENT` | content bank root | `content` |

> Leave a key out of `.env.local` rather than setting it blank. Every loader
> sets an empty value as the empty string, which overrides the default shown
> above instead of falling back to it.

**Values are read literally, to the end of the line.** A Windows path needs no
quoting and no doubled backslashes: write `RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx`
exactly as the checklist shows it, spaces and all. Quote a value only to protect
a leading or trailing space you actually want.

That is true because every npm script now loads the file the same way, through
`node --env-file-if-exists=.env.local`. It was not always true, and the history
is worth keeping so it is not reintroduced: `test:vm` used to source the file
with `set -a; . ./.env.local`, and `/bin/sh` here is dash, which reads an
unquoted assignment as an escape sequence. Measured — the very
`RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx` line `scripts/provision.sh` writes
into the template arrived as `C:VMsrhcsa-labrhcsa-lab.vmx`, a path that does not
exist, with no error and no empty value to give the game away. A path holding a
space failed differently and more loudly: dash split on it and tried to *run*
`Files/VM/lab.vmx`, printing one `not found` to stderr, leaving the key empty,
and exiting 0. Either way the suite failed for a reason unrelated to its
subject. `provision.sh` fixed the same bug in its own parser earlier by reading
the file as data rather than as shell; this is the last consumer that had it.

If you run `node src/cli/index.ts` directly, pass
`--env-file-if-exists=.env.local` yourself or it will exit saying
`RHCSA_VMX is not set`.

Nothing here needs your Red Hat credentials. Do not put them in a file in
this repo.

### Checking the content

```bash
npm run lint:content                             # grader headers and checkpoint ids, no VM
npm run coverage                                 # objectives with and without tasks
npm run validate -- storage/014-grow-home-lv     # one task, 6 fixtures
npm run validate                                 # the whole bank - see the warning below
npm test                                         # unit tests, no VM needed
npm run test:vm                                  # VM-dependent suites, including the e2e
npm run corpus                                   # regenerate corpus/ from the PDFs, needs poppler
```

`npm run corpus` regenerates `corpus/` from the two source PDFs. It is the only
one of these that is not reproducible from a clean checkout: it shells out to
`pdftotext -layout` (poppler), and it expects the two PDFs at the paths hardcoded
in `scripts/extract-corpus.ts`. Nothing else needs it — `corpus/` is committed —
so run it only after changing the extractor, and check the counts in
`test/corpus/corpus-real.test.ts` afterwards, since every one of them is a
measurement of the artifact it produces.

Use the poppler RHEL 9 ships, 21.01.0. Not a style preference: `-layout` column
spacing differs between poppler versions, so a newer one rewrites bodies without
moving a single count, and the counts are what the tests watch. On this host it is
unpacked rather than installed — `extract()`'s comment carries the recipe, which
needs no root.

`npm run lint:content` is the only content gate that needs no hypervisor. It
reads the graders statically: every id a `# baseline-fail:`, `# expect-fail:` or
`# unprobed-invariant:` header names is emitted somewhere, every emitted id is a
literal the checkpoint counter can see, and every id follows the naming rule
below. It cannot tell you whether a grader is *correct* — that is
`npm run validate`, and that needs the guest.

`npm run validate` reverts the snapshot repeatedly and reboots the guest for
most fixtures. Do not run it while you are studying in the Lab screen — the
revert will take your work with it.

With no arguments it loads the whole bank, and the transport is chosen once
for the run: a single task declaring `transport: vmrun` pushes every fixture
through the slow path. Name the SSH tasks explicitly and run the `vmrun` ones
separately. `docs/exit-criterion.md` has the two commands.

The choice is only ever a requirement in that one direction, so **read the
`transport:` line of the output before you trust a pass.** A task declaring
`transport: ssh` gets validated over vmrun whenever the SSH probe fails, and it
says so in a `warning:` on stderr naming each affected task. That is not
pedantry: `storage/014-grow-home-lv` once failed two post-reboot checkpoints over
ssh and then passed 6/6 over vmrun with nothing changed in between, because its
`02-removed-persistence.sh` comments `/home` out of fstab and takes
`/home/student/.ssh/authorized_keys` down with it — a failure vmrun cannot see,
since it grades through `vmtoolsd` and never authenticates. Set
`RHCSA_TRANSPORT=ssh` to insist; it errors out instead of falling back.

That particular fixture is fixed rather than merely diagnosed: the post-reboot
grade run now retries over vmrun when the chosen channel produced no checkpoints
at all, so pinning 014 to ssh gives 6/6 and a `note:` naming the fallback instead
of a failure (`GradeOptions.fallback` in `src/engine/grading/grader.ts` explains
the three ways it is deliberately narrow). **Read that note when it appears.** It
means verdict B came from a channel you did not choose, which is a weaker claim
than the pass it sits under — and the warning above still matters, because the
fallback covers the post-reboot run only. Nothing rescues `setup.sh`, the fixture
script, or verdict A: a task that cannot be *set up* over the chosen transport
must fail loudly, not half-run somewhere else.

### Adding content

Copy `content/tasks/storage/014-grow-home-lv/` as the reference shape. The
rules the validator enforces:

- Two or more independent solutions. Two spellings of the same command are
  one solution; they do not catch a grader that over-fits.
- At least one anti-solution, with `# expect-fail:` naming the checkpoint
  ids it must fail.
- `# baseline-fail:` on `grade.sh` naming every goal checkpoint — the ones
  that must fail on an untouched machine. Invariant checkpoints are left out.
- Every checkpoint id is a literal. No loops, no interpolated ids: the masked
  checkpoint count is derived by reading the script, counting distinct ids.
  Emitting one id from several branches is normal and changes nothing.
- `requires_concepts` lists cards that exist. A missing card is a load error,
  not a warning.

And five conventions the validator does not enforce, or enforces only in part:

- **Any command that might read stdin needs `< /dev/null`.** Every script here is
  delivered *on bash's stdin* — the transport pipes it into `bash -s` — so a child
  that reads stdin consumes the rest of the script, and bash then exits **0** at
  end-of-input. No error, no non-zero exit, half the script never ran, and the
  fixture reports success. `ausearch` and `aureport` are the ones that catch people
  out, because they take their event stream from stdin whenever stdin is not a
  terminal: `-ts recent` names a time window, not an input, so the command line
  looks complete and is not. `ssh` needs `-n` or the redirect; `sftp` needs `-b`.
  This cost `net/046 antisolutions/04` a full validation run — ausearch ate the
  `sudo setenforce 0` the fixture existed to perform, and the grader was blamed for
  reading the machine correctly. `npm run lint:content` now checks this, and only
  for commands that read stdin *even when given arguments*; prompting commands like
  `dnf` and `parted` are excluded on purpose, because they fail loudly with their
  own message and listing them would flag correct lines.

- **Checkpoint ids are lowercase kebab-case** — `fs-home-size`, not
  `FS_Home_Size`. `npm run lint:content` enforces this; the runtime counter
  does not, and deliberately so. The counter accepts a wider id class than the
  convention allows, because a counter that misses an id fails *open*: it
  under-counts, `expectedTotal` lands low, and a grader that died half way
  reads as complete. Being permissive there and strict here is the design.
- **A checkpoint you emit but knowingly do not probe gets
  `# unprobed-invariant: <id>`, and must be absent from `# baseline-fail:`.**
  The live example is `content/tasks/storage/014-grow-home-lv/grade.sh:82`,
  `# unprobed-invariant: var-intact`: it asserts `/var` was left alone, which
  is already true on an untouched machine, so it cannot be a baseline failure.
  Only `rhcsa validate` and `npm run lint:content` check the declared ids
  against the emitted ones. An emitted id that **no** header anywhere in the task
  names — not `# baseline-fail:`, not `# unprobed-invariant:`, and no
  anti-solution's `# expect-fail:` — is an **error**: nothing states that
  checkpoint should exist, so a typo in its id reads as a passing invariant. An id
  named only by a sibling anti-solution's `# expect-fail:` stays a **note**,
  because that header is a second reference to the id and a rename breaks it
  loudly. `home-from-lv` and `persist-config` in 014 and `default-target` in 017
  are the three live notes.
- **A task's first solution should be straight-line commands.** Rung 4 shows a
  command sketch built from the sorted-first solution file, so `01-*.sh` is
  what the student reads. The sketch extracts leading words, so `for u in …`
  and `case` labels surface as noise. Keep `01-` linear and put the clever
  variant in `02-`. `solutions/01-lvextend-then-growfs.sh` is the model.
- **Do not write `ck_pass`, `ck_fail` or `ck_skip` followed by a word in a
  grader comment.** The id-extraction check in `docs/r1-findings.md` matches
  comment text as readily as code, so prose that looks like a call inflates the
  emitted set.
