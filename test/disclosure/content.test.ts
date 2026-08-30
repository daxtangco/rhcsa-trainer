import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
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
    //
    // This line alone does not prove the mechanism: every fragment of it
    // contains a `[` or a `'`, so COMMAND_SHAPE would reject them wherever the
    // walk stopped. The two tests below carry that weight, with expressions
    // whose fragments are ordinary words.
    const line = "sudo sed -i '\\|[[:space:]]/home[[:space:]]|d' /etc/fstab\n"
    const s = commandSketch(line)
    expect(s).toEqual(['sed'])
    for (const cmd of s) {
      expect(cmd).not.toContain('[')
      expect(cmd).not.toContain("'")
    }
  })

  it('emits no word from inside a quoted run, even when the words look like commands', () => {
    // The real selinux/019 line, and the reason the claim "neither can leak an
    // argument" was false: splitting on `|` made pseudo-segments whose first
    // word was `Listen`, and the stop-at-the-command-position rule then emitted
    // it - the two httpd directives the task is about, under a heading that
    // promises arguments are omitted, followed by "read the man page".
    const s = commandSketch(
      "sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf\n" +
        'sudo sed -i \'s|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|\' /etc/httpd/conf/httpd.conf\n',
    )
    expect(s).toEqual(['sed'])
  })

  it('emits nothing from a quoted alternation or a quoted device name', () => {
    expect(commandSketch("grep -E 'foo|bar' /etc/hosts\n")).toEqual(['grep'])
    expect(commandSketch("sudo parted -s /dev/sdb print 'sdb1' 'sdb2'\n")).toEqual(['parted'])
  })

  it('treats << as a heredoc only where it is really one', () => {
    // HEREDOC_START used to be matched against the whole line, so any of these
    // put the walk into heredoc mode and silently discarded every following
    // line of the solution - a two-command sketch for a ten-command task.
    expect(commandSketch('grep -q x <<<WORD\nsudo blkid\n')).toEqual(['grep', 'blkid'])
    expect(commandSketch('echo "shift a << b"\nsudo blkid\n')).toEqual(['echo', 'blkid'])
    expect(commandSketch('blkid # see << EOF note\nsudo lvs\n')).toEqual(['blkid', 'lvs'])
    expect(commandSketch("printf 'usage <<HELP'\nsudo lvs\n")).toEqual(['printf', 'lvs'])
  })

  it('keeps skipping a real heredoc body, quoted delimiter or not', () => {
    const body = '[Unit]\nDescription=nope\n'
    expect(commandSketch(`sudo tee /etc/x >/dev/null <<'EOF'\n${body}EOF\nsudo lvs\n`)).toEqual([
      'tee',
      'lvs',
    ])
    expect(commandSketch(`sudo tee /etc/x <<EOF\n${body}EOF\nsudo lvs\n`)).toEqual(['tee', 'lvs'])
  })

  it('has these residuals, deliberately', () => {
    // Pinned rather than fixed: each needs a real shell parser, each is either
    // noise in a hint or under-disclosure that rung 5 covers, and pinning them
    // means a future rewrite has to notice it changed them.
    //
    // An *unquoted* delimiter still leaks one word.
    expect(commandSketch('sed -i s\\|a\\|b\\| /etc/hosts\n')).toEqual(['sed', 'hosts'])
    // A first word that is not a command shape stops the line dead.
    expect(commandSketch('$EDITOR /etc/fstab\n')).toEqual([])
    expect(commandSketch('> /etc/motd echo hi\n')).toEqual([])
    // A case block emits one word per pattern label, not just the first.
    expect(commandSketch('case $x in\n  a) echo one ;;\n  b) echo two ;;\nesac\n')).toEqual([
      'a',
      'echo',
      'b',
    ])
    // A command substitution inside double quotes goes with the quoted run.
    expect(commandSketch('sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" yes\n')).toEqual([
      'nmcli',
    ])
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

describe('commandSketch over the real bank', () => {
  /** Read-only. Nothing under content/ is written by this suite. */
  async function solution(relative: string): Promise<string> {
    return await readFile(fileURLToPath(new URL(`../../content/${relative}`, import.meta.url)), 'utf8')
  }

  it('does not hand rung 4 the two httpd directives selinux/019 is about', async () => {
    // This is the assertion whose absence let the leak look fixed: the mandate
    // was checked against a synthetic fixture while the file that defeats it
    // sat in the repo. `loadTaskScripts` sorts fixture names, so solution 01 is
    // the one rung 4 renders.
    const s = commandSketch(
      await solution('tasks/selinux/019-httpd-alt-port/solutions/01-semanage-fcontext-type.sh'),
    )
    expect(s).not.toContain('Listen')
    expect(s).not.toContain('DocumentRoot')
    // No word from a config file's directives, generalised: the leak's
    // signature was a capitalised argument presented as a command.
    for (const cmd of s) expect(cmd).toMatch(/^[a-z]/)
    // Still a useful sketch, not an empty one bought by over-stripping.
    expect(s).toContain('sed')
    expect(s).toContain('semanage')
    expect(s).toContain('restorecon')
    expect(s).toContain('firewall-cmd')
  })

  it('pins troubleshooting/028, the other sketch this change moved', async () => {
    // Exactly two bank sketches changed when quoted runs stopped contributing
    // words: 019 lost `Listen` and `DocumentRoot`, and this one lost `cat` from
    // `nmcli … "$(cat /etc/rhcsa-conn)"`. What survives is the whole answer to
    // "restore remote access", so the hint did not get worse - but it was the one
    // output this diff moved and did not pin, which is exactly the output a future
    // splitter change could move again unnoticed.
    expect(
      commandSketch(
        await solution(
          'tasks/troubleshooting/028-restore-remote-access/solutions/01-systemctl-firewallcmd-nmcli.sh',
        ),
      ),
    ).toEqual(['systemctl', 'firewall-cmd', 'nmcli'])
  })

  it('still sketches the other real solutions it is rendered from', async () => {
    expect(
      commandSketch(await solution('tasks/storage/014-grow-home-lv/solutions/01-lvextend-then-growfs.sh')),
    ).toEqual(['lvextend', 'xfs_growfs'])
    expect(
      commandSketch(await solution('tasks/users/006-team-provisioning/solutions/01-useradd-usermod-chage.sh')),
    ).toContain('useradd')
    // A heredoc body in a real solution, not a fixture of one.
    expect(
      commandSketch(await solution('tasks/systemd/017-boot-time-service/solutions/01-oneshot-multiuser.sh')),
    ).toEqual(['tee', 'systemctl'])
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
