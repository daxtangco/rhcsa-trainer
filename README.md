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
4. Check the content bank's state: `npm run coverage`. It reports five tasks
   and ten concepts against 68 objectives, and exits 0. Most objectives have
   no task yet — that is Phase 2's job, not a broken install.

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

> Leave a key out of `.env.local` rather than setting it blank. `npm run test:vm`
> exports every line it finds, and an exported empty value overrides the default
> shown above instead of falling back to it.

**Quote any value containing a space.** `RHCSA_VMX`, `RHCSA_VMRUN` and
`RHCSA_ISO` all commonly hold Windows paths under `/mnt/c/Program Files/...`.
`scripts/provision.sh:34` says this too, but it sits directly above the
`RHCSA_VMRUN` line and reads like advice about that one key. It is a house rule
for the whole file.

It matters more than a style rule, because the two loaders disagree. Measured:
`RHCSA_VMX=/mnt/c/Program Files/VM/lab.vmx`, unquoted, is read correctly by
`node --env-file-if-exists` — so `npm run dev:server` and `npm run validate`
work. But `npm run test:vm` sources the file with `. ./.env.local` under
`/bin/sh`, which is dash, and dash splits on the space and tries to *run*
`Files/VM/lab.vmx`. It prints one `not found` line to stderr, leaves `RHCSA_VMX`
**empty**, carries on to the next line, and exits 0. The suite then fails for a
reason that has nothing to do with the space. Quoting the value fixes it; the
same line quoted survives intact under both loaders.

The npm scripts load `.env.local` for you — `node --env-file-if-exists` for
the API and the CLI, `set -a; . ./.env.local` for `test:vm`. If you run
`node src/cli/index.ts` directly, pass `--env-file-if-exists=.env.local`
yourself or it will exit saying `RHCSA_VMX is not set`.

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
```

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

And four conventions the validator does not enforce, or enforces only in part:

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
  against the emitted ones — nothing enforces that the union of probed and
  unprobed ids accounts for every checkpoint a grader emits, so an id named by
  no header at all is legal and is reported as a note rather than an error.
- **A task's first solution should be straight-line commands.** Rung 4 shows a
  command sketch built from the sorted-first solution file, so `01-*.sh` is
  what the student reads. The sketch extracts leading words, so `for u in …`
  and `case` labels surface as noise. Keep `01-` linear and put the clever
  variant in `02-`. `solutions/01-lvextend-then-growfs.sh` is the model.
- **Do not write `ck_pass`, `ck_fail` or `ck_skip` followed by a word in a
  grader comment.** The id-extraction check in `docs/r1-findings.md` matches
  comment text as readily as code, so prose that looks like a call inflates the
  emitted set.
