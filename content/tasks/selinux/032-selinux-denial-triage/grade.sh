#!/usr/bin/env bash
# Grader for selinux/032-selinux-denial-triage.
#
# READ-ONLY. Nothing here changes the guest: every command is a query
# (curl, stat, matchpathcon, getsebool, getenforce, semanage -l, awk over a
# config file). The exit code is ignored; only the JSONL emitted by
# ck_pass/ck_fail is read. assert.sh is prepended by loadTaskScripts, so its
# helpers are already in scope and must not be sourced again.
#
# Seven checkpoints, because this ticket can look fixed while being wrong in
# five different ways, and each way needs its own verdict:
#   - the label on the inode is right but the policy never learned it   (chcon)
#   - the policy learned it but the inode was never relabelled     (no restorecon)
#   - the boolean is on, but only until the next boot                    (no -P)
#   - the endpoint answers with the file's *source* rather than its output
#   - it all "works" because SELinux was switched off
#
# What is deliberately NOT here:
#   - nothing greps /etc/httpd. Where the ScriptAlias lives is not the
#     objective, and 019-httpd-alt-port already documents why config text is
#     not an end state.
#   - nothing reads the audit log. The denial is how the student diagnoses the
#     fault, not evidence of a fix: requiring an AVC to be present would fail
#     anyone who read the log once, fixed both halves and never re-requested
#     the page, and requiring it to be *absent* would fail anyone whose earlier
#     probing left a denial behind. Either direction grades history instead of
#     state.
# baseline-fail: report-served, context-now, context-policy, boolean-now, boolean-persistent
set -uo pipefail

# The type the shipped policy uses for CGI programs, and the boolean that lets
# httpd execute one. Both are constants of the RHEL 9 targeted policy, and the
# guard below refuses to grade if this guest disagrees with either.
WANT_TYPE=httpd_sys_script_exec_t
BOOL=httpd_enable_cgi
SCRIPT=/srv/reports/status.sh
URL=http://localhost/reports/status.sh
# The script prints this line and its own PID. Both halves are needed - see
# report-served for why the PID is the load-bearing one.
MARKER=RHCSA-REPORT-OK-4471
# The stock CGI directory, used only as a question to the policy: "what type do
# you give CGI programs on this machine?"
REF_CGI_DIR=/var/www/cgi-bin
CONFIG=/etc/selinux/config

# The type field of an SELinux context, i.e. the third of
# user:role:type:level. Used for both "what is on the inode" and "what would
# the policy put there", so the two are always compared field-for-field rather
# than by substring. A substring match would accept
# httpd_unconfined_script_exec_t for httpd_sys_content_t-shaped questions and,
# worse, would make any future type whose name merely contains the target read
# as a pass.
type_field() {
  awk -F: 'NF >= 3 { print $3 }' | tr -d '[:space:]'
}

# --- 0. fail closed -------------------------------------------------------
# Ask the policy what type it assigns to the stock CGI directory. If that is
# not WANT_TYPE, then either matchpathcon is missing (empty output), or
# libselinux is broken, or this guest's policy is not the stock targeted policy
# the whole task is written against - and in every one of those cases the two
# context checkpoints below would be comparing student labels against a
# constant this grader cannot vouch for.
#
# This is the fail-closed guard 014-grow-home-lv documents, in the shape this
# task needs. The individual checks below are already fail-closed one by one
# (an empty `stat` or `getsebool` result compares unequal to a non-empty
# expected value, so it fails), but "the grader could not establish its own
# target" must never be reported as five cryptic single failures the student
# reads as their own mistake. One explanatory failure on every checkpoint, and
# exit 0, is the honest answer.
ref_type=$(matchpathcon -n "$REF_CGI_DIR" 2>/dev/null | type_field)
if [[ $ref_type != "$WANT_TYPE" ]]; then
  detail="grader could not confirm its own target type: the policy maps $REF_CGI_DIR to '${ref_type:-nothing}' instead of $WANT_TYPE, so matchpathcon is missing or this guest is not running the stock targeted policy"
  ck_fail report-served "http://localhost/reports/status.sh returns the report, produced by running the script" "$detail"
  ck_fail context-now "/srv/reports/status.sh is labelled $WANT_TYPE right now" "$detail"
  ck_fail context-policy "the policy would relabel /srv/reports/status.sh to $WANT_TYPE" "$detail"
  ck_fail boolean-now "the $BOOL boolean is on" "$detail"
  ck_fail boolean-persistent "the $BOOL boolean is on in the stored policy, so a reboot keeps it" "$detail"
  ck_fail mode-enforcing-now "SELinux is still in enforcing mode" "$detail"
  ck_fail mode-enforcing-config "$CONFIG still selects enforcing mode at boot" "$detail"
  exit 0
fi

# --- 1. the endpoint works, and works by *running* the script -------------
# The grader runs inside the guest and curls loopback, which firewalld does not
# filter, so this measures Apache plus SELinux and deliberately says nothing
# about the firewall. There is no firewall checkpoint in this task: the ticket
# does not ask for one, and 019-httpd-alt-port owns that ground.
#
# Two patterns, not one, and the second is why this checkpoint cannot be
# faked. MARKER is a literal string *inside the script file*, so a student who
# gives up on CGI and serves the script as static text - or who copies its text
# into an index page - returns a body containing MARKER. The PID line only ever
# contains digits when the shell actually expanded $$, so `generated-by-pid=`
# followed by a number is proof that a process ran, which is precisely the
# permission SELinux was denying. Served as source, that line reads
# `generated-by-pid=%s` and fails.
#
# Three attempts, two seconds apart, and the loop is about verdict B rather
# than about flaky networking. This grader runs once before the reboot and once
# after it, and after a reboot httpd is starting in parallel with sshd: a single
# request that arrives during that window gets connection-refused and would
# report a correct, persistent fix as broken. The retry is bounded and stops at
# the first success, so it cannot turn a genuinely broken endpoint green - a host
# where httpd never comes back still fails, six seconds later.
body=
for attempt in 1 2 3; do
  body=$(curl -s --max-time 15 "$URL" 2>/dev/null)
  if printf '%s' "$body" | grep -qF "$MARKER"; then break; fi
  [[ $attempt -lt 3 ]] && sleep 2
done
if printf '%s' "$body" | grep -qF "$MARKER" &&
  printf '%s' "$body" | grep -Eq 'generated-by-pid=[0-9]+'; then
  ck_pass report-served "http://localhost/reports/status.sh returns the report, produced by running the script"
else
  ck_fail report-served "http://localhost/reports/status.sh returns the report, produced by running the script" \
    "got=${body:0:120} - if this is empty, check that httpd is running; if it is the text of the script, the script was served instead of executed"
fi

# --- 2. the label on the inode -------------------------------------------
# `stat -c %C` reads the label stored on the file right now. This is the half a
# bare `semanage fcontext -a` does not change: adding a rule tells the policy
# what the label *should* be and relabels nothing that already exists.
now_type=$(stat -c %C "$SCRIPT" 2>/dev/null | type_field)
if [[ $now_type == "$WANT_TYPE" ]]; then
  ck_pass context-now "/srv/reports/status.sh is labelled $WANT_TYPE right now"
else
  ck_fail context-now "/srv/reports/status.sh is labelled $WANT_TYPE right now" \
    "the label on the inode is '${now_type:-nothing}'; a new fcontext rule does not relabel files that already exist"
fi

# --- 3. the label the policy would assign --------------------------------
# The read-only test for "does this survive a filesystem relabel". A relabel -
# `restorecon -R /`, `fixfiles relabel`, /.autorelabel after a policy update -
# writes onto every inode whatever the policy database says, so the question
# "would a relabel undo this fix?" is answerable without relabelling anything:
# ask the policy what it would put there and compare it to WANT_TYPE.
#
# matchpathcon is the right question rather than `semanage fcontext -l | grep`
# for two reasons. It resolves the *whole* rule set in the same precedence order
# restorecon uses, so it is right about which of several matching rules wins;
# and it answers identically for a type rule (`-a -t httpd_sys_script_exec_t
# '/srv/reports(/.*)?'`), an exact-path rule (`-a -t ... /srv/reports/status.sh`)
# and an equivalence rule (`-a -e /var/www/cgi-bin /srv/reports`), none of which
# a grep for the type name would find in all three cases. Mechanism-agnostic by
# construction.
#
# This checkpoint is what fails a `chcon` answer, and it fails it in *both*
# verdicts: chcon survives a reboot perfectly well. Reboot durability and
# relabel durability are two different axes and this task grades both.
want_now=$(matchpathcon -n "$SCRIPT" 2>/dev/null | type_field)
if [[ $want_now == "$WANT_TYPE" ]]; then
  ck_pass context-policy "the policy would relabel /srv/reports/status.sh to $WANT_TYPE"
else
  ck_fail context-policy "the policy would relabel /srv/reports/status.sh to $WANT_TYPE" \
    "matchpathcon says the policy would assign '${want_now:-nothing}'; chcon writes the inode without telling the policy, so the next relabel reverts it"
fi

# --- 4. the boolean, right now -------------------------------------------
# getsebool reads the running policy. `--> on` is the whole output format, so
# the last field is the value.
bool_now=$(getsebool "$BOOL" 2>/dev/null | awk '{ print $NF }')
if [[ $bool_now == on ]]; then
  ck_pass boolean-now "the $BOOL boolean is on"
else
  ck_fail boolean-now "the $BOOL boolean is on" \
    "getsebool reports '${bool_now:-nothing}'; with it off, httpd may not execute a CGI program no matter how the program is labelled"
fi

# --- 5. the boolean, after the next boot ---------------------------------
# The persistence half, and mechanism-agnostic on purpose: `setsebool -P` and
# `semanage boolean -m --on` are both correct answers and both land in the same
# place, so the *stored* value is what gets measured rather than the command
# that wrote it.
#
# Primary witness: the Default column of `semanage boolean -l`. Its two values
# are (State, Default) - the running value and the stored value - which is
# exactly the distinction a missing -P creates, and the reason this checkpoint
# can catch a non-persistent change before any reboot happens.
persist=$(sudo semanage boolean -l 2>/dev/null | tr -d '(),' | awk -v b="$BOOL" '$1 == b { print $3; exit }')

# Second witness: booleans.local in the policy store, which is the file the
# boot-time policy load actually reads. It is accepted as an equivalent answer,
# not required, for one reason: if the column order or spacing of
# `semanage boolean -l` ever shifts, the primary witness silently goes empty
# and would fail every correct solution. A second, independent source of the
# same fact turns that into a survivable formatting change. The store path
# moved between RHEL releases (/etc/selinux/<type>/... on 7,
# /var/lib/selinux/<type>/... on 8+), and SELINUXTYPE is read from the config
# rather than hardcoded as "targeted", so a candidate that does not exist is
# simply not a witness.
polType=$(awk -F= '/^[[:space:]]*SELINUXTYPE[[:space:]]*=/ { v = $2 } END { print v }' "$CONFIG" 2>/dev/null | tr -d '[:space:]')
stored=no
if [[ -n $polType ]]; then
  for f in "/var/lib/selinux/$polType/active/booleans.local" \
    "/etc/selinux/$polType/active/booleans.local" \
    "/etc/selinux/$polType/modules/active/booleans.local"; do
    if sudo test -r "$f" && sudo grep -Eq "^[[:space:]]*$BOOL[[:space:]]*=[[:space:]]*1[[:space:]]*$" "$f"; then
      stored=yes
      break
    fi
  done
fi

if [[ $persist == on || $stored == yes ]]; then
  ck_pass boolean-persistent "the $BOOL boolean is on in the stored policy, so a reboot keeps it"
else
  ck_fail boolean-persistent "the $BOOL boolean is on in the stored policy, so a reboot keeps it" \
    "the stored value is '${persist:-unknown}' (booleans.local witness: $stored); setsebool without -P changes the running policy only, and the next boot reloads the stored one"
fi

# --- 6. SELinux is still enforcing, now ----------------------------------
# An invariant: it passes before the student does anything, and it exists
# because `setenforce 0` makes this endpoint work while teaching nothing. It is
# probed by antisolutions/03-permissive-and-forgot.sh, which is a fixture the
# harness can safely run: `setenforce 0` is runtime-only, so the reboot between
# the two verdicts undoes it with no relabel and nothing left behind for whatever
# runs next. That is why the fixture declares it `@pre` - permissive in verdict A,
# enforcing again in verdict B - and why this checkpoint is probed while
# mode-enforcing-config below is not.
mode=$(getenforce 2>/dev/null)
if [[ $mode == Enforcing ]]; then
  ck_pass mode-enforcing-now "SELinux is still in enforcing mode"
else
  ck_fail mode-enforcing-now "SELinux is still in enforcing mode" \
    "getenforce reports '${mode:-nothing}'; switching SELinux off is not a fix for an SELinux denial"
fi

# --- 7. SELinux is still enforcing at the next boot ----------------------
# The other half of the same invariant, and not redundant with it: `setenforce
# 1` restores enforcing without touching the config, and editing the config
# does not change the running mode. So each of the two can be true while the
# other is false, and only both together mean "this host is enforcing and will
# still be enforcing tomorrow".
#
# The last assignment in the file wins, matching how libselinux parses it, so a
# student who appended a second SELINUX= line cannot be graded on the first.
# Comment lines cannot match: the pattern is anchored at the start of the line
# and a '#' is not whitespace. SELINUXTYPE= cannot match either, because the
# character after SELINUX must be whitespace or '='.
#
# Mechanism-agnosticism does not apply here the way it does to
# boolean-persistent: this is an invariant that is already true, so passing it
# needs no action and no choice of mechanism. Nobody has to express "enforcing
# at boot" some other way, so accepting only the canonical file is not a
# constraint on a correct answer.
#
# Knowingly unprobed, and by policy rather than by oversight. The only way to
# fail this checkpoint is to write SELINUX=permissive into the config, and the
# SELinux state policy carried at the top of setup.sh forbids an anti-solution
# from writing a persistent global it is not graded on repairing: a fixture that
# seds this file leaves it damaged for whatever runs next without a snapshot
# revert, which is how containers/030's and containers/031's enforcing invariant
# ends up failing for a fault no student caused. antisolutions/03 used to do
# exactly that and is now runtime-only, so mode-enforcing-now is probed and this
# one is not.
#
# What is being accepted is the same risk 014-grow-home-lv accepts for
# var-intact: replacing the parse below with an unconditional ck_pass would
# validate green across every fixture. The mitigation is that the parse is not
# unique to this file - setup.sh runs the identical awk as a precondition before
# it stages anything, so a guest whose config this grader would misread fails
# setup loudly instead of grading green here.
#
# The parse itself was wrong in three ways until selinux/050 was written and had to
# get it right, since there the same reading decides a graded checkpoint rather than
# an invariant. It is corrected in both places rather than only where it mattered,
# because a wrong parser left in the tree is a parser the next task copies:
#
#   - It took the LAST `SELINUX=` line. libselinux stops at the FIRST one, so an
#     `enforcing` appended below a `permissive` read as enforcing here and booted
#     permissive.
#   - It allowed leading whitespace before `SELINUX`. libselinux requires column 0
#     and recognises no setting at all otherwise - and an unrecognised file fails
#     open to permissive, so an indented line read as enforcing here too.
#   - It compared the value for equality, so `SELINUX=Enforcing`, which boots
#     enforcing perfectly well, read as a failure.
#
# `substr($0, 9)` is the eight bytes of `SELINUX=` skipped; the prefix tests rather
# than equality are what accept a trailing comment on the line.
# unprobed-invariant: mode-enforcing-config
cfg_mode=$(awk '
  /^SELINUX=/ && found == "" {
    v = substr($0, 9)
    sub(/^[[:space:]]+/, "", v)
    v = tolower(v)
    if (index(v, "enforcing") == 1) found = "enforcing"
    else if (index(v, "permissive") == 1) found = "permissive"
    else if (index(v, "disabled") == 1) found = "disabled"
  }
  END { print found }' "$CONFIG" 2>/dev/null)
if [[ $cfg_mode == enforcing ]]; then
  ck_pass mode-enforcing-config "$CONFIG still selects enforcing mode at boot"
else
  ck_fail mode-enforcing-config "$CONFIG still selects enforcing mode at boot" \
    "SELINUX is set to '${cfg_mode:-nothing}' in $CONFIG; the running mode says nothing about what the next boot will do"
fi

exit 0
