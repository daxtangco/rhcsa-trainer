#!/usr/bin/env bash
# Route 3: the candidate who copies what the page printed, character for
# character, instead of trimming it to the shortest form.
#
# This is a real behaviour and the commonest one under exam pressure - you have the
# page open, you paste the line - so it has to pass. It is also this task's guard
# against its own most likely defect: an over-strict comparison. Every value below
# is a spelling a grader written carelessly would reject, and each one proves the
# same knowledge as the terse spelling in solution 01:
#
#   namei(1)                                     the page reference, not the bare
#                                                command name
#   gecos                                        the page shouts it, the student
#                                                does not
#   -s, --hctosys                                exactly as hwclock(8) prints the
#                                                option pair
#   -K, --key KEY=VALUE                          exactly as useradd(8) prints it,
#                                                argument and all
#   /usr/share/doc/.../getopt-example.bash       the full path rather than the file
#                                                name the question asked for, which
#                                                the prompt says is accepted
#   info '(coreutils) df invocation'             the whole command df(1) suggests,
#                                                command word and quotes included
#
# If this fixture ever fails, the grader has become stricter than the task, and the
# fix belongs in grade.sh's comparisons rather than here.
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

# The lookups, in the terse form an experienced candidate uses: `whatis` for the
# one-line description, `man -f` to see both passwd pages before choosing, and
# `man -k` over a single distinctive word rather than a phrase.
whatis namei
man -f passwd
man -k pathname

man -P cat 5 passwd
man -P cat 8 hwclock
man -P cat 8 useradd
man -P cat 1 getopt
man -P cat 1 df
ls /usr/share/doc/util-linux/

# Pasted, quotes and commas and all.
printf '%s\n' \
  'path_walk_command=namei(1)' \
  'passwd_fifth_field=gecos' \
  'hwclock_long_option=-s, --hctosys' \
  'useradd_short_option=-K, --key KEY=VALUE' \
  'getopt_doc_file=/usr/share/doc/util-linux/getopt-example.bash' \
  "df_info_node=info '(coreutils) df invocation'" \
  > "$ANSWERS"

cat -- "$ANSWERS"
