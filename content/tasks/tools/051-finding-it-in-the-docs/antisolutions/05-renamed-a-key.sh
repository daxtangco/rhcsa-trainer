#!/usr/bin/env bash
# All six answers correct, one of them filed under a key of the student's own
# invention.
#
# The prompt says to keep the key names as they are, and this fixture is why that
# sentence is in the prompt: an answer nobody can find is an answer nobody can mark.
# There is no way for a grader to accept "passwd_field_5" without guessing which
# question it belongs to, and a grader that guesses is a grader that can be gamed.
#
# It is a fair failure rather than a gotcha because the file was planted with the
# key already on it - renaming it takes deliberate work - and because the same
# discipline is what an exam grader's scripted checks demand of a real candidate:
# the file goes where it was asked for, named what it was asked to be named.
# expect-fail: passwd-field-name
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

printf '%s\n' \
  'path_walk_command=namei' \
  'passwd_field_5=GECOS' \
  'hwclock_long_option=--hctosys' \
  'useradd_short_option=-K' \
  'getopt_doc_file=getopt-example.bash' \
  'df_info_node=(coreutils) df invocation' \
  > "$ANSWERS"
