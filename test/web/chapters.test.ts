// `groupByChapter` is the one thing the Lab picker and the Learn sidebar share, and
// what it decides is what order a student studies in. Both screens have their own
// rendering tests; this file pins the contract they both lean on, in particular the
// two cases neither screen makes easy to see: an empty group is kept, and a task
// whose chapter is not in the book's list is still grouped rather than dropped.
import { describe, expect, it } from 'vitest'
import type { TaskSummary } from '../../src/web/api.ts'
import { groupByChapter } from '../../src/web/chapters.ts'

function task(id: string, chapter: number): TaskSummary {
  return {
    id,
    title: `task ${id}`,
    chapter,
    scope: 'exam-objective',
    difficulty: 2,
    timeBudget: 600,
    weight: 'medium',
    rebootCheck: false,
    transport: 'ssh',
    objectives: [],
  }
}

describe('groupByChapter', () => {
  it('sorts chapters numerically, not as the bank or as strings', () => {
    // Two failure modes in one assertion. The bank arrives sorted by task *file
    // path*, so `net/044` precedes `storage/014` whatever their chapters; and a
    // string sort would put 15 before 9. Both produce a list that reads as an order
    // to study in and is not one.
    const groups = groupByChapter([task('storage/014', 15), task('pkg/002', 9)], [9, 15])
    expect(groups.map((g) => g.chapter)).toEqual([9, 15])
  })

  it('keeps a chapter with no task as an empty group', () => {
    // The authoring backlog. Filtering these out is what makes 27 tasks look like a
    // finished bank; the screens differ in what they offer for one, and neither can
    // offer anything for a group it never receives.
    const groups = groupByChapter([task('storage/014', 15)], [12, 15])
    expect(groups.map((g) => [g.chapter, g.tasks.length])).toEqual([
      [12, 0],
      [15, 1],
    ])
  })

  it('falls back to the chapters the tasks name when the book list is empty', () => {
    // `chapters: []` means the server has no corpus loaded, which is a working lab
    // with no guided mode. Grouping on nothing would render nothing.
    const groups = groupByChapter([task('storage/014', 15), task('pkg/002', 9)], [])
    expect(groups.map((g) => g.chapter)).toEqual([9, 15])
  })

  it('still groups a task claiming a chapter the book does not have', () => {
    // An authoring mistake, or a chapter the corpus extraction missed. Either way it
    // has to be visible: silently dropping the task would hide a lab that exists.
    const groups = groupByChapter([task('storage/014', 15), task('odd/001', 99)], [15])
    expect(groups.map((g) => g.chapter)).toEqual([15, 99])
    expect(groups[1]?.tasks.map((t) => t.id)).toEqual(['odd/001'])
  })

  it('orders tasks within a chapter by id, which is the authoring order', () => {
    // Nothing better to sort on: two tasks in one chapter do not declare which comes
    // first. What matters is that it is stable and not the bank's path order.
    const groups = groupByChapter(
      [task('storage/021', 15), task('storage/014', 15), task('net/044', 15)],
      [15],
    )
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual([
      'net/044',
      'storage/014',
      'storage/021',
    ])
  })

  it('does not mutate the array it is given', () => {
    // It sorts, and the caller is a React component holding this array in state.
    const tasks = [task('storage/021', 15), task('storage/014', 15)]
    groupByChapter(tasks, [15])
    expect(tasks.map((t) => t.id)).toEqual(['storage/021', 'storage/014'])
  })

  it('deduplicates a chapter listed twice', () => {
    // `chapters` arrives deduplicated from the server, but the seeding loop and the
    // task loop write to the same map, so a repeat must not produce two groups.
    const groups = groupByChapter([task('storage/014', 15)], [15, 15])
    expect(groups.length).toBe(1)
    expect(groups[0]?.tasks.length).toBe(1)
  })
})
