#!/usr/bin/env bash
# The reflex. The archive has to be unpacked inside a directory that is mode 0700
# and belongs to somebody else, student cannot write there, so - sudo. It works
# immediately, which is the problem: root can write into any directory on the
# system, so there is no error, no permission denied, and no hint that anything is
# off. The tree appears exactly where the requirement said it should.
#
# And the operator owns none of it. Measured behaviour of tar 1.34 run as root:
# restoring ownership from the archive is the SUPERUSER's default (--same-owner is
# what an ordinary user has to ask for and never gets), so every file in
# /home/backupop/reports comes out owned by student, the account the files belonged
# to under /srv/reports. backupop cannot chmod them, cannot rotate them, cannot
# delete them, and cannot write to the ledger its own group bit was set for. The
# handover produced a directory the operator can read and nothing else.
#
# The correct instinct is the opposite one and it is the reason the task hands over
# a key rather than a password: the account that should own the result is the
# account that should do the extraction. Logging in as backupop and unpacking there
# needs no privilege at all, gets the ownership right for free, and gets it right
# for every file in the tree rather than for the ones somebody remembered to chown.
#
# The two neighbours of this mistake, both worth knowing and neither of them a
# repair:
#
#   `sudo chown -R backupop /home/backupop/reports` afterwards. It would pass this
#     checkpoint, and it is a second privileged command papering over the first. It
#     also silently loses the distinction on any tree where more than one account
#     legitimately owns files - which is the case where you most needed the archive
#     to carry ownership.
#   `sudo chown backupop /home/backupop/reports`, the top directory alone. This is
#     the one candidates actually do, and it is why the checkpoint walks the whole
#     tree instead of stat-ing one path: the directory then belongs to backupop and
#     every file inside it still belongs to student.
#
#   Wrong from the moment the extraction runs, and a reboot does not chown
#   anything: no phase. The modes and the timestamps are all correct here - root
#   with -p preserves both - so exactly one line is red and it says exactly what
#   went wrong.
# expect-fail: unpacked-owned-by-backupop
set -euo pipefail

# The correct half. The archive is right and the transfer is right; note that the
# transfer is done properly over SSH with the key, so this fixture is not about the
# transport.
tar -czf "$HOME/reports.tar.gz" -C /srv reports
timeout 25 scp -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOME/reports.tar.gz" backupop@localhost:/home/backupop/reports.tar.gz < /dev/null

# And the one decision that ruins it. -p is here, -C puts the tree in the right
# place, the command succeeds, and the result belongs to the wrong account.
sudo tar -xpzf /home/backupop/reports.tar.gz -C /home/backupop

# What the candidate looked at. `ls -d` on the directory says 0755 and the name is
# right; nothing in this output is wrong.
sudo ls -ld /home/backupop/reports

# Where the answer actually is, and it is one column further right than anybody
# looks. Every file in the operator's copy belongs to student.
sudo ls -l /home/backupop/reports
sudo find /home/backupop/reports \! -user backupop -printf '%u %P\n'
