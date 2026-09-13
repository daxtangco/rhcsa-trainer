#!/usr/bin/env bash
# "It said get the reporting data to the backup operator over SSH. Done."
#
# And in one sense it is: the operator has every file, in the right directory, with
# the right contents, owned by the right account, and it went over SSH. A candidate
# who read the requirements as a description of an outcome rather than as a list
# lands here, and so does one who ran out of time and did the part they were sure
# of. It is the single most common shape of wrong answer to any task whose
# requirements are cumulative.
#
# What is missing is everything the archive was for:
#
#   There is no archive. Not a wrongly-named one, not a broken one - none. Three
#     checkpoints go red together and they are one mistake, not three, which is
#     what their details say. An archive is a single file: it can be checksummed,
#     it can be signed, it can be dropped on tape, and it can be handed to a
#     restore procedure that expects one thing to exist. A directory tree is none
#     of those, and "compressed" is not a property a directory has.
#   The permissions did not survive. `scp -r` without -p creates each file fresh
#     and lets the umask decide, so ledger.csv 0660 arrives 0640 under this guest's
#     umask 022 - and the setgid bit on rotate-reports.sh is gone, because a
#     freshly created file has no setgid bit to begin with. The man page is explicit
#     about which flag does this: "-p Preserves modification times, access times,
#     and file mode bits from the source file."
#     Adding it is not enough, and that is the sharper half of this lesson: measured
#     against the shipped sftp-server, `scp -pr` brings back the timestamps and the
#     low nine mode bits - 0660 arrives 0660 - but still lands rotate-reports.sh as
#     0750, because the attributes an SFTP transfer carries stop at nine bits and
#     setuid/setgid are not among them. Graded, `scp -pr` recovers exactly one of
#     these five checkpoints - the timestamps - and still fails
#     unpacked-mode-preserved on that one bit, with the three archive checkpoints
#     red regardless. There is no flag spelling of "copy this tree faithfully";
#     there is an archive.
#   The modification times did not survive either, for exactly the same reason and
#     from exactly the same missing flag. Every file in the operator's copy is
#     stamped with the moment the copy ran, so the dates that said which export was
#     which are gone. This is the checkpoint that most cleanly separates "copied"
#     from "unpacked from an archive": tar restores timestamps without being asked
#     and a plain recursive copy never does.
#
# Note what is NOT wrong, because the contrast is the lesson. The tree is present
# and complete, it is owned by backupop, and the transfer genuinely happened over
# SSH. This candidate did not fail to work; they solved a different problem.
#
#   All five are wrong from the moment the copy runs and stay wrong: no phase.
# expect-fail: archive-present, archive-is-gzip, archive-holds-tree, unpacked-mode-preserved, unpacked-mtime-preserved
set -euo pipefail

# The whole answer, in one command. -r for the subdirectory, and nothing else,
# because nothing else seemed to be needed. The trailing slash on the destination
# means "into that directory", so the tree lands at /home/backupop/reports.
timeout 25 scp -r -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /srv/reports backupop@localhost:/home/backupop/ < /dev/null

# The check the candidate ran, which is why they stopped. Every file is there.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'ls -R ~/reports' < /dev/null

# Where the answer actually is, and both halves of it are visible here. The
# operator's home holds a directory and no archive at all, and the numbers do not
# match the source. `%a` is the mode, `%y` the modification time.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'ls -la ~; stat -c "%a %y %n" ~/reports/ledger.csv ~/reports/rotate-reports.sh' < /dev/null
stat -c '%a %y %n' /srv/reports/ledger.csv /srv/reports/rotate-reports.sh
