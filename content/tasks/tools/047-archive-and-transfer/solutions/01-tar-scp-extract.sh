#!/usr/bin/env bash
# Route 1: build the archive, carry it with scp, unpack it over ssh. Three
# commands, one per requirement, in the order the requirements are written.
#
# Straight-line on purpose - no loop, no case, no function, no if at the top
# level: rung 4 builds the student-facing command sketch out of the sorted-first
# solution file, so the shape of this file is part of what a student is shown. The
# independent route - a different archive layout, a separate compressor, sftp
# instead of scp, and tar's long option names - lives in 02.
#
# That is also why the three connections below are NOT wrapped in `timeout 25` the
# way every other fixture in this task wraps them: the sketch takes the first word
# of each line, so a wrapper here would show a student `timeout` and hide `scp` and
# `ssh`, which are the two commands the task is about. The wrapper's job is done
# instead by the two options every connection carries - BatchMode=yes, so a client
# that would have asked for a password exits non-zero rather than waiting for an
# answer that cannot come, and ConnectTimeout=10, so an unreachable host fails in
# ten seconds instead of the kernel's default minutes. Neither can prompt.
#
# What is deliberately NOT here, and the omissions are the lesson:
#   - No sudo anywhere. /srv/reports is student's to read and /home/backupop is
#     backupop's to write, and the login below is what makes the second one true.
#     A `sudo tar -xpzf` into backupop's home would put the whole tree there owned
#     by root, which looks finished and hands the operator files it cannot manage.
#     That is anti-solution 04.
#   - No change to sshd, to firewalld, or to any key. The task states the key is
#     already installed; there is nothing to configure, only something to use.
#   - Nothing written to or read from student's own ~/.ssh. The key is at
#     /home/student/backup-key, and every connection below passes
#     UserKnownHostsFile=/dev/null so that not even a host-key entry is left
#     behind in a directory this machine is graded through.
set -euo pipefail

# Build it in student's own home, where student can certainly write. `-C /srv`
# with `reports` as the member means the archive stores paths beginning
# `reports/`, so unpacking it in backupop's home creates ~/reports without
# anything else being said. That is the whole reason for -C: `tar -czf x
# /srv/reports` would work too, but GNU tar strips the leading slash and the
# archive then carries `srv/reports/...`, which unpacks to ~/srv/reports instead.
#
# -z is gzip, which is the required format. -c creates, -f names the file.
tar -czf "$HOME/reports.tar.gz" -C /srv reports

# Sanity-check it before sending it. `tar -tzf` lists the members without
# extracting anything, and `-z` insists the payload really is gzip: on the wrong
# compressor this exits 2 and says so, which is a great deal cheaper to discover
# here than after the handover.
tar -tzf "$HOME/reports.tar.gz"

# Carry it. scp uses the SFTP protocol over an ssh connection - the same
# authentication, the same port, the same key - so this is a genuine transfer to
# another account and would be spelled identically for another host. -i names the
# key, and it has to be named: backup-key is not one of the filenames an ssh
# client tries on its own.
#
# `< /dev/null` because this script arrives on ssh's standard input, and a client
# that inherited it could read the rest of this file.
scp -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOME/reports.tar.gz" backupop@localhost:/home/backupop/reports.tar.gz < /dev/null

# Unpack it AS backupop, so every extracted file belongs to backupop without a
# single chown. -x extracts, -z reads gzip, -f names the archive, and -p is the
# one that matters: without it tar applies the shell's umask to every file it
# creates and drops the setgid bit from rotate-reports.sh whatever the umask is.
# The tree still looks perfect in `ls -l`.
#
# -n on ssh for the stdin reason above; the remote command runs in backupop's home
# directory, which is where the `reports/` prefix inside the archive lands.
ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'tar -xpzf ~/reports.tar.gz' < /dev/null

# And confirm what arrived, from backupop's side. This is the comparison the
# requirement is really about: `ls -l` on its own says nothing, because a tree
# that lost its permission bits looks entirely normal until it is put next to the
# original. ledger.csv should read rw-rw---- and rotate-reports.sh rwxr-s---.
ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'ls -l ~/reports ~/reports/daily' < /dev/null
ls -l /srv/reports
