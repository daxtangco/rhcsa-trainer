import { describe, expect, it } from 'vitest'
import { loadObjectives } from '../../src/engine/content/objectives.ts'

const ROOT = new URL('../../content/', import.meta.url).pathname

describe('content/objectives.yaml', () => {
  it('loads without a ContentError', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.version).toBe('rhel9')
  })

  it('cites its source, because the mapping tables are images and must be read visually', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.source).toMatch(/visual/i)
  })

  it('has exactly the published objective count', async () => {
    // The reasoning behind the original 20-80 bound: EX200 publishes dozens of
    // bullets across ~10 areas, so far fewer means bullets were merged and far
    // more means they were split. But a range that wide does not actually catch
    // a merge - collapsing two Table 1 rows into one entry takes the count to
    // 67 and stays inside it. The exact count does catch it.
    //
    // 68 is the RHCSA 9 Cert Guide Table 1 row count, section by section:
    // 11+4+10+6+6+6+4+4+9+8. Counted independently twice.
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.objectives.length).toBe(68)
  })

  it('covers every area the exam is organised around', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    const areas = new Set(set.objectives.map((o) => o.id.split('.')[0]))
    for (const area of [
      'tools',
      'files',
      'users',
      'storage',
      'boot',
      'systemd',
      'net',
      'pkg',
      'selinux',
      'containers',
      'sys',
    ]) {
      expect(areas, `missing area: ${area}`).toContain(area)
    }
  })

  it('includes the LVM and SELinux context objectives the Phase 1 tasks need', async () => {
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    const ids = set.objectives.map((o) => o.id)
    expect(ids.some((id) => id.startsWith('storage.lvm'))).toBe(true)
    expect(ids.some((id) => id.startsWith('selinux.'))).toBe(true)
    expect(ids.some((id) => id.startsWith('users.'))).toBe(true)
    expect(ids.some((id) => id.startsWith('systemd.'))).toBe(true)
  })
})

// Compares two objective texts for *meaning* rather than for exact bytes, so a
// cosmetic rewording between editions passes while a substantive one fails.
//
// Beyond the lowercase / whitespace / trailing-punctuation folding the taxonomy
// task called for, this also folds hyphens away. Red Hat respelled two bullets
// between editions without changing them at all - "multiuser" -> "multi-user"
// and "nondestructively" -> "non-destructively" - and minting a second
// permanent id for a hyphen would fork an FSRS scheduling key for no reason.
// Hyphen folding does not mask any of the real RHEL 10 changes: each of those
// differs in a whole word (star, MBR, systemd timer units, Content Delivery
// Network, firewalld, privileged) and so still gets its own id.
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/-/g, '')
    .replace(/[.,;:!?]+$/, '')
    .trim()
}

describe('content/objectives-rhel10.yaml', () => {
  it('loads and is tagged rhel10', async () => {
    const set = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    expect(set.version).toBe('rhel10')
  })

  it('has exactly the published objective count', async () => {
    // Same reasoning as the rhel9 count above: an exact count is what catches a
    // merged or split bullet, which a 20-80 range does not.
    //
    // 62 is Red Hat's published EX200 bullet count, section by section:
    // 11+4+4+10+6+5+6+4+4+8. It is also this file's row count, which is the
    // point - the two agree only if nothing was merged, split or dropped.
    const set = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    expect(set.objectives.length).toBe(62)
  })

  it('drops containers and adds flatpak, enumerating risk R2', async () => {
    const r10 = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    const areas = new Set(r10.objectives.map((o) => o.id.split('.')[0]))
    expect(areas.has('containers')).toBe(false)
    expect(r10.objectives.some((o) => o.id.includes('flatpak'))).toBe(true)
  })

  it('reuses ids for unchanged objectives so the two files diff meaningfully', async () => {
    const r9 = await loadObjectives(`${ROOT}objectives.yaml`)
    const r10 = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    const shared = r10.objectives.filter((o) => r9.byId.has(o.id))
    // Chapters 1-25 align 1:1 across editions, so most ids must be shared.
    expect(shared.length).toBeGreaterThan(r10.objectives.length / 2)
  })

  it('never reuses an id whose objective changed meaning between editions', async () => {
    const r9 = await loadObjectives(`${ROOT}objectives.yaml`)
    const r10 = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)

    // House style: report every divergence in one pass rather than failing on
    // the first, so a mistranscription is fixed in one edit.
    const divergent: string[] = []
    for (const o of r10.objectives) {
      const nine = r9.byId.get(o.id)
      if (nine === undefined) continue
      if (normalizeText(nine.text) !== normalizeText(o.text)) {
        divergent.push(`${o.id}: rhel9 "${nine.text}" vs rhel10 "${o.text}"`)
      }
    }

    expect(
      divergent,
      `shared ids whose text diverges - give the RHEL 10 objective its own id:\n${divergent.join('\n')}`,
    ).toEqual([])
  })
})
