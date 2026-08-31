# Task 22 — scoped re-review of fix round 1

Range: `85bf671..decf75d` (2 commits, 11 files, 199 insertions / 31 deletions).
`85bf671` excluded as BASE. Re-reviewed 2026-08-30 on the WSL host (`date +%z` =
`+0800`). No VM exists; nothing in `content/` was executed against a guest. No
`vmrun`, no `provision.sh`, no `ssh-keygen`, no `.env.local`, no `sudo`. The repo
was not mutated: `git status --porcelain` was empty before and after (verified
twice, 0 lines).

## Verdict

**APPROVED.**

Every finding the round claimed to close is closed in code. All five gates pass
and I ran each one myself. There is no checkpoint drift of any kind — I diffed
every declaration header in `content/` between `9d2dc22` and `decf75d`, not just
the five files the implementer compared, and found zero differences. F1's
arithmetic reproduces exactly as reported and holds for timezones on both sides
of UTC, which I measured rather than inherited.

Two leftovers are documentation-only and I am naming them rather than pretending
they are closed: **F13** and the reporting half of **F7** published their
corrections in `task-22-fix-1-report.md` section 5 instead of correcting the rows
in `task-22-report.md`, which still carries both wrong rows (lines 174 and 118)
with no pointer to the correction. Neither affects content, `validate` or Task 23.

## Per-finding disposition

| # | Sev | Disposition | Basis |
| --- | --- | --- | --- |
| F1 | HIGH | **CLOSED** | measured — arithmetic, behaviour, both TZ signs |
| F2 | MED | **CLOSED** | measured (YAML parses via `coverage`); wording reasoned |
| F3 | MED | **CLOSED** | measured (exact clause deleted, YAML parses) |
| F4 | MED | **CLOSED**, one residual named | parsers measured; guest zone unmeasurable |
| F5 | MED | **CLOSED**, comment over-claims | measured (split against real nmcli escaping) |
| F6 | LOW | **CLOSED**, header enumeration incomplete by one temp file | measured by reading fixtures |
| F7 | LOW | **CLOSED** (code) / **PARTIALLY CLOSED** (report row) | guard measured; `task-22-report.md:118` still wrong |
| F8 | LOW | **CLOSED** | measured, 18 renderings incl. adversarial |
| F9 | LOW | **CLOSED**, one asymmetry left in an untouched file | measured by reading; strictness reasoned |
| F10 | LOW | **NOT ATTEMPTED** (as ruled) | measured: all nine sites unchanged |
| F11 | NOTE | **NOT ATTEMPTED** (as ruled) | measured: `src/` diff is empty |
| F12 | NIT | **CLOSED** | measured: comment now matches the fixture; body and `# expect-fail:` byte-identical |
| F13 | NIT | **PARTIALLY CLOSED** | `task-22-report.md:174` still describes `--list-services` |
| F14 | NIT | **NOT ATTEMPTED** (as ruled) | measured: `task-22-mandates.md` carries both strikethroughs |
| F15 | LOW | **CLOSED**; its stated rationale is wrong | measured by reading; see §4 |

## 1. F1 — verified independently, both signs

### The arithmetic on this host

```
TZ offset +0800 (Asia/Manila)
date -d    2027-06-30 +%s = 1814284800  /86400 = 20998  remainder 57600
date -u -d 2027-06-30 +%s = 1814313600  /86400 = 20999  remainder 0
day-index difference = 1
```

Both of the implementer's numbers reproduce, including the **57600** remainder.
The remainder is the load-bearing half: it is why dropping `-u` while keeping the
old `days * 86400` form would have broken the check in every timezone rather than
fixing it in one hemisphere, because `days * 86400` is always a multiple of 86400
and a non-UTC local midnight is not.

### The new comparison accepts what `strtoday()` stores here, and rejects the rest

Simulated the exact shipped comparison against a stubbed field 8, alongside the
old one:

| field 8 | new grader | old grader |
| --- | --- | --- |
| 20998 (what `strtoday` stores at UTC+8) | **PASS** | FAIL |
| 20997 (a day early) | FAIL | FAIL |
| 20999 (a day late) | FAIL | PASS (wrong) |
| empty (no expiry set) | FAIL | FAIL |

Fail-closed on the unset case, and the day-late case is now correctly rejected
where the old form accepted it on this host.

### Does it hold for a timezone behind UTC? Yes — measured

This is the question the fix turns on, and the answer is stronger than "both
signs happen to work". The grader now computes **the identical expression
`strtoday()` computes**, in the same timezone, on the same host — so the two
agree by construction, whatever the offset is. Measured across nine zones:

| TZ | `want` = `strtoday` stores | new | old |
| --- | --- | --- | --- |
| Asia/Manila (+08) | 20998 | PASS | FAIL |
| Australia/Sydney (+10) | 20998 | PASS | FAIL |
| Asia/Kolkata (+05:30) | 20998 | PASS | FAIL |
| Pacific/Kiritimati (+14) | 20998 | PASS | FAIL |
| Europe/Berlin (+02 DST) | 20998 | PASS | FAIL |
| Europe/London (+01 BST) | 20998 | PASS | FAIL |
| UTC | 20999 | PASS | PASS |
| America/New_York (−04) | 20999 | PASS | PASS |
| America/Los_Angeles (−07) | 20999 | PASS | PASS |
| Pacific/Midway (−11) | 20999 | PASS | PASS |

`TZ=America/Los_Angeles date -d 2027-06-30 +%s` = 1814338800, `/86400` = 20999 —
which is also the UTC day index, which is why the old check passed there and why
the original review's "correct at or behind UTC" characterisation is right. Note
`Europe/London` also failed under the old check, because BST is UTC+1 in June;
the review's "east of Greenwich" phrasing was one zone too generous.

What remains **reasoned**, not measured, and is unchanged from the implementer's
own statement: that `chage -E` and `useradd -e` route through `strtoday()`, and
that `strtoday()` parses a bare `YYYY-MM-DD` as local midnight. No guest exists
to observe it on. If that premise is wrong the fix is wrong in the same direction
the old code was — but the old code additionally required the guest to be at or
behind UTC, so the fix is strictly less exposed than what it replaced.

### The comment does its job

`006/grade.sh:23-28` names `strtoday()`, states that it parses a bare
`YYYY-MM-DD` as local midnight and integer-divides by 86400, names `chage -E` and
`useradd -e` as the two writers that go through it, states the consequence
("off by one day on every guest ahead of UTC"), and only then says "Do not add
-u here." That is the mechanism, not a bare prohibition. A reader who wanted to
re-add `-u` has to disagree with a stated causal chain to do it.

One genuine improvement worth noting: `want=` is now in the detail string, so a
future timezone surprise is diagnosable from fixture output.

### Side effect worth recording: the checklist no longer needs pinning

`docs/vm-build-checklist.md:63` still reads `**Time**: your zone` — measured, it
is unchanged and still does not pin UTC. It no longer needs to. The fix removes
the timezone dependency instead of constraining the guest, which is the better of
the two available resolutions. No action.

## 2. F4 — the two new parsers

### The zone parser is correct against the real two-line-per-zone shape

Extracted the shipped awk verbatim and drove it through 15 shapes, including the
ones the implementer's six did not cover:

| shape | result | correct |
| --- | --- | --- |
| zone == default, iface listed | (no output) | yes |
| zone != default, iface listed | `public` | yes |
| multi-iface default zone, dev is 2nd of `eth0 eth1` | (no output) | yes |
| **substring hazard: dev=`eth1`, `eth10` under another zone** | `public` (not `trusted`) | yes |
| **dev=`eth10`, default `public`, `eth10` under `trusted`** | `trusted` | yes |
| `sources:`-only zone plus an iface zone | correct both ways | yes |
| iface absent from every zone (implicit default) | (no output) | yes |
| non-default named zone (`FedoraWorkstation`) | `FedoraWorkstation` | yes |
| two iface zones (`public` + `libvirt`), dev in each | correct both ways | yes |
| **tab-indented `interfaces:` line** | correct both ways | yes |
| empty input | (no output) | yes |

The `eth1`/`eth10` substring hazard the context asked about does not exist: awk's
`$n == i` is a whole-field comparison, and the zone-name line is matched by
`/^[^[:space:]]/` which excludes tabs as well as spaces. Not one-line-per-zone —
it carries `z` forward across the indented lines correctly.

### "No zone is fine" is implemented deliberately, not by fallthrough

`otherzone` is empty → `[ -z "$otherzone" ] ||` short-circuits → no `fail`. That
is the ruled semantics, implemented explicitly.

The obvious way this could have been an accidental pass — `firewall-cmd
--get-active-zones` failing and yielding empty output — is closed, because both
files assert `systemctl is-active firewalld` **before** reaching the zone check
(`019/setup.sh:58-59`, `028/setup.sh:81-82`). I checked the ordering in both
files specifically. Similarly, `defzone` being unreadable is a `fail`, not a skip.

### The route parser, and no-default-route

`ip -o route show default | awk '{for (n=1; n<NF; n++) if ($n == "dev") { print $(n+1); exit }}'`
resolves `ens160`, `enp0s3`, the multi-line `nexthop` form (returns the first
`dev`), and a bare `default via X dev tun0`. Empty input → no output → `dev`
empty → **loud `fail`** with a message naming the property that could not be
proven. Behaves as required with no default route.

Neither file hardcodes a device name: I grepped both, no `ens160`, no `eth0`.

### Residual — reasoned, unmeasurable here, and the one thing to check on the first guest

`019/setup.sh:131` derives the device as
`nmcli -g DEVICE connection show --active | head -1`, and `:146` derives the
connection as `nmcli -g NAME connection show --active | head -1`.

NetworkManager 1.42+ (RHEL 9.2 and later; the checklist says `rhel-9.x`) manages
loopback and lists a `lo` connection. `lo` is activated first at boot, so
`head -1` of the active list can plausibly be `lo`. If it is, then `dev=lo`, `lo`
appears under no firewalld zone, `otherzone` is empty, `connection.zone` for `lo`
is empty — and **F4's check in `019` silently passes while the real NIC sits in a
non-default zone.** That is a fail-open precondition, which is the direction this
project treats as unacceptable.

Three things keep this from being a reason to withhold approval:

1. It is **not measurable here** — no `nmcli`, no `firewall-cmd` on this host
   (verified: both absent). nmcli's active-list ordering is reasoned from
   NM's activation order, not observed.
2. `028` is **not exposed**: it derives `dev` from `$conn`, the connection the
   task is actually about and the one `grade.sh` reads out of `/etc/rhcsa-conn`.
   Its zone check therefore measures the right interface by construction.
3. The `head -1` idiom is **pre-existing and unchanged** at `028/setup.sh:21`,
   where the whole task's staging already depends on it, and the original review
   passed it. `019`'s new code inherits a project-wide assumption rather than
   introducing a new one.

Recommended hardening when someone is next in these files, not now: prefer
`ip -o route show default` as the *primary* source (it can never return `lo`), or
filter the `--active` rows by `TYPE != loopback`. Cheap, and it turns a
fail-open into a fail-loud.

## 3. F5 — the field split and the assertion

**The assertion is right.** `028/solutions/02:36-40` reads the end state through
`nmcli -g connection.autoconnect`, which is format-agnostic: it reports `yes` for
an ifcfg profile's `ONBOOT=yes` just as it does for a keyfile's
`autoconnect=true`. So it genuinely detects the ifcfg no-op the two `sed`s cannot
perform, rather than re-checking what the `sed` wrote. The explicit
`printf >&2; exit 1` over a bare `[ … ]` is the right call and the implementer's
reasoning for it is correct: a bare test under `set -e` aborts with status 1 and
no message, which defeats the stated purpose of an *attributable* failure.

**The escaping story, measured.** The parser is
`awk -F: -v u="$uuid" '$1==u { sub(/^[^:]*:/, ""); print; exit }'`. It does not
strip backslashes, so it cannot corrupt a path containing one — that hazard is
avoided. It handles a name with spaces and an ifcfg path correctly. But it also
does not **un-escape**, and `nmcli -g` writes a colon inside a value as `\:`.
Measured against both inputs:

```
implementer's synthetic input   .../odd:name.nmconnection   -> .../odd:name.nmconnection
real nmcli -g output            .../odd\:name.nmconnection  -> .../odd\:name.nmconnection
```

So the comment at `:22` — *"The sub() takes everything after the first colon so a
colon in the path is safe too"* — is **over-claimed**. With a real colon in the
filename, `$file` keeps a literal backslash and `sed -i` fails with "no such
file". That is loud, not silent, and no worse than the old form (which produced
an empty `$file` and failed loudly too), and the connection names a RHEL 9
installer produces (`ens160`, `Wired connection 1`) contain no colon. So: the
fix is an improvement, the *measurement behind one clause of its comment used a
synthetic fixture that did not reproduce nmcli's own escaping*, which is the
same measurement-tool defect class as F1 in miniature. NIT. Fix is either to
un-escape (`gsub(/\\:/, ":")` after the `sub`) or to soften the comment to say
what was actually proven.

The UUID key itself is sound: `connection.uuid` is a valid profile-mode property,
a UUID cannot contain a colon, and `UUID,FILENAME` are both valid list-mode
fields.

## 4. F15 — the fourth `is-enabled` site

**The code is correct.** `017/grade.sh:42-44` anchors on the string, adds a
detail string where there was none, `# unprobed-invariant: sshd-intact` is
untouched at `:36`, and `sshd-intact` appears in **zero** `# baseline-fail:`
headers anywhere in `content/` (measured, `grep -c` = 0). Checkpoint id,
description text and invariant status all unchanged.

**The implementer's stated rationale for the variable name is wrong, and the
ruling repeated it.** The claim is that using `state` would have "clobbered the
value the `stamp-enabled` detail string reads". It would not have.
`state=$(…)` is at `:14`, and `ck stamp-enabled … "is-enabled=$state"` is at
`:16` — the detail string is expanded when `ck` is *called*, and `ck` in
`content/lib/assert.sh:61-68` is a plain function that formats and prints
immediately, with no deferred evaluation. By the time line 42 runs, line 16 has
already emitted its JSON. Reusing `state` at line 42 would have been harmless.

So: `state` is genuinely intact for `stamp-enabled` at its point of use (verified
by reading), but for a reason of ordering, not of naming. `sshd_state` is still
the better name — it is self-describing and it removes any question for a future
editor who reorders the file — so nothing needs changing. I am recording it
because the ruling in `task-22-fix-1.md` §4 endorsed the claim as "correct" and
called it "the one place in the round where a careless edit could corrupt an
unrelated checkpoint's diagnostic". There was no such hazard.

**No other variable was shadowed by either commit.** Checked every new
assignment against every pre-existing one in the same file:

| file | added | pre-existing | collision |
| --- | --- | --- | --- |
| `019/grade.sh` | `state` | `body`, `now`, `want` | none |
| `019/setup.sh` | `defzone`, `dev`, `otherzone`, `aconn`, `czone` | `state`, `enforce`, `repos`, `now`, `want` | none |
| `017/grade.sh` | `sshd_state` | `unit`, `state`, `target` | none |
| `028/grade.sh` | `state` | `perm`, `conn`, `auto` | none |
| `028/setup.sh` | `defzone`, `dev`, `czone`, `otherzone` | `conn`, `perm`, `recorded`, `auto` | none |
| `006/grade.sh` | — (`want` retyped from timestamp to day count; `got` deleted) | `gid`, `days`, `max` | none; `want` and `got` have no other reader |
| `006/setup.sh` | `expdef`, `wantday`, `expsecs` | `u`, `maxdef` | none (`wantday`, not `want`) |
| `028/solutions/02` | `uuid` | `conn`, `file` | none |

## 5. No checkpoint drift — verified independently and more broadly than claimed

I did not compare the five files the implementer compared. I compared **every
`.sh` and `.yaml` file present in `content/tasks` at `9d2dc22`**, diffing the full
set of `# baseline-fail:`, `# expect-fail:` and `# unprobed-invariant:` lines
between `git show 9d2dc22:<path>` and the working tree:

```
header drift files: 0
content file set identical (no file added, removed or renamed under content/)
```

Twenty-six declaration headers across all five tasks, byte-identical. The full
current inventory (five `# baseline-fail:`, sixteen `# expect-fail:`, five
`# unprobed-invariant:`) is reproduced in my transcript and matches `9d2dc22`
line for line. `sshd-intact` in a `# baseline-fail:` header: 0 hits.

Task 23's `countCheckpoints` is unaffected: every `ck` id in the changed graders
is still a bare literal — no variable, no interpolation, no loop — which I
confirmed while extracting them below.

## 6. Per-task declared/emitted counts, from my own extractor

Written from scratch, covering all four call forms (`ck`, `ck_pass`, `ck_fail`,
`ck_skip`) and stripping comments before matching:

| task | my emitted | my goal | implementer's | match |
| --- | --- | --- | --- | --- |
| `selinux/019-httpd-alt-port` | 8 | 7 | 8/7 | yes |
| `storage/014-grow-home-lv` | 5 | 2 | 5/2 | yes |
| `systemd/017-boot-time-service` | 5 | 3 | 5/3 | yes |
| `troubleshooting/028-restore-remote-access` | 5 | 4 | 5/4 | yes |
| `users/006-team-provisioning` | 8 | 7 | 8/7 | yes |

All five pairs match. `storage/014` reports 5/2 on the first run of my extractor,
not 0/2 — the `ck_pass`/`ck_fail` direct-call forms are covered, so the
under-count the implementer disclosed is not reproduced. Its correction is
confirmed as genuine: the numbers now have a second, independent source.

Cross-check both directions, over `# baseline-fail:` + all `# expect-fail:`
(with `@post` stripped) + `# unprobed-invariant:` against the emitted set:
**zero `UNPROBED-GOAL`, zero `UNDECLARED-ID`** across all five tasks.

## 7. The rest

**F2 — CLOSED.** `017/task.yaml:26` now carries
`- Make sure it has already run, not just that it will run at the next boot.`
`coverage` parses the file (exit 0), so the block scalar is intact. One
observation, not a finding: there is mild tension with the bullet above it
("Nobody is going to run it by hand"), which a student could read as
contradictory. `enable --now` satisfies both, and the wording is the one the
ruling authorised, so I am flagging it only in case a later prompt pass wants to
merge the two bullets.

**F3 — CLOSED.** The deleted clause is exactly the one named: *"in addition to
their own primary groups"*, and only that. `006/task.yaml:25` now reads
`- Create users alice and bob. Both must be members of devops.` Nothing else in
the prompt changed. `coverage` exit 0, zero `problem:` lines, `tasks: 5`,
`objectives: 68`, `untaught concepts: 0` — unchanged from the original review's
numbers.

**F6 — CLOSED, with one incomplete enumeration.** Both one-liners are present:
`006/setup.sh:34` (`sed -i '/^[[:space:]]*%devops/d' /etc/sudoers`, placed before
the `visudo` precondition, using the identical `^[[:space:]]*%devops` pattern the
precondition greps for, and with no address count so it deletes every match) and
`028/setup.sh:47` (`--permanent --remove-port=22/tcp`, beside the service
removal).

Both rewritten headers were checked against the fixtures rather than taken on
trust. I inventoried every state-changing command in all five `006` fixtures and
all five `028` fixtures:

- `028`'s header is **accurate**. The four artefacts the fixtures create —
  sshd enabled, permanent `ssh`, permanent `22/tcp`, `autoconnect=yes` — are each
  undone, and `antisolutions/02`'s *runtime-only* `--add-service=ssh` is undone by
  the `--reload` that follows the two permanent removals. The disclaimer about
  arbitrary hand edits is true and points at the right mechanism.
- `006`'s header says *"'Any prior attempt' means every artefact the shipped
  solutions and antisolutions create: the three accounts, the group,
  `/etc/sudoers.d/devops`, and a `%devops` line appended to `/etc/sudoers` by
  solutions/02."* The enumeration misses one: `solutions/02:15` leaves
  `/tmp/sudoers.new` behind, and setup does not remove it. It affects no
  precondition and no checkpoint, so this is a NIT against a header that says
  "every artefact" — the same over-claiming class F6 exists to fix, one notch
  smaller. Either add `rm -f /tmp/sudoers.new` or say "every artefact that could
  affect a precondition".

**F7 — CLOSED in code, PARTIALLY CLOSED in the report.** The guard at
`006/setup.sh:47-56` mirrors the `PASS_MAX_DAYS` one and converts `EXPIRE=` to a
local day count with the same expression `grade.sh` uses, cross-referencing the
`strtoday` note. Measured against seven `/etc/default/useradd` shapes:

| input | behaviour | correct |
| --- | --- | --- |
| `EXPIRE=` (stock RHEL 9) | skipped | yes |
| `EXPIRE=2027-06-30` | **fires** | yes |
| hazard date among other keys | fires | yes |
| `EXPIRE=2030-01-01` | skipped (deliberate: `carol-expiry` still starts red) | yes |
| `# EXPIRE=2027-06-30` | skipped (`-F=` makes `$1` = `# EXPIRE`) | yes |
| `EXPIRE=garbage` | skipped, `date` failure swallowed by the `if` | yes |
| realistic multi-key stock file | skipped | yes |

The report row: `task-22-report.md:118` still reads
`| carol-expiry | covered by carol's absence above | — |`. The corrected row is
in `task-22-fix-1-report.md` §5.

**F8 — CLOSED, measured against 18 renderings.** The shipped pattern
`\((ALL|root)([[:space:]]*:[[:space:]]*(ALL|root))?\)[[:space:]]+(NOPASSWD:[[:space:]]*)?ALL`
was compared against the ruled pattern and the original:

| rendering | shipped | ruled | old | wanted |
| --- | --- | --- | --- | --- |
| `(ALL) ALL` | YES | YES | YES | match |
| `(ALL : ALL) ALL` | **YES** | **no** | no | match |
| `(ALL:ALL) ALL` | YES | YES | YES | match |
| `(root) ALL` | YES | YES | **no** | match |
| `(root : root) ALL` | **YES** | **no** | no | match |
| `(ALL) NOPASSWD: ALL` | YES | YES | YES | match |
| `(root) NOPASSWD: ALL` | YES | YES | no | match |
| `(ALL : ALL) NOPASSWD: ALL` | **YES** | **no** | no | match |
| `(ALL : bob) ALL` | no | no | no | reject |
| `(bob : ALL) ALL` | no | no | no | reject |
| `(bob) ALL` | no | no | no | reject |
| `(ALL) /usr/bin/less` | no | no | no | reject |
| `(ALL : ALL) /bin/ls` | no | no | no | reject |
| `(ALLX) ALL` | no | no | no | reject |
| `(rooty) ALL` | no | no | no | reject |
| `(ALL : ALLX) ALL` | no | no | no | reject |
| `(bobALL) ALL` | no | no | no | reject |

The deviation is justified as claimed and the lead's acceptance holds: the
shipped pattern is a strict superset of the ruled one that still rejects every
must-not case, including the four adversarial near-misses I added. `(ALL : ALL)`
is real — the ruled pattern would have false-failed it.

One pre-existing looseness, **not a regression**: the trailing `ALL` is
unanchored, so `(ALL) ALLOW` matches. It matched under the old pattern too, and
`sudo -l` renders command specs as absolute paths or the literal `ALL`, so it is
unreachable. Recording it so the next reader does not think it is new.

**F9 — CLOSED, with one asymmetry left in an untouched file.** All three named
sites are strict and identically spelled: `019/grade.sh:15-17`,
`028/grade.sh:17-19`, and `028/setup.sh:67-69`, whose comment now honestly says
*"the exact negation of the grader's probe, which anchors on the string rather
than on is-enabled's exit status"* — which is true, byte for byte.

The residual: `019/setup.sh:75-76` is untouched by this round and still uses
`[ "$state" != "enabled" ]`, an equality test on the whole capture, where the
grader now uses `grep -qx enabled`, which matches *any line* equal to `enabled`.
If `systemctl is-enabled httpd` ever emitted a warning line alongside `enabled`
(both are captured, `2>&1`), the grader would report enabled while setup's `!=`
would not fire — so `httpd-enabled` could pass at baseline. Reasoned, not
measured; `is-enabled` on `httpd.service` prints one word in practice. The
implementer explicitly kept `028/setup.sh` in step but did not do the same for
`019/setup.sh`. Worth one line in the next pass over these files, and worth
noting that the strict `grep -qx` form is the *more* tolerant of the two here,
which is the opposite of what its name suggests.

**F10 — NOT ATTEMPTED, as ruled.** Measured: all nine `producer | grep -q` sites
are unchanged in body (`006/grade.sh:14,57`, `019/grade.sh:23,26,30,37,40,43`,
`028/grade.sh:23`, `019/setup.sh:80,86`, `028/setup.sh:74`). Line numbers moved;
no probe body did. Note that F9 and F15 *added* four new `printf | grep -qx`
pipelines and F5 added one `nmcli | awk … exit` pipeline — all of the same
SIGPIPE-hazard shape, all reading input that fits the pipe buffer by orders of
magnitude, and the `printf | grep -qx` form was already shipped and reviewed at
`017/grade.sh:15`. Consistent with the ruling; nothing to do, but the forwarded
whole-branch pass now has 14 sites rather than 9.

**F11 — NOT ATTEMPTED, as ruled.** `git diff --stat 85bf671 decf75d -- src/` is
empty. `vmrun.ts` untouched.

**F12 — CLOSED.** The new comment at `006/antisolutions/01:2-6` describes what
the fixture does: it creates the group and the three accounts with the aging,
adds nobody to `devops`, writes no sudoers rule, and therefore fails
`sudo-devops` for two independent reasons. I checked that against the body: it
is accurate. Fixture body byte-identical (only the comment block changed in the
diff) and `# expect-fail: alice-in-devops, bob-in-devops, carol-in-devops,
sudo-devops` unchanged — confirmed by the header-drift diff in §5, which covers
this file. A pleasing interlock: this fixture's `# expect-fail:` deliberately
omits `carol-expiry`, which means it only tells the truth *because* F1 is fixed.

**F13 — PARTIALLY CLOSED.** `task-22-report.md:174` still reads
`| firewall-ssh | … | firewall-cmd --permanent --list-services and --permanent --list-ports |`.
The corrected row is in `task-22-fix-1-report.md` §5 and is right (the code does
use `--permanent --list-all` and greps both spellings, byte-for-byte the
grader's probe at `028/grade.sh:32-33` — I verified that). Publishing a labelled
correction rather than silently rewriting a delivered report is defensible and
arguably better provenance, but a reader who opens `task-22-report.md` alone is
still misled, and there is no pointer. One-line fix: strike the row in place, or
add a "corrected in `task-22-fix-1-report.md` §5" note.

**F14 — NOT ATTEMPTED, as ruled.** Verified the lead's own corrections landed:
`task-22-mandates.md:433-436` has mandate 7 item 5 struck through,
`:489` reads `(~~23~~ **30** scripts …)`, and `:495-496` reads
`~~**203 passing / 20 files**~~ **246 passing / 23 files**`.

## 8. Gates — re-run, not accepted

| gate | command | result |
| --- | --- | --- |
| typecheck | `npm run typecheck` | `tsc --noEmit`, **exit 0**, no output |
| tests | `npx vitest run` | **23 files passed, 246 tests passed**, exit 0 |
| shell syntax | `bash -n` over every `content/**/*.sh` | **38 scripts, 0 errors** (37 fixtures + `content/lib/assert.sh`) |
| shell syntax, diff only | `bash -n` on the 9 changed scripts | 9/9 ok |
| coverage | `node src/cli/index.ts coverage` | **exit 0**, `problem:` lines = **0**, `tasks: 5`, `concepts: 10`, `objectives: 68`, `uncovered: 58`, `untaught concepts: 0` |
| repo clean | `git status --porcelain` | **0 lines**, before and after |

246/23 is unchanged, and the diff contains no TypeScript and no test file, so
the count could not have moved.

**Scope confirmed empty**, by `git diff --name-only 85bf671 decf75d` filtered:
nothing under `src/`, nothing under `scripts/`, no `*.test.*` / `*.spec.*`, not
`package.json`, not `package-lock.json`, not `content/objectives.yaml`, not
`content/lib/assert.sh`, nothing under `content/tasks/storage/014-grow-home-lv/`.
All 11 changed paths are under `content/tasks/`. File modes are unchanged: nine
scripts at 755, two `task.yaml` at 644. No `set -e` was added to any `setup.sh`
(all four still `set -uo pipefail` with the `need`/`fail` wrappers, and
`storage/014` still `set -euo pipefail` as documented).

Against `9d2dc22` the same 11 files appear plus `scripts/guest-provision.sh`,
which is `85bf671` — the lead's commit, correctly excluded.

## 9. New, and out of the fix round's scope

Both of these are mine, not the round's, and neither is a reason to withhold
approval. Stating scope explicitly as instructed.

### N1 — NIT, measured. F1's new form can make four checkpoints vanish instead of failing one

`006/grade.sh:29` is `want=$(( $(date -d 2027-06-30 +%s) / 86400 ))`. If `date`
ever produced no output, the arithmetic expansion raises a syntax error and
leaves `want` **unset** (not empty), and the next line's `"$want"` then trips
`set -u`, which is fatal. Measured, running the exact grader shape:

```
{"id":"group-gid","status":"0"}
g.sh: line 5: / 86400 : arithmetic syntax error: operand expected
g.sh: line 7: want: unbound variable
grader exit=1
```

`carol-expiry`, `alice-maxdays`, `sudo-devops` and `student-intact` are never
emitted. The old form (`want=$(date -u -d …)`) left `want` *empty*, so
`carol-expiry` simply failed and the grader ran to completion — measured as the
control. So the F1 fix trades "one checkpoint fails" for "four checkpoints
disappear" in this one failure mode.

Reachability: `date -d 2027-06-30 +%s` cannot fail on any system with GNU
coreutils, and if `date` is missing the grader has larger problems. So this is a
NIT. But "a checkpoint silently vanishes from the verdict instead of failing" is
the exact hazard `content/lib/assert.sh:22-27` was written to prevent, so it is
worth one line: split the two steps (`epoch=$(date -d … +%s)` then
`want=$(( ${epoch:-0} / 86400 ))`), or `|| echo 0`. The same shape exists at
`006/setup.sh:49` (`wantday=`), where a death is loud and harmless — setup
exiting non-zero is a correctly-reported staging failure.

### N2 — observation only, no action

Not a finding, recorded for the Step 9 failure table: because F1's fix now makes
`carol-expiry` correct in every timezone, `006/antisolutions/01`'s
`# expect-fail:` list — which deliberately omits `carol-expiry` and
`alice-maxdays` — becomes honest for the first time. Before the fix that fixture
would have reported an *undeclared* `carol-expiry` failure on this host, which
the original review predicted. Both `006` antisolutions' declarations are now
consistent with the grader on a UTC+8 guest as well as a UTC one.

## 10. Where a ruling in `task-22-fix-1.md` was wrong

One, and it is small: §4's endorsement of the `sshd_state` naming rationale as
"correct", and its characterisation of that line as *"the one place in the round
where a careless edit could corrupt an unrelated checkpoint's diagnostic"*.
There was no such hazard — `stamp-enabled` consumes `state` at `017/grade.sh:16`,
26 lines before the new assignment, and `ck` prints immediately. See §4. The code
is right; only the reason given for it was. Flagging it because the same
reasoning, applied to a file where the order *was* the other way round, would
have produced a false sense of having checked something.

Nothing else. The F4 "no zone is fine" ruling is correct and correctly
implemented. The F8 deviation ruling is correct and I reproduced the measurement
that justifies it. F10, F11 and F14 were rightly left alone.

## 11. Prohibitions honoured

No VM operation of any kind. No `vmrun`. `scripts/provision.sh` not run. No
`ssh-keygen`; nothing written to `/home/daxtangco/.ssh/`. `.env.local` neither
created nor read. `shellcheck` not run and not reported (still not installed).
No `sudo`. No subagents dispatched — every measurement in this file was run in
this session. The repo was never mutated; all measurement of alternative inputs
was done with synthetic stdin and `/tmp` throwaway scripts, so no `/tmp` copy of
the tree was needed.
