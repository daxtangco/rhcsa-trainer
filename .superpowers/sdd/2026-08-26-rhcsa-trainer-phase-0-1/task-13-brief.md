### Task 13: Transcribe the objective taxonomies

Phase 0's central data artifact. **The mapping tables are rendered images in both editions** — `pdftotext` returns nothing for them, so they must be read visually.

**Files:**
- Create: `content/objectives.yaml`, `content/objectives-rhel10.yaml`
- Test: `test/content/objectives-real.test.ts`

**Interfaces:**
- Consumes: `loadObjectives` (T6).
- Produces: the objective id vocabulary every `task.yaml` and concept references. **Ids created here are permanent** — they are the FSRS scheduling keys, so renaming one later orphans history.

**Sources, in priority order:**
1. Red Hat's published EX200 objectives for RHEL 9 — the contractual statement of what is testable.
2. RHCSA 9 Cert Guide mapping table, **page 38** of `/mnt/c/Users/DaxAxisTangco/Downloads/(REFERENCE) Red Hat RHCSA 9 Cert Guide EX200.pdf`.
3. RHCSA 10 Cert Guide mapping table, **page 42** of `/mnt/c/Users/DaxAxisTangco/Downloads/Red_Hat_RHCSA_10_Cert_Guide_EX200_ER_-_Sander_van_Vugt.pdf`.

- [ ] **Step 1: Read the RHCSA 9 mapping table visually**

Use the `Read` tool with `pages: "38-40"` on the RHCSA 9 PDF. Record, verbatim, every row's Objective text and Chapter number. Do **not** use `pdftotext` — it returns an empty body for these pages because they are images.

- [ ] **Step 2: Cross-check against Red Hat's published list**

`WebFetch` `https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam` and reconcile. Where the book and Red Hat disagree on wording, **Red Hat's wording wins** and goes in `text:`; the book's chapter number goes in `chapters:`. Note any objective present in one source and not the other in a `# comment` on that entry.

- [ ] **Step 3: Write `content/objectives.yaml`**

Use dotted lowercase ids grouped by area. The file must open with the two required scalars, then one entry per objective:

```yaml
version: rhel9
source: "Red Hat EX200 published objectives, cross-checked against RHCSA 9 Cert Guide mapping table p.38 (read visually; the table is a rendered image)"
objectives:
  - id: tools.shell.essentials
    text: Use grep and regular expressions to analyze text
    chapters: [4]
  - id: storage.lvm.resize
    text: Extend existing logical volumes
    chapters: [15]
  # ... one entry per published objective, ids grouped by area:
  #   tools.*      shell, redirection, editors, archives, ssh, man
  #   files.*      permissions, ACLs, links, find
  #   users.*      local accounts, groups, aging, sudo
  #   storage.*    partitions, lvm, filesystems, swap, autofs, nfs
  #   boot.*       targets, grub, rescue, root password recovery
  #   systemd.*    services, units, timers
  #   net.*        addressing, hostname, firewall, ssh server
  #   pkg.*        dnf, repositories, modules
  #   selinux.*    modes, contexts, booleans, troubleshooting
  #   containers.* podman, rootless, systemd integration
  #   sys.*        tuned, time, logs, cron/at
```

Rules while transcribing:
- One objective per published bullet. Do not merge two bullets into one id, and do not split one bullet into two — the ids are the scheduling keys and must map 1:1 to what Red Hat publishes.
- Every id must match `^[a-z0-9]+(\.[a-z0-9]+(-[a-z0-9]+)*)+$`.
- `chapters` must be integers 1–28, at least one per objective.
- **Include the `containers.*` objectives.** They are in scope for RHEL 9 and are the single largest casualty if the exam version turns out to be RHEL 10 (risk R2).

- [ ] **Step 4: Write `content/objectives-rhel10.yaml`**

Repeat steps 1–3 against page 42 of the RHCSA 10 PDF, with `version: rhel10`. Nothing loads this file yet; it exists so the R2 delta is enumerated rather than guessed, per spec §16 Phase 0.

Reuse the same ids wherever an objective is unchanged, so a future diff of the two files is meaningful. Expect `containers.*` to be absent and a `pkg.flatpak.*` area to be present.

- [ ] **Step 5: Write the validation test**

`test/content/objectives-real.test.ts`:

```ts
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

  it('has a plausible objective count', async () => {
    // EX200 publishes dozens of bullets across ~10 areas. Far fewer means
    // bullets were merged; far more means they were split.
    const set = await loadObjectives(`${ROOT}objectives.yaml`)
    expect(set.objectives.length).toBeGreaterThanOrEqual(20)
    expect(set.objectives.length).toBeLessThanOrEqual(80)
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

describe('content/objectives-rhel10.yaml', () => {
  it('loads and is tagged rhel10', async () => {
    const set = await loadObjectives(`${ROOT}objectives-rhel10.yaml`)
    expect(set.version).toBe('rhel10')
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
})
```

- [ ] **Step 6: Run the tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test`
Expected: 8 new tests PASS. If the count assertion fails, re-read the source pages rather than adjusting the bound — the bound exists to catch merged or split bullets.

- [ ] **Step 7: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/objectives.yaml content/objectives-rhel10.yaml test/content/objectives-real.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): transcribe the RHEL 9 and RHEL 10 objective taxonomies

Both mapping tables are rendered images, so they were read visually rather
than extracted. Red Hat's published wording wins over the book's; the book
supplies chapter numbers. The RHEL 10 file enumerates risk R2 - containers
absent, flatpak present - and reuses ids so the two files diff meaningfully."
```

---

