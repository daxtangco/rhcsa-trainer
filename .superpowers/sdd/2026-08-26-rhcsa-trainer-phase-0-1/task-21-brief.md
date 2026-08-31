### Task 21: Author the first task, end to end

The Phase 1 exit criterion runs through this directory. Everything before it was scaffolding for this.

**Files:**
- Create: `content/tasks/storage/014-grow-home-lv/task.yaml`
- Create: `content/tasks/storage/014-grow-home-lv/setup.sh`
- Create: `content/tasks/storage/014-grow-home-lv/grade.sh`
- Create: `content/tasks/storage/014-grow-home-lv/solutions/01-lvextend-then-growfs.sh`
- Create: `content/tasks/storage/014-grow-home-lv/solutions/02-lvextend-r-by-uuid.sh`
- Create: `content/tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh`
- Create: `content/tasks/storage/014-grow-home-lv/antisolutions/02-removed-persistence.sh`
- Create: `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`
- Create: `content/concepts/storage/lvm-abstraction-stack.md`
- Create: `content/concepts/storage/why-xfs-cannot-shrink.md`
- Create: `src/engine/validate/run.ts` (`validateBank` over many tasks)
- Modify: `src/cli/index.ts` (add the `validate` command deferred from Task 12)
- Test: `test/validate/run.test.ts`

**Interfaces:**
- Consumes: everything. `loadBank` (T7), `loadTaskScripts`/`validateTask` (T11), `chooseTransport` (T18), `VmController` (T17), `assert.sh` (T20), the objective ids from T13.
- Produces: the content conventions Task 22 copies, and `rhcsa validate [taskId]`.

**Two decisions worth stating before the code.**

**1. The task grows `/home`, not `/var`.** An anti-solution has to remove the mount's persistence to prove the reboot check works. Doing that to `/var` risks a machine that does not come back — RHEL 9 boots with an empty `/var` only sometimes, and when it does not, the harness reports `reboot failed` instead of the checkpoint failure it was testing. The harness cannot tell "correctly broken" from "unbootable", so the anti-solution would fail for the wrong reason. `/home` carries the same `storage.lvm.resize` objective, the same two-step grow, and the same persistence signature, and a machine with no `/home` boots every time.

**2. `fs-home-size` checks the size **and** the source device.** Either check alone has a hole. "Filesystem fills its LV" passes on an untouched system, so it cannot be a goal checkpoint. "Filesystem at `/home` is ≥ 12 GiB" passes after the mount disappears, because `/home` then falls back to the 12 GiB root filesystem. Requiring both closes it, and makes every fixture's outcome independent of what size the root LV happens to be.

- [ ] **Step 1: Write `task.yaml`**

`content/tasks/storage/014-grow-home-lv/task.yaml`:

```yaml
id: storage/014-grow-home-lv
title: Grow /home to 12 GiB
chapter: 15
scope: exam-objective
rhel: 9
objectives:
  - storage.lvm.resize
requires_concepts:
  - storage.lvm-abstraction-stack
  - storage.why-xfs-cannot-shrink
difficulty: 3
time_budget: 600
# Present in both editions' chapter 15, so it is durable core material
# (spec section 14.4).
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: ssh
prompt: |
  Users are reporting that /home is almost full.

  Make at least 12 GiB of space available under /home, using the free space
  already present in the volume group. Do not remove any existing data, and do
  not take space away from any other filesystem.

  Your change must still be in effect after a reboot.
```

- [ ] **Step 2: Write `setup.sh`**

Setup verifies the machine it was promised and then creates the pressure the prompt describes. It exits non-zero if the layout is wrong, which the harness reports rather than grading a machine that cannot be solved.

`content/tasks/storage/014-grow-home-lv/setup.sh`:

```bash
#!/usr/bin/env bash
# Prepare the system for storage/014-grow-home-lv.
#
# Idempotent: reset reverts to the `clean` snapshot, but setup must also
# survive being run twice against the same machine.
set -euo pipefail

fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

# --- preconditions ---------------------------------------------------------
# These are guarantees from docs/vm-build-checklist.md. If any is missing the
# task is unsolvable, and a checkpoint failure would be misleading.
src=$(findmnt -no SOURCE --target /home 2>/dev/null || true)
case $src in
  /dev/mapper/rhel-home | /dev/rhel/home) ;;
  *) fail "/home must be its own LV (found: ${src:-nothing}); see docs/vm-build-checklist.md" ;;
esac

free_extents=$(sudo vgs --noheadings --nosuffix --units b -o vg_free rhel 2>/dev/null | tr -d ' ')
[[ -n $free_extents ]] || fail "volume group 'rhel' not found"
if (( free_extents < 5 * 1024 * 1024 * 1024 )); then
  fail "VG rhel has only ${free_extents} bytes free; this task needs at least 5 GiB"
fi

# --- create the pressure the prompt describes -----------------------------
# A believable "/home is almost full" beats an instruction to resize something
# for no reason. fallocate is instant on XFS.
FILLER=/home/.rhcsa-filler.dat
if [[ ! -f $FILLER ]]; then
  sudo fallocate -l 6500M "$FILLER"
  sudo chmod 600 "$FILLER"
fi

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
: > "$HOME/.bash_history" 2>/dev/null || true

exit 0
```

- [ ] **Step 3: Write `grade.sh`**

`content/tasks/storage/014-grow-home-lv/grade.sh`:

```bash
#!/usr/bin/env bash
# Grader for storage/014-grow-home-lv.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL matters.
# assert.sh is prepended by loadTaskScripts, so its helpers are already here.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: lv-home-size, fs-home-size

TARGET=$(to_bytes 12G)
HOME_LV_MIN=$TARGET
VAR_MIN=$(to_bytes 2G)

# --- 1. the logical volume grew -------------------------------------------
lv_bytes=$(lv_size_bytes rhel home || echo 0)
if [[ ${lv_bytes:-0} -ge $HOME_LV_MIN ]]; then
  ck_pass lv-home-size "logical volume rhel/home is at least 12 GiB"
else
  ck_fail lv-home-size "logical volume rhel/home is at least 12 GiB" \
    "rhel/home is ${lv_bytes:-0} bytes; lvextend grows the volume"
fi

# --- 2. the filesystem grew too, and it is still the LV's filesystem ------
# Both halves are needed. "fills its LV" passes on an untouched system, and
# "is 12 GiB" passes once /home falls back to the 12 GiB root filesystem.
home_src=$(mount_source /home 2>/dev/null || true)
home_on_lv=no
case $home_src in
  /dev/mapper/rhel-home | /dev/rhel/home) home_on_lv=yes ;;
esac

fs_bytes=$(fs_size_bytes /home 2>/dev/null || echo 0)

if [[ $home_on_lv == no ]]; then
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" \
    "/home is not mounted from rhel/home (source: ${home_src:-none})"
# within_pct first, exact second. A 12 GiB XFS filesystem never reports 12 GiB
# usable — df shows space after metadata — so a bare `-ge $TARGET` fails both
# correct solutions and makes `6/6 fixtures ok` unreachable. This is exactly
# what within_pct exists for.
elif within_pct "${fs_bytes:-0}" "$TARGET" 2 || [[ ${fs_bytes:-0} -ge $TARGET ]]; then
  ck_pass fs-home-size "the filesystem on /home is at least 12 GiB"
else
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" \
    "df reports ${fs_bytes:-0} bytes; growing the LV does not grow the filesystem inside it"
fi

# --- 3. /home is still served by its own logical volume -------------------
if [[ $home_on_lv == yes ]]; then
  ck_pass home-from-lv "/home is mounted from the rhel/home logical volume"
else
  ck_fail home-from-lv "/home is mounted from the rhel/home logical volume" \
    "findmnt reports ${home_src:-nothing} for /home"
fi

# --- 4. nothing was taken from /var --------------------------------------
# An invariant: it passes from the start, and exists to catch a destructive
# answer that funds /home by damaging something else.
var_src=$(mount_source /var 2>/dev/null || true)
var_lv=$(lv_size_bytes rhel var || echo 0)
case $var_src in
  /dev/mapper/rhel-var | /dev/rhel/var)
    if [[ ${var_lv:-0} -ge $VAR_MIN ]]; then
      ck_pass var-intact "/var is untouched: still its own LV, still at least 2 GiB"
    else
      ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" \
        "rhel/var is now ${var_lv:-0} bytes"
    fi
    ;;
  *)
    ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" \
      "/var is mounted from ${var_src:-nothing}"
    ;;
esac

# --- 5. it survives a reboot ---------------------------------------------
# Mechanism-agnostic on purpose (spec 6.5 rule 1): fstab and a systemd mount
# unit are both correct answers, and a UUID is as good as a device path.
if is_persistent /home; then
  ck_pass persist-config "/home is configured to mount at boot"
else
  ck_fail persist-config "/home is configured to mount at boot" \
    "no /home entry in /etc/fstab and no matching .mount unit"
fi
```

- [ ] **Step 4: Write the two solutions**

Two *independent* correct paths, not two spellings of one. The second differs in both mechanism (`lvextend -r` instead of a separate `xfs_growfs`) and persistence expression (UUID instead of the device-mapper path). If a grader over-fits to one command or one fstab string, solution 02 is what catches it.

`solutions/01-lvextend-then-growfs.sh`:

```bash
#!/usr/bin/env bash
# The two-step path: grow the volume, then grow the filesystem inside it.
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home
```

`solutions/02-lvextend-r-by-uuid.sh`:

```bash
#!/usr/bin/env bash
# Equally correct, and deliberately different in two ways:
#   -r resizes the filesystem as part of lvextend, so no xfs_growfs runs
#   the fstab entry is re-expressed by UUID, so a grader that greps for
#   /dev/mapper/rhel-home would wrongly reject this
set -euo pipefail
sudo lvextend -r -L +4G /dev/mapper/rhel-home

uuid=$(sudo blkid -s UUID -o value /dev/mapper/rhel-home)
# The pattern requires whitespace on both sides of /home, so it cannot match
# a /home/something entry.
sudo sed -i '\|[[:space:]]/home[[:space:]]|d' /etc/fstab
printf 'UUID=%s /home xfs defaults 0 0\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
```

- [ ] **Step 5: Write the three anti-solutions**

Each declares exactly which checkpoints it must break. If the grader fails more or fewer than declared, `validate` fails — that is what makes these false-positive detectors rather than decoration.

`antisolutions/01-forgot-growfs.sh`:

```bash
#!/usr/bin/env bash
# The single most common real mistake: the volume grew, the filesystem did not.
# df still shows 8 GiB. Wrong in both verdicts.
# expect-fail: fs-home-size
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
```

`antisolutions/02-removed-persistence.sh`:

```bash
#!/usr/bin/env bash
# Correct right now, gone after a reboot. This is the persistence signature the
# whole reboot check exists to detect.
#
# persist-config is wrong immediately. home-from-lv and fs-home-size only break
# after the reboot, because until then /home is still mounted - which is exactly
# why one phase per file would not be enough to express this.
# expect-fail: persist-config, home-from-lv@post, fs-home-size@post
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home
sudo sed -i '\|[[:space:]]/home[[:space:]]|s|^|#|' /etc/fstab
sudo systemctl daemon-reload
```

`antisolutions/03-wrong-lv.sh`:

```bash
#!/usr/bin/env bash
# Grew the wrong logical volume: root got the space, /home did not. Proves the
# grader looks at rhel/home specifically rather than at "did the VG shrink".
# expect-fail: lv-home-size, fs-home-size
set -euo pipefail
sudo lvextend -r -L +4G /dev/rhel/root
```

- [ ] **Step 6: Write the two concept cards**

These are the reason the app can replace the book. The card is what the user reads at rung 3 of the disclosure ladder — it must actually teach, not gesture at a man page.

`content/concepts/storage/lvm-abstraction-stack.md`:

Six backticks on this block, not three: the card itself contains a fenced code block, and a three-backtick outer fence would end at the inner one instead of at the end of the card.

``````markdown
---
id: storage.lvm-abstraction-stack
title: Physical volumes, volume groups, logical volumes
rhel: 9
objectives: [storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
---
LVM puts two layers between a disk and a filesystem, and almost every LVM
mistake comes from forgetting one of them.

A **physical volume** is a whole disk or a partition that has been handed over
to LVM with `pvcreate`. A **volume group** pools one or more physical volumes
into a single space to allocate from — `vgcreate`, `vgextend`. A **logical
volume** is a slice carved out of that pool with `lvcreate`, and it is the only
one of the three you ever format and mount.

Read the stack from the bottom up and the commands stop needing memorisation:

```
filesystem   xfs, ext4          mkfs, xfs_growfs
logical vol  /dev/rhel/home     lvcreate, lvextend, lvs
volume group rhel               vgcreate, vgextend, vgs
physical vol /dev/sdb1          pvcreate, pvs
disk         /dev/sdb           lsblk
```

The consequence that catches people: **a filesystem does not notice that its
logical volume grew.** `lvextend` changes the size of the container; the
filesystem inside it keeps using the size it was created with, so `lvs` shows
12 GiB while `df` still shows 8 GiB. You either grow the filesystem afterwards
(`xfs_growfs /home`) or tell `lvextend` to do it for you (`lvextend -r`).

The other consequence is the useful one: because a logical volume is allocated
from a pool, it does not have to be contiguous and does not have to live on one
disk. That is why growing a volume almost never requires touching a partition
table, and why leaving free space *in the volume group* rather than in a
partition is what makes a system easy to extend later.

Three commands are worth reaching for before anything else: `lsblk` to see the
shape of the storage, `lvs` to see what LVM thinks the sizes are, and `df -h`
to see what the filesystems think. When `lvs` and `df` disagree, you already
know what went wrong.
``````

`content/concepts/storage/why-xfs-cannot-shrink.md`:

```markdown
---
id: storage.why-xfs-cannot-shrink
title: XFS grows but never shrinks
rhel: 9
objectives: [storage.lvm.resize]
sources: [r9:ch15, r10:ch15]
prerequisites: [storage.lvm-abstraction-stack]
---
XFS has no shrink operation. Not "it is risky", not "it needs a flag" — the
tooling does not exist. `xfs_growfs` grows a mounted filesystem; there is no
`xfs_shrinkfs`, and there never has been. XFS is the default filesystem on
RHEL, so on a stock system this is the case you are in.

The reason is that XFS spreads metadata across allocation groups over the whole
device as it is used. Shrinking would mean relocating metadata that the format
was never designed to relocate. Growing only adds allocation groups, which is
straightforward, so that is the only direction supported.

What this means in practice:

- `lvreduce` on a volume holding XFS **destroys data**. The volume shrinks; the
  filesystem does not know and keeps addressing blocks that are no longer
  there. `lvreduce` warns you. Believe it.
- To genuinely reclaim space from an XFS filesystem you back up the data,
  `lvremove` the volume, create a smaller one, `mkfs.xfs` it, and restore. That
  is a maintenance window, not a command.
- ext4 *can* shrink, but only while unmounted: `umount`, then
  `resize2fs /dev/vg/lv 4G`, then `lvreduce`. Filesystem first when shrinking,
  volume first when growing — the order is opposite in the two directions,
  and getting it backwards is how people lose data.

This is why sizing decisions matter more on RHEL than they might elsewhere, and
why the habit worth building is to **leave free extents in the volume group
rather than handing every extent to a filesystem on day one.** Space still in
the volume group can go anywhere. Space inside an XFS filesystem is committed
for good.

So when a task asks you to make room, the question is never "what can I
shrink" — it is "what free space does `vgs` show, and if the answer is none,
what disk can I add".
```

- [ ] **Step 7: Extract the validation loop, with a test**

Add `src/engine/validate/run.ts`, which is the part of `rhcsa validate` worth testing without a VM:

```ts
import type { TaskSpec } from '../content/task.ts'
import type { FixtureResult, HarnessDeps, TaskScripts } from './harness.ts'
import { validateTask } from './harness.ts'

export interface ValidateOptions {
  tasks: TaskSpec[]
  assertLib: string
  deps: HarnessDeps
  loadScripts: (task: TaskSpec, assertLib: string) => Promise<TaskScripts>
  onTask?: (taskId: string) => void
}

export interface ValidateSummary {
  results: FixtureResult[]
  failed: FixtureResult[]
}

/**
 * Run every fixture of every task. Never throws for content reasons: a task
 * whose scripts will not load is reported as a failed result, so one broken
 * task does not hide the state of the others.
 */
export async function validateBank(opts: ValidateOptions): Promise<ValidateSummary> {
  const results: FixtureResult[] = []

  for (const task of opts.tasks) {
    opts.onTask?.(task.id)

    let scripts: TaskScripts
    try {
      scripts = await opts.loadScripts(task, opts.assertLib)
    } catch (e) {
      results.push({
        taskId: task.id,
        kind: 'none',
        name: 'load-scripts',
        ok: false,
        failures: [e instanceof Error ? e.message : String(e)],
      })
      continue
    }

    results.push(...(await validateTask(task, scripts, opts.deps)))
  }

  return { results, failed: results.filter((r) => !r.ok) }
}
```

`test/validate/run.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateBank } from '../../src/engine/validate/run.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(id: string): TaskSpec {
  return {
    id,
    title: id,
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: false,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'p',
    dir: `/content/${id}`,
  }
}

const PASSING: TaskScripts = {
  setup: 'SETUP',
  grade: '# baseline-fail: goal\nGRADE',
  fixtures: [
    { kind: 'none', name: 'no-action', script: '' },
    { kind: 'solution', name: '01.sh', script: 'DO' },
    { kind: 'solution', name: '02.sh', script: 'DO' },
    { kind: 'antisolution', name: '01.sh', script: '# expect-fail: goal\n' },
  ],
}

function deps() {
  let done = false
  return {
    transport: new FakeTransport((script) => {
      if (script.includes('SETUP')) done = false
      else if (script.includes('DO')) done = true
      if (script.includes('GRADE')) {
        return {
          stdout: `{"id":"goal","desc":"g","status":"${done ? 'pass' : 'fail'}"}`,
          stderr: '',
          code: 0,
        }
      }
      return { stdout: '', stderr: '', code: 0 }
    }),
    reset: async () => {
      done = false
    },
    reboot: async () => {},
  }
}

describe('validateBank', () => {
  it('runs every fixture of every task and reports nothing failed', async () => {
    const seen: string[] = []
    const summary = await validateBank({
      tasks: [task('storage/014-a'), task('storage/015-b')],
      assertLib: '',
      deps: deps(),
      loadScripts: async () => PASSING,
      onTask: (id) => seen.push(id),
    })

    expect(seen).toEqual(['storage/014-a', 'storage/015-b'])
    expect(summary.results).toHaveLength(8)
    expect(summary.failed, JSON.stringify(summary.failed)).toEqual([])
  })

  it('reports an unloadable task as a failure instead of throwing', async () => {
    // One task with a missing grade.sh must not hide the state of the rest.
    const summary = await validateBank({
      tasks: [task('storage/014-a'), task('storage/015-b')],
      assertLib: '',
      deps: deps(),
      loadScripts: async (t) => {
        if (t.id === 'storage/014-a') throw new Error('ENOENT: grade.sh')
        return PASSING
      },
    })

    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.name).toBe('load-scripts')
    expect(summary.failed[0]?.failures[0]).toMatch(/ENOENT: grade\.sh/)
    // The second task still ran.
    expect(summary.results.filter((r) => r.taskId === 'storage/015-b')).toHaveLength(4)
  })
})
```

- [ ] **Step 8: Run the run.ts tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/run.test.ts`
Expected: FAIL first (module missing), then 2 tests PASS after Step 7's implementation is in place.

- [ ] **Step 9: Add the `validate` command to the CLI**

Add to `src/cli/index.ts`. The command is thin wiring: everything it decides is already unit-tested, and the acceptance step below is what proves the wiring.

```ts
// --- new imports ---
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateBank } from '../engine/validate/run.ts'
import { loadTaskScripts } from '../engine/validate/harness.ts'
import { loadVmConfig } from '../engine/vm/config.ts'
import { chooseTransport } from '../engine/vm/select.ts'
import { VmController } from '../engine/vm/vmrun.ts'
```

```ts
async function validate(argv: string[], io: CliIo): Promise<number> {
  const root = option(argv, 'content', 'content')
  const snapshot = option(argv, 'snapshot', 'clean')
  const wanted = positionals(argv)

  let bank
  try {
    bank = await loadBank(root)
  } catch (e) {
    if (e instanceof ContentError) {
      io.err(e.message)
      return 1
    }
    throw e
  }

  const tasks = wanted.length === 0 ? bank.tasks : []
  for (const id of wanted) {
    const t = bank.tasksById.get(id)
    if (!t) {
      io.err(`unknown task: ${id}`)
      return 1
    }
    tasks.push(t)
  }

  if (tasks.length === 0) {
    io.err(`no tasks found under ${root}/tasks`)
    return 1
  }

  const cfg = loadVmConfig(process.env)
  const controller = new VmController(cfg)
  // A task can require the vmrun transport; honour the strictest requirement
  // across the set rather than probing per task.
  const require = tasks.some((t) => t.transport === 'vmrun') ? 'vmrun' : undefined
  const transport = await chooseTransport(cfg, require ? { require } : {})
  io.out(`transport: ${transport.kind}`)

  const assertLib = await readFile(join(root, 'lib', 'assert.sh'), 'utf8')

  const summary = await validateBank({
    tasks,
    assertLib,
    deps: {
      transport,
      // Every fixture starts from the same known machine. This is the whole
      // reason the clean snapshot is captured live.
      reset: () => controller.revert(snapshot),
      reboot: () => controller.reboot(),
    },
    loadScripts: loadTaskScripts,
    onTask: (id) => io.out(`\n${id}`),
  })

  for (const r of summary.results) {
    io.out(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.kind}/${r.name}`)
    for (const f of r.failures) io.out(`         ${f}`)
  }

  io.out(
    `\n${summary.results.length - summary.failed.length}/${summary.results.length} fixtures ok`,
  )
  return summary.failed.length === 0 ? 0 : 1
}
```

Extend the dispatcher and usage:

```ts
const VALUE_FLAGS = new Set(['content', 'snapshot'])

/** Arguments that are not flags and not a flag's value. */
function positionals(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a.slice(2))) i += 1
      continue
    }
    out.push(a)
  }
  return out
}
```

```ts
const USAGE = `usage: rhcsa <command> [options]

commands:
  coverage              report content coverage gaps
  validate [task-id]    run every fixture of every task against the lab VM

options:
  --content <dir>       content root (default: ./content)
  --strict              coverage: exit non-zero while gaps remain
  --snapshot <name>     validate: snapshot to reset to (default: clean)`
```

```ts
    case 'validate':
      return await validate(rest, io)
```

- [ ] **Step 10: Check the content loads and every reference resolves**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
node src/cli/index.ts coverage; echo "exit=$?"
```

Expected: `tasks: 1`, `concepts: 2`, `untaught concepts: 0`, no `problem:` lines, `exit=0`.

**`untaught concepts: 0` is the assertion that matters** — it proves both cards are reachable through `requires_concepts`. If `problem: ... maps to unknown objective: storage.lvm.resize` appears, Task 13's transcription used a different id for that objective; change `task.yaml` and both cards to the real id rather than adding an id to `objectives.yaml` to suit the task.

- [ ] **Step 11: Check the scripts are valid bash before involving a VM**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
for f in content/tasks/storage/014-grow-home-lv/setup.sh \
         content/tasks/storage/014-grow-home-lv/grade.sh \
         content/tasks/storage/014-grow-home-lv/solutions/*.sh \
         content/tasks/storage/014-grow-home-lv/antisolutions/*.sh; do
  bash -n "$f" || echo "SYNTAX ERROR: $f"
done
echo "syntax pass complete"
```
Expected: no `SYNTAX ERROR` lines. `grade.sh` alone references helpers it does not define, which `bash -n` does not mind.

Also confirm every declared checkpoint id is one the grader actually emits:

```bash
cd /home/daxtangco/rhcsa-trainer
T=content/tasks/storage/014-grow-home-lv
emitted=$(grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+' "$T/grade.sh" | awk '{print $2}' | sort -u)
declared=$(grep -hoE '^# (expect|baseline)-fail:.*' "$T/grade.sh" "$T"/antisolutions/*.sh \
  | sed 's/^# [a-z]*-fail://' | tr ',' '\n' | sed 's/@.*//' | tr -d ' ' | sort -u)
comm -13 <(echo "$emitted") <(echo "$declared")
echo "^ any id above is declared but never emitted"
```
Expected: no output above the marker line.

- [ ] **Step 12: ACCEPTANCE — run the full fixture matrix against the VM**

This is the step that proves the grader is trustworthy. It runs 6 fixtures × up to 2 verdicts, each preceded by a snapshot revert, so budget 10–15 minutes.

```bash
cd /home/daxtangco/rhcsa-trainer
export RHCSA_GUEST_PASSWORD=...   # only needed if the vmrun transport is selected
node --env-file-if-exists=.env.local src/cli/index.ts validate storage/014-grow-home-lv
echo "exit=$?"
```

`--env-file-if-exists=.env.local` is what supplies `RHCSA_VMX` and `RHCSA_VM_IP`. Without it the command exits immediately with `RHCSA_VMX is not set`. Task 25 wraps this in `npm run validate` so the flag stops being something to remember.

Expected:
```
transport: ssh

storage/014-grow-home-lv
  ok   none/no-action
  ok   solution/01-lvextend-then-growfs.sh
  ok   solution/02-lvextend-r-by-uuid.sh
  ok   antisolution/01-forgot-growfs.sh
  ok   antisolution/02-removed-persistence.sh
  ok   antisolution/03-wrong-lv.sh

6/6 fixtures ok
exit=0
```

How to read a failure — the direction matters more than the count:

| Failure | What it means | Fix |
|---|---|---|
| `no-action`: `lv-home-size: expected fail, got pass` | the grader passes an untouched system | the checkpoint is not measuring what it claims |
| `no-action`: `var-intact: expected pass, got fail` | an invariant is broken at baseline | usually a wrong VM layout — re-read `setup.sh`'s preconditions |
| `solution/02`: any `expected pass, got fail` | **grader over-fitting** — the most valuable finding here | make the checkpoint mechanism-agnostic; do not change the solution to suit the grader |
| `antisolution/02`: `home-from-lv: expected pass, got fail` in verdict **A** | the phase is wrong: it breaks immediately, not only after the reboot | move the id off `@post` |
| `antisolution/*`: `expected fail, got pass` | **false positive** — the grader accepts wrong work | tighten the checkpoint |
| any fixture: `reboot failed: ...` | the guest did not come back | not a content bug; check the transport and `docs/r1-findings.md` |

**Do not proceed to Task 22 until this is `6/6`.** Every later task copies these conventions, so a flaw here is a flaw twenty times over.

- [ ] **Step 13: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/tasks content/concepts src/engine/validate/run.ts src/cli/index.ts test/validate/run.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): first graded task, two concept cards, rhcsa validate

The task grows /home rather than /var: an anti-solution has to remove the
mount's persistence to prove the reboot check, and a machine with no /var may
not come back - which the harness cannot distinguish from the checkpoint
failure it was testing. /home carries the same objective and boots every time.

fs-home-size checks both the size and the source device. Either alone has a
hole: 'fills its LV' passes on an untouched system, and 'is 12 GiB' passes once
/home falls back to the root filesystem.

Solution 02 differs in mechanism and in how persistence is expressed, so it
fails the moment a grader over-fits to one command or one fstab string."
```

---

