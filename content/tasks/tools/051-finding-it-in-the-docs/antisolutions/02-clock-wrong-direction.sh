#!/usr/bin/env bash
# Near-miss: the right option pair, the wrong direction.
#
# hwclock(8) lists "-s, --hctosys  Set the System Clock from the Hardware Clock"
# and "-w, --systohc  Set the Hardware Clock from the System Clock". The names are
# near-anagrams of each other and the descriptions are the same words in the
# opposite order, so a candidate skimming rather than reading picks whichever one
# their eye lands on. This one picks --systohc, which is the other function.
#
# The grader rejects any answer that names --systohc even if it also names
# --hctosys: an answer hedging between the two directions has not chosen, and
# choosing is the entire question.
# expect-fail: hwclock-function-option
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

printf '%s\n' \
  'path_walk_command=namei' \
  'passwd_fifth_field=GECOS' \
  'hwclock_long_option=--systohc' \
  'useradd_short_option=-K' \
  'getopt_doc_file=getopt-example.bash' \
  'df_info_node=(coreutils) df invocation' \
  > "$ANSWERS"
