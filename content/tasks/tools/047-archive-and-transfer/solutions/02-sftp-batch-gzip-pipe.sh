#!/usr/bin/env bash
# Route 2: a different archive layout, a separate compressor, sftp instead of scp,
# and tar's long option names. Not a respelling of 01 - four of the four steps use
# different machinery, which is the point of having a second solution at all:
#
#   01 stores the tree as `reports/...` and lets the extraction create the
#      directory. This stores it as `./...` and creates the directory first, which
#      is the layout you get from `-C dir .` and the layout most people are
#      surprised by. A grader that only knew one of these shapes would fail a
#      correct answer, and both are correct.
#   01 lets tar call gzip through -z. This pipes tar's output through gzip as a
#      separate process, which is what you do when you want a compression level, or
#      when the tar you are using has no -z, or when the archive is being made on
#      one machine and compressed on another.
#   01 uses scp. This uses sftp in batch mode, which is the same protocol driven
#      from a script rather than from a command line - and `put -p` is the flag
#      that makes it preserve times and the low nine mode bits. It is enough here
#      because what moves is one 0644 archive; it would not be enough for the tree
#      inside it, because neither `put -p` nor `scp -p` carries setuid or setgid.
#      That is the reason the tree travels as an archive and tar does the unpacking.
#   01 uses -xpzf. This spells the same three flags out in full, because
#      --preserve-permissions is a name you can look up and -p is not.
#
# What is deliberately NOT here: sudo, any change to sshd or firewalld, any key
# work, and any write inside student's own ~/.ssh. See 01 for why each of those is
# the wrong instinct on this machine.
set -euo pipefail

# Compress as a separate stage. `--file -` writes the archive to standard output;
# gzip reads it and writes the compressed stream to the file. -9 asks for the
# smallest result, which is free to ask for here and is the reason to do it this
# way rather than with -z.
#
# `--directory /srv/reports .` archives the CONTENTS of the tree rather than the
# directory itself, so the stored names are ./README.txt, ./daily/... and so on.
# Nothing about that is worse than 01's layout; it just means the extraction has to
# be given somewhere to put them, which the next-but-one step does.
tar --create --file - --directory /srv/reports . | gzip -9 > "$HOME/reports.tar.gz"

# Read it back before sending it. `gzip --test` is gzip's own verdict on its own
# format: 0 if the stream is complete and readable, non-zero on a truncated file or
# on a payload that is not gzip at all. It is the cheapest possible check that the
# thing named .tar.gz really is one.
gzip --test "$HOME/reports.tar.gz"

# The batch file sftp will run. One command per line, and sftp aborts on the first
# failure of a put, so a batch that finishes has done everything in it. Writing the
# commands to a file rather than piping them in keeps this script's own standard
# input - which is how the script itself arrived - out of the picture entirely.
printf 'put -p %s /home/backupop/reports.tar.gz\n' "$HOME/reports.tar.gz" > "$HOME/handover.sftp"

# -b runs that file instead of reading commands from a terminal, which is what
# makes sftp usable from a script; -i names the key, which has to be named because
# backup-key is not a filename the client tries by itself. The transport underneath
# is the same ssh connection scp would have made.
timeout 25 sftp -b "$HOME/handover.sftp" -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost < /dev/null

# Unpack it as backupop, into a directory made for it, because this archive's
# members have no directory of their own. --preserve-permissions is what keeps
# ledger.csv group-writable and keeps the setgid bit on rotate-reports.sh; without
# it tar applies the umask and silently drops the setgid bit as well, and the result
# looks entirely normal.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'mkdir -p ~/reports && tar --extract --gunzip --preserve-permissions --file ~/reports.tar.gz --directory ~/reports' < /dev/null

# The comparison that answers the requirement, printed as numbers rather than as
# ls's letters so the two sides can be read side by side. %a is the mode including
# the setgid bit, %Y the modification time in seconds, %U the owner.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'stat -c "%a %Y %U %n" ~/reports ~/reports/README.txt ~/reports/ledger.csv ~/reports/rotate-reports.sh ~/reports/daily' < /dev/null
stat -c '%a %Y %U %n' /srv/reports /srv/reports/README.txt /srv/reports/ledger.csv /srv/reports/rotate-reports.sh /srv/reports/daily
