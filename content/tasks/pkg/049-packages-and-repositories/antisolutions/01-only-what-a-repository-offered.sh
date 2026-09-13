#!/usr/bin/env bash
# Two of the three packages, because the second one was tried by name, was not
# there, and was never come back to.
#
# The most likely way to lose a mark on this objective and the least dramatic.
# `dnf install telnet` on this host says "No match for argument: telnet" - one
# line, no error dialogue, no failed transaction - and a candidate working down a
# list reads that as "not on the disc" and moves to the next requirement. The
# package file was in /var/tmp/rhcsa-packages the whole time. "From the local file
# system" is a third of the objective's own sentence, and it is the third that
# has no command a repository can be asked for.
#
# Everything else here is right, deliberately: tree comes from BaseOS, the new
# repository is correct in every setting, whois is installed from it. One red line.
# expect-fail: telnet-installed
#
# `-e` is off in this fixture alone: the point of it is a dnf command that fails,
# and the script has to survive it to leave the rest of the machine correct.
set -uo pipefail

sudo dnf -y install tree < /dev/null

# The attempt, in the order a candidate makes it - BEFORE the AppStream
# repository exists, which is why it fails. (After that repository is defined
# telnet would come straight out of it, since the disc's AppStream directory is
# where its package file lives. That is not a trap: it is why this task's grader
# does not try to prove which source telnet arrived from.)
sudo dnf -y install telnet < /dev/null || echo 'no match for telnet - moving on'

sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF

sudo dnf -y install whois < /dev/null

# The candidate's own check, and it is the reason the mistake survives: two of the
# three names come back, and the list looks like progress rather than a gap.
rpm -q tree whois
