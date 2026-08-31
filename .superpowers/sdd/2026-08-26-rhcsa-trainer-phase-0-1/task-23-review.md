# Task 23 — review (spec compliance + task quality)

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range `9300d2b..ab32303`.
Every conclusion below is labelled **measured** (I executed it in this session and
quote the output) or **reasoned** (I traced it by reading and could not execute it
here). `git status --porcelain` was empty before and after; every mutation was
performed in `/tmp/t23/repo`, a copy of the tree with `node_modules` symlinked back.

## Verdict 1 — spec compliance: PARTIALLY MET (8 of 10 mandates MET, 1 PARTIALLY MET, 1 NOT MET)

## Verdict 2 — task quality: NOT ACCEPTABLE AS SHIPPED

Four high-severity defects, all in the two surfaces the review context named as
highest-risk, and three of them are this project's signature defect class: a control
that reports success without doing what it says. One test (`content.test.ts:98`)
is named after a property the code does not have, and one guard (mandate 7's) is
turned off by the authoring idiom the shipped library documents.

## Overall: CHANGES REQUIRED

---

## Gates reproduced (measured)

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | **301 passed / 27 files** (baseline 246/23 → +55 / +4) |
| per-file: app / session / terminal / content | 16 / 17 / 10 / 12 = **55** |
| `test/vm/ssh.test.ts` | 12 passed, file **byte-identical** to BASE (`git diff --stat` empty) |
| `node src/cli/index.ts coverage` | exit 0, **0** `problem:` lines |
| casts (own token-level extractor, `as const` excluded) | src **5** / test **29** / scripts **0**; all pre-existing, none in a file this commit touches |
| `as unknown as` / `as never` | 0 |
| non-null assertions in `src/server/` + `content.ts` | 0 |
| `enum` / `namespace` / decorators / parameter properties | 0 |
| `package.json` delta | exactly the four packages, `dev:server`, and the `engines` reformat — nothing else |
| out-of-scope | nothing under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh` |
| `git status --porcelain` | empty |

Two numbers I did **not** inherit and which came out differently from the way they
were quoted to me:

- `grep -cE '\b(at|items|str|num)\('` over `test/server/app.test.ts` gives **45
  matching lines**, but 49 occurrences: the per-name figures quoted to me
  (`at 34 / items 5 / str 7 / num 3`) each include the helper's own definition
  line. **Call sites are `at 33 / items 4 / str 6 / num 2`.** Same total, and this
  is exactly the word-vs-call trap, so it is stated rather than carried.
- mandate 8 says `test/content/bank.test.ts` has 7 `.pathname` occurrences. It has
  **8** call sites. The *file* count (seven) is right; the file is parked.

## Not measurable on this host (reasoned only, stated as such)

No VM, no ISO, no `nmcli`/`systemd`, no `vmrun`; `react`, `react-dom`,
`@testing-library/react`, `jsdom`, `tailwindcss`, `@xterm/xterm` are not installed.
So: nothing about a real guest, a real browser, or Task 24's UI is measured here.
`npm run validate` cannot run and its absence is not a finding.

---

## Per-mandate disposition

| # | Mandate | Disposition |
|---|---|---|
| 1 | `sshArgs` refactor keeps the guard and existing behaviour | **MET** |
| 2 | (a) explicit `hostname`, (b) `Origin` allow-list, + 2 tests | **MET** |
| 3 | No new `as` casts | **MET** |
| 4 | `TOP_RUNG` / `RUNGS` replace the magic `5` | **MET** |
| 5 | `commandSketch` redaction | **PARTIALLY MET** |
| 6 | `countCheckpoints` over `assertLib` — comment + pinning test | **MET** |
| 7 | Truncated grader run must not report `allPassed: true` | **NOT MET** |
| 8 | `fileURLToPath` in the new test files, seven parked | **MET** |
| 9 | `readPort` validation, `/hint` comment, empty sketch, `Produces` | **MET** |
| 10 | `taskTransport` alongside `transport`, + distinguishing test | **MET** |

### 1 — MET (measured)

Pure extraction. The option list, the throw and its message are identical
character-for-character; `bash -s` is appended in the same position
(`ssh.ts` `#args()` → `[...sshArgs(this.#cfg), 'bash -s']`); `KNOWN_HOSTS` is
reused rather than recomputed. `test/vm/ssh.test.ts` is unchanged (`git diff
--stat` empty) and still 12 passing, which is the strongest available evidence
that behaviour did not move.

One consequence the mandate did not anticipate: moving the no-IP throw into
`sshArgs` is what makes **F2** reachable. The mandate's own rationale for the move
("for the terminal that is worse than for the grader, because the student sees a
bare ssh failure with nothing naming `RHCSA_VM_IP`") is inverted in practice — the
student sees nothing at all, because the server dies and the message goes to a
stderr they are not watching. The mandate is still right; the missing piece is a
`try`/`catch` in `attachTerminal`.

### 2 — MET (measured)

(a) `@hono/node-server@2.1.1`, `dist/index.mjs:1305`:

```
server.listen(options?.port ?? 3e3, options.hostname, () => {
```

so `hostname` is passed straight through and the default is **not** loopback. I
probed it rather than reasoning about it:

```
WITH hostname 127.0.0.1 (as shipped) -> address={"address":"127.0.0.1","family":"IPv4",...}
WITHOUT hostname (brief as written)  -> address={"address":"::","family":"IPv6",...}
```

Without mandate 2(a) this endpoint would have bound every interface. `HOST` does
reach `serve` (`index.ts:71`), and `serve()` returns a plain `node:http` `Server`,
so the `instanceof Server` narrowing at `index.ts:77` holds on the default path.

(b) Origin check present at `terminal.ts:130-134`, ahead of the pathname check,
with the allowed set injected as a **required** `ReadonlySet<string>` with no
default — stronger than mandated, and the right call. Fail-closed on every variant
I could think of (measured, real handshakes against a real ephemeral loopback
server, `[pty spawned]` marks where a shell was actually started):

```
  no Origin header at all                        ACCEPTED (101)  [pty spawned]
  allowed: http://localhost:5175                 ACCEPTED (101)  [pty spawned]
  allowed: http://127.0.0.1:5173                 ACCEPTED (101)  [pty spawned]
  evil.com                                       REFUSED (socket destroyed)
  empty Origin value                             REFUSED
  literal null (sandboxed iframe / file://)      REFUSED
  case: HTTP://LOCALHOST:5175                    REFUSED
  trailing slash                                 REFUSED
  IPv6 loopback http://[::1]:5175                REFUSED
  https instead of http                          REFUSED
  duplicate Origin: allowed then evil            REFUSED
  duplicate Origin: evil then allowed            REFUSED
  allowed Origin but wrong path                  REFUSED
  no Origin, wrong path                          REFUSED
  allowed + absolute-form request URI            ACCEPTED (101)  [pty spawned]
```

Exact string matching is correct here — every near-miss is a different origin, and
loosening any of them would only add ways in. `http://[::1]:PORT` being absent is
not a gap: `HOST` is `127.0.0.1`, so the UI can never be served from `[::1]`.
Duplicate headers are refused because Node joins them with `", "`. The
absolute-form request target (`GET http://evil.com/ws/terminal HTTP/1.1`) is
accepted only when the `Origin` is *already* allowed, and `new URL(req.url ?? '/',
'http://localhost')` still yields `pathname === '/ws/terminal'` — so `req.url` can
steer the throwaway base but not any decision. Privilege-neutral.

Four tests, two more than required.

### 3 — MET (measured, own extractor)

src 5 / test 29 / scripts 0, zero `as unknown as`, zero `as never`, zero non-null
assertions in the new server code, zero banned syntax. The five `src/` casts are
all in files this commit does not modify.

### 4 — MET (measured)

`TOP_RUNG` and `RUNGS` are defined in `ladder.ts:23,26` and consumed at exactly the
six sites the mandate names. Outside `ladder.ts` itself there is no remaining inline
`5`-as-a-rung and no `[1,2,3,4,5]`.

Enforcement is genuinely server-side, which is the part that mattered. Measured
against a live exam-mode session: `maxRung` is 2; the first `/hint` returns rung 2
`nudge`; the next five return `409 rung 2 is the maximum in exam mode`; a `rung: 5`
and `maxRung: 5` in the request body are ignored (the rung comes from session
state, never from the body); and `/reset` does **not** roll the rung back, so a
reset cannot launder disclosure. **Rung 4 and rung 5 are unreachable in exam mode
through `/hint`.** But see **F7** — rung 3's *content* is reachable without the
ladder at all.

### 5 — PARTIALLY MET

All three mandated changes are present (`NOISE` extended, `COMMAND_SHAPE`, the
inner loop `break`ing at the command position) and the eight-case before/after table
reproduces: `]]`, `d'`, `home[[:space:]]` and `fstab` are gone. That part is a
genuine improvement.

It is PARTIALLY MET because the redactor still emits argument text, the doc comment
and the report both assert that it cannot, the test that should catch it passes for
an unrelated reason, and the disclosed residual list is incomplete. See **F5**,
**F6**, **F8**.

### 6 — MET (measured)

Comment at `app.ts:152-156`, regression test at `session.test.ts:67` reading the
real library through `fileURLToPath`. I measured `countCheckpoints` over
`content/lib/assert.sh` independently: **0**. No line in the library matches
`CK_CALL` — the definitions are `ck_pass() {` (a `(`, not whitespace) and the usage
example line begins with `#`.

### 7 — NOT MET (downgraded from PARTIALLY MET after the addendum; see F16)

The guard exists at `session.ts:107` and the mechanism it defends against is real,
but it is **silently disabled** for any grader written to `content/lib/assert.sh`'s
own documented usage, because `countCheckpoints` cannot see a `ck` call that does not
begin its line. Measured end-to-end: mandate 7's exact bug still reports
`allPassed: true`. A guard that a supported authoring style turns off has not met the
mandate.

The context asked me to check the **reverse** direction — can it report a fail where
the state is right? Measured, today it cannot:

- `ck_skip` emits a real verdict line (`_emit skip` in `assert.sh`), so a skipped
  checkpoint is *present* and cannot shorten the array.
- A `ck` in a comment is not counted (`countCheckpoints('# ck x …\nck real …')` → 1).
- The word `ck` inside a string is not counted (`printf "run ck now"` → 1).
- An id emitted from several branches counts once (`if/else` over one id → correct).
- All five real graders emit every declared id on every path: 43 `ck` sites across
  the five, every one at column 0 or inside mutually exclusive `if`/`case` arms, and
  `storage/014`'s `to_bytes` guard emits all five `ck_fail`s before `exit 0`.

So no healthy run trips `incomplete` with the content that exists. Two defects
remain, one in each direction:

- **F4 (fail-open)** — the comparison is wrong-unit: `v.checkpoints.length` counts
  *lines*, `expectedTotal` counts *distinct ids*. Measured, this re-opens the exact
  false pass mandate 7 was written to close.
- **over-count (false `incomplete`, latent)** — `CK_CALL` matches inside a heredoc
  body. Measured: `cat <<'EOF'\nck heredoc-id "x" $?\nEOF\nck real "y" $?` counts
  **2** where only one checkpoint executes. No current grader does this and no test
  pins it.

### 8 — MET (measured)

Exactly **seven** test files *call* `new URL(...).pathname`, and they are the seven
parked ones. The naive grep returns nine, as the mandate warns —
`test/lib/assert.test.ts` and `test/cli/validate.test.ts` already use
`fileURLToPath` and only mention `.pathname` in a comment. The one new file that
resolves a repo path (`test/server/session.test.ts:72`) uses `fileURLToPath`.
`terminal.ts:135`'s `url.pathname` is a *request* path — correct usage, not a
filesystem path. (See the `bank.test.ts` per-file count nit, **F14**.)

### 9 — MET (measured), and one of the mandate's premises is wrong

`readPort` copies `loadVmConfig`'s shape faithfully: `Number.isInteger(p) && p >= 1
&& p <= 65535`, and a message naming the variable and JSON-quoting the value.

**The mandate's premise that `config.ts:35-55` holds an "empty-string-defeats-`??`"
defect is wrong in outcome.** The `??` genuinely fails to apply the default for
`''` — in both files — but in both files the range check catches it immediately:
`Number('')` is `0`, `0 < 1`, so `RHCSA_SSH_PORT=''` throws
`RHCSA_SSH_PORT must be a port number, got ""` and `RHCSA_PORT=''` throws the
matching message. There is nothing silent to copy, and nothing silent was copied.
(Both do accept `'0x50'` as 80 and `' 22 '` as 22 — shared, cosmetic, parked.)

The other three: `/hint`'s comment now says `advanceRung` threw at the mode's cap
and keeps the 409-over-400 reasoning; the empty-sketch branch is at
`content.ts:172-178`; `maxRungFor` is in the brief's `Produces` block — invisible to
the diff because `.superpowers/` is git-ignored (measured via `git check-ignore`).

### 10 — MET (measured)

Both fields on the session response with the mandated doc comments, `TASK_VMRUN`
built with `satisfies TaskSpec`, and `app.test.ts:257` asserts `taskTransport:
'vmrun'` against `transport: 'ssh'` — a state the server can actually produce, which
was the whole point.

One naming residual to carry into Task 24 rather than to fix here: `transport` means
the **task's** transport on `/api/tasks` summaries (`app.ts:56`) and the **server's**
transport on `/api/health`, the session response and `view()`. The mandate chose that
deliberately, and I agree with the choice, but Task 24 will read `/api/tasks` and get
the other meaning of the same field name.

---

## Findings

Severity: **HIGH** = takes the app down or reports a pass/rating that is wrong.
**MEDIUM** = defeats a stated contract or a stated guarantee. **LOW** = correctness
or hygiene. **INFO** = a correction to an input document.

### F1 — HIGH (measured) — one malformed WebSocket frame kills the whole server

`terminal.ts:142-152` registers `ws.on('message')` and `ws.on('close')` and no
`ws.on('error')`. Seven bytes with RSV1 set, sent after a valid handshake:

```
  handshake ok; sending a frame with a reserved RSV bit set
UNCAUGHT: Invalid WebSocket frame: RSV1 must be clear
```

`index.ts` installs no `uncaughtException` handler, so the process exits — taking
grading, sessions and the whole in-memory `SessionStore` with it. The irony is
precise: `bridge` comments at `terminal.ts:49` that "a malformed frame is not worth
ending a lab session over", and handles malformed *JSON* inside a valid frame, while
a malformed *WebSocket* frame one layer down ends the entire server.

**Failure scenario:** a browser extension or proxy mangles one frame mid-attempt and
the trainer exits, losing the session the student was 20 minutes into.

### F2 — HIGH (measured) — a `spawnPty` throw is uncaught, and the vmrun configuration guarantees it

`terminal.ts:143` calls `spawnPty` inside `handleUpgrade`'s callback with no
`try`/`catch`. `spawnSshPipe` → `sshArgs(cfg)` throws whenever `cfg.ip` is empty.
Measured:

```
UNCAUGHT EXCEPTION reached the process: SshTransport has no IP.
```

This is not hypothetical. `config.ts:48` makes `ip` optional (`env.RHCSA_VM_IP`),
`chooseTransport` falls back to `vmrun` when ssh is unavailable and honours
`RHCSA_TRANSPORT=vmrun`, and `index.ts:80` calls `attachTerminal` unconditionally.
The throw's own message says "or let the vmrun transport handle it" — so the
supported vmrun setup is exactly the one where the terminal cannot start.

**Failure scenario:** a user on the vmrun transport clicks the terminal tab once and
the whole API dies, with the message naming `RHCSA_VM_IP` going to a terminal they
are not looking at.

### F3 — HIGH (measured) — `/finish` is neither terminal nor idempotent, so masking and the derived rating can both be laundered

`app.ts:235` (`/grade`) and `app.ts:259` (`/finish`) check only that the session
exists. Measured, end-to-end through `app.request()`, in **exam** mode:

```
grade#1 masked? true  allPassed= false
finish#1 status=200 rating=hard checkpoints= [{"id":"lv-home-size",...,"status":"pass"},
                                              {"id":"fs-home-size",...,"status":"fail"}]
grade#2 AFTER finish status=200 phase=graded allPassed=true
finish#2 status=200 rating=easy allPassed=true endedAt=4000
```

`/grade` is careful to pass `revealed: false` precisely so grading is not a way to
read the answer key — and `/finish` hands over the whole key for free, then lets the
attempt continue. `deriveRating` is recomputed from the later attempt with the rung
unchanged, so the rating claims a cold solve that used the key. This is the same
defect class as mandate 10's: a check that reports success without doing what was
asked, one layer up.

**Failure scenario:** exam mode — finish early to learn *which* checkpoints failed,
fix exactly those, finish again, and get `rating: 'easy'`, `allPassed: true`.

**Fix:** `/finish` should 409 when `phase === 'graded'`, and `/grade` should 409 on a
finished session (or the rating must be computed once, at the first finish, and
stored).

### F4 — MEDIUM (measured) — mandate 7's guard compares a line count to a distinct-id count

`session.ts:100` is `v.checkpoints.length < expectedTotal`. `countCheckpoints`
counts **distinct ids** — `session.test.ts:63` pins that it does — and
`parseVerdict` does not dedupe. Measured:

```
countCheckpoints (distinct ids)      = 3
verdict.checkpoints.length (lines)   = 3
distinct ids that actually arrived   = 2   duplicates: [ 'fstab-entry' ]
SHIPPED guard  -> {"incomplete":false,"allPassed":true}
  persists-reboot never ran, yet allPassed is true
proposed guard -> incomplete = true
```

Latent, not live: measured, none of the five graders can emit an id twice in one run
(all 43 `ck` sites are unconditional or in mutually exclusive branches). It becomes
live the moment a grader re-checks an id or emits one inside a loop — which the
code's own comment at `session.ts:29-32` describes as routine. `duplicateIds` and
`statusById` are already exported from `verdict.ts`, so the fix is one line:
`statusById(v).size < expectedTotal`. `passed` and `total` in the report have the
same wrong unit and would double-count alongside it.

**Failure scenario:** a grader that emits one id from two branches that both run is
killed halfway, and the student is told they passed a checkpoint that never ran.

### F16 — HIGH (measured) — `countCheckpoints` cannot see a `ck` call that does not begin its line, and `assert.sh:60` documents exactly that shape

`CK_CALL` (`session.ts:34`) is anchored `^[ \t]*ck…`, so only whitespace may precede
the call. `content/lib/assert.sh:60` reads:

```
# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"
```

The library teaches authors the one shape the counter is blind to. Confirmed with my
own 29-shape table, and I found ten more misses beyond the two reported. Every one of
these yields `[]`:

```
UND after a semicolon (assert.sh:60 usage)  true; ck after-semi "d" $?
UND after a pipe                            grep -q x file | ck piped "d" $?
UND after &&                                test -f /x && ck and-id "d" $?
UND after ||                                test -f /x || ck or-id "d" $?
UND one-line if/then                        if test -f /x; then ck then-id "d" 0; fi
UND one-line for body                       for u in a b; do ck loop-id "d" $?; done
UND one-line case arm                       case $x in a) ck case-id "d" $? ;; esac
UND brace group                             { ck brace-id "d" $?; }
UND subshell                                ( ck paren-id "d" $? )
UND after done;                             done; ck after-done "d" $?
UND continuation, ck leads the next line     test -f /x \  <newline>  && ck cont-id …
UND continuation, pipe leads the next line   some_cmd \    <newline>  | ck cont2-id …
```

The comment and prose shapes are all correctly ignored (comment at column 0, indented
comment, trailing comment after a real call, `echo "ck_pass fake-id"`, `ckfoo`,
`ck-check`), so Task 21's comment-matching problem is genuinely fixed, and
`countCheckpoints(assert.sh)` is **0** — prepending the library changes nothing today.

**The whole chain, measured**, on a four-checkpoint grader that uses the documented
idiom for two of them (every id a literal, so Task 22's rule is obeyed):

```
declared checkpoints (truth, by hand): 4
countCheckpoints(assertLib + grade.sh): 2
checkpoints that arrived: 2  noise: 1        <- grader died mid-third line
reportFor -> {"passed":2,"total":2,"expectedTotal":2,"incomplete":false,
              "allPassed":true,"rebooted":false,"regressionCount":0}
SHIPPED         : incomplete=false  allPassed=true
IF COUNT CORRECT: incomplete=true   allPassed=false
```

That is mandate 7's original bug, intact, reached through the extractor instead of the
comparison — and `expectedTotal: 2` is reported to the client as if it were the truth.

**Reachability: latent.** My own scan (every physical line in all five `grade.sh` plus
`assert.sh` whose first non-blank token is not `ck`/`ck_*` but which contains a `ck`
call token) returns **two hits, both comments**: `assert.sh:59` and `:60`. Zero code
hits. Independently re-derived distinct-id counts, matching what I was told:
`selinux/019=8`, `storage/014=5`, `systemd/017=5`, `troubleshooting/028=5`,
`users/006=8`.

*Scenario:* an author writes `systemctl is-active httpd; ck svc-active "…" $?` exactly
as `assert.sh:60` shows, the guest kills the grader before that line, and the student
is told they passed a task whose checkpoint never ran.

### F17 — MEDIUM (measured) — the id character class silently truncates or drops ids

`([a-z0-9][a-z0-9-]*)` excludes `_` and uppercase, and nothing enforces the
convention. Measured: `ck my_id "d" $?` counts as the id **`my`** (truncated at the
underscore, not skipped), and `ck My-Id "d" $?` counts as **nothing at all**. The
truncation is the dangerous half, because it collides:

```
ck my "d" $?
ck my_second "d" $?     ->  truth 2, counted 1   ids ["my","my"]
```

No shipped grader violates the convention (measured: zero ids across all five graders
begin with a non-`[a-z0-9]` character or contain `_`), and `npm run validate` does not
check it. *Scenario:* an author adds `ck disk_size` next to an existing `ck disk`,
`expectedTotal` silently stops counting one, and the truncation guard goes quiet for it.

### F5 — MEDIUM (measured) — `commandSketch` leaks argument text, on content that is in the repo today

`content.ts:90` states "neither can leak an argument"; the report states "arguments
can never be mistaken for commands". Both are false. Measured against the **first**
solution of `content/tasks/selinux/019-httpd-alt-port` — the one rung 4 uses:

```
["dnf","sed","Listen","DocumentRoot","tee","semanage","restorecon","firewall-cmd","systemctl"]
```

`Listen` and `DocumentRoot` are the *replacement halves* of two `sed` expressions
(`solutions/01-…sh:5-6`, `sudo sed -i 's|^Listen 80$|Listen 82|' …`). Splitting on
`|` creates pseudo-segments whose first word is an argument, and the "stop at the
command position" rule then emits it — so the mechanism the code comment credits
with handling `sed`-with-`|` is exactly the mechanism that fails here. Confirmed
end-to-end through the live `/hint` route at rung 4:

```
In roughly this order, arguments omitted:
- `sed`
- `Listen`
Each one has a man page. Read the one you are least sure about.
```

An unquoted `|` delimiter leaks a filename too (`sed -i s\|a\|b\| /etc/hosts` →
`["sed","hosts"]`).

Impact is bounded: rung 4 is only reachable in practice mode (cap 5) and guided
mode, where rung 5 is one step away — so this is a broken contract and a wrong hint
rather than an exam bypass. But for `selinux/019` it names the two httpd directives
the task is about under a heading that promises arguments are omitted, and then
tells the student to `man Listen`.

**Failure scenario:** rung 4 of selinux/019 hands the student `Listen` and
`DocumentRoot` — most of the answer — while claiming to withhold arguments.

### F6 — MEDIUM (measured) — the test that should catch F5 passes for an unrelated reason

`test/disclosure/content.test.ts:98`, "does not tear a sed expression apart on its
`|` delimiters", uses `sudo sed -i '\|[[:space:]]/home[[:space:]]|d' /etc/fstab`.
Every fragment of that line contains `[` or `'`, so `COMMAND_SHAPE` rejects them
*regardless of where the walk stops*. The test therefore verifies punctuation, not
the mechanism it is named after — and the sibling real line in the same repo (F5)
defeats it. A test reporting a property the code does not have.

**Failure scenario:** someone rewrites the splitter, this test stays green, and the
leak survives another review.

### F7 — MEDIUM (measured) — rung 3 is available in exam mode without the ladder

`MAX_RUNG.exam` is 2, and the ladder enforces it correctly. But
`GET /api/tasks/:area/:slug` (`app.ts:101-104`) hands out the task's concept ids, and
`GET /api/concepts/:id` (`app.ts:108`) returns the full card body with **no session,
no mode, and no rung check**. Measured, in an exam-mode session:

```
task detail exposes concept ids: [{"id":"storage.lvm-abstraction-stack","title":"..."}]
GET /api/concepts/:id status=200 body="THE WHOLE CONCEPT CARD BODY, which is rung 3."
rung 3 via ladder body: "## PVs, VGs, LVs\n\nTHE WHOLE CONCEPT CARD BODY, which is rung 3."
```

Same content, one hop apart. An unguarded card browser is probably a feature the app
wants; if so, say so and stop describing rung 3 as gated. If not, the endpoint needs
to consider the caller's session.

**Failure scenario:** exam mode caps hints at rung 2 and the student reads rung 3
from `/api/concepts/:id` in another tab.

### F8 — MEDIUM (measured) — `HEREDOC_START` is unanchored, so `<<` anywhere silently swallows the rest of the solution

`HEREDOC_START` is matched against the whole trimmed line, so it fires inside
quotes, inside a trailing comment, and on a herestring. Each of these discards every
following line of the solution:

```
unquoted herestring       grep -q x <<<WORD         -> ["grep"]      (next line lost)
string containing <<      echo "shift a << b"       -> ["echo"]      (next line lost)
trailing comment with <<  blkid # see << EOF note   -> ["blkid"]     (next line lost)
printf with <<TEXT        printf 'usage <<HELP'     -> ["printf"]    (next line lost)
```

Fail-closed, so it under-discloses rather than leaking — but silently, with nothing
saying why, and no test covers it. Two smaller siblings, also measured and also
undisclosed: a line whose first word is a variable expansion or a redirect emits
nothing (`$EDITOR /etc/fstab` → `[]`, `> /etc/motd echo hi` → `[]`), and a `case`
block emits one word *per label* (`["a","echo","b"]`), not just the first as
documented.

**Failure scenario:** an author puts a herestring on line 2 of a solution and rung 4
renders a two-command sketch for a ten-command task.

### F9 — LOW (measured) — `spawnSshPipe` registers no `child.on('error')`

Same listener set as the shipped code (`exit` only): `spawn ssh-that-does-not-exist`
→ `UNCAUGHT from a missing binary: spawn ssh-that-does-not-exist ENOENT`. Low
reachability (ssh is present on any plausible host), same blast radius as F1/F2.

**Failure scenario:** the trainer runs somewhere `ssh` is not on `PATH` and the first
terminal click takes the API down instead of showing an error in the tab.

### F10 — LOW (measured/reasoned) — nothing bounds an idle or half-open terminal

Ordinary closes are clean: I sent a TCP RST after a successful handshake and
`pty.kill()` ran (measured). But `WebSocketServer` is constructed with no
ping/heartbeat and there is no idle timeout, so a connection that dies without FIN
or RST — laptop sleep, NAT timeout — leaves `ssh -tt` and the guest PTY alive
indefinitely (reasoned; I did not simulate a half-open socket).

### F11 — LOW (measured) — `at()`'s docstring overstates its guarantee

`test/server/app.test.ts:101-110` says "a wrong *path* throws … a missing *leaf*
returns undefined". Measured, a missing key at **any** position returns `undefined`
and abandons the rest of the path:

```
  missing leaf key                           -> returned undefined
  missing INTERMEDIATE key                   -> returned undefined
  array container + string key               -> THREW
  record container + numeric key             -> THREW
  descend into a string / number / null      -> THREW
  array index out of range, path ENDS        -> returned undefined
  array index out of range, path CONTINUES   -> THREW
  explicit undefined-valued own key          -> returned undefined
```

So the `undefined` arm is *not* reachable only at the leaf. Nothing is wrong today
(see the ruling below — both `toBeUndefined()` assertions are proven to have teeth),
but the docstring licenses the mistake for the next reader.

### F12 — LOW (measured) — `/api/sessions` reports a body problem as a task problem

No body, `not json`, `[]`, `null`, `"hello"` all return
`400 {"error":"unknown task: undefined"}`. The status is right and nothing is
insecure; the message misdirects. Every other failure path is clean: unknown ids
404 on all five session routes, `..` and extra segments 404 (Map lookup only — no
filesystem path is ever built from a task id, so there is no traversal), and
`Object.hasOwn(MODES, v)` correctly refuses `constructor`, `toString` and
`__proto__` as modes (all 400).

### F13 — LOW (reasoned) — the shared `upgrade` listener destroys sockets for every other path

`attachTerminal` adds a `server.on('upgrade')` that `socket.destroy()`s anything
that is not `/ws/terminal`. It is the only upgrade consumer today; a second one
added later would have its handshakes destroyed by this one.

### F14 — INFO (measured) — mandate 8's per-file count

`test/content/bank.test.ts` has **8** `new URL(...).pathname` call sites, not 7. The
file count (seven files) is correct and the file is parked, so nothing follows.

### F15 — INFO (measured) — the report understates its own coverage

The report says `wscat` sends no `Origin`, "so the browser path was never exercised
and cross-origin refusal was never observed". `test/server/terminal.test.ts:157`
performs a real `ws` handshake with `Origin: https://anywhere.example`, asserts the
socket is refused, and asserts `spawned === []`. The refusal arm **is** observed, in
an automated test, against a real loopback server. What is unexercised is a real
browser. This matters because the disclosure as written invites a heavier remedy
than the gap needs.

---

## The four rulings

### 1. Is the `at` helper acceptable?

**Yes — accept it into the project's conventions, with the docstring corrected and
an `expectMissing` added for future use. Do not require retrofitting.**

The decisive check, done in `/tmp/t23/repo`, both halves:

*Part one — do the typo'd forms still pass?* Yes, as predicted, and worse than
predicted. Typo'ing the **leaf** (`prompt`→`prromptt`, `checkpoints`→`checkpointz`):
`Tests 16 passed (16)`. Typo'ing an **intermediate** key (`tasks`→`taskzz`), which
the docstring implies should throw: `Tests 16 passed (16)`.

*Part two — do the un-typo'd forms fail when the masking is deleted?* Yes. Removing
the `if (namesCheckpoints(mode) || revealed)` guard at `session.ts:113`:

```
 FAIL  test/server/app.test.ts > grading and finishing > masks which checkpoints failed in exam mode
AssertionError: expected [ { id: 'lv-home-size', …(2) }, …(1) ] to be undefined
 ❯ test/server/app.test.ts:375:39
 Tests  1 failed | 15 passed (16)
```

Adding `prompt: t.prompt` to `summary()` in `app.ts`:

```
 FAIL  test/server/app.test.ts > GET /api/tasks > lists tasks without the prompt
AssertionError: expected 'Grow the home logical volume to 12 Gi…' to be undefined
 ❯ test/server/app.test.ts:215:44
 Tests  1 failed | 15 passed (16)
```

**Both masking assertions have teeth.** So the conclusion I was given is right, and
one premise of it is wrong: the `undefined` arm is *not* reachable only through a
missing leaf, so a wrong path does not always throw (F11). The tautology is not live
because there are only two `toBeUndefined()` call sites, each one key past a
container the same test has already asserted the shape of.

Required, cheaply: fix the docstring to say "a missing key at any depth returns
`undefined`; a type mismatch throws", and add

```ts
function expectMissing(root: unknown, ...path: Array<string | number>): void
```

that asserts the parent container is a record before asserting the key is absent.
Use it for the two sites. `items`/`str`/`num` need no change — they throw on the
wrong runtime type, which is what makes the other 25 `at` assertions real.

### 2. Is allowing a missing `Origin` the right call?

**Yes. Keep it, on two conditions.**

Browsers always send `Origin` on a `ws://` handshake, so the only clients the gap
admits are non-browser clients that already reached loopback — and any process that
can do that can also run `ssh -i ~/.ssh/rhcsa_lab student@$RHCSA_VM_IP` directly,
without this server. The gate exists to stop a *page the user visits* from driving
their own loopback, and measured, it does that on every variant I tried, including
the ones that usually break allow-lists (`''`, `null`, case, trailing slash,
duplicate headers). Requiring the header would buy nothing against an attacker who
already has local execution, and would break the `wscat` acceptance path that Step
20 depends on.

Conditions: (i) if Task 24 ever drops `wscat` from the acceptance path, tighten this
to require the header — it is a two-line change and the reason for the allowance
disappears with the client; (ii) the allowance must stay pinned by a test rather
than a comment, and it already is (`terminal.test.ts:177`).

On the disclosed browser gap: **carry it into Task 24, do not block on it.** The
refusal arm is covered by an automated real-handshake test (F15), so what is missing
is browser integration, which is Task 24's own subject and cannot be exercised here
(react/jsdom/xterm are not installed). Add it to Task 24's manual acceptance: open a
page on a foreign origin, attempt the upgrade, confirm refusal in the browser
console.

### 3. Is an untested 83-line `index.ts` acceptable?

**No. Extract — and the reason is not the line count, it is that `HOST` is one
character away from binding `::` (measured) and nothing would fail.**

The seam: a new **side-effect-free** `src/server/config.ts` exporting

```ts
export function readPort(raw: string | undefined): number
export const HOST = '127.0.0.1'
export const VITE_DEV_PORT = 5173
export function allowedOriginsFor(port: number, vitePort: number): ReadonlySet<string>
```

with `index.ts` reduced to wiring. Note the real obstacle is not that `readPort` is
impure — it is already pure — it is that importing `index.ts` *executes*
`loadVmConfig`, `loadBank`, `chooseTransport` and `serve`. A separate module is what
removes that, and it needs no `.env.local` and no VM.

Then pin, in one small test file:

- `readPort(undefined) === 5175`; `readPort('')`, `readPort('abc')`, `readPort('0')`,
  `readPort('70000')` each throw with `RHCSA_PORT` in the message.
- `HOST === '127.0.0.1'`.
- `allowedOriginsFor(5175, 5173)` equals exactly the four expected strings, and does
  not admit `http://evil.com` or `http://localhost:5175/`.
- And the one that matters most, which is cheap because `terminal.test.ts` already
  starts a real ephemeral loopback server: `serve({ fetch, port: 0, hostname: HOST })`,
  assert `server.address()` is `{ address: '127.0.0.1', family: 'IPv4' }`, assert
  `server instanceof Server`, close it. I ran exactly that (both arms — omitting
  `hostname` gives `::`), so this is known to work and is the regression test for
  mandate 2(a) itself.

That leaves only `chooseTransport` and `loadBank` uncovered in `index.ts`, which is
the right place for the line to fall.

### 4. Is the redactor's residual mitigation adequate?

**No — but not for the reason it is defended.**

The two *disclosed* residuals are fine. `for u in alice bob` → `u` and a `case`
label → `a` are harmless noise in a hint, correctly triaged, and I agree the sketch
is a hint and not a grader.

What is not adequate is that the same paragraph asserts "neither can leak an
argument" while the repo contains a first-solution fixture that leaks two (F5), the
test that should have caught it passes for an unrelated reason (F6), the residual
list omits three more behaviours (F8), and the proposed mitigation — an authoring
convention — is enforced by nothing and is already violated by the content in the
repo. An authoring convention cannot mitigate a leak the existing content triggers.

Required:

1. **Fix the leak.** Cheapest correct change: strip quoted runs before splitting —
   replace the contents of `'…'` and `"…"` with a placeholder that cannot match
   `COMMAND_SHAPE`, then split on the command separators as now. Measured against my
   probe set, that removes `Listen`, `DocumentRoot`, `sdb1`/`sdb2` and the `grep -E
   'foo|bar'` class while leaving every real command (`sed`, `tee`, `awk`, `find`,
   `systemctl`) intact. The unquoted-delimiter case (`s\|a\|b\|` → `hosts`) survives
   and should be *documented* as a residual rather than chased.
2. **Anchor `HEREDOC_START`** to a heredoc position, or at minimum skip it when the
   `<<` is inside a quoted run or after a `#`, and add the herestring case to the
   tests (F8).
3. **Fix the two false claims**: `content.ts:90`'s "neither can leak an argument",
   and `content.test.ts:98`'s name.
4. **Test against real content, not a synthetic** — assert the sketch for
   `selinux/019`'s solution 01 contains no `Listen` and no `DocumentRoot`. That is
   the assertion that would have caught this, and its absence is why the mandate's
   fix looked complete.

---

## Items 5 and 7 of the review context, for completeness

**Step 20 deferral and the `tasks: 5` / `checkpointTotal: 5` predictions:** I agree
with the reasoning and with not encoding them in a test. Tasks 21/22 own the bank and
both numbers move when content is added; the right invariants are the ones already
pinned (`countCheckpoints(assert.sh) === 0`, and that an id emitted from several
branches counts once). One correction to the prediction itself: the report's expected
`"rebooted": true` is contingent, not certain — `grade()` returns early with
`rebooted: false` when `!task.rebootCheck || !anythingPassed`
(`grader.ts:88-92`), so on an untouched guest the correct expected value is `false`.
Worth writing into the manual step so a `false` is not read as a regression.

**Non-`Error` rejection from the reboot path and `exec` rejection on run B:**
confirmed as described, and both are in `src/engine/grading/grader.ts`, which this
commit does not touch — out of scope per the range. `grader.ts:103` does handle a
non-`Error` rejection (`e instanceof Error ? e.message : String(e)`). The in-scope
half — that a failed reboot surfaces to the student — is covered at
`session.test.ts:145`.

**FL2 (the brief's Step 5 acceptance checks deferred):** accepted; it needs the VM.
