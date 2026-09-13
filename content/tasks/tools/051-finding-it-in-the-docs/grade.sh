#!/usr/bin/env bash
# Grader for tools/051-finding-it-in-the-docs.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL is read. content/lib/assert.sh is prepended by loadTaskScripts, so its
# helpers are already in scope - do not source it.
#
# WHAT THIS GRADES, AND WHAT IT CANNOT.
# "Locate, read, and use system documentation" is a skill, not a state: when the
# student is finished, nothing on the machine has changed, so there is nothing for
# a grader to measure. The only honest way to mark it is to make the student
# produce an artefact that could only have come from the documentation installed
# here, and then read the artefact. That is what this does, and the prompt says so
# outright.
#
# The residual is stated plainly: a candidate who already knew all six answers
# passes without opening a page, and this grader cannot tell. Counted honestly,
# three of the six cannot be answered from general knowledge at all - the command
# whose one-line description question 1 quotes, the CASE of useradd's override
# option, and the name of a file that appears in no manual page. The other three -
# the name passwd(5) gives its fifth field, which hwclock function goes which way,
# and the shape of a coreutils Texinfo node reference - a well-read candidate may
# simply know, and that is accepted rather than papered over. What makes the task
# still worth grading is that allPassed() requires every checkpoint: a candidate
# guessing at all six fails on the three that cannot be guessed.
#
# WHERE EACH EXPECTED ANSWER COMES FROM. Every one was read out of the shipped
# RHEL 9 file named below, extracted from the RPM with `rpm2archive | tar -x`:
#
#   namei                        util-linux-2.37.4-25.el9      man1/namei.1.gz
#                                NAME: "namei - follow a pathname until a
#                                terminal point is found"
#   GECOS                        man-pages-6.04-10.el9_8       man5/passwd.5.gz
#                                "seven colon-separated fields:
#                                name:password:UID:GID:GECOS:directory:shell"
#   --hctosys                    util-linux-2.37.4-25.el9      man8/hwclock.8.gz
#                                "-s, --hctosys  Set the System Clock from the
#                                Hardware Clock" (the reverse is -w, --systohc)
#   -K                           shadow-utils-4.9-16.el9       man8/useradd.8.gz
#                                "-K, --key KEY=VALUE  Overrides /etc/login.defs
#                                defaults (UID_MIN, UID_MAX, UMASK,
#                                PASS_MAX_DAYS and others)". The near-miss is
#                                "-k, --skel SKEL_DIR", a different option.
#   getopt-example.bash          util-linux-2.37.4-25.el9      the file itself,
#                                /usr/share/doc/util-linux/getopt-example.bash,
#                                which getopt(1) EXAMPLES points at: "Example
#                                scripts for (ba)sh and (t)csh are provided with
#                                the getopt(1) distribution, and are installed in
#                                /usr/share/doc/util-linux directory."
#   (coreutils) df invocation    coreutils-common-8.32-41.el9_8.1  man1/df.1.gz
#                                SEE ALSO: "or available locally via: info
#                                '(coreutils) df invocation'"
#
# setup.sh re-proves all six against the files on the guest before handing over, so
# a page that changes in some later RHEL 9 minor release fails the fixture loudly
# instead of failing a student who read it correctly.
#
# MATCHING TOLERANCE is the most likely defect in a task like this: an over-strict
# comparison is a false failure, and a false failure on a documentation task teaches
# the student that the documentation is wrong. Each comparison below states its own
# tolerance and why. The rule applied throughout: accept every spelling that proves
# the same knowledge, reject every spelling that proves different knowledge. So
# "-s, --hctosys" copied straight off the page passes, and "--systohc" - the right
# idea in the wrong direction - does not.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: command-by-description, passwd-field-name, hwclock-function-option, useradd-override-option, doc-example-script, df-info-node
set -uo pipefail

ANSWERS=/home/student/doc-answers.txt

# The documentation each question is answered from. Same paths as setup.sh.
SRC_NAMEI=/usr/share/man/man1/namei.1.gz
SRC_PASSWD=/usr/share/man/man5/passwd.5.gz
SRC_HWCLOCK=/usr/share/man/man8/hwclock.8.gz
SRC_USERADD=/usr/share/man/man8/useradd.8.gz
SRC_GETOPT=/usr/share/man/man1/getopt.1.gz
SRC_DF=/usr/share/man/man1/df.1.gz
DOC_EXAMPLE=/usr/share/doc/util-linux/getopt-example.bash
INFO_DOC=/usr/share/info/coreutils.info.gz

# Neutral on purpose: a word from no answer in this task, so a student reading the
# detail line of the invariant below learns nothing from it. Same probe setup.sh
# asserts before handing the guest over.
INDEX_PROBE=password

D_CMD="the command named by its one-line manual description is right"
D_FIELD="the fifth field of an /etc/passwd line is named as the manual page names it"
D_HWCLOCK="the hwclock function that sets the system clock from the hardware clock is right"
D_USERADD="the useradd option that overrides an /etc/login.defs default is right"
D_DOCFILE="the (ba)sh example file under /usr/share/doc is named right"
D_INFO="the Texinfo node df(1) points at is recorded right"
D_INDEX="the manual pages are still searchable on this guest"
D_DOCS="the documentation the questions are answered from is still installed"

# --- the two invariants, as a function so the fail-closed path below can reuse
# them without a second copy of the ids ------------------------------------
#
# Knowingly unprobed, both of them: no shipped fixture here breaks either, and
# none should. Every anti-solution in this task is a wrong ANSWER, which is what a
# real candidate produces; a fixture that removed man-db or deleted a man page to
# exercise these would be vandalism rather than a near-miss, and it would be
# testing the lab rather than the student. They exist to name the problem in a
# report when a guest arrives broken - which is the one case where a run of six
# wrong answers is not the student's fault.
# unprobed-invariant: man-index-usable, documentation-installed
emit_invariants() {
  if ! command -v apropos >/dev/null 2>&1; then
    ck_fail man-index-usable "$D_INDEX" \
      "apropos is not installed (package man-db), so 'man -k' cannot be used on this guest at all"
  else
    # Captured, then tested for emptiness: apropos exits 16 and prints "nothing
    # appropriate" on STDERR when the index is missing or empty - measured on
    # man-db-2.9.3-9.el9 - so an empty stdout is the reliable signal, and there is
    # no producer for an early exit to kill.
    local probe
    probe=$(timeout 25 apropos "$INDEX_PROBE" 2>/dev/null)
    if [[ -n $probe ]]; then
      ck_pass man-index-usable "$D_INDEX"
    else
      ck_fail man-index-usable "$D_INDEX" \
        "'apropos $INDEX_PROBE' returned nothing, so the index under /var/cache/man is missing or empty and every 'man -k' search on this guest answers \"nothing appropriate\"; 'sudo mandb' rebuilds it"
    fi
  fi

  local f missing=''
  for f in "$SRC_NAMEI" "$SRC_PASSWD" "$SRC_HWCLOCK" "$SRC_USERADD" "$SRC_GETOPT" \
           "$SRC_DF" "$DOC_EXAMPLE" "$INFO_DOC"; do
    [[ -r $f ]] || missing+=" $f"
  done
  if [[ -z $missing ]]; then
    ck_pass documentation-installed "$D_DOCS"
  else
    ck_fail documentation-installed "$D_DOCS" \
      "not readable on this guest:${missing}. setup.sh asserts all of these before the task starts, so this is a lab defect and the answers that come from them cannot be found here"
  fi
}

# --- read the answer file once -------------------------------------------
# Read through sudo, following sys/035 and tools/038: the student may have written
# the file as root with a umask that leaves it unreadable to their own account, and
# "the grader could not read it" must never be graded as "it is not there". That is
# a false failure and it sends the student looking for a problem that does not exist.
RAW=$(timeout 20 sudo cat -- "$ANSWERS" 2>/dev/null)

# FAIL CLOSED, the same shape as tools/038's digest guard: with no file there is no
# honest verdict on any of the six, and every one of them is a goal checkpoint that
# must fail at baseline anyway. The invariants are still collected, because they are
# what distinguishes "the student deleted the file" from "the guest arrived broken".
if [[ -z $RAW ]]; then
  detail="$ANSWERS is missing or empty. setup.sh plants it with one blank line per question; if it is gone, put it back or reset the lab"
  ck_fail command-by-description "$D_CMD" "$detail"
  ck_fail passwd-field-name "$D_FIELD" "$detail"
  ck_fail hwclock-function-option "$D_HWCLOCK" "$detail"
  ck_fail useradd-override-option "$D_USERADD" "$detail"
  ck_fail doc-example-script "$D_DOCFILE" "$detail"
  ck_fail df-info-node "$D_INFO" "$detail"
  emit_invariants
  exit 0
fi

# answer_for KEY - the value after the first "=" on the KEY= line, trimmed.
#
# The LAST non-empty value wins. A student who leaves the planted blank line in
# place and writes a filled line underneath it is answering the question; so is one
# who edits the line in place. Taking the last non-empty value accepts both and
# accepts a corrected second attempt, which is the likeliest shape of a real edit.
# Carriage returns are stripped: a file pasted in from a Windows editor is a
# formatting accident, not a wrong answer.
#
# awk reads to EOF, so the SIGPIPE-under-pipefail trap in content/lib/assert.sh
# cannot fire here.
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
    END { print last }' <<<"$RAW"
}

# squeeze VALUE - trim, tabs to spaces, collapse runs of spaces, and strip one
# matched pair of surrounding quotes. Quotes are stripped because the one answer
# that contains spaces is printed inside quotes by the page it comes from, so a
# student who copies it faithfully brings the quotes along.
squeeze() {
  local v=${1//$'\t'/ }
  while [[ $v == *"  "* ]]; do v=${v//  / }; done
  v=${v# }
  v=${v% }
  if (( ${#v} >= 2 )); then
    case $v in
      "'"*"'") v=${v:1:${#v}-2} ;;
      '"'*'"') v=${v:1:${#v}-2} ;;
    esac
  fi
  v=${v# }
  v=${v% }
  printf '%s' "$v"
}

# token_is WANT VALUE MODE - MODE is `fold` for a case-insensitive comparison and
# `exact` for a case-sensitive one. True when any whitespace-separated token of
# VALUE equals WANT after being stripped of stray quoting characters, a trailing
# "(1)"-style section suffix, a leading directory path, trailing punctuation, and -
# for a long option - an "=argument" tail.
#
# Token-wise rather than whole-string, so "namei(1)", "/usr/bin/namei" and "the
# namei command" all read as the same answer. A wrong answer does not accidentally
# contain the right token.
#
# Backticks and stray quotes go first, before the paren and path handling: a
# student who writes `namei` or "GECOS" field has quoted a word inside a longer
# value, which squeeze's whole-value quote stripping does not reach. Quoting a word
# is a typing habit, never a different answer.
token_is() {
  local want=$1 mode=$3 t
  local -a toks
  read -ra toks <<<"$2"
  for t in "${toks[@]}"; do
    t=${t//[\`\"\']/}
    t=${t%%"("*}
    t=${t##*/}
    t=${t%[.,;:]}
    [[ $t == --* ]] && t=${t%%=*}
    [[ $mode == fold ]] && t=${t,,}
    [[ $t == "$want" ]] && return 0
  done
  return 1
}

# missing_doc FILE - the detail line for a question that cannot be evaluated
# because the documentation it is answered from is not on this guest. Reported as
# skipped rather than failed: the student cannot be marked wrong for not finding a
# page that is not there. It is not treated as correct either - allPassed() counts
# a skipped checkpoint as not-passed - which is the honest verdict on a question
# that could not be asked. setup.sh asserts all eight files are present before the
# task starts, so this path should never run on a healthy guest.
#
# A function that returns the TEXT, with every checkpoint id written out at the
# call site as a literal: an id inside a helper would be invisible to the
# checkpoint counter and lint rejects it (src/cli/lint.ts, nonLiteralIds).
missing_doc() {
  printf '%s' \
    "$1 is not readable on this guest, so the answer to this question cannot be found here; setup.sh asserts it is present, so this is a lab defect rather than a wrong answer"
}

# --- 1. the command found by its description ------------------------------
# apropos matches its keyword against the page name and the description, so
# `man -k 'terminal point'` returns exactly one page on a RHEL 9 guest: namei(1).
# Verified by running man-db-2.9.3-9.el9's own binaries against an index built
# from the shipped man tree.
#
# Case-folded: a command name is lowercase and "Namei" is a typing habit, not a
# different answer. `realpath` and `readlink` - the two plausible guesses from
# general knowledge - are different answers and fail.
#
# Token-wise, so "namei(1)", "/usr/bin/namei" and "the namei command" all pass, but
# a value that ALSO names one of the two guesses fails even though it contains the
# right word. Same rule as the hwclock question below: an answer offering two
# candidates has not answered, and this task is about being able to settle the
# question from the machine in front of you rather than shortlist from memory.
v=$(squeeze "$(answer_for path_walk_command)")
if [[ ! -r $SRC_NAMEI ]]; then
  ck_skip command-by-description "$D_CMD" "$(missing_doc "$SRC_NAMEI")"
elif [[ -z $v ]]; then
  ck_fail command-by-description "$D_CMD" \
    "path_walk_command is still blank in $ANSWERS"
elif token_is realpath "$v" fold || token_is readlink "$v" fold; then
  ck_fail command-by-description "$D_CMD" \
    "path_walk_command=$v names more than one candidate; searching the one-line descriptions for the phrase in the question returns exactly one page on this guest, so there is one answer to give"
elif token_is namei "$v" fold; then
  ck_pass command-by-description "$D_CMD"
else
  ck_fail command-by-description "$D_CMD" \
    "path_walk_command=$v is not the command whose manual description is \"follow a pathname until a terminal point is found\"; searching the descriptions for that phrase names exactly one page"
fi

# --- 2. the fifth field of an /etc/passwd line ----------------------------
# passwd(5) from man-pages-6.04-10.el9_8: "Each line of the file describes a single
# user, and contains seven colon-separated fields:
# name:password:UID:GID:GECOS:directory:shell". Fifth is GECOS.
#
# Case-folded, because the page prints it in capitals and a student writing "gecos"
# has read it.
#
# Token-wise, like question 1, and this one matters more than it looks. The page
# heads the field `GECOS` and then says it is "sometimes called the "comment
# field"", so a student who read it writes any of "GECOS", "GECOS field", "the
# GECOS field", or "GECOS:" copied out of the colon-separated list. All four name
# the same field and all four pass. A whole-string comparison against "gecos"
# rejected three of them, which is a false failure on a student who did the work.
#
# "comment" ALONE still fails, and that is the distinction being drawn: the page
# gives the field a name in its field list, the question asks for that name, and
# "comment" is the name a DIFFERENT page uses for it - useradd(8) calls the option
# that sets it "-c, --comment". A value that names GECOS and mentions "comment"
# alongside it passes, because it has given the name; a value that only says
# "comment" has answered from the wrong page.
v=$(squeeze "$(answer_for passwd_fifth_field)")
if [[ ! -r $SRC_PASSWD ]]; then
  ck_skip passwd-field-name "$D_FIELD" "$(missing_doc "$SRC_PASSWD")"
elif [[ -z $v ]]; then
  ck_fail passwd-field-name "$D_FIELD" \
    "passwd_fifth_field is still blank in $ANSWERS"
elif token_is gecos "$v" fold; then
  ck_pass passwd-field-name "$D_FIELD"
else
  ck_fail passwd-field-name "$D_FIELD" \
    "passwd_fifth_field=$v is not the name the manual page for the /etc/passwd FILE gives the fifth of its seven colon-separated fields; that page is not the one about the passwd command, and the name it gives the field is the word in the colon-separated list, not the aside about what the field is sometimes called"
fi

# --- 3. hwclock's system-from-hardware function ---------------------------
# hwclock(8) from util-linux-2.37.4-25.el9: "-s, --hctosys  Set the System Clock
# from the Hardware Clock", against "-w, --systohc  Set the Hardware Clock from
# the System Clock".
#
# Tolerance, deliberately wide in one direction and closed in the other:
#   - "--hctosys", "hctosys" and "-s, --hctosys" all pass. The last one is exactly
#     what the page prints, so a student who copies the line is not punished for
#     copying it faithfully.
#   - a bare "-s" passes too. The prompt asks for the long form, but the knowledge
#     being graded is WHICH function, not which of its two spellings, and nobody
#     learns "-s" without reading the page.
#   - anything naming --systohc fails, even if it also names --hctosys: an answer
#     that hedges between the two directions has not decided, and deciding is the
#     whole question.
# Case-folded: long options are lowercase everywhere in this page, so there is no
# case distinction to preserve, unlike the short option in question 4. Stray quoting
# characters go too, so that a bare "-s" still reads as "-s" when the student wrote
# it as `-s`; the long form passes on a substring match either way.
v=$(squeeze "$(answer_for hwclock_long_option)")
compact=${v,,}
compact=${compact//[\`\"\']/}
compact=${compact// /}
compact=${compact//,/}
if [[ ! -r $SRC_HWCLOCK ]]; then
  ck_skip hwclock-function-option "$D_HWCLOCK" "$(missing_doc "$SRC_HWCLOCK")"
elif [[ -z $v ]]; then
  ck_fail hwclock-function-option "$D_HWCLOCK" \
    "hwclock_long_option is still blank in $ANSWERS"
elif [[ $compact == *systohc* ]]; then
  ck_fail hwclock-function-option "$D_HWCLOCK" \
    "hwclock_long_option=$v names the function that sets the HARDWARE clock from the SYSTEM clock; the question asks for the other direction, and hwclock(8) lists both"
elif [[ $compact == *hctosys* || $compact == -s || $compact == s ]]; then
  ck_pass hwclock-function-option "$D_HWCLOCK"
else
  ck_fail hwclock-function-option "$D_HWCLOCK" \
    "hwclock_long_option=$v is not the option hwclock(8) documents for setting the System Clock from the Hardware Clock"
fi

# --- 4. useradd's login.defs override -------------------------------------
# useradd(8) from shadow-utils-4.9-16.el9: "-K, --key KEY=VALUE  Overrides
# /etc/login.defs defaults (UID_MIN, UID_MAX, UMASK, PASS_MAX_DAYS and others)".
#
# THE ONE CASE-SENSITIVE COMPARISON IN THIS GRADER, and it is deliberate: the same
# page documents "-k, --skel SKEL_DIR", a different option doing a different thing,
# so "-k" is not a typo for "-K" - it is the other answer. The prompt warns that
# useradd has two options spelled with this letter. Accepted spellings: "-K", a
# bare "K", "--key", and the page's own "-K, --key KEY=VALUE"; "--key=..." has its
# argument tail trimmed by token_is. "--skel" and "-k" fail.
v=$(squeeze "$(answer_for useradd_short_option)")
if [[ ! -r $SRC_USERADD ]]; then
  ck_skip useradd-override-option "$D_USERADD" "$(missing_doc "$SRC_USERADD")"
elif [[ -z $v ]]; then
  ck_fail useradd-override-option "$D_USERADD" \
    "useradd_short_option is still blank in $ANSWERS"
elif token_is -K "$v" exact || token_is K "$v" exact || token_is --key "$v" exact; then
  ck_pass useradd-override-option "$D_USERADD"
else
  ck_fail useradd-override-option "$D_USERADD" \
    "useradd_short_option=$v is not the option useradd(8) documents for overriding an /etc/login.defs default; useradd has two options spelled with that letter and they do different things, so the case of it matters"
fi

# --- 5. the example script under /usr/share/doc ---------------------------
# getopt(1) EXAMPLES names the directory; util-linux-2.37.4-25.el9 installs
# getopt-example.bash and getopt-example.tcsh in it. The question asks for the
# (ba)sh one, so the tcsh sibling is a different answer and fails - which is the
# point: this is the one question whose answer is not in any man page at all, only
# in the directory the man page sends you to.
#
# A bare file name and a full path both pass; only the last path component is
# compared. Case-folded, since the file name is lowercase on disk. Whitespace
# inside the value is rejected rather than picked apart: the prompt asks for one
# file name, and a value naming both example scripts has not answered the question.
#
# Stray quoting characters and ONE trailing punctuation mark are dropped first, for
# the same reason token_is drops them on the other questions: "getopt-example.bash."
# and `getopt-example.bash` are the file name with a full stop or a pair of
# backticks around it, not a different file. Only a trailing mark is dropped, so the
# ".bash" that IS the answer's extension survives, and "getopt-example.tcsh." is
# still the wrong file afterwards.
v=$(squeeze "$(answer_for getopt_doc_file)")
v=${v//[\`\"\']/}
v=${v%[.,;:]}
base=${v##*/}
if [[ ! -r $DOC_EXAMPLE ]]; then
  ck_skip doc-example-script "$D_DOCFILE" "$(missing_doc "$DOC_EXAMPLE")"
elif [[ -z $v ]]; then
  ck_fail doc-example-script "$D_DOCFILE" \
    "getopt_doc_file is still blank in $ANSWERS"
elif [[ $v == *[[:space:]]* ]]; then
  ck_fail doc-example-script "$D_DOCFILE" \
    "getopt_doc_file=$v holds more than one word; the question asks for one file name (a full path is fine, a list is not)"
elif [[ ${base,,} == getopt-example.bash ]]; then
  ck_pass doc-example-script "$D_DOCFILE"
else
  ck_fail doc-example-script "$D_DOCFILE" \
    "getopt_doc_file=$v is not the (ba)sh example script installed in the directory getopt(1) names; that directory holds an example for each of two shells"
fi

# --- 6. the Texinfo node df(1) points at ----------------------------------
# df(1) from coreutils-common-8.32-41.el9_8.1 ends: "or available locally via:
# info '(coreutils) df invocation'". The node exists: coreutils.info.gz carries
# "Node: df invocation".
#
# Normalised hard, because this is the answer most likely to be typed with
# punctuation of the student's own choosing. A leading "info" command word is
# dropped, then every character that is punctuation or separator rather than content
# is removed - quotes, backticks, parentheses, spaces, commas, semicolons, colons,
# hyphens and underscores - so all of these pass:
#
#   (coreutils) df invocation          the page's own form
#   info '(coreutils) df invocation'   the whole command the page suggests
#   "(coreutils) df invocation"        requoted by the student
#   (coreutils)df invocation           spacing dropped
#   coreutils df invocation            parentheses dropped
#   (coreutils) df invocation.         a full stop at the end of the line
#   (coreutils) df invocation,         a comma at the end of the line
#   coreutils, df invocation           the two halves punctuated as a list
#   (coreutils) df-invocation          the node name hyphenated in transcription
#
# Every one of those names both halves of the reference, which is the knowledge.
# Both halves stay REQUIRED: "coreutils" alone, "(coreutils)" alone, "df invocation"
# alone and "info coreutils" all fail, because the node reference is the pair and
# naming one half does not tell you where to look. Nothing wrong normalises onto the
# right answer - "(coreutils) ls invocation" is a different node and still fails.
# Punctuation goes BEFORE the "info" command word is dropped, not after: a value
# written as `info '(coreutils) df invocation'` - the whole command, backquoted the
# way a student marks up a command - keeps its leading backtick glued to "info",
# and stripping the command word first would then miss it and leave "info" in the
# comparison. Spaces survive this step so that "info " is still a recognisable
# prefix; they are removed afterwards.
v=$(squeeze "$(answer_for df_info_node)")
node=${v,,}
node=${node//[()\`\"\',;:_-]/}
node=$(squeeze "$node")
node=${node#info }
node=${node// /}
node=${node%.}
if [[ ! -r $SRC_DF ]]; then
  ck_skip df-info-node "$D_INFO" "$(missing_doc "$SRC_DF")"
elif [[ -z $v ]]; then
  ck_fail df-info-node "$D_INFO" \
    "df_info_node is still blank in $ANSWERS"
elif [[ $node == coreutilsdfinvocation ]]; then
  ck_pass df-info-node "$D_INFO"
else
  ck_fail df-info-node "$D_INFO" \
    "df_info_node=$v is not the Texinfo node df(1) names at the end of its page; the reference has two parts, the manual and the node inside it"
fi

emit_invariants
exit 0
