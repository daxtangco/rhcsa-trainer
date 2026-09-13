#!/usr/bin/env bash
# Prepare the system for tools/051-finding-it-in-the-docs.
#
# This task grades an artefact - a text file of six answers - and every one of
# those answers is a string that the documentation shipped on this guest actually
# contains. So this script has two jobs, and the second one is the unusual one:
#
#   1. Make the documentation present and searchable. A guest with no man-db has
#      no `man` and no `man -k`; a guest with man-db but no index answers every
#      `man -k` with "nothing appropriate", which is the classic broken-lab
#      symptom and must never be graded as a student error.
#   2. PROVE that the six expected answers are still what the shipped files say.
#      grade.sh compares against hardcoded strings (see its header for the exact
#      file and package version each one was read out of). If a RHEL 9 minor
#      release ever changes one of those pages, the honest failure is here, loud,
#      naming the stale expectation - not a correct student marked wrong.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# IDEMPOTENT, and it overwrites the answer file every time on purpose. Establishing
# the baseline is this script's whole job, and a half-answered file left from an
# earlier session would either break the baseline assertions at the bottom or, far
# worse, let a goal checkpoint pass with no work done. A human re-running setup by
# hand is asking for a fresh start; that is what they get.
#
# `set -uo pipefail` without -e, following net/045 and files/036: `rpm -q` and the
# grep probes below legitimately return non-zero, and -e would abort on the first
# question rather than report it. Everything that MUST work goes through `need`,
# because a silent failure here stages the wrong machine and every checkpoint
# afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }
warn() { printf 'setup.sh: warning: %s\n' "$*" >&2; }

ANSWERS=/home/student/doc-answers.txt

# The six keys, spelled identically in grade.sh, in the prompt and in every
# fixture. If these ever disagree the task becomes unsatisfiable for every answer.
KEYS=(path_walk_command passwd_fifth_field hwclock_long_option useradd_short_option getopt_doc_file df_info_node)

# The documentation each question is answered from. Same paths as grade.sh.
SRC_NAMEI=/usr/share/man/man1/namei.1.gz
SRC_PASSWD=/usr/share/man/man5/passwd.5.gz
SRC_HWCLOCK=/usr/share/man/man8/hwclock.8.gz
SRC_USERADD=/usr/share/man/man8/useradd.8.gz
SRC_GETOPT=/usr/share/man/man1/getopt.1.gz
SRC_DF=/usr/share/man/man1/df.1.gz
DOC_EXAMPLE=/usr/share/doc/util-linux/getopt-example.bash
INFO_DOC=/usr/share/info/coreutils.info.gz

# The keyword the man index is probed with, here and in grade.sh. Neutral on
# purpose: it is a word from no answer in this task, so a student reading a
# grader detail line learns nothing from it.
INDEX_PROBE=password

# --- tooling every step below depends on ----------------------------------
# Convention for every task in this bank: verify every precondition the goal
# checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass or
# fail for reasons that have nothing to do with the student.
for t in awk grep gzip rpm timeout; do
  command -v "$t" >/dev/null \
    || fail "$t is missing, and this script cannot prove the documentation says what grade.sh expects without it"
done

[[ -d /home/student ]] \
  || fail "/home/student does not exist, so the answer file this task grades has nowhere to live; see docs/vm-build-checklist.md section 2.6"

# --- packages -------------------------------------------------------------
# man-db brings /usr/bin/man, /usr/bin/apropos and /usr/bin/whatis (all three via
# `update-alternatives` in its %post - read out of man-db-2.9.3-9.el9.x86_64.rpm),
# and it Requires groff-base, gzip and less, so installing it is what makes a page
# formattable at all. man-pages brings the section 5 and 7 pages, including
# passwd(5), which one of the six questions is answered from.
#
# coreutils-common carries df(1) and /usr/share/info/coreutils.info.gz, and on a
# RHEL 9 Minimal Install it is NOT there: minimal ships coreutils-single, which
# provides /usr/bin/df on its own and requires nothing named coreutils - measured on
# a RHEL 9.8 minimal host, where `rpm -q coreutils coreutils-common` reported both
# absent and `rpm -qf /usr/bin/df` answered coreutils-single-8.32-40.el9. So this is
# the expected step on the target guest, not a repair for an odd image, and the last
# question in this task is unanswerable without it. It is safe to add alongside
# coreutils-single: coreutils-common declares no Conflicts and requires nothing from
# coreutils, so dnf does not try to swap the binaries out from under the guest.
#
# `< /dev/null` because dnf reads stdin and this script's stdin is the rest of the
# script - without it dnf eats the remainder of this file.
for pkg in man-db man-pages coreutils-common; do
  if ! rpm -q "$pkg" &>/dev/null; then
    sudo dnf -y install "$pkg" &>/dev/null < /dev/null
    rpm -q "$pkg" &>/dev/null \
      || fail "$pkg is not installed and 'dnf -y install $pkg' did not fix that; check that /etc/yum.repos.d/rhcsa-dvd.repo points at a mounted DVD (docs/vm-build-checklist.md section 3.3)"
  fi
done

# The info READER is a warning, not a failure, and that asymmetry is deliberate:
# no checkpoint in this task needs it. df_info_node is answered from df(1), which
# names the node in its SEE ALSO, and the node itself lives in
# /usr/share/info/coreutils.info.gz, which coreutils-common ships whether or not
# anything can read it. The reader is installed anyway so that a student who wants
# to follow the pointer can - the objective names info, and a pointer you cannot
# follow teaches half the lesson.
if ! command -v info >/dev/null; then
  sudo dnf -y install info &>/dev/null < /dev/null
  command -v info >/dev/null \
    || warn "the 'info' package could not be installed from the DVD repo, so 'info coreutils' will not run on this guest. No checkpoint depends on it: df_info_node is answered from df(1). The lab is runnable, but the student cannot follow the pointer they are being asked to record"
fi

# man-db ships its binaries as man.man-db, apropos.man-db and whatis.man-db and its
# %post creates the three plain names with one alternatives group: `man` is the
# master link, `apropos` and `whatis` are `--slave` links under it (read out of
# man-db-2.9.3-9.el9's postinstall scriptlet). One broken group therefore takes all
# three names out at once, which is why all three are checked here.
for c in man apropos whatis; do
  command -v "$c" >/dev/null \
    || fail "$c is missing even though man-db is installed. man-db's %post creates /usr/bin/man and, as slave links under it, /usr/bin/apropos and /usr/bin/whatis; run 'sudo alternatives --auto man' to rebuild the whole group, or revert to the \`clean\` snapshot"
done

# --- the man index --------------------------------------------------------
# `man -k` and `apropos` are the same binary and both read the index caches under
# /var/cache/man. apropos(1) says so outright: "The database searched by apropos
# is updated by the mandb program. Depending on your installation, this may be run
# by a periodic cron job, or may need to be run manually after new manual pages
# have been installed." man-db's %post also empties /var/cache/man, and its rpm
# file trigger starts man-db-cache-update.service in the BACKGROUND
# (`systemd-run systemctl start man-db-cache-update`), so right after an install
# the index may be absent, half-built, or complete - all three.
#
# So: probe first, build only if the probe fails, probe again. Probing first keeps
# the common case free, which matters because setup.sh shares one 120-second ssh
# budget with everything above it (src/engine/vm/ssh.ts).
#
# mandb's own exit status is not trusted here. If the background cache update is
# still running it holds the lock and mandb exits non-zero having done nothing
# wrong; the only thing worth asserting is whether a search works afterwards.
#
# TWO probes, not one, and the second one is the point. The neutral probe proves an
# index EXISTS; it does not prove the page question 1 is answered from is IN it.
# Because the cache update runs in the background after an install, a half-built
# index answers one search and not another, and a guest handed over in that state
# looks perfectly healthy while the first question is unanswerable - which is the
# exact failure this whole script exists to prevent, and it would read as a student
# error. So the second probe runs the search question 1 actually needs. Naming that
# search here leaks nothing: setup.sh's output is never shown to the student, only
# to whoever built the guest, and grade.sh keeps the neutral probe for the detail
# line the student can see.
index_works() {
  local out
  out=$(timeout 30 apropos "$INDEX_PROBE" 2>/dev/null)
  [[ -n $out ]] || return 1
  out=$(timeout 30 apropos 'terminal point' 2>/dev/null)
  [[ -n $out ]]
}

if ! index_works; then
  # 60s and not more: this script shares one 120-second ssh budget with the dnf
  # installs above it (src/engine/vm/ssh.ts), so a longer wait here would run the
  # whole exec out of time instead of failing this step. Measured, not guessed:
  # `mandb -q` over a 4519-page tree (man-db 2.9.3 running against the RHEL 9.8
  # man-pages, util-linux, shadow-utils, coreutils-common and groff trees) took
  # 5.0 s wall from an empty /var/cache/man, so a minute is roughly twelve times
  # the observed cost. If a rebuild ever does need longer, the probe below fails
  # and says so in a message rather than the ssh channel dying without one. A
  # partly built index still answers some searches, which is why the probe and not
  # this exit status decides.
  timeout 60 sudo mandb -q &>/dev/null < /dev/null || true
  index_works \
    || fail "the manual page index is not usable after 'mandb -q': either 'apropos $INDEX_PROBE' returns nothing at all, or it returns hits but the page the first question is answered from is not indexed yet. Either way 'man -k' cannot answer question 1 on this guest. Check that /var/cache/man is populated ('sudo mandb' with no -q reports what it read), that man-pages is installed, and that no man-db-cache-update.service run is still in progress"
fi

# --- prove the documentation still says what grade.sh expects -------------
# doc_says FILE PATTERN - the pattern appears in the gzipped nroff SOURCE of a man
# page. The source, not `man` output: rendering depends on groff, on the locale and
# on the terminal width, and a hyphen in rendered output is not always the ASCII
# hyphen the pattern would have to match. The source is a byte-for-byte artefact of
# the package.
#
# `grep -F -- pat >/dev/null` and not `grep -qF`: content/lib/assert.sh documents
# that grep's early exit kills the producer with SIGPIPE and `set -o pipefail`
# then reports a successful search as a failed pipeline. Reading to EOF cannot do
# that, and man page sources are small.
doc_says() {
  local f=$1 pat=$2
  [[ -r $f ]] || return 2
  timeout 20 gzip -cd -- "$f" 2>/dev/null | grep -F -- "$pat" >/dev/null
}

# assert_doc FILE PATTERN ANSWER - one question's evidence.
assert_doc() {
  local f=$1 pat=$2 answer=$3
  doc_says "$f" "$pat"
  case $? in
    0) return 0 ;;
    2) fail "$f is missing or unreadable, so the expected answer '$answer' cannot be found on this guest by any means. It ships in a package this script has already verified is installed, so this guest's documentation has been stripped (a tsflags=nodocs install, or a manual rm); revert to the \`clean\` snapshot" ;;
    *) fail "$f exists but no longer contains '$pat', so grade.sh's expected answer '$answer' is STALE - the shipped page has changed under it. Do not blame the student: fix the expectation in grade.sh (its header names the exact file and package build each answer was verified against) or drop the question" ;;
  esac
}

# The seven strings below are the whole evidence base for this task. Each was read
# out of the named RHEL 9 package with `rpm2archive | tar -x` and `gzip -cd`; the
# builds are named in grade.sh's header.
assert_doc "$SRC_NAMEI"   'terminal point' 'namei'
# The full field list, not the bare word GECOS: this is what pins the FIFTH field
# to GECOS, which is what the question asks. The bare word appears several times
# in the page and would still be there if the order changed.
assert_doc "$SRC_PASSWD"  'name:password:UID:GID:GECOS:directory:shell' 'GECOS'
assert_doc "$SRC_HWCLOCK" 'hctosys' '--hctosys'
# `\-\-key` and not `--key`: nroff writes an option's leading hyphens escaped, so
# the two hyphens in the source file are each preceded by a backslash.
assert_doc "$SRC_USERADD" '\-\-key' '-K'
assert_doc "$SRC_GETOPT"  'share/doc/util' 'getopt-example.bash'
assert_doc "$SRC_DF"      'df invocation' '(coreutils) df invocation'

# getopt(1) says the example scripts "are installed in /usr/share/doc/util-linux";
# the question asks for the name of the file that is actually there, so the file
# itself has to be there. A Minimal Install with docs stripped is exactly the guest
# on which this question is unanswerable while looking perfectly answerable.
[[ -r $DOC_EXAMPLE ]] \
  || fail "$DOC_EXAMPLE does not exist, so the answer to getopt_doc_file cannot be found on this guest. util-linux ships it (rpm -qd util-linux lists it); if it is gone, this guest's documentation has been stripped - revert to the \`clean\` snapshot"

# The Texinfo node df(1) points at. Not what df_info_node is graded against - that
# is the string in the man page - but if the manual it names is absent then the
# pointer this task teaches leads nowhere, which is worth failing over.
[[ -r $INFO_DOC ]] \
  || fail "$INFO_DOC does not exist, so the Texinfo manual df(1) points at is not on this guest and the pointer the last question is about leads nowhere. coreutils-common ships it; revert to the \`clean\` snapshot"

# --- plant the answer file ------------------------------------------------
# Planted rather than left to the student, and that is a fairness decision: it
# fixes the six key names and the one-answer-per-line shape in front of them, so
# nothing in this task is a guess about format. It also means no checkpoint grades
# the file's SHAPE - all six grade values, and all six are blank below, which is
# what makes them fail at baseline.
#
# Removed with sudo first, then written as student: an earlier fixture may have
# left a root-owned file here, and a student-owned file is what the prompt
# promises. Nothing here goes near /home/student/.ssh.
sudo rm -f -- "$ANSWERS"
printf '%s\n' \
  '# tools/051-finding-it-in-the-docs - your answers.' \
  '# One answer per line, after the "=". Do not rename the keys.' \
  'path_walk_command=' \
  'passwd_fifth_field=' \
  'hwclock_long_option=' \
  'useradd_short_option=' \
  'getopt_doc_file=' \
  'df_info_node=' \
  > "$ANSWERS" \
  || fail "could not write $ANSWERS as student; check that /home/student is writable by student and that /home is mounted"
need chmod 0644 "$ANSWERS"
[[ -O $ANSWERS ]] \
  || fail "$ANSWERS is not owned by student after being written by student, which should be impossible; do not hand this guest over"

# --- verify every goal checkpoint fails at baseline -----------------------
# The same extraction grade.sh does, kept deliberately in step with it: value is
# everything after the first "=", trimmed, and the last non-empty one wins. If
# this ever disagrees with the grader, the baseline assertion below stops meaning
# anything.
answer_for() {
  awk -v k="$1" '
    { gsub(/\r/, "") }
    /^[[:space:]]*#/ { next }
    {
      i = index($0, "=")
      if (i == 0) next
      name = substr($0, 1, i - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name != k) next
      v = substr($0, i + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      if (v != "") last = v
    }
    END { print last }' "$ANSWERS"
}

for k in "${KEYS[@]}"; do
  # Counted into a variable rather than piped into `grep -q`: assert.sh's SIGPIPE
  # note applies to every producer, and a count is easier to put in a message.
  n=$(grep -c "^${k}=" "$ANSWERS")
  [[ ${n:-0} -eq 1 ]] \
    || fail "$ANSWERS holds ${n:-0} '${k}=' lines after being written by this script, not exactly one, so the student is being handed a file whose shape the prompt describes wrongly"
  v=$(answer_for "$k")
  [[ -z $v ]] \
    || fail "$ANSWERS already answers '$k' with '$v' at baseline, so that checkpoint would pass with no work done"
done

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
