#!/usr/bin/env bash
# The candidate who answers from general knowledge and never opens a page.
#
# Three plausible wrong answers, each wrong for a different reason, and each one
# what a competent Linux user would produce from memory alone:
#
#   realpath              resolves a path and prints where it ends up, which is
#                         what "follow a pathname until a terminal point is found"
#                         sounds like it means. It is not the page that says it.
#   comment               is what useradd(8) names the option that SETS that field
#                         ("-c, --comment COMMENT ... currently used as the field
#                         for the user's full name"), so this is not ignorance - it
#                         is answering from a different page than the one the
#                         question named. passwd(5) calls the field GECOS.
#
#                         passwd(5) does mention the word: under the GECOS heading
#                         it says the field is "sometimes called the "comment
#                         field"". That aside is why the grader accepts any answer
#                         that NAMES GECOS even when it mentions "comment" too -
#                         "GECOS (the comment field)" is a faithful read of the page
#                         and passes. What fails is "comment" on its own, which
#                         gives the aside instead of the name and is what a
#                         candidate who never opened passwd(5) writes.
#   getopt-example.tcsh   is really in /usr/share/doc/util-linux, next to the file
#                         the question asked for. Guessing the directory contents
#                         from the man page's wording gets you a real file name and
#                         the wrong shell.
#
# Three answers are right here, and none of them is evidence that a page was opened:
#   --hctosys                  a well-read admin knows which direction is which
#   (coreutils) df invocation  every coreutils node is "<command> invocation", so the
#                              form follows from having seen any one of them
#   -K                         the substance is knowable from having used it; the CASE
#                              is the part nobody remembers, and this fixture is the
#                              candidate who happens to get the coin-flip right.
#                              Anti-solution 01 is the same candidate losing it.
# That asymmetry is the honest limit of this task, and grade.sh's header states it:
# three of the six cannot be produced from memory (question 1's command name, the case
# of useradd's option, the file name that appears in no page) and three can.
# expect-fail: command-by-description, passwd-field-name, doc-example-script
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

printf '%s\n' \
  'path_walk_command=realpath' \
  'passwd_fifth_field=comment' \
  'hwclock_long_option=--hctosys' \
  'useradd_short_option=-K' \
  'getopt_doc_file=getopt-example.tcsh' \
  'df_info_node=(coreutils) df invocation' \
  > "$ANSWERS"
