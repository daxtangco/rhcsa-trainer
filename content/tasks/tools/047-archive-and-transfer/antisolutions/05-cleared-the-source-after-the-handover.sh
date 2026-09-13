#!/usr/bin/env bash
# The tidy-up. The handover is complete and correct - a real gzip archive of the
# whole tree, carried over SSH, unpacked in the operator's home with its
# permissions and timestamps intact and owned by the operator. Then the candidate
# reads "hand the reporting data over" as a transfer of custody, decides that
# keeping a second copy under /srv is exactly the sort of stale duplicate that
# fills a filesystem, and clears it out.
#
# It is a professional instinct applied to the wrong sentence. The requirements said
# to leave /srv/reports alone, in as many words, and the reason is the one that
# always applies: the only verification anybody can do of a copy is to compare it
# with the original, and this candidate has just destroyed the only thing that could
# have told them whether the copy was any good. Had the extraction dropped the
# setgid bit, nothing on this machine could now prove it.
#
# Which is also why the grader compares the operator's copy against fixed expected
# values rather than against the live source tree: a grader that compared the two
# directories would call this correct, and would also call it correct if a candidate
# had chmod-ed /srv/reports down to match a bad extraction - the neighbouring
# mistake, and the more destructive of the two, because it silently changes
# production data to make a check pass.
#
# What this is NOT, and it is worth saying because the two are easy to confuse:
# `mv` would be a clearer version of the same mistake, and `tar --remove-files`
# would be a version so quiet that most people do not know the option exists. All
# three end in the same place - an original that is gone - and the requirement
# treats them identically.
#
#   Wrong from the moment the files are removed, and a reboot does not bring them
#   back: no phase. Everything else here is correct on purpose, so a single red line
#   points at a single sentence in the requirements.
# expect-fail: source-tree-intact
set -euo pipefail

# The handover, done entirely correctly.
tar -czf "$HOME/reports.tar.gz" -C /srv reports
timeout 25 scp -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOME/reports.tar.gz" backupop@localhost:/home/backupop/reports.tar.gz < /dev/null
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'tar -xpzf ~/reports.tar.gz' < /dev/null

# The confirmation that made the candidate confident enough to delete. It is a good
# check, and it is not a comparison: it proves the files arrived, not that they
# arrived unchanged.
timeout 25 ssh -n -i /home/student/backup-key -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null backupop@localhost 'ls -lR ~/reports' < /dev/null

# And the tidy-up. Named paths rather than a glob, because this candidate is
# careful - which is exactly the point: care about HOW you delete is no substitute
# for asking WHETHER to.
rm -rf /srv/reports/daily
rm -f /srv/reports/README.txt /srv/reports/ledger.csv /srv/reports/rotate-reports.sh

# Where the answer actually is. An empty source directory, and no way left to
# verify the copy that replaced it.
ls -la /srv/reports
