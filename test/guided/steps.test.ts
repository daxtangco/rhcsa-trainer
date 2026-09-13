import { describe, expect, it } from 'vitest'
import {
  commandCandidates,
  parseGuidedSteps,
  parsePreamble,
  titleContinuation,
  typedStepMatches,
} from '../../src/engine/guided/steps.ts'

// Every rule in steps.ts came out of a measurement against the extracted corpus,
// and the point of these tests is to hold the rule still when the corpus changes
// under it. So the inputs are the real layout shapes, both editions' indentation
// included, rather than tidy invented text: a step parser that only works on tidy
// text is the parser this file replaced.

/** RHCSA 9's layout: step numbers at column 0-1, wrapped text at column 4. */
const R9 = [
  'Exercise 15-2 Creating the Volume Group and Logical Volumes',
  '',
  'In Exercise 15-1, you created a physical volume. You need it for this exercise.',
  '',
  ' 1. Open a root shell.',
  ' 2. Type vgcreate vgdata /dev/sdb1 to create the volume group.',
  '    Verify with vgs.',
  ' 3. Type lvcreate -n lvdata -L 1G vgdata.',
].join('\n')

/** RHCSA 10's layout: step numbers at column 7-8, wrapped text at column 10-11. */
const R10 = [
  'Exercise 15-2 Creating the Volume Group and Logical',
  '  Volumes',
  '        1. Open a root shell.',
  '        2. Type vgcreate vgdata /dev/sdb1 to create the volume',
  '           group.',
].join('\n')

describe('parseGuidedSteps', () => {
  it('reads a RHCSA 9 step list, undoing the hard wraps', () => {
    const steps = parseGuidedSteps(R9)

    expect(steps.map((s) => s.n)).toEqual([1, 2, 3])
    expect(steps[0]?.text).toBe('Open a root shell.')
    expect(steps[1]?.text).toBe(
      'Type vgcreate vgdata /dev/sdb1 to create the volume group. Verify with vgs.',
    )
  })

  it('reads a RHCSA 10 step list, whose numbers sit eight columns further right', () => {
    // The first version of this parser bounded the indent at three spaces and
    // found zero steps in 65 of the 85 RHCSA 10 exercises.
    const steps = parseGuidedSteps(R10)

    expect(steps.map((s) => s.n)).toEqual([1, 2])
    expect(steps[1]?.text).toBe('Type vgcreate vgdata /dev/sdb1 to create the volume group.')
  })

  it('ends the list at a number that is not the next one expected', () => {
    // What stops a body from swallowing the chapter prose that followed it in
    // print. RHCSA 9's Exercise 6-1 runs on into a two-item `sudo` list, and
    // without this rule gained two steps about visudo it never mentioned.
    const text = [
      'Exercise 6-1 Creating a User',
      ' 1. Open a root shell.',
      ' 2. Type useradd betty.',
      '',
      'Using sudo',
      ' 1. Type visudo.',
      ' 2. Add a line for betty.',
    ].join('\n')

    const steps = parseGuidedSteps(text)
    expect(steps.map((s) => s.n)).toEqual([1, 2])
    expect(steps.map((s) => s.text).join(' ')).not.toMatch(/visudo/)
  })

  it('ends a step at a line no further indented than its own number', () => {
    // Keeps the section heading and the shell transcript that follow the last step
    // out of that step's text. No blank line here on purpose: with one, the test
    // would pass on the blank-line rule alone and the indent rule could be deleted
    // unnoticed. Measured over the real corpus, 21 step endings are decided by the
    // indent rule on a non-blank line and 247 by a blank line, and the 21 are
    // exactly this shape — the next section heading at column 0 (*"Editing Files
    // with vim"*, *"Summary"*, *"End-of-Chapter Lab"*).
    const text = [
      'Exercise 15-3 Extending a Logical Volume',
      '        1. Type lvextend -L 6G /dev/vgdata/lvdata.',
      'Example 15-2 Verifying the extension',
      '[root@server1 ~]# lvs',
    ].join('\n')

    const steps = parseGuidedSteps(text)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.text).toBe('Type lvextend -L 6G /dev/vgdata/lvdata.')
  })

  it('drops the e-book link line the print edition had a code listing at', () => {
    // 90 occurrences in the real corpus, every one a line of its own. Before the
    // filter it was absorbed as a continuation and read as part of the step.
    const text = [
      'Exercise 4-1 Reading a Tar Archive',
      ' 1. Type file etc.tar and read the information. This should look like the',
      '    following:',
      'Click here to view code image',
    ].join('\n')

    expect(parseGuidedSteps(text)[0]?.text).toBe(
      'Type file etc.tar and read the information. This should look like the following:',
    )
  })

  it('joins a hyphen-broken token with no space, and an ordinary wrap with one', () => {
    // Both directions, because this is the rule most likely to be wrong for a
    // future corpus and the failure is silent: joining with a space produces
    // `firewall-cmd --add- service`, a command the student types wrong. All 29
    // hyphen-ending joins in the corpus today are mid-token breaks.
    const text = [
      'Exercise 23-1 Managing the Firewall',
      ' 1. Type firewall-cmd --add-',
      '    service=http --permanent.',
      ' 2. Type firewall-cmd --reload to activate',
      '    the new configuration.',
    ].join('\n')

    const steps = parseGuidedSteps(text)
    expect(steps[0]?.text).toBe('Type firewall-cmd --add-service=http --permanent.')
    expect(steps[1]?.text).toBe('Type firewall-cmd --reload to activate the new configuration.')
  })

  it('ignores the page-break form feed', () => {
    const text = [
      'Exercise 5-1 Working from Several Terminals',
      '\f 1. Start your computer.',
      ' 2. Log in as student.',
    ].join('\n')

    expect(parseGuidedSteps(text).map((s) => s.n)).toEqual([1, 2])
  })

  it('finds no steps in a body that has none, rather than inventing one', () => {
    expect(parseGuidedSteps('Lab 15.1\nCreate a volume group and a 6 GB logical volume.')).toEqual(
      [],
    )
  })
})

describe('titleContinuation', () => {
  it('returns the wrapped remainder of a RHCSA 10 heading', () => {
    expect(titleContinuation(R10)).toBe('Volumes')
  })

  it('returns undefined when the heading did not wrap', () => {
    expect(titleContinuation(R9)).toBeUndefined()
  })

  it('is not fooled by a Note box, which is the one false positive the corpus had', () => {
    const text = [
      'Exercise 3-3 Working with Files',
      '            Note',
      '            In this exercise dots are important.',
      '        1. Open a shell.',
    ].join('\n')

    expect(titleContinuation(text)).toBeUndefined()
  })

  it('is not fooled by a step, a long preamble line, or a sentence', () => {
    expect(titleContinuation('Exercise 7-2 Special Permissions\n 1. Start from a root shell.')).toBeUndefined()
    expect(
      titleContinuation(
        [
          'Exercise 14-3 Creating GPT Partitions',
          '     To apply the procedure in this exercise, you need an unused disk',
        ].join('\n'),
      ),
    ).toBeUndefined()
    expect(titleContinuation('Exercise 8-3 Managing Connections\n     with nmcli.')).toBeUndefined()
  })
})

describe('parsePreamble', () => {
  it('returns the prose between the heading and step 1', () => {
    expect(parsePreamble(R9)).toBe(
      'In Exercise 15-1, you created a physical volume. You need it for this exercise.',
    )
  })

  it('is empty when step 1 follows the heading directly', () => {
    expect(parsePreamble('Exercise 7-2 Special Permissions\n 1. Start from a root shell.')).toBe('')
  })

  it('does not read a wrapped title as the preamble', () => {
    // Before this, RHCSA 10's Exercise 15-2 opened with "Volumes In Exercise
    // 15-1, you created a physical volume", and 10 exercises had a "preamble"
    // consisting only of their own title's tail.
    expect(parsePreamble(R10)).toBe('')
  })

  it('keeps the preamble that follows a wrapped title', () => {
    const text = [
      'Exercise 24-3 Configuring Direct and Indirect Maps to',
      '    Mount NFS Shares',
      '    This exercise is performed on server1.',
      '        1. Install autofs.',
    ].join('\n')

    expect(parsePreamble(text)).toBe('This exercise is performed on server1.')
  })
})

describe('commandCandidates', () => {
  it('takes the command after each of the four imperatives', () => {
    expect(commandCandidates('Type pvs.')).toEqual(['pvs'])
    expect(commandCandidates('Run vgs to list volume groups.')).toEqual(['vgs'])
    expect(commandCandidates('Use lvs for a list of logical volumes.')).toEqual(['lvs'])
    expect(commandCandidates('Enter +1G to set the size.')).toEqual(['+1G'])
  })

  it('takes both commands when a step issues two', () => {
    expect(
      commandCandidates('Type exit to go back to a root shell, and next use su - laura.'),
    ).toEqual(['exit', 'su - laura'])
  })

  it('keeps a shell sequence joined by a semicolon whole', () => {
    // Measured: 14 of the 16 candidates abutting a semicolon are genuine
    // sequences the book prints on one line. Breaking there truncated all 14 to
    // their first command, which a student typing what the book shows would fail
    // to match.
    expect(commandCandidates('Type useradd betty; useradd amy.')).toEqual([
      'useradd betty; useradd amy',
    ])
  })

  it('takes a vim colon command, whose head starts with punctuation', () => {
    expect(commandCandidates('Type :wq to write the file and quit.')).toEqual([':wq'])
  })

  it('keeps a bang inside a command but not at the head of one', () => {
    // Measured, and the asymmetry is deliberate: the 4 corpus steps with a bang in
    // the *head* are `:wq!` (whose step already yields `:wq` from its first
    // imperative) and `!nn` (the book's own placeholder, which no student can type
    // literally), so admitting it would buy two duplicates and two candidates that
    // can never match.
    expect(commandCandidates('Type echo hello! > /tmp/f to write it.')).toEqual([
      'echo hello! > /tmp/f',
    ])
    expect(commandCandidates('Type :q! to quit without saving.')).toEqual([])
  })

  it('stops at a parenthetical', () => {
    expect(commandCandidates('Type dnf install -y dnsmasq (you may see a message).')).toEqual([
      'dnf install -y dnsmasq',
    ])
  })

  it('stops at a clause word, which is where the English resumes', () => {
    expect(commandCandidates('Type pvcreate /dev/sdd1 to mark the new partition.')).toEqual([
      'pvcreate /dev/sdd1',
    ])
  })

  it('rejects a capitalised head, because that is prose and not a command', () => {
    expect(commandCandidates('Press Enter to accept the default.')).toEqual([])
    expect(commandCandidates('Type Ctrl-X to boot.')).toEqual([])
  })

  it('returns nothing for a step that has no imperative', () => {
    expect(commandCandidates('Open a root shell on server2.')).toEqual([])
    expect(commandCandidates('Which command schedules a cron job for user lisa?')).toEqual([])
  })

  it('deduplicates a command a step names twice', () => {
    expect(commandCandidates('Type vgs. Then type vgs again.')).toEqual(['vgs'])
  })

  it('is honest about its false positives, which is why it is only a hint', () => {
    // Three of the 43 steps in the audited sample carry one of these. The step's
    // prose is always shown, so the cost is a rejected keystroke and not a hidden
    // step; the test exists so nobody mistakes the extractor for a parser.
    expect(commandCandidates('You need to type the root password on the console.')).toEqual([
      'root password',
    ])
  })
})

describe('typedStepMatches', () => {
  const step = { n: 1, text: 'Type lvextend -L 6G /dev/vgdata/lvdata.', commands: ['lvextend -L 6G /dev/vgdata/lvdata'] }

  it('accepts the command the book shows', () => {
    expect(typedStepMatches(step, 'lvextend -L 6G /dev/vgdata/lvdata')).toBe(true)
  })

  it('accepts surrounding and repeated whitespace, which bash does too', () => {
    expect(typedStepMatches(step, '  lvextend  -L   6G\t/dev/vgdata/lvdata  ')).toBe(true)
  })

  it('rejects the wrong case, because the shell does', () => {
    // A guided mode that accepted LVEXTEND would teach a habit the exam fails.
    expect(typedStepMatches(step, 'LVEXTEND -L 6G /dev/vgdata/lvdata')).toBe(false)
    expect(typedStepMatches({ n: 1, text: 'Type ls.', commands: ['ls'] }, 'LS')).toBe(false)
  })

  it('rejects a near miss', () => {
    expect(typedStepMatches(step, 'lvextend -L 6G /dev/vgdata/lvdat')).toBe(false)
    expect(typedStepMatches(step, 'lvextend-L 6G /dev/vgdata/lvdata')).toBe(false)
  })

  it('rejects an empty line', () => {
    expect(typedStepMatches(step, '   ')).toBe(false)
  })

  it('rejects everything for a step with no candidates, so callers must not gate on it', () => {
    // 347 of the corpus's 1405 steps are in this position. They advance on the
    // student's acknowledgement, with the book's prose in front of them.
    const prose = { n: 1, text: 'Open a root shell.', commands: [] }
    expect(typedStepMatches(prose, 'sudo -i')).toBe(false)
    expect(typedStepMatches(prose, '')).toBe(false)
  })
})
