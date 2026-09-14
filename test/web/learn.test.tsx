// @vitest-environment jsdom
//
// The Learn screen is a picker in front of `GuidedWalkthrough`, so what is worth
// testing here is the picking: which URL each source builds (the two guided routes
// disagree about percent-encoding, and one of them must keep a literal slash), and
// that an empty answer is rendered as an answer rather than as a failure. The
// typing gate itself is `guided-walkthrough.test.tsx`.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createApi, type GuidedItem, type TaskSummary } from '../../src/web/api.ts'
import { Learn } from '../../src/web/screens/Learn.tsx'
import { fakeFetch, routes } from './fake-fetch.ts'

function task(over: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'title'>): TaskSummary {
  return {
    chapter: 15,
    scope: 'exam-objective',
    difficulty: 2,
    timeBudget: 600,
    weight: 'medium',
    rebootCheck: false,
    transport: 'ssh',
    objectives: [],
    ...over,
  }
}

// The two tasks share an objective, which is why the objective list is deduped.
const TASKS: TaskSummary[] = [
  task({
    id: 'storage/014-grow-home-lv',
    title: 'Grow the home logical volume',
    objectives: ['storage.lvm.resize', 'storage.fstab.persistent'],
  }),
  task({
    id: 'storage/021-add-swap-file',
    title: 'Add a swap file',
    chapter: 14,
    objectives: ['storage.fstab.persistent'],
  }),
]

function item(over: Partial<GuidedItem> & Pick<GuidedItem, 'id'>): GuidedItem {
  return {
    chapter: 15,
    editions: ['r9'],
    crossEdition: false,
    shown: {
      edition: 'r9',
      title: 'Creating the Volume Group and Logical Volumes',
      preamble: '',
      steps: [
        { n: 1, text: 'Type pvcreate /dev/sdd1 to mark the partition.', commands: ['pvcreate /dev/sdd1'] },
        { n: 2, text: 'Open a root shell on server2.', commands: [] },
      ],
    },
    ...over,
  }
}

const ITEMS: GuidedItem[] = [
  item({ id: 'Exercise 15-2', editions: ['r9', 'r10'], crossEdition: true }),
  item({
    id: 'Exercise 15-3',
    shown: {
      edition: 'r9',
      title: 'Resizing Logical Volumes',
      preamble: '',
      steps: [{ n: 1, text: 'Type lvextend -r -L +100M /dev/vgdata/lvdata.', commands: ['lvextend -r -L +100M /dev/vgdata/lvdata'] }],
    },
  }),
]

function mount(handler: (url: string) => [number, unknown]) {
  const { impl, seen } = fakeFetch(handler)
  render(<Learn api={createApi(impl)} />)
  return seen
}

const TASK_ROUTE = '/api/guided/task/storage/014-grow-home-lv'

// Chapter 12 is the point of the list: the book has it, the bank has no task for
// it, and before `guidedForChapter` existed there was no way to reach its
// exercises from this screen at all. The real corpus has five of these.
const CHAPTERS = [12, 14, 15]

const OK = routes({
  '/api/tasks': { tasks: TASKS, chapters: CHAPTERS },
  [TASK_ROUTE]: { items: ITEMS },
  '/api/guided/objective/storage.fstab.persistent': { items: [] },
  '/api/guided/chapter/12': { items: [item({ id: 'Exercise 12-1', chapter: 12 })] },
  '/api/guided/chapter/14': { items: [] },
})

async function pickTheTask(seen: string[]) {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Grow the home logical volume/ })).toBeDefined(),
  )
  fireEvent.click(screen.getByRole('button', { name: /Grow the home logical volume/ }))
  await waitFor(() => expect(seen).toContain(TASK_ROUTE))
}

describe('Learn, the three ways in', () => {
  it('asks for a task by its unencoded id, slash and all', async () => {
    // The route is `/api/guided/task/:area/:slug`, so the slash in the task id is
    // part of the path. Percent-encoding it produces a 404 the screen would then
    // report as "the walkthroughs could not be read", and no fake client can catch
    // that mistake - which is why these tests drive the real client.
    const seen = await (async () => {
      const s = mount(OK)
      await pickTheTask(s)
      return s
    })()
    expect(seen).toContain(TASK_ROUTE)
    expect(seen.join(' ')).not.toMatch(/%2F/i)
  })

  it('lists the bank objectives it can see and says which ones it cannot', async () => {
    // Deduped across tasks and sorted. And captioned: there is no route that lists
    // the taxonomy, so this is the objectives some task claims - a subset - and a
    // student who cannot find an objective here needs to know it may still have
    // exercises rather than concluding the corpus lacks them.
    mount(OK)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'storage.fstab.persistent' })).toBeDefined(),
    )
    expect(screen.getAllByRole('button', { name: 'storage.fstab.persistent' }).length).toBe(1)
    expect(screen.getByRole('button', { name: 'storage.lvm.resize' })).toBeDefined()
    expect(screen.getByText(/not the full EX200 taxonomy/)).toBeDefined()
  })

  it('encodes an objective id, which has no slash to preserve', async () => {
    const seen = mount(OK)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'storage.fstab.persistent' })).toBeDefined(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'storage.fstab.persistent' }))
    await waitFor(() =>
      expect(seen).toContain('/api/guided/objective/storage.fstab.persistent'),
    )
  })

  it('reports a failed task list without pretending the corpus is empty', async () => {
    mount(routes({}))
    await waitFor(() => expect(screen.getByText(/the task list could not be read/)).toBeDefined())
  })
})

describe('Learn, by chapter', () => {
  const headings = () =>
    screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /^Chapter \d+/.test(t))

  const heading = (n: number) =>
    screen.getAllByRole('button').find((b) => (b.textContent ?? '').startsWith(`Chapter ${n}`)) ??
    null

  it('lists every chapter the book has, in chapter order, tasks or not', async () => {
    // The bank's own order is by task file path, so `storage/014` and `storage/021`
    // arrive 14-after-15. Chapter order is the book's dependency order, and the
    // chapters with no task stay in because the gap is the authoring backlog.
    mount(OK)
    await waitFor(() => expect(headings().length).toBe(3))
    expect(headings()[0]).toMatch(/^Chapter 12/)
    expect(headings()[1]).toMatch(/^Chapter 14/)
    expect(headings()[2]).toMatch(/^Chapter 15/)
  })

  it('says which chapters have no graded lab, on the heading itself', async () => {
    mount(OK)
    await waitFor(() => expect(heading(12)).not.toBeNull())
    expect(heading(12)?.textContent).toMatch(/no graded lab/)
    expect(heading(14)?.textContent).not.toMatch(/no graded lab/)
    expect(heading(15)?.textContent).not.toMatch(/no graded lab/)
  })

  it('nests each task under its own chapter, not the first one', async () => {
    mount(OK)
    await waitFor(() => expect(heading(14)).not.toBeNull())
    const group = (n: number) => heading(n)?.closest('li') ?? null
    expect(group(14)?.textContent).toMatch(/Add a swap file/)
    expect(group(14)?.textContent).not.toMatch(/Grow the home logical volume/)
    expect(group(15)?.textContent).toMatch(/Grow the home logical volume/)
    // The chapter with no task carries no task button, only the heading's note.
    expect(group(12)?.querySelectorAll('button').length).toBe(1)
  })

  it('opens a chapter the bank has no task for, which nothing else here can reach', async () => {
    // The whole reason the heading is a button. `guidedForTask` and
    // `guidedForObjective` both walk the bank, so chapter 12's exercises were in the
    // corpus and unreachable from this screen until this route existed.
    const seen = mount(OK)
    await waitFor(() => expect(heading(12)).not.toBeNull())
    fireEvent.click(heading(12) as Element)
    await waitFor(() => expect(seen).toContain('/api/guided/chapter/12'))
    // "1 walkthrough for chapter 12", not "for 12" - a bare chapter number in that
    // sentence reads as a count of something.
    await waitFor(() => expect(screen.getByText('1 walkthrough for chapter 12')).toBeDefined())
  })

  it('calls a chapter with no printed exercise an answer, not a failure', async () => {
    // Chapters 1, 27 and 28 are like this in the real corpus: the book teaches them
    // without a numbered exercise. Chapter 14 stands in for them here.
    const seen = mount(OK)
    await waitFor(() => expect(heading(14)).not.toBeNull())
    fireEvent.click(heading(14) as Element)
    await waitFor(() => expect(seen).toContain('/api/guided/chapter/14'))
    expect(screen.getByText(/No guided exercise for chapter 14/)).toBeDefined()
    expect(screen.queryByText(/could not be read/)).toBeNull()
  })
})

describe('Learn, the walkthrough list', () => {
  it('shows each exercise with its edition badge and step count', async () => {
    const seen = mount(OK)
    await pickTheTask(seen)

    expect(screen.getByText('2 walkthroughs for storage/014-grow-home-lv')).toBeDefined()
    expect(screen.getByText('Creating the Volume Group and Logical Volumes')).toBeDefined()
    expect(screen.getByText('Resizing Logical Volumes')).toBeDefined()
    // Only the cross-edition one is badged, and the ordering note explains why it
    // is first rather than leaving the order looking arbitrary.
    expect(screen.getAllByText('in both editions').length).toBe(1)
    expect(screen.getByText('2 steps')).toBeDefined()
    expect(screen.getByText('1 step')).toBeDefined()
  })

  it('opens a walkthrough and can come back out of it', async () => {
    const seen = mount(OK)
    await pickTheTask(seen)

    fireEvent.click(screen.getByRole('button', { name: /Exercise 15-2/ }))
    expect(screen.getByText(/mark the partition/)).toBeDefined()
    expect(screen.getByLabelText(/step 1/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /back to the 2 walkthroughs/ }))
    expect(screen.getByText('Resizing Logical Volumes')).toBeDefined()
  })

  it('resets the step position when a walkthrough is reopened', async () => {
    // The `key={open.id}` on `GuidedWalkthrough`: leaving and returning must not
    // drop the student back in at step 2 of an exercise they are starting again.
    const seen = mount(OK)
    await pickTheTask(seen)

    fireEvent.click(screen.getByRole('button', { name: /Exercise 15-2/ }))
    fireEvent.change(screen.getByLabelText(/step 1/), { target: { value: 'pvcreate /dev/sdd1' } })
    fireEvent.click(screen.getByRole('button', { name: /^Check$/ }))
    expect(screen.queryByLabelText(/step 1/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /back to the 2 walkthroughs/ }))
    fireEvent.click(screen.getByRole('button', { name: /Exercise 15-2/ }))
    expect(screen.getByLabelText(/step 1/)).toBeDefined()
  })

  it('calls an empty list an answer, not a failure', async () => {
    // `guidedForObjective` legitimately returns nothing: the corpus is keyed on
    // chapters, and chapters 1, 27 and 28 carry no numbered exercises in either
    // edition. Rendering that as an error would send the student looking for a bug.
    mount(OK)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'storage.fstab.persistent' })).toBeDefined(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'storage.fstab.persistent' }))
    await waitFor(() =>
      expect(screen.getByText(/No guided exercise for storage.fstab.persistent/)).toBeDefined(),
    )
    expect(screen.getByText(/not that anything is broken/)).toBeDefined()
    expect(screen.queryByText(/could not be read/)).toBeNull()
  })

  it('reports a failed corpus read as a failure', async () => {
    const seen = mount((url) =>
      url === '/api/tasks'
        ? [200, { tasks: TASKS, chapters: CHAPTERS }]
        : [500, { error: 'corpus not extracted' }],
    )
    await pickTheTask(seen)
    expect(screen.getByText(/the walkthroughs could not be read: corpus not extracted/)).toBeDefined()
    // And it is not confused with "the book has no exercise for this".
    expect(screen.queryByText(/No guided exercise/)).toBeNull()
  })
})
