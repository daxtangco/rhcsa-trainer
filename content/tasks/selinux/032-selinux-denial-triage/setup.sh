#!/usr/bin/env bash
# Prepare the system for selinux/032-selinux-denial-triage.
#
# The situation this stages is the one the prompt describes: "last night's
# hardening run" tightened two things at once, so the reporting endpoint fails
# and there is a real AVC denial in the audit log waiting to be read. Both
# halves are genuine policy state, not a simulation - the label on the deployed
# script is the default one for /srv (var_t, which httpd may not execute) and
# the httpd_enable_cgi boolean is off in the stored policy.
#
# Runs as student over ssh stdin with passwordless sudo and no TTY, so nothing
# here may prompt, read from the terminal, or rely on a login shell.
#
# Idempotent: everything a previous attempt could have left behind is removed
# or overwritten before the preconditions are checked, so a second run against
# the same machine stages the same starting state as the first.
set -uo pipefail

# No `set -e`. The cleanup block below is full of commands that legitimately
# fail on a first run - deleting an fcontext rule that was never added, removing
# a package that is not installed - and under `set -e` the first of those would
# abort setup before it staged anything. So the commands that MUST succeed are
# wrapped in `need` instead: a silent failure there stages the wrong machine and
# every checkpoint result afterwards is a lie about the student's work.
#
# This is the same deliberate divergence from
# content/tasks/storage/014-grow-home-lv/setup.sh (`set -euo pipefail`) that
# content/tasks/selinux/019-httpd-alt-port/setup.sh documents. Do not
# "harmonise" them.
need() { "$@" || {
  printf 'setup.sh: FAILED: %s\n' "$*" >&2
  exit 1
}; }
fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

# Every one of these is also spelled in grade.sh. They are constants of the
# stock RHEL 9 targeted policy and of this task's fixtures; the two files are
# kept in step by hand because the grader may not source anything but assert.sh.
WANT_TYPE=httpd_sys_script_exec_t
BOOL=httpd_enable_cgi
DIR=/srv/reports
SCRIPT=$DIR/status.sh
URL=http://localhost/reports/status.sh
MARKER=RHCSA-REPORT-OK-4471
REF_CGI_DIR=/var/www/cgi-bin
CONFIG=/etc/selinux/config
CONF=/etc/httpd/conf.d/rhcsa-reports.conf

# Same helper, same reason, as the one in grade.sh: compare the *type* field of
# a context, never a substring of the whole context string.
type_field() {
  awk -F: 'NF >= 3 { print $3 }' | tr -d '[:space:]'
}

# The stored (boot-time) value of a boolean. `semanage boolean -l` prints
# (State, Default); Default is the stored one, so this is the same witness
# grade.sh's boolean-persistent uses, asked here to prove the checkpoint starts
# out failing.
bool_stored() {
  sudo semanage boolean -l 2>/dev/null | tr -d '(),' | awk -v b="$1" '$1 == b { print $3; exit }'
}

# --- SELinux state: the shared repair policy ------------------------------
# Carried verbatim by containers/030-container-web-service,
# containers/031-build-and-inspect-image and selinux/032-selinux-denial-triage -
# the three tasks whose graders emit an "SELinux is enforcing" invariant. Change
# it in one place and change it in all three, or the tasks disagree about whose
# job it is to repair a machine-wide global and one task's fixture quietly
# rewrites another task's baseline.
#
# THE RULE: no setup.sh repairs SELinux state. Not the runtime mode, not
# /etc/selinux/config. A setup.sh stages its own task and asserts what it staged;
# both of those are machine-wide state that outlives every task in the bank.
#
# Rejected - "every setup.sh repairs both halves before its preconditions run":
# it cannot tell a sibling fixture's leftover from a guest that was genuinely
# built permissive at boot, so it launders the second case into a green stage and
# the operator never learns the image is wrong. In this task it would also erase
# the exact state the invariant exists to detect.
#
# Rejected harder - `setenforce 1` alone, leaving SELINUX=permissive in the
# config: it repairs the half the next boot would have repaired anyway and leaves
# the half that persists. The task stages green, grades green, and the guest is
# permissive again at the next boot, failing this invariant and its siblings' in a
# later run that points back at nothing.
#
# So: CHECK BOTH HALVES, REPAIR NEITHER. Both, because `setenforce 1` does not
# touch the config and editing the config does not change the running mode, so
# either can be wrong while the other is right.
#
# And diagnose it identically in all three. The lab never turns SELinux off, so
# report what was found, name the likely cause - a fixture or a practice session
# run without the snapshot revert that normally precedes setup, or a `clean`
# snapshot captured while the guest was already permissive - and prescribe the
# revert. Only a freshly reverted guest that is still not enforcing means the
# image is wrong; no task may blame the image on its own evidence.
#
# The other half of the policy lives in antisolutions/: a fixture may break the
# runtime mode, which the next boot undoes, and may never write a persistent
# global it is not graded on repairing. That is why this task's
# mode-enforcing-config is a declared unprobed invariant rather than one a `sed`
# in a fixture probes.
#
# These two checks run FIRST here, before the teardown and before anything is
# staged, and the ordering is load-bearing rather than tidy. In permissive mode
# the denial this endpoint depends on is logged and allowed, so the fault staged
# below does not actually break anything: the report-served baseline probe at the
# bottom of this file would be reached first and would fail with "$URL already
# returns the report", blaming the fixture for a fault that is really the guest's
# SELinux mode. First check wins, and this is the one that names the real cause.
# It is also the cheapest possible failure - it lands before a dnf remove and
# reinstall of httpd.
#
# getenforce is checked separately from the mode it reports, because an empty
# result has two very different causes: a permissive guest is a leftover to
# revert, a missing binary is a broken image. Folding them together would print
# the revert advice at someone whose guest has no libselinux-utils.
command -v getenforce >/dev/null ||
  fail "getenforce is missing (libselinux-utils); the mode-enforcing-now invariant cannot be evaluated, see docs/vm-build-checklist.md"
enforce=$(getenforce 2>/dev/null)
[[ $enforce == Enforcing ]] ||
  fail "getenforce reports '${enforce:-nothing}' and this task needs enforcing mode. Nothing in the lab ever turns SELinux off, so this is a leftover: most likely a fixture or a practice session run without the snapshot revert that normally precedes setup, or a 'clean' snapshot captured while the guest was already permissive. Revert to the clean snapshot and start again - not repaired here on purpose, see the SELinux state policy above. If a freshly reverted guest still does not report Enforcing, the image is wrong; rebuild it to docs/vm-build-checklist.md"

# The config half, with the same parse the grader uses for mode-enforcing-config:
# the last assignment wins, a comment cannot match because the pattern is
# anchored and '#' is not whitespace, and SELINUXTYPE= cannot match because the
# character after SELINUX must be whitespace or '='.
# Deliberately the same reader as grade.sh's, which is the whole point of the
# mitigation argued there: a guest whose config this pair would misread has to fail
# here, loudly, rather than grade green later. Its three corrected defects - first
# line wins, column 0 only, prefix match not equality - are documented at the
# grade.sh copy.
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
[[ $cfg_mode == enforcing ]] ||
  fail "SELINUX is '${cfg_mode:-nothing}' in $CONFIG, so the next boot leaves this guest permissive even if getenforce says Enforcing right now - and this task grades after a reboot. Same cause and same remedy as above: revert to the clean snapshot rather than hand-editing the file, because an edit here repairs the symptom and hides how the guest got into this state. If a freshly reverted guest still says '${cfg_mode:-nothing}', the image is wrong; rebuild it to docs/vm-build-checklist.md"

# --- undo any previous attempt -------------------------------------------
# Local fcontext rules first. All four forms a solution or an anti-solution in
# this task can create are removed by name, because `semanage fcontext -d` needs
# the same path spec that created the rule:
#   - the recursive type rule       '/srv/reports(/.*)?'
#   - a bare directory type rule    '/srv/reports'
#   - the exact-file type rule      '/srv/reports/status.sh'
#   - the equivalence rule          -e /var/www/cgi-bin /srv/reports
# Leaving any of them in place would make context-policy pass at baseline, which
# is a student-facing false pass rather than a solved task.
sudo semanage fcontext -d "$DIR(/.*)?" &>/dev/null
sudo semanage fcontext -d "$DIR" &>/dev/null
sudo semanage fcontext -d "$SCRIPT" &>/dev/null
sudo semanage fcontext -d -e "$REF_CGI_DIR" "$DIR" &>/dev/null

# A permissive domain is the other way to make this endpoint work without
# fixing anything: `semanage permissive -a httpd_t` leaves getenforce saying
# Enforcing while httpd itself is unconfined. If a previous attempt left that
# behind, report-served would pass at baseline with the script still mislabelled
# and the boolean still off - so it is removed here, and the baseline probe far
# below re-checks the symptom empirically rather than trusting this line.
sudo semanage permissive -d httpd_t &>/dev/null

# Apache is reinstalled from scratch rather than reconfigured in place. The
# prompt tells the student to leave Apache's configuration alone, but a previous
# attempt may not have: a mangled httpd.conf would make report-served fail for
# a correct solution, which is the one failure direction this project treats as
# unacceptable in the other direction too. `rm -rf /etc/httpd` after the remove
# is what actually guarantees a stock config, because dnf leaves modified
# config files behind. Same approach, and same cost, as 019's setup.
#
# `< /dev/null` on both dnf calls, and it is not decoration. This script is
# delivered to the guest on ssh stdin (`bash -s`, src/engine/vm/ssh.ts:167-168),
# so the unread remainder of this file *is* stdin - and rpm scriptlets are
# /bin/sh forks that inherit it. One scriptlet that reads a line silently eats
# the next line of setup, which then never runs and never errors: the staging
# below would half-happen and the preconditions that are supposed to catch that
# would be gone too. Same guard, same reason, as
# content/tasks/sys/035-persistent-journal-and-schedule/grade.sh:206.
sudo systemctl disable --now httpd &>/dev/null
sudo dnf -y remove httpd &>/dev/null </dev/null
sudo rm -rf /etc/httpd
need sudo dnf -y install httpd </dev/null

# --- stage the situation the prompt describes ----------------------------
# The endpoint's own configuration, "deployed by configuration management".
# Written by setup rather than by the student on purpose: this task is about
# reading a denial and repairing policy, and 019-httpd-alt-port already owns
# "configure Apache". A student who never opens an Apache config file can still
# solve this ticket completely.
sudo tee "$CONF" >/dev/null <<'EOF'
# Internal reporting endpoint. Deployed by configuration management.
ScriptAlias "/reports/" "/srv/reports/"
<Directory "/srv/reports">
    AllowOverride None
    Options +ExecCGI
    Require all granted
</Directory>
EOF
[[ -s $CONF ]] || fail "could not write $CONF, so nothing would serve $URL"

need sudo mkdir -p "$DIR"

# The reporting script. Quoted heredoc: $$ and the printf formats must reach the
# file literally.
#
# The PID line is what makes report-served unfakeable. MARKER is text inside
# this file, so serving the file as static content returns it; only actually
# executing the script turns `generated-by-pid=%s` into a number. The context
# line is there for the student, not the grader - seeing httpd_sys_script_t in
# the output is the moment the CGI transition stops being abstract.
sudo tee "$SCRIPT" >/dev/null <<'EOF'
#!/bin/bash
# Internal reporting endpoint. Deployed by configuration management.
printf 'Content-Type: text/plain\r\n\r\n'
printf 'RHCSA-REPORT-OK-4471\n'
printf 'generated-by-pid=%s\n' "$$"
printf 'running-as=%s\n' "$(id -Z 2>/dev/null || echo unknown)"
EOF
[[ -s $SCRIPT ]] || fail "could not write $SCRIPT, the file the whole task is about"

need sudo chmod 0755 "$DIR"
need sudo chmod 0755 "$SCRIPT"

need sudo systemctl enable httpd
# restart, not start: httpd may already be running from an earlier phase, and
# only a restart picks up the drop-in written above.
need sudo systemctl restart httpd

# --- prove the endpoint works BEFORE breaking it --------------------------
# This block is the precondition that has nothing to do with SELinux and
# everything to do with honesty: it establishes that a correct answer can pass.
#
# Every other precondition in this file checks that a checkpoint starts out
# FAILING. None of them can see the opposite hazard - a ScriptAlias that does not
# resolve, an httpd that lost mod_cgid, a heredoc that wrote a script with a
# typo in it. In every one of those cases the baseline probes further down still
# say "broken, as staged", the task looks correctly set up, and report-served is
# unreachable for a student who does everything right. That is a false FAIL, and
# it is invisible without asking the question in this order: make it work, prove
# it works, then break exactly the two things the ticket is about.
#
# chcon, deliberately, for the temporary label. chcon writes the inode and adds
# nothing to the policy database - which is the very property that makes it the
# wrong answer for a student and the right tool here, because `restorecon` below
# reverts it completely and leaves context-policy failing at baseline. A
# `semanage fcontext` rule would have to be deleted again, and a deletion that
# silently failed would hand the student a solved task.
need sudo chcon -R -t "$WANT_TYPE" "$DIR"
# Runtime only, no -P: the stored value is still off, so the break below needs
# one policy rebuild rather than two.
need sudo setsebool "$BOOL" on

# Bounded retry, because `systemctl restart` returns when httpd is ready to
# accept connections and this is still a race worth two seconds of patience.
probe=
for attempt in 1 2 3; do
  probe=$(curl -s --max-time 15 "$URL" 2>/dev/null)
  if printf '%s' "$probe" | grep -qF "$MARKER"; then break; fi
  [[ $attempt -lt 3 ]] && sleep 2
done
printf '%s' "$probe" | grep -qF "$MARKER" ||
  fail "with the label and the boolean both correct, $URL still does not return the report (got: ${probe:0:120}); the ScriptAlias, the CGI module or $SCRIPT is broken, so no correct answer could pass report-served"
printf '%s' "$probe" | grep -Eq 'generated-by-pid=[0-9]+' ||
  fail "$URL returns the marker but not a real PID, so the script is being served as text rather than executed; report-served would be unreachable for a correct answer"

# --- now stage the break -------------------------------------------------
# Half one: restorecon puts the *default* label back on the tree, which for
# anything under /srv is var_t - a type httpd may not execute. This is not a
# sabotaged label. It is exactly what you get when a program is deployed to a
# path nobody taught the policy about, which is the commonest way this fault
# happens for real, and it is also what undoes the chcon above.
need sudo restorecon -R "$DIR"

# Half two: the boolean, and -P is required rather than stylistic. Without it
# the stored value would stay on, boolean-persistent would pass at baseline, and
# the reboot would hand the student a fix they never made.
need sudo setsebool -P "$BOOL" off

# --- preconditions --------------------------------------------------------
# Every checkpoint in grade.sh gets a check here, including the two invariants,
# and including the ones this script does not itself need. A precondition that
# only guards the script leaves the checkpoints free to pass or fail at baseline
# for reasons that have nothing to do with the student.

# Tooling the grader depends on. Without any of these the corresponding
# checkpoint measures nothing and, worse, the cleanup above may have silently
# done nothing.
command -v matchpathcon >/dev/null ||
  fail "matchpathcon is missing (libselinux-utils); context-policy and the grader's fail-closed guard cannot be evaluated"
command -v semanage >/dev/null ||
  fail "semanage is missing (policycoreutils-python-utils); the fcontext cleanup above did nothing and boolean-persistent cannot be evaluated"
command -v getsebool >/dev/null ||
  fail "getsebool is missing (libselinux-utils); boolean-now cannot be evaluated"
command -v restorecon >/dev/null ||
  fail "restorecon is missing (policycoreutils); the label could not be reset and no solution could apply one"
command -v curl >/dev/null || fail "curl is missing; report-served cannot be evaluated"

# The grader's fail-closed guard asks the policy what type it gives the stock
# CGI directory and refuses to grade unless the answer is WANT_TYPE. If that is
# not true here, every checkpoint would fail for a reason the student cannot
# see or fix, so it is a precondition of the task rather than of any one check.
ref_type=$(matchpathcon -n "$REF_CGI_DIR" 2>/dev/null | type_field)
[[ $ref_type == "$WANT_TYPE" ]] ||
  fail "the policy maps $REF_CGI_DIR to '${ref_type:-nothing}', not $WANT_TYPE; this guest is not running the stock targeted policy and the grader will refuse to grade it"

# The denial has to be readable, or the task teaches guessing. No checkpoint
# reads the audit log, so this is not guarding a checkpoint - it is guarding the
# objective (selinux.troubleshoot.violations): a student who cannot run
# `ausearch -m AVC -ts recent` has no way to diagnose this ticket as designed
# and would be reduced to trying commands. A warning would not do, because
# setup runs over ssh stdin with no TTY and nobody sees stderr.
command -v ausearch >/dev/null ||
  fail "ausearch is missing (audit); the AVC denial this task is built around could not be read, see docs/vm-build-checklist.md"
sudo systemctl is-active auditd &>/dev/null ||
  fail "auditd is not running, so the denial the student must read is never written to /var/log/audit/audit.log; see docs/vm-build-checklist.md"

# Every solution needs httpd from the DVD repos, and the install above already
# proved that - but an empty /etc/yum.repos.d is worth naming, because the same
# emptiness would break a student who chooses to install anything else while
# troubleshooting.
repos=(/etc/yum.repos.d/*.repo)
[[ -e ${repos[0]} ]] ||
  fail "no dnf repository is configured; see docs/vm-build-checklist.md"

# mode-enforcing-now and mode-enforcing-config are invariants, and both are
# checked at the TOP of this file rather than here - before the teardown and
# before anything is staged. See the SELinux state policy there for why they are
# checked and never repaired, and for why they have to be checked before the
# report-served baseline probe just below, which misdiagnoses the same fault.
# Nothing between here and there can change either half, so there is no gap.

# report-served depends on httpd actually running, and on the file holding both
# patterns the grader looks for. If the marker or the PID line went missing from
# the heredoc above, report-served could never pass for anyone.
sudo systemctl is-active httpd &>/dev/null ||
  fail "httpd is not active after 'systemctl restart httpd', so report-served could never pass"
sudo grep -qF "$MARKER" "$SCRIPT" ||
  fail "$SCRIPT does not contain the marker the grader looks for"
sudo grep -q 'generated-by-pid' "$SCRIPT" ||
  fail "$SCRIPT does not print the PID line report-served uses to prove the script was executed rather than served"
[[ -x $SCRIPT ]] ||
  fail "$SCRIPT is not executable, so no amount of correct labelling would let Apache run it"

# context-now: the label on the inode must be wrong at the start. This is the
# check that catches a guest where an inherited or leftover rule already labels
# the tree - the student would do nothing and pass.
now_type=$(stat -c %C "$SCRIPT" 2>/dev/null | type_field)
[[ $now_type != "$WANT_TYPE" ]] ||
  fail "$SCRIPT is already labelled $WANT_TYPE; context-now would pass at baseline"

# context-policy: and the policy must not already want that label either. A
# local fcontext rule from a previous attempt that used a path spec none of the
# four deletions above matches would land here.
want_type=$(matchpathcon -n "$SCRIPT" 2>/dev/null | type_field)
[[ $want_type != "$WANT_TYPE" ]] ||
  fail "the policy already labels $SCRIPT $WANT_TYPE; context-policy would pass at baseline. Look for a leftover local rule with 'semanage fcontext -l -C' and delete it"

# boolean-now and boolean-persistent: exactly the grader's two probes, so a pass
# at baseline is impossible by construction rather than by hope.
bool_now=$(getsebool "$BOOL" 2>/dev/null | awk '{ print $NF }')
[[ $bool_now == off ]] ||
  fail "$BOOL is '${bool_now:-nothing}' after 'setsebool -P $BOOL off'; boolean-now would pass at baseline"
bool_def=$(bool_stored "$BOOL")
[[ -n $bool_def ]] ||
  fail "could not read the stored value of $BOOL from 'semanage boolean -l'; boolean-persistent cannot be proven to start out failing"
[[ $bool_def == off ]] ||
  fail "the stored value of $BOOL is '$bool_def'; boolean-persistent would pass at baseline and a reboot would fix the task for the student"

# report-served, empirically. The two probes above establish *why* the endpoint
# is broken; this one establishes that it IS broken, which is the only way to
# rule out every other route to a baseline pass at once - a permissive domain, a
# custom policy module, an httpd_t that is unconfined for some reason nobody
# predicted.
#
# %{http_code} is 000 when curl never got an HTTP response at all. That case is
# a broken guest, not a staged fault: if nothing answers on port 80 then a
# correct solution cannot pass either, and the student would be debugging the
# lab instead of the ticket.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL" 2>/dev/null)
[[ -n $code && $code != 000 ]] ||
  fail "nothing answered an HTTP request to $URL (curl code '${code:-none}'); httpd is running but not serving, so report-served could never pass"
body=$(curl -s --max-time 15 "$URL" 2>/dev/null)
if printf '%s' "$body" | grep -qF "$MARKER" &&
  printf '%s' "$body" | grep -Eq 'generated-by-pid=[0-9]+'; then
  fail "$URL already returns the report (http $code); report-served would pass at baseline"
fi

# The request above is also the point of it: a denied exec has now been logged,
# so the student's first `ausearch -m AVC -ts recent` shows a real denial for a
# real request rather than an empty log that makes them doubt the tooling. One
# more request for good measure, since a proxy of a fault the student cannot see
# is worth nothing.
curl -s -o /dev/null --max-time 15 "$URL" &>/dev/null || true

# The grader never reads history, but a student who reverts and finds their own
# previous commands has been handed a hint nobody offered them.
cat /dev/null >~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
