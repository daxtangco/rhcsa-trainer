#!/usr/bin/env bash
# Near-miss: the right letter in the wrong case.
#
# useradd(8) documents "-k, --skel SKEL_DIR" and "-K, --key KEY=VALUE" one after the
# other. A candidate who half-remembers that useradd has "a -k option" and does not
# open the page writes the lower-case one, which copies a skeleton directory and has
# nothing to do with /etc/login.defs. Everything else here is correct, so this
# fixture fails exactly one checkpoint - and that checkpoint is the reason the
# question is on the sheet.
#
# The grader's comparison for this answer is the only case-SENSITIVE one in the
# task, deliberately: "-k" is not a typo for "-K", it is the other option.
# expect-fail: useradd-override-option
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

printf '%s\n' \
  'path_walk_command=namei' \
  'passwd_fifth_field=GECOS' \
  'hwclock_long_option=--hctosys' \
  'useradd_short_option=-k' \
  'getopt_doc_file=getopt-example.bash' \
  'df_info_node=(coreutils) df invocation' \
  > "$ANSWERS"
