#!/usr/bin/env bash
# Route 2: never render a page at all.
#
# Genuinely independent of 01, not a re-spelling of it. Four things differ, and each
# is a different tool doing the work:
#   - the search is `apropos -a` with two ordinary words instead of `man -k` with
#     one quoted phrase, so the hit comes from an AND of keywords rather than a
#     substring;
#   - the pages are located with `man -w` and read as gzipped nroff SOURCE through
#     grep, so `man`'s formatter is never involved and neither is a pager;
#   - the example file is found from the RPM database with `rpm -qd`, which answers
#     "what documentation does this package ship" without going near the man page
#     that names the directory;
#   - the answers are edited into the planted file in place with `sed -i` rather
#     than the file being rewritten, so the two routes cannot share a bug in how
#     the file is produced.
#
# Reading the source rather than the rendered page is a real habit, not a trick: it
# is how you grep a page for a flag without scrolling, and it is what you fall back
# to on a system where groff is missing. The cost is that you read nroff markup -
# `\fB\-\-key\fP` is what the source calls `--key` - which is why grep patterns
# here allow for the escaping.
set -euo pipefail

ANSWERS=/home/student/doc-answers.txt

# Question 1. apropos -a requires every keyword to match - apropos(1) documents
# "-a, --and" as "Only display items that match all the supplied keywords. The
# default is to display items that match any keyword" - which narrows two vague
# words to one page without needing the description's exact wording.
apropos -a pathname terminal

# Questions 2, 3, 4 and 6, read out of the page sources. `man -w NAME` prints the
# file it would format - man(1): "-w, --where, --path, --location  Don't actually
# display the manual page, but do print the location of the source". Everything
# after that is ordinary text processing.
#
# grep patterns, and why each one is shaped the way it is:
#   passwd(5)  the whole colon-separated field list, so the position of GECOS is
#              visible rather than inferred
#   hwclock(8) both direction options at once, to be forced to choose between them
#   useradd(8) the escaped long option as nroff writes it, plus its description
#   df(1)      the SEE ALSO pointer, which holds the node reference verbatim
gzip -cd -- "$(man -w 5 passwd)" | grep -F 'name:password:UID:GID:GECOS:directory:shell'
gzip -cd -- "$(man -w 8 hwclock)" | grep -E 'hctosys|systohc'
gzip -cd -- "$(man -w 8 useradd)" | grep -A4 -E '^\\fB\\-K\\fR'
gzip -cd -- "$(man -w 1 df)" | grep -F 'df invocation'

# Question 5, from the package database instead of the page. `rpm -qd PACKAGE`
# lists the files that package marks as documentation, which is every path under
# /usr/share/doc and /usr/share/man that came out of util-linux.
rpm -qd util-linux | grep -F 'getopt-example'

# The answers, edited into the file setup.sh planted. `sed -i` replaces each whole
# key= line, so running this twice is harmless and the key names cannot drift.
# `|` as the delimiter because two of the values contain `/` characters or would
# read badly with `/` as the separator.
sed -i \
  -e 's|^path_walk_command=.*|path_walk_command=namei|' \
  -e 's|^passwd_fifth_field=.*|passwd_fifth_field=GECOS|' \
  -e 's|^hwclock_long_option=.*|hwclock_long_option=--hctosys|' \
  -e 's|^useradd_short_option=.*|useradd_short_option=-K|' \
  -e 's|^getopt_doc_file=.*|getopt_doc_file=getopt-example.bash|' \
  -e 's|^df_info_node=.*|df_info_node=(coreutils) df invocation|' \
  "$ANSWERS"

cat -- "$ANSWERS"
