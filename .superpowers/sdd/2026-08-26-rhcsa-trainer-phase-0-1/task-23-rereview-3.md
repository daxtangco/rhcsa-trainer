# Task 23 — scoped re-review of fix round 3 (`8083796..2cfbe8b`)

**Verdict: CHANGES REQUIRED.**

Not because anything in the brief was left undone — all nine findings are dispositioned, all six
invariants are unmoved, every gate reproduces, and every new pin has teeth under mutation. It is
`CHANGES REQUIRED` because the rewrite introduced **defect number five in `countCheckpoints`, it is
a regression, and it is fail-open**: five shapes that counted correctly at both `b7c7f61` and
`8083796` now count zero, and one of them discards every remaining line of the grader. That is the
same class as F8 and N1 — a quote-state bug that silently truncates the file — arriving for the
third time through a third door.

The brief said to assume there is a third fail-open defect until I had tried hard and failed. I did
not have to try very hard.

---

## Verdict table — N1 to N9

| # | direction | disposition | how proved |
|---|---|---|---|
| N1 | fail-open | **FIXED** | `HEREDOC_START` is now `/^<<…/` and is matched against the slice at a `<<` reached by a walk that skips quoted runs. `echo "a << b"` + `ck real-id` → **1** (was 0). M7 (restore the `8083796` scan) fails the new pin. |
| N2 | fail-closed | **FIXED**, with a narrower residual re-opened by its own fix | `printf "ok; ck phantom-id\n"` + `ck real-id` → **1** (was 2). M7 fails the pin. But the `CK_BEFORE_QUOTE` exception added to keep quoted ids re-admits N2's exact mechanism in a narrower window — see **R2/R3**. |
| N3 | — | **FIXED** | `heartbeatMs` injection point + 2 tests; `terminal.test.ts` 12 → 14. M1 (delete the whole block) and M2 (delete only the `ws.terminate()` branch) each fail, and each fails with the *named* diagnostic `timed out waiting for the silent socket to be terminated`, not a bare vitest timeout. |
| N4 | — | **FIXED** | M3 (`result: s.result` added to `view()`) fails the pin. M3b (filter mutated to match nothing) **also** fails, so the `toEqual` on the sorted route list does prevent a vacuous pass. |
| N5 | fail-open | **FIXED** for what it named; same class recurs | Line continuation removed (measured: counts 1, so removing it was correct); the `$((` shift added; over-arrival warning added and pinned — M6 (delete the warning) fails. **Gap: the corrected list still omits a `case` label — see R7.** |
| N6 | — | **FIXED as ruled** | `/reset` 409 (M8 fails the pin), `/hint` open, comment added. Ruling verified by measurement — see below. |
| N7 | — | **FIXED** | M4a (drop `hostname` from `serveOptions`) fails 2 tests with `expected '::' to be '127.0.0.1'`. M4b (production line reverted to an inline literal without hostname) fails. M4c (inline literal *with* `hostname: HOST`) also fails — so the text pin really does forbid "simplifying" it back, exactly as its comment claims. |
| N8 | — | **FIXED** | The brief allowed teeth *or* an accurate comment; they chose the comment. I verified the comment is true: deleting the `<<<` branch from `content.ts` leaves `content.test.ts` at **20 passed (20)**. An honest disclosure. |
| N9 | — | **FIXED** | 028 pinned to `['systemctl','firewall-cmd','nmcli']`; M5 (revert the quote-stripping) fails 4 tests including that pin. The `sh -c` residual is documented and its unreachability claim is true — `grep -rnE '\b(sh\|bash\|dash)[ \t]+-[a-z]*c\b' content/` → NONE. |

Nothing is NOT FIXED. Nothing in the parked set was touched.

---

## Gates — all re-run, none inherited

| gate | measured at `2cfbe8b` | matches your figure |
|---|---|---|
| `npm run typecheck` | exit **0** | yes |
| `npx vitest run` | **337 passed / 28 files**, 0 skipped, exit 0 | yes |
| `node src/cli/index.ts coverage` | exit **0**, `problem:` lines **0** | yes |
| added `as` casts | **0** (11 grep hits, all inside comments/prose) | yes |
| added non-null `!`, `enum`, `namespace`, parameter properties, decorators | **0** of each | yes |
| out-of-scope files | `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`, `src/engine/grading/grader.ts`, `package.json` — **none modified** | yes |
| `git status --porcelain` | empty before and after; HEAD still `2cfbe8b` | yes |

**The six invariants — re-measured, both standalone and as `assertLib + grade.sh`:**

```
assert.sh standalone = 0
019: standalone=8  assertLib+grade=8
014: standalone=5  assertLib+grade=5
017: standalone=5  assertLib+grade=5
028: standalone=5  assertLib+grade=5
006: standalone=8  assertLib+grade=8
```

All six unmoved. Nothing outranks the rest of this review.

Your baseline table also reproduces — all 13 shapes, `measured`:

```
ok  echo "a << b"            + ck real-id   -> 1
ok  printf "ok; ck phantom"  + ck real-id   -> 1
ok  printf "a # b"; ck real-id              -> 1
ok  cat <<'EOF' … ck x … EOF + ck real-id   -> 1
ok  cat <<EOF   … ck x … EOF + ck real-id   -> 1
ok  grep -q x <<<"$perm"     + ck real-id   -> 1
ok  ck_pass 'home-from-lv' "…"              -> 1
ok  test -f /etc/fstab; ck gamma            -> 1
ok  true && ck delta                        -> 1
ok  ck lv_size + ck lv                      -> 2
ok  # ck nope  + ck real-id                 -> 1
ok  want=$(( 1 << shift ))  + ck real-id    -> 0
ok  want=$(( bytes << 3 ))  + ck real-id    -> 1
```

---

## Method

I did not verify by reading the walk. I wrote 61 grader fragments, ran each one under **real bash**
with a `ck`/`ck_pass`/`ck_fail`/`ck_skip` stub that prints the id it is handed on fd 3, counted the
distinct ids bash actually emitted, and diffed that against `countCheckpoints`. Every count below is
`measured` that way. Where a mismatch existed I then re-ran the same fragment against
`session.ts` as of `b7c7f61` and `8083796` to establish whether it is a regression or pre-existing.

One case in my harness (`exec 3>&1; ck …`) is an artifact — the script clobbers my measurement fd —
and is discarded, not reported.

---

## New findings

### R1 — an escaped `\"` desynchronises the quote walk. **HIGH. Fail-open. REGRESSION.**

`scanLine` finds the end of a double-quoted run with `line.indexOf(ch, i + 1)`, which does not
honour `\"`. Bash pairs quote characters *after* removing escaped ones; the scanner pairs them
positionally. So an **odd** number of `"` characters on a line — which is exactly what one escaped
quote produces — leaves the walk running *inside* the string, and everything after it on that line
is misread.

`measured`, against real bash and against the two previous scanners:

| shape | bash | `b7c7f61` | `8083796` | `2cfbe8b` |
|---|---|---|---|---|
| `echo "it\"s ok"; ck real-id "d" $?` | 1 | 1 | 1 | **0** |
| `echo "a\"b"; ck lost-id "d" $?` | 1 | 1 | 1 | **0** |
| `printf '%s\n' "wanted \" here"; ck real-id "d" $?` | 1 | 1 | 1 | **0** |
| `echo \"; ck real-id "d" $?` (unquoted escaped quote) | 1 | 1 | 1 | **0** |
| `echo "a \" b << EOF c"` then `ck one-id`, `ck two-id` | 2 | 0 | 0 | **0** |

The first four are **regressions this commit introduced**. Both earlier scanners got them right, for
the accidental reason that neither did any quote handling at all, so the trailing `; ck real-id`
survived into `code`. Round 3 added quote handling and, with it, a way to lose the real `ck`.

Failure scenario: a grader line of the form `some_condition; ck my-id "…" $?` — *the* usage
`content/lib/assert.sh:60` documents — where `some_condition` contains one escaped quote. The `ck`
is not seen, `expectedTotal` lands low, a grader killed partway matches the deflated total,
`incomplete` stays `false`, and a student who changed nothing is told the task passed.

The fifth row is the worse one and is pre-existing rather than a regression: the resumed walk reaches
a `<<` that is *inside* the string, `HEREDOC_START` matches it, and **every remaining line of the
grader is discarded**. That is N1's failure shape through the door the brief predicted.

**Does the bank reach it today? Not yet — and the reason is undocumented.** The shape `\"` is already
present in `content/lib/assert.sh:16` (`s=${s//\"/\\\"}`), the file prepended to every grader; it is
harmless *there* only because that line has an even number of `"` characters and neither a `ck` nor a
`<<` after them, which is why the six invariants do not move. More broadly, all **43** `ck` call
sites across the five graders are the *first token of their line* (`measured`), so nothing can be
lost before them. That is a real invariant and it is load-bearing, but it is written down nowhere —
and `assert.sh:60` documents the opposite shape as canonical.

Two even-numbered variants are correct, and I report them so the characterisation is exact, not to
soften the finding: `grep -q "\"Listen 82\"" /etc/httpd/conf/httpd.conf; ck listen-set "…" $?` counts
**1**, and `ck first-id "a \"b\" c" $?` + `ck second-id` counts **2**. The bug is odd-parity only.

Fix: track backslash escapes when scanning for the closing quote (inside a single-quoted run bash
does *not* honour `\`, so only the double-quoted branch and the bare-word case need it). Pin both
parities and pin the `<<`-inside-a-string case, which is the one that truncates the file.

### R2 — `CK_BEFORE_QUOTE` is not word-anchored. **MEDIUM. Fail-closed. Pre-existing mechanism, new trigger.**

`/ck(?:_pass|_fail|_skip)?[ \t]+$/` has no word-start anchor, so **any word ending in `ck`** followed
by whitespace makes the next quoted run be kept verbatim — and kept content is then re-scanned by a
global `CK_CALL`. `measured`:

| shape | bash | scanner |
|---|---|---|
| `ck perm-check "checked; ck also-ran" $?` | 1 | **2** |
| `ck fs-check "ran && ck nope" $?` | 1 | **2** |
| `fsck "$dev; ck phantom" …` + `ck real-id` | 1 | **2** |

Failure scenario: a checkpoint id ending in `-check` whose description contains a separator followed
by the word `ck`; the grader declares one checkpoint too many, so a complete run on a correctly
solved machine reports `incomplete` and forces `allPassed: false` — a false fail.

Bank reach today: **no.** No id in the bank ends in `ck` and no description contains `; ck ` or
`&& ck ` (`measured`). But `-check` is the most natural suffix an RHCSA checkpoint id could have, and
this is the exception N2's fix introduced, so it is worth an anchor: the rule the docstring states is
"a `ck` token sitting immediately before the quote", and `perm-check` is not a `ck` token.

This is also why **N2 is only mostly fixed**: inside a `CK_BEFORE_QUOTE`-kept run, a separator
followed by `ck` still declares a phantom id, exactly as N2 described. It counted 2 at `b7c7f61` and
`8083796` too, so it is pre-existing, not a regression — but it is the one window where N2's
mechanism survives, and it survives *because of* N2's fix.

### R3 — one `ck` call can declare two ids. **LOW. Fail-closed.**

The exception used as a weapon, as the brief suspected. `ck "real-id; ck phantom" "d" $?` → bash
**1** (the id bash passes is the whole string `real-id; ck phantom`), scanner **2**. Same root cause
as R2. Unreachable in the bank; an anchor on `CK_BEFORE_QUOTE` does not close this one, only
declining to re-scan kept content for a *second* id would.

### R4 — the heredoc terminator is matched with `trim()`. **LOW. Fail-closed.**

Bash ends a `<<EOF` body only at a line that is *exactly* the delimiter; leading tabs are stripped
only for `<<-`, and a trailing space never terminates. `raw.trim() === heredoc` accepts all three.
`measured`:

| shape | bash | scanner |
|---|---|---|
| `cat <<EOF` / `\tEOF` / `ck phantom` / `EOF` / `ck real-id` | 1 | **2** |
| `cat <<EOF` / `EOF ` / `ck phantom` / `EOF` / `ck real-id` | 1 | **2** |

The body ends early, so lines bash treats as printed text are counted as checkpoints. The `<<-EOF`
case with a tab-indented terminator is handled correctly (bash and the scanner agree at 1).

Bank reach today: **no** — no grader in the bank opens a heredoc at all. The only `<<` in any
`grade.sh` is 028's two `<<<` herestrings, both counted correctly.

### R5 — only the first of several heredocs on a line is tracked. **LOW. Fail-closed.**

`cat <<A <<B` with bodies for both: bash **1**, scanner **2**. The `heredoc === undefined` guard in
`scanLine` keeps `A`, so `B`'s body is read as code after `A` terminates. Unreachable today.

### R6 — a `#` that starts a comment after a non-blank character is not a comment. **LOW–MEDIUM. Both directions.**

Bash starts a comment at any *word* start, which includes immediately after `;`, `)`, `}`, `&` or
`|`. The walk requires the preceding character to be a space, a tab, or start of line. `measured`:

| shape | bash | scanner | direction |
|---|---|---|---|
| `true;# note; ck phantom` + `ck real-id` | 1 | **2** | fail-closed |
| `(true)# note; ck phantom` + `ck real-id` | 1 | **2** | fail-closed |
| `true;#uses <<EOF style` + `ck real-id` | 1 | **0** | **fail-open** |

The third is the interesting one: a `<<` inside a comment the walk does not recognise opens a phantom
heredoc and discards the rest of the file. Bank reach today: **no** — no `[;)}&|]#` in any
`grade.sh` (the two hits in `content/` are `#` characters inside quoted `sed` expressions in
*solution* files, which `countCheckpoints` never sees).

### R7 — the corrected known-misses list still omits a `case` label, and `case` is already the bank's idiom. **MEDIUM. Fail-open. Disclosure accuracy.**

`session.ts:63-65` names "a `ck` after `then`, `do`, `else`, `{` or `(` on the same line". `measured`:

```
case "$s" in
  enabled) ck en-id "d" 0 ;;
esac
```

bash **1**, scanner **0**. A case-branch label is a *closing* paren; no reader gets it from "`(`".
And this is not a hypothetical shape for this bank —
`content/tasks/storage/014-grow-home-lv/grade.sh:44-46` already contains a `case` statement, and
`content/lib/assert.sh:88-91` contains another. The bank's own graders are one line away.

I am **not** re-opening the settled `then`/`do`/`else`/`{`/`(` group, and I confirm its wording is
otherwise accurate after round 3's edit: `grep -rnE '(\)|then|do|else|\{|\()[ \t]+ck…' content/ docs/`
→ **NONE**, the 43-call-site figure is exactly right, every one is at column 0 or space-indented, and
the `$((` claim holds (the only uses in the bank are `/ 86400` and `1024 ** 2..4` — no shifts).
The point is narrower: N5 was raised because two specifics of a disclosure were false, and this
disclosure is now silent about the one member of its own group that the bank is closest to writing.
Add `)` to the list, or say "after any shell keyword or punctuation other than a separator".

### R8 — a `/reset` between `/grade` and `/finish` moves the clock the rating is derived from, while the stale verdict survives. **MEDIUM. Fail-open. Pre-existing; directly contradicts this commit's own stated principle.**

`measured` through the real app — exam mode, fully passing verdict, 600 s budget, injected clock:

| sequence | `startedAt` | `endedAt` | `report.allPassed` | `rating` |
|---|---|---|---|---|
| grade → finish | 0 | 1200000 | true | `good` |
| grade → **reset** → finish | 1200000 | 1200500 | true | **`easy`** |

`restart()` moves `startedAt` and `s.result` survives the VM revert, so `/finish` derives a rating
from a verdict measured on a machine that has since been wiped and re-`setup`'d, over a clock that
says the attempt took no time. `deriveRating` returns `easy` when `rungUsed <= 1 && durationS <=
timeBudgetS`, so a 20-minute solve on a 10-minute task is laundered into a cold, inside-budget one.

This commit's new `/reset` comment argues exactly the right principle — "a reset must not make the
report describe an attempt that did not happen" — but the guard it added keys on
`phase === 'graded'`, i.e. post-`/finish`, and the rating-relevant window is post-`/grade`,
pre-`/finish`. It is not a regression: `restart()` moving the clock while `s.result` persists
predates round 3. It is reachable today by anyone who grades, resets to try again, then finishes.

Suggested fix: have `restart()` clear `s.result`. A reverted machine has no valid verdict, so
`/finish` would then correctly answer "nothing has been graded yet" (already a 409) instead of
grading a machine that no longer exists. That keeps reset-to-retry working, which a 409 on
`/reset`-after-grade would not.

---

## The `$(( 1 << shift ))` disclosure — is it adequate?

**Yes, adequate — with one wording correction I would make, not a finding.** `session.ts:66-71` gives
the identifier example explicitly (`want=$(( 1 << shift ))`), says a phantom heredoc opens, says
every line after it is discarded, says no grader shifts, and points at the runtime warning as the
thing that would surface it. A grader author reading that cannot come away believing a shift is safe.
I reproduced both halves of your measurement: `$(( 1 << shift ))` → **0**, `$(( bytes << 3 ))` →
**1**.

Where I agree with you that it is "narrower and stranger than either document states": the comment
attributes the miss to "the `<<` is not inside quotes and this scan does not track redirect
position", which is the correct *cause* but does not tell the reader that a shift by a **literal** is
fine while a shift by a **variable** is not. Someone who reads the cause and generalises will
over-avoid rather than under-avoid, so the error is in the safe direction — which is why this is not
a finding under N5's rule. One clause (`a shift by a literal, $(( bytes << 3 )), is counted; only a
shift by an identifier is not`) would make it exact.

The genuinely inadequate disclosure in the same comment block is R7, not this one.

## Does the N6 ruling survive?

**Yes. I could not produce a stored value that a post-finish rung contradicts, and I looked for one
deliberately.** `measured`, driving all three modes through the real app: grade, finish, then climb
the ladder as far as it will go, then retry every route.

```
[exam]     finish rating="hard" rung=1 maxRung=2
           hint#1 -> 200 rung 2, kind "nudge"        hint#2 -> 409 "rung 2 is the maximum in exam mode"
           finish2=409  grade2=409  reset=409
           GET view = {…,"rung":2,"maxRung":2,"startedAt":1000,"endedAt":2000,"phase":"graded"}
[drill]    hint#1 -> 200 nudge   hint#2 -> 200 concept card   hint#3 -> 409 (cap 3)
[practice] hint#1..#4 -> 200, reaching rung 5 "A full solution"   hint#5 -> 409 (cap 5)
```

- `/reset` on a graded session is **409** (M8: deleting the guard fails the new pin).
- `startedAt` **cannot** move past `endedAt`: after a finish the only writer of `startedAt` is
  `restart`, the only caller is `/reset`, and `/reset` is now 409. The view above shows the clock
  frozen at `1000/2000` after every subsequent attempt.
- `/hint` on a **finished practice** session returns **200** and reaches rung 5, deliberately.
- No path emits a checkpoint id in exam or drill mode — asserted over the serialised bodies of every
  hint response, the session view, and all three 409 bodies. The route-table pin (N4) covers the
  same property against future routes, and M3b shows it cannot pass vacuously.
- No second rating in any mode: `rating` is a local at `app.ts:313-322`, never stored, and `/finish`
  is 409 on a second call.

The only stored value that moves post-finish is `s.rung`, and nothing stored disagrees with it,
because the `rungUsed` the rating was built from was never persisted. Your rationale holds on every
point I checked.

The one caveat is R8, and it does not touch the ruling: it is the *pre*-finish window, and the fix
for it is in `restart()`, not in a 409 on `/hint`.

---

## What I would require before approving

1. **R1** — track backslash escapes when finding a closing quote; pin both parities and pin the
   `<<`-inside-a-string truncation. This is the fail-open regression and it is the only blocking item
   in the counter.
2. **R8** — clear `s.result` in `restart()`. This is the fail-open one in the rating path.
3. **R7** — add `)` to the known-misses list, or generalise its wording.
4. **R2** — anchor `CK_BEFORE_QUOTE` at a word start. Cheap, and it is the exception this round
   introduced.

R3, R4, R5, R6 are unreachable in the bank today and are fine as disclosures if they are written
down accurately — but note that R6's third row and R1's fifth row are both "a phantom heredoc
discards the rest of the file", which is now the fourth distinct route into that failure. A `<<`
recognised only in redirect position would close R1's truncation, R6's, and the disclosed `$((`
residual at once, and would be worth costing before disclosing them one at a time.

## Notes on how the round-3 tests hold up

Every new pin has teeth. Mutations run in a copy of the tree at `/tmp/mut` with `node_modules`
symlinked back; the real repo was never modified and `git status --porcelain` is empty. Baseline in
the copy: 337 passed (28 files).

| mutation | result |
|---|---|
| M1 delete the whole heartbeat block | 1 failed — named diagnostic |
| M2 delete only the `ws.terminate()` branch | 1 failed — named diagnostic |
| M3 add `result: s.result` to `view()` | 1 failed |
| M3b make the N4 route filter match nothing | 1 failed (no vacuous pass) |
| M4a drop `hostname` from `serveOptions` | 2 failed, `expected '::' to be '127.0.0.1'` |
| M4b production line → inline literal without hostname | 1 failed |
| M4c production line → inline literal *with* hostname | 1 failed |
| M5 revert `content.ts` quote-stripping | 4 failed, including the 028 pin |
| M6 delete the over-arrival warning | 1 failed |
| M7 restore the `8083796` scan | 2 failed (the N1 pin and the N2 pin) |
| M7b remove only the `CK_BEFORE_QUOTE` exception | 2 failed (the quoted-id pins) |
| M7c remove the `<<` branch from the walk | 2 failed (heredoc-body and N1 pins) |
| M8 delete the `/reset` 409 | 1 failed |
| N8 delete the `<<<` branch in `content.ts` | **20 passed** — which is what its comment says, so the comment is honest |

The over-arrival warning behaves as specified: 3 ids against a declared 2 warns once, naming both
numbers, and leaves `incomplete: false`, `allPassed: true`. It does not fail the grade.
