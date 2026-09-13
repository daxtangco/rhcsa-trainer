#!/usr/bin/env bash
# Near-miss: five answered, one left as a note to self.
#
# The last question is the one that needs a second lookup - the man page names the
# node, and following the pointer with `info` is a separate step - so it is the one
# a candidate defers and then runs out of time on. A placeholder is not an answer,
# and it must not be graded as one just because the line is no longer blank.
#
# This is also the fixture that proves the grader reads VALUES rather than the shape
# of the file: every key is present, every line is well formed, and it still fails.
# expect-fail: df-info-node
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

printf '%s\n' \
  'path_walk_command=namei' \
  'passwd_fifth_field=GECOS' \
  'hwclock_long_option=--hctosys' \
  'useradd_short_option=-K' \
  'getopt_doc_file=getopt-example.bash' \
  'df_info_node=TODO look this up' \
  > "$ANSWERS"
