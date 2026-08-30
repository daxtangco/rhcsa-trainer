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

1. Build the lab VM once by hand: [`docs/vm-build-checklist.md`](docs/vm-build-checklist.md).
   You need a RHEL 9 binary DVD ISO from your own Red Hat Developer account.
2. Check that WSL can reach it: `bash scripts/r1-probe.sh` (Task 16; does not exist yet).
3. Configure it: `bash scripts/provision.sh` (Task 19; does not exist yet).
4. Check the content bank's state: `node src/cli/index.ts coverage`. Right
   now this exits non-zero and reports `content/tasks` and `content/concepts`
   as missing — that is expected at this point in the project, not a broken
   install. No task or concept content has been authored yet; that is Phase 2's
   job.
