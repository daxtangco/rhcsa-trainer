#!/usr/bin/env bash
# Route 1, and the one the exam expects: read the six pages with `man`, then write
# the answers down.
#
# Straight-line commands on purpose - rung 4 builds the student-facing command
# sketch from the sorted-first solution file, so there is no loop, no case and no
# if at the top level here (README, "Adding content"). The variant that never opens
# a page lives in 02.
#
# THE SKETCH FOR THIS TASK CONTAINS THE ANSWERS, unavoidably: the answers are what
# a solution to this task consists of, so any file that solves it spells them out.
# There is no version of this script that both works and keeps them hidden. Worth
# knowing before using the hint on rung 4 - it is a full spoiler here in a way it
# is not on a task that changes system state.
#
# `-P cat` sends each page to `cat` instead of a pager. man(1) documents
# `-P pager, --pager=pager`, and its default is `less`; less waits for a keypress
# that a script over ssh will never send. Interactively you would just run
# `man 5 passwd` and read it.
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

# Question 1. `man -k` searches the page names and the one-line descriptions - it
# is the same program as `apropos`, and the phrase from the question is enough to
# find it on its own. Exactly one page on a RHEL 9 guest describes itself as
# following a pathname until a terminal point is found.
man -k 'terminal point'

# Question 2. Two pages are called passwd: passwd(1) is the command, passwd(5) is
# the file format. Naming the section is how you ask for the second one; `man -f
# passwd` (or `whatis passwd`) lists both if you want to see the choice first. The
# field names are in the DESCRIPTION, as a single colon-separated line.
man -f passwd
man -P cat 5 passwd

# Question 3. The two directions sit next to each other in OPTIONS, and the whole
# trap is that their names are near-anagrams: hardware-clock-to-system versus
# system-to-hardware-clock. Read them in full rather than pattern-matching.
man -P cat 8 hwclock

# Question 4. useradd(8) lists a lower-case and an upper-case option one after the
# other. One copies a skeleton directory; the other overrides an /etc/login.defs
# default, which is what the question asks for.
man -P cat 8 useradd

# Question 5. getopt(1) EXAMPLES names the directory the example scripts are
# installed in, but not their file names - so the page gets you to the directory
# and the directory gets you the answer. That is the shape of a lot of real
# lookups, and it is why /usr/share/doc is in the objective alongside man.
man -P cat 1 getopt
ls -l /usr/share/doc/util-linux

# Question 6. Every GNU coreutils page ends with a pointer to the full Texinfo
# manual, and prints the node reference in the exact form the `info` reader wants.
man -P cat 1 df

# Following that pointer is `info '(coreutils) df invocation'`, which is worth
# doing once by hand. It is not run here: `info` is a full-screen reader and this
# script has no terminal. The answer comes off the df(1) page either way.

# The answers. Written with printf rather than an editor only because a script
# cannot use one; by hand this is `vim /home/student/doc-answers.txt` and six
# lines filled in. The keys are the ones setup.sh planted, unchanged.
printf '%s\n' \
  '# tools/051-finding-it-in-the-docs - your answers.' \
  'path_walk_command=namei' \
  'passwd_fifth_field=GECOS' \
  'hwclock_long_option=--hctosys' \
  'useradd_short_option=-K' \
  'getopt_doc_file=getopt-example.bash' \
  'df_info_node=(coreutils) df invocation' \
  > "$ANSWERS"

cat -- "$ANSWERS"
