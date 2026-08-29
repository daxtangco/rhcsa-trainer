import { describe, expect, it } from 'vitest'
import {
  allPassed,
  duplicateIds,
  parseVerdict,
  statusById,
} from '../../src/engine/grading/verdict.ts'

describe('parseVerdict', () => {
  it('parses one checkpoint per line', () => {
    const v = parseVerdict(
      [
        '{"id":"lv-var-size","desc":"var LV is >= 6G","status":"pass"}',
        '{"id":"persist-config","desc":"/var mounts at boot","status":"fail","detail":"no entry found"}',
      ].join('\n'),
    )

    expect(v.checkpoints).toHaveLength(2)
    expect(v.checkpoints[0]).toEqual({
      id: 'lv-var-size',
      desc: 'var LV is >= 6G',
      status: 'pass',
    })
    expect(v.checkpoints[1]?.detail).toBe('no entry found')
    expect(v.noise).toEqual([])
  })

  it('keeps non-JSON output as noise instead of throwing', () => {
    // Real graders leak stderr and tool chatter. Losing that output would make
    // a misbehaving grader impossible to debug; throwing would make one stray
    // warning destroy an otherwise valid grading run.
    const v = parseVerdict(
      [
        '  WARNING: device /dev/sdb not found',
        '{"id":"a","desc":"A","status":"pass"}',
        '',
        'not json at all',
      ].join('\n'),
    )

    expect(v.checkpoints).toHaveLength(1)
    expect(v.noise).toEqual(['WARNING: device /dev/sdb not found', 'not json at all'])
  })

  it('treats JSON that is not a checkpoint as noise', () => {
    const v = parseVerdict('{"unrelated":true}\n[1,2,3]')
    expect(v.checkpoints).toEqual([])
    expect(v.noise).toHaveLength(2)
  })

  it('rejects an unknown status as noise rather than inventing a verdict', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"probably"}')
    expect(v.checkpoints).toEqual([])
    expect(v.noise).toHaveLength(1)
  })

  it('carries an optional numeric weight through', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"pass","weight":3}')
    expect(v.checkpoints[0]?.weight).toBe(3)
  })

  it('does not let a truncated line between two checkpoints swallow either one', () => {
    // The failure this parser exists to prevent, concentrated into one input:
    // if a malformed middle line ever ate the checkpoint after it, the user
    // would see a failing score on a lab they actually got right, and the
    // scheduler would make them re-study an objective they had mastered.
    const v = parseVerdict(
      [
        '{"id":"a","desc":"A","status":"pass"}',
        '{"id":"b","desc":"B","status":"fail","det',
        '{"id":"c","desc":"C","status":"pass"}',
      ].join('\n'),
    )

    expect(v.checkpoints).toEqual([
      { id: 'a', desc: 'A', status: 'pass' },
      { id: 'c', desc: 'C', status: 'pass' },
    ])
    expect(v.noise).toEqual(['{"id":"b","desc":"B","status":"fail","det'])
  })
})

describe('duplicateIds', () => {
  it('finds repeated checkpoint ids', () => {
    const v = parseVerdict(
      [
        '{"id":"a","desc":"A","status":"pass"}',
        '{"id":"a","desc":"A again","status":"fail"}',
        '{"id":"b","desc":"B","status":"pass"}',
      ].join('\n'),
    )
    // Kept, not thrown: a duplicate is a grader authoring bug for `validate`
    // to catch, and blowing up mid-session would punish the user for it.
    expect(v.checkpoints).toHaveLength(3)
    expect(duplicateIds(v)).toEqual(['a'])
  })

  it('returns empty when ids are unique', () => {
    expect(duplicateIds(parseVerdict('{"id":"a","desc":"A","status":"pass"}'))).toEqual([])
  })
})

describe('allPassed', () => {
  it('is false when any checkpoint failed', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"fail"}',
    )
    expect(allPassed(v)).toBe(false)
  })

  it('treats skip as not-a-pass so a skipped check cannot fake success', () => {
    const v = parseVerdict('{"id":"a","desc":"A","status":"skip"}')
    expect(allPassed(v)).toBe(false)
  })

  it('is false for an empty verdict, because a grader that emitted nothing is broken', () => {
    expect(allPassed(parseVerdict(''))).toBe(false)
  })

  it('is true only when every checkpoint passed', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"pass"}',
    )
    expect(allPassed(v)).toBe(true)
  })
})

describe('statusById', () => {
  it('indexes statuses for comparison between verdict A and B', () => {
    const v = parseVerdict(
      '{"id":"a","desc":"A","status":"pass"}\n{"id":"b","desc":"B","status":"fail"}',
    )
    expect(statusById(v).get('a')).toBe('pass')
    expect(statusById(v).get('b')).toBe('fail')
  })
})
