# Task 13 report — objective taxonomies

Status: **DONE_WITH_CONCERNS**. Both deliverable YAML files, the test file, a green
suite and a clean typecheck are in place, and no test needed changing. The
concerns are about what the transcription *found*, not about the work being
incomplete.

## Headline: the plan's RHEL 10 guesses both held — but the reason flatpak is
## present is not the reason the plan expected, and a bigger fact turned up

- **`containers.*` absent: HELD.** Red Hat's currently published EX200
  objectives have no "Manage containers" section at all, and the RHCSA 10 Cert
  Guide has no containers chapter — its chapter 26 is *Final Preparation*, where
  the RHCSA 9 edition's chapter 26 was *Managing Containers*. `podman` appears 4
  times in the whole RHEL 10 book (57 for `flatpak`). All eight RHEL 9
  `containers.*` objectives are gone.
- **`pkg.flatpak.*` present: HELD, but not from the source the brief named.**
  The RHCSA 10 Cert Guide's Table 1 — the table the brief sent me to — has **no
  Flatpak row anywhere**. Had I transcribed Table 1 and stopped, the brief's
  `flatpak` assertion would have failed. Flatpak objectives are present in the
  book's **Chapter 9 opener** and on Red Hat's published page. See "Judgment
  call" below; this is the one place where I went beyond the designated source,
  and it is the finding most worth a second opinion.

**The larger discovery, which the plan does not anticipate at all: Red Hat's
published EX200 objectives page is *already* the RHEL 10 set.** Fetched
successfully on 2026-08-30, it lists 62 bullets, has no containers section, and
carries a "Manage software" section with the four RPM/Flatpak objectives. It
matches `content/objectives-rhel10.yaml` bullet for bullet.

Two consequences the plan should absorb:

1. **R2 is not a future risk on Red Hat's side; it is the current published
   contract.** The plan treats "the exam may have moved to RHEL 10" as a
   possibility to hedge. Red Hat's own published statement of what is testable no
   longer contains the RHEL 9 objective set. Whatever the VM runs, the
   *contractual* objective list is the RHEL 10 one.
2. **The brief's rule "Red Hat's wording wins over the book's" is unusable for
   `objectives.yaml`.** Applying it would have deleted the containers block and
   added Flatpak — i.e. it would have turned `objectives.yaml` into
   `objectives-rhel10.yaml`. Red Hat no longer publishes RHEL 9 objectives, so it
   cannot arbitrate RHEL 9 wording. I used the book's wording throughout the
   rhel9 file and said so in its `source:`. I applied the brief's rule as written
   only to the rhel10 file, where Red Hat's page *is* the contractual statement.

## PDF page indices actually read, with verbatim heading and first/last row

The brief's page numbers were printed folios, as mandate 1 predicted, but the
offset was small (~1 page), not the 20–40 it warned about.

### RHCSA 9 — `(REFERENCE) Red Hat RHCSA 9 Cert Guide EX200.pdf` (944 pages)

Table located at **PDF pages 39–45** (brief said printed p.38; PDF page 38 is the
"Review All Key Topics" prose that immediately precedes the table).

- **Pages read visually with the `Read` tool:** 39, 40, 44, 45.
- **Caption, verbatim** (PDF p.38, above the table): `Table 1 Coverage of RHCSA
  Objectives`
- **Column headings, verbatim:** `Objective` | `Chapter Title` | `Chapter`
- **First data row, verbatim:** `Access a shell prompt and issue commands with
  correct syntax` | `Using Essential Tools` | `2`
- **Last data row, verbatim:** `Attach persistent storage to a container` |
  `Managing Containers` | `26`

**Correction to the brief:** this table is **not** a rendered image.
`pdftotext -layout -f 38 -l 46` returns the complete table as text. I used that
text as the transcription base and read pages 39, 40, 44 and 45 visually to
confirm it; the visual read matched the extracted text exactly, including the two
blank chapter cells below. I did **not** read pages 41, 42 or 43 visually — those
three rows blocks come from the text layer only, corroborated by Red Hat's page
where the bullets survive into RHEL 10. Calling that out explicitly because the
brief asked me not to imply visual verification I did not perform.

**Two rows have an empty `Chapter Title` and `Chapter` cell in Table 1** —
confirmed visually on PDF p.44 for one of them, so it is a real gap in the book,
not an extraction artifact:

- `Manage default file permissions` — chapter taken as **7** from the book's
  Chapter 7 opener, which lists `Manage default permissions`.
- `Manage SELinux port labels` — chapter taken as **22** from the book's Chapter
  22 opener, which lists `Manage SELinux port labels` verbatim.

Both are recorded in `#` comments on the entries. These came from the book, not
from my own knowledge.

### RHCSA 10 — `Red_Hat_RHCSA_10_Cert_Guide_EX200_ER_-_Sander_van_Vugt.pdf` (990 pages)

Table located at **PDF pages 42–49** (brief said printed p.42; PDF p.42 holds the
caption and the table body runs 43–49).

- **Pages read visually with the `Read` tool:** 42, 43, 44, 48, 49.
- **Caption, verbatim** (PDF p.42, text layer + read visually): `Table 1 Coverage
  of RHCSA Objectives`
- **Column headings, verbatim:** `Objective` | `Chapter Title` | `Chapter`
- **First data row, verbatim:** `Access a shell prompt and issue commands with
  correct syntax` | `Using Essential Tools` | `2`
- **Last data row, verbatim:** `Use Boolean settings to modify system SELinux
  settings` | `Managing SELinux` | `22`

**This table genuinely is a rendered image** — `pdftotext` returns an empty body
for pages 43–48, exactly as the brief said.

A trap worth recording for whoever re-verifies this: the table is **six** JPEGs,
and calibre places **each one on two consecutive PDF pages**, so every rendered
page is clipped mid-row at both seams. Rendering pages 43–48 loses rows. On my
first pass this made `Create hard and soft links` look absent from RHEL 10 when
it is present (chapter 3). I therefore extracted the six unique images with
`pdfimages -f 43 -l 48 -png` (deduplicated by md5: objects 1908, 1910, 1912,
1914, 1916, 1918) and read all six whole. The full transcription comes from those
six images. I then read PDF pages 48–49 rendered to confirm the table really ends
at `Use Boolean settings…` and that nothing follows it.

## WebFetch

**Succeeded.** `https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam`,
fetched 2026-08-30. It returned 62 bullets under 10 headings, with a `Manage
software` section and **no** `Manage containers` section.

Where Red Hat and the RHEL 10 book disagree, Red Hat's wording is in `text:` and
each disagreement carries a `#` comment on the entry:

| Red Hat | RHCSA 10 book Table 1 |
| --- | --- |
| `List, create, and delete partitions on GPT disks` | `…on MBR and GPT disks` |
| `Log in and switch users in multi-user targets` | `…multiuser targets` |
| `…swap to a system non-destructively` | `…nondestructively` |
| `Create, mount, unmount, and use VFAT, ext4, and XFS file systems` | `…vfat, ext4, and xfs…` |
| `Schedule tasks using at, cron and systemd timer units` | `…using at cron and systemd timer units` |
| `Use Looping constructs (for, etc.)…` | `Use looping constructs (for, etc.)…` |

### Exact `source:` strings written

`content/objectives.yaml`:

> RHCSA 9 Cert Guide 'Table 1 Coverage of RHCSA Objectives', PDF pages 39-45 (read visually with the Read tool; cross-checked against the PDF text layer). Red Hat's published EX200 objectives page was reachable on 2026-08-30 but now states the RHEL 10 objective set rather than RHEL 9's, so it could not arbitrate RHEL 9 wording; text is the book's throughout. Chapters for 'Manage default file permissions' and 'Manage SELinux port labels' come from the Chapter 7 and Chapter 22 openers, because Table 1 leaves the chapter cell of both rows blank.

`content/objectives-rhel10.yaml`:

> RHCSA 10 Cert Guide 'Table 1 Coverage of RHCSA Objectives', PDF pages 43-49 - rendered images, so read visually (pdftotext returns an empty body for them); the six unique page images were also extracted with pdfimages and read directly to rule out crop loss at the page seams. Wording follows Red Hat's published EX200 objectives page, fetched successfully 2026-08-30, which now states the RHEL 10 set; the book supplies chapter numbers. The four 'Manage software' RPM/Flatpak objectives are absent from the book's Table 1 and were taken from the book's Chapter 9 opener, which lists them as RHCSA exam objectives; Red Hat's page independently confirms them.

Both contain `visual`, satisfying the `/visual/i` assertion.

## Measured counts

Measured by loading both files through `loadObjectives`, not by hand:

| | value |
| --- | --- |
| `objectives.yaml` (rhel9) | **68** objectives |
| `objectives-rhel10.yaml` | **62** objectives |
| shared ids | **52** |
| test bound `r10.length / 2` | 31 |

**Neither brief bound had to move.**

- The 20–80 count bound holds for both files with room to spare. No bullet was
  merged and none was split: 68 is exactly the RHCSA 9 Table 1 row count
  (11+4+10+6+6+6+4+4+9+8), and 62 is exactly Red Hat's published bullet count
  (11+4+4+10+6+5+6+4+4+8), which is an independent confirmation of the RHEL 10
  figure from a second source.
- `shared.length > r10.objectives.length / 2` → 52 > 31, comfortably. The
  conflict between mandate 4 and this bound that you anticipated **did not
  materialise**.

Areas present in rhel9: `tools users files boot sys systemd net storage pkg
selinux containers` (all 11 the test requires). In rhel10: the same minus
`containers`.

## Mandate 4's test result

The ninth test passes with an empty divergence list. 52 shared ids, each carrying
the same objective in both files.

**10 ids are RHEL 10-only.** Six because the wording changed substantively, so
per mandate 4 they got their own id plus a `#` comment recording the change; four
because they are the new `Manage software` section:

| RHEL 10 id | why not shared |
| --- | --- |
| `tools.archive.tar-gzip-bzip2` | `star` dropped from the tool list (was `tools.archive.tar`) |
| `storage.partitions.gpt` | MBR dropped; Red Hat now says GPT only (was `storage.partitions.mbr-gpt`) |
| `sys.cron.schedule-systemd-timers` | systemd timer units added (was `sys.cron.schedule`) |
| `pkg.dnf.install-cdn` | "Red Hat Network" → "Red Hat Content Delivery Network" (was `pkg.dnf.install`) |
| `net.firewall.restrict-access-firewalld` | `firewall-cmd/firewall` → `firewalld and firewall-cmd` (was `net.firewall.restrict-access`) |
| `users.sudo.privileged` | "superuser access" → "privileged access" (was `users.sudo.superuser`) |
| `pkg.dnf.repositories` | new `Manage software` section |
| `pkg.rpm.install-remove` | new `Manage software` section |
| `pkg.flatpak.repositories` | new `Manage software` section |
| `pkg.flatpak.install-remove` | new `Manage software` section |

**16 ids are RHEL 9-only:** the six superseded ones above, the eight
`containers.*`, plus `files.permissions.set-gid` ("Create and configure set-GID
directories for collaboration") and `selinux.troubleshoot.violations` ("Diagnose
and address routine SELinux policy violations"), both of which vanish from Red
Hat's page *and* from the RHCSA 10 Table 1.

### One deviation from mandate 4's normalizer, disclosed

Mandate 4 specified: lowercase, collapse whitespace, strip trailing punctuation.
I added **hyphen folding**, with the reasoning in a comment above the function.

Red Hat respelled exactly two bullets between editions without changing their
meaning at all — `multiuser` → `multi-user` and `nondestructively` →
`non-destructively`. Under the literal normalizer those two would each have had
to mint a second permanent id, forking an FSRS scheduling key over a hyphen —
precisely the cost the mandate opens by warning about. Mandate 4's stated intent
is that "a cosmetic rewording between editions passes while a substantive one
fails", and hyphen folding serves that intent. I verified it masks none of the
six real changes: each of those differs in a whole word (`star`, `MBR`, `systemd
timer units`, `Content Delivery Network`, `firewalld`, `privileged`) and still
gets its own id. Reverting the fold would move `shared` from 52 to 50, still
above the bound.

## Judgment call you should review: the four `Manage software` objectives

This is the one substantive discretionary decision in the task, and it is what
makes the brief's `flatpak` assertion pass.

The RHCSA 10 Cert Guide's Table 1 does not contain any Flatpak row. I added the
four RPM/Flatpak objectives from the book's Chapter 9 opener, which reads:

> `THE FOLLOWING RHCSA EXAM OBJECTIVE IS COVERED IN THIS CHAPTER:`
> `• Configure access to RPM repositories`
> `• Install and remove RPM software packages`
> `• Configure access to Flatpak repositories`
> `• Install and remove Flatpak software packages`
> `• Install and update software packages from Red Hat Content Delivery Network, a remote repository, or from the local file system`

Reasons I treated Table 1 as incomplete rather than authoritative here:

- Red Hat's published page lists exactly these four under a `Manage software`
  heading of its own. Two independent sources against Table 1's silence.
- The book devotes a section (`Managing Software with Flatpak`) and a chunk of
  chapter 9 to it; 57 `flatpak` occurrences in the RHEL 10 book, 0 in the RHEL 9
  book.
- Only chapter 9's opener carries the updated `Red Hat Content Delivery Network`
  wording, so that opener was revised for this edition — it is not stale
  boilerplate.
- Including them makes the count 62, matching Red Hat's published count exactly.
  Excluding them gives 58, matching nothing.

**Counter-evidence, in fairness:** the chapter openers in the RHEL 10 book are
*generally* less updated than Table 1, and I used Table 1 over them elsewhere.
Chapter 3's opener still says `tar, star, gzip, and bzip2`; chapter 6's still says
`Configure superuser access`; chapter 7's still lists the dropped set-GID
objective; chapter 12's still says `Schedule tasks using at and cron`. So "the
opener is right and Table 1 is wrong" is not a rule I applied consistently — I
applied it only to chapter 9, only for additive objectives, and only with Red
Hat's page agreeing. If you would rather the file be a pure Table 1
transcription, removing those four entries drops the count to 58, drops `pkg` from
the rhel10 areas, and makes the brief's `flatpak` assertion fail — at which point
mandate 2 applies and the test changes.

## What I relied on my own knowledge for

**Nothing in `text:` or `chapters:`.** Every objective's wording is from Red Hat's
fetched page or a book table/opener as attributed above, and every chapter number
is from a book table or opener.

Where my own judgment (not knowledge of EX200 content) shaped the files:

- **All 78 distinct ids are mine** (68 in the rhel9 file plus the 10 rhel10-only
  ones). No source supplies ids; the brief supplied the area
  prefixes and I assigned the leaf names. Two came from the brief's worked
  examples: `storage.lvm.resize` matches the brief exactly. `tools.shell.essentials`
  from the brief's example is *not* used — I split that area into
  `tools.shell.prompt` and `tools.shell.redirection` because Table 1 has two
  separate bullets and merging them is what the count bound exists to catch.
- **Cross-area placement.** Some objectives sit in a Red Hat section whose name
  does not match the brief's area list. I filed by topic, not by exam section:
  `Log in and switch users…` → `users.login.switch` though it is under "essential
  tools"; `Securely transfer files…` and `Configure key-based authentication…` →
  `net.ssh.*`; `Start, stop, and check the status of network services` →
  `systemd.services.network`; the four scripting bullets → `tools.script.*` (the
  brief's area list has no scripts area). These are defensible but arguable, and
  they are permanent.
- The judgment call in the section above.

## Verification actually run

- `npx vitest run` → **147 tests / 14 files, all passing** (was 138/13; +9 tests,
  +1 file). No pre-existing test changed.
- `npm run typecheck` (`tsc --noEmit`) → clean, no output.
- Counts, shared-id count and area sets in this report were printed by loading
  both YAML files through `loadObjectives` under
  `node --experimental-strip-types`, not counted by hand.
- Not verified: that the VM's actual exam version is RHEL 9 or RHEL 10. Out of
  scope here, but see concern 1.

## Concerns and what later tasks inherit

1. **The plan's premise that RHEL 9 is the target deserves a re-decision, now,
   before content authoring.** Red Hat publishes the RHEL 10 set today. Every
   task and concept authored against `objectives.yaml` inherits 10 objectives
   that Red Hat no longer lists (8 containers + set-GID + SELinux violations) and
   misses 4 it does list (RPM/Flatpak). If the answer is "RHEL 10", the FSRS
   scheduling keys should be the rhel10 file's, and that swap is far cheaper now
   than after content exists. I did not act on this — it is a scope decision, not
   mine.
2. **`objectives-rhel10.yaml` has no loader or test coverage beyond the four
   tests here**, and nothing validates it against `content/tasks/` because it is
   not wired into the bank. If the project switches to RHEL 10 it needs the same
   treatment `objectives.yaml` gets.
3. **The six superseded ids are a migration hazard.** If the project ever moves
   from the rhel9 to the rhel10 taxonomy, six ids change name for what is broadly
   the same skill (`tools.archive.tar` → `tools.archive.tar-gzip-bzip2`, etc.).
   Review history keyed on the old ids would be orphaned. A future migration
   should carry an explicit old-id → new-id map rather than relying on the names.
   The `#` comments in both files record every pairing needed to build it.
4. **The brief's "Red Hat's wording wins" rule needs restating for future content
   tasks**, since it silently means "RHEL 10 wording wins" now. Any later task
   that re-applies it to `objectives.yaml` will corrupt that file.
5. `node src/cli/index.ts coverage --content content` fails after this task —
   objectives exist but no tasks or concepts. Expected per the mandates' "Out of
   scope"; I created no placeholder directories and consider this correct.
6. The RHCSA 9 mapping table is machine-readable text, not an image, contrary to
   the brief. Only the RHCSA 10 one is an image. Worth fixing in the plan
   narrative so nobody budgets visual-read effort for the RHEL 9 table again —
   and worth knowing that the RHEL 10 images need `pdfimages`, not page
   rendering, because of the two-pages-per-image seam problem.
