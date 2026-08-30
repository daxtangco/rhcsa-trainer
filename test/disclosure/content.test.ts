import { describe, expect, it } from 'vitest'
import { commandSketch, rungContent, type RungContext } from '../../src/engine/disclosure/content.ts'
import type { ConceptSpec } from '../../src/engine/content/concept.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

const SOLUTION = `#!/usr/bin/env bash
# a comment
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home

uuid=$(sudo blkid -s UUID -o value /dev/mapper/rhel-home)
sudo sed -i '/home/d' /etc/fstab
printf 'UUID=%s /home xfs defaults 0 0\\n' "$uuid" | sudo tee -a /etc/fstab >/dev/null
sudo systemctl daemon-reload
`

const HEREDOC = `#!/usr/bin/env bash
set -euo pipefail
sudo tee /etc/systemd/system/x.service >/dev/null <<'EOF'
[Unit]
Description=nope
ExecStart=/bin/true
EOF
sudo systemctl daemon-reload
`

const TASK = {
  id: 'storage/014-grow-home-lv',
  title: 'Grow /home to 12 GiB',
  chapter: 15,
  scope: 'exam-objective',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  requiresConcepts: ['storage.lvm-abstraction-stack'],
  difficulty: 3,
  timeBudget: 600,
  weight: 'high',
  editions: ['r9'],
  rebootCheck: true,
  requiresDisks: 0,
  claims: [],
  transport: 'ssh',
  prompt: 'Grow the home logical volume to 12 GiB.',
  dir: '/content/tasks/storage/014-grow-home-lv',
} satisfies TaskSpec

const CONCEPT = {
  id: 'storage.lvm-abstraction-stack',
  title: 'Physical volumes, volume groups, logical volumes',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  sources: ['r9:ch15'],
  prerequisites: [],
  body: 'LVM puts two layers between a disk and a filesystem.',
  path: '/content/concepts/storage/lvm-abstraction-stack.md',
} satisfies ConceptSpec

function ctx(over: Partial<RungContext> = {}): RungContext {
  return {
    task: TASK,
    objectives: [{ id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] }],
    concepts: [CONCEPT],
    solution: SOLUTION,
    ...over,
  }
}

describe('commandSketch', () => {
  it('lists the commands in order, once each, with no arguments', () => {
    expect(commandSketch(SOLUTION)).toEqual([
      'lvextend',
      'xfs_growfs',
      'blkid',
      'sed',
      'printf',
      'tee',
      'systemctl',
    ])
  })

  it('drops the shebang, comments and set -e', () => {
    const s = commandSketch(SOLUTION)
    expect(s).not.toContain('set')
    expect(s).not.toContain('#!/usr/bin/env')
    expect(s).not.toContain('bash')
  })

  it('does not mistake heredoc bodies for commands', () => {
    // Without heredoc tracking this returns things like '[Unit]' and
    // 'Description=nope', which would be a nonsense hint.
    expect(commandSketch(HEREDOC)).toEqual(['tee', 'systemctl'])
  })

  // The three below assert absence, not an exact list. An exact list
  // over-specifies a heuristic, and the next person to improve the heuristic
  // deletes the test instead of the bug.
  it('does not tear a sed expression apart on its | delimiters', () => {
    // The real solutions/02-lvextend-r-by-uuid.sh line. Splitting on `|`
    // yielded 'home[[:space:]]' and "d'" as things to read the man page for.
    const line = "sudo sed -i '\\|[[:space:]]/home[[:space:]]|d' /etc/fstab\n"
    const s = commandSketch(line)
    expect(s).toEqual(['sed'])
    for (const cmd of s) {
      expect(cmd).not.toContain('[')
      expect(cmd).not.toContain("'")
    }
  })

  it('does not present ]] as a command', () => {
    const s = commandSketch('if [[ -n $x ]]; then\n  echo yes\nfi\n')
    expect(s).not.toContain(']]')
    expect(s).toContain('echo')
  })

  it('does not mistake a [ test argument for a command', () => {
    // `[` is noise and `-f` is skipped for its leading dash, so a walk that
    // continued past them emitted the basename of the *argument*: 'fstab'.
    const s = commandSketch('if [ -f /etc/fstab ]; then\n  cat /etc/fstab\nfi\n')
    expect(s).not.toContain('fstab')
    expect(s).toContain('cat')
  })
})

describe('rungContent', () => {
  it('rung 1 is the prompt and nothing else', () => {
    const c = rungContent(1, ctx())
    expect(c.kind).toBe('prompt')
    expect(c.body).toBe('Grow the home logical volume to 12 GiB.')
  })

  it('rung 2 names the objective and the concepts without saying how', () => {
    const c = rungContent(2, ctx())
    expect(c.kind).toBe('nudge')
    expect(c.body).toContain('Extend existing logical volumes')
    expect(c.body).toContain('Physical volumes, volume groups, logical volumes')
    // A nudge that contains a command is not a nudge.
    expect(c.body).not.toContain('lvextend')
  })

  it('rung 3 is the full text of every concept card', () => {
    const c = rungContent(3, ctx())
    expect(c.kind).toBe('concepts')
    expect(c.body).toContain('LVM puts two layers between a disk and a filesystem.')
  })

  it('rung 4 lists the commands without their arguments', () => {
    const c = rungContent(4, ctx())
    expect(c.kind).toBe('sketch')
    expect(c.body).toContain('lvextend')
    expect(c.body).toContain('xfs_growfs')
    // The point of a sketch is that it withholds the arguments.
    expect(c.body).not.toContain('12G')
  })

  it('rung 4 says so rather than rendering a dangling heading when there are no commands', () => {
    const c = rungContent(4, ctx({ solution: '' }))
    expect(c.kind).toBe('sketch')
    expect(c.body).not.toContain('In roughly this order')
    expect(c.body).toMatch(/no commands/i)
  })

  it('rung 5 is the solution verbatim', () => {
    const c = rungContent(5, ctx())
    expect(c.kind).toBe('solution')
    expect(c.body).toContain('sudo lvextend -L 12G /dev/rhel/home')
  })
})
