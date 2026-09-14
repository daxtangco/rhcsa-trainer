import type { TaskSummary } from './api.ts'

export interface ChapterGroup {
  chapter: number
  tasks: TaskSummary[]
}

/**
 * Chapter order, with the empty chapters kept in.
 *
 * The order matters because the bank arrives in the order `bank.ts` loads it,
 * which sorts task *file paths* - so it comes out grouped by area and then by
 * authoring number, and `net/044` sits next to `net/045` while the chapters
 * interleave. That is the order the files were written in, not an order to study
 * in. The book's own order is a dependency order: chapter 15 assumes chapter 14,
 * and reading it the other way round is the thing the screens should not quietly
 * encourage.
 *
 * `chapters` comes from the book corpus (`GET /api/tasks`) and is a strictly larger
 * set than the chapters the bank covers, which is the whole point: a chapter with
 * no task is returned as an empty group rather than skipped, because the gaps are
 * the authoring backlog and a list that hides them makes 27 tasks look finished.
 * What a screen then *does* with an empty group differs by screen and is the
 * screen's business - the Lab picker has nothing to offer for one, while Learn has
 * the book's own exercises.
 *
 * A task whose chapter is *not* in `chapters` still gets a group. That covers both
 * the server-has-no-corpus case (`chapters` is `[]`, so grouping falls back to the
 * chapters the tasks name) and the case of a task claiming a chapter the book does
 * not have, which should be visible rather than dropped on the floor.
 *
 * Lives here rather than in either screen because both group the same list the same
 * way, and a second copy is a second answer to "what order do I study in".
 */
export function groupByChapter(tasks: TaskSummary[], chapters: number[]): ChapterGroup[] {
  const byChapter = new Map<number, TaskSummary[]>()
  for (const c of chapters) byChapter.set(c, [])
  for (const t of tasks) {
    const existing = byChapter.get(t.chapter)
    if (existing === undefined) byChapter.set(t.chapter, [t])
    else existing.push(t)
  }
  return [...byChapter.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, list]) => ({
      chapter,
      // Within one chapter, the id is the authoring order and there is nothing
      // better to sort on: two tasks in the same chapter do not declare which
      // comes first.
      tasks: [...list].sort((a, b) => a.id.localeCompare(b.id)),
    }))
}
