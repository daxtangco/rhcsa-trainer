#!/usr/bin/env bash
# Everything installed, everything working, and then the candidate tidied up: they
# moved their new stanza into the file that was already there, with one > instead
# of two, and took the disc's BaseOS repository out of the machine.
#
# The tidying instinct is good and the shell is unforgiving about it. `>` truncates
# and `>>` appends, and the difference is invisible until something asks for a
# package that used to be available. Nothing complains at the time: the AppStream
# repository in the rewritten file works perfectly, `dnf repolist --enabled` lists
# a repository, and the three packages that are already installed stay installed.
# The next `dnf install` for anything in BaseOS - the next task, the next
# question, the next person - says "No match for argument".
#
# It is also the one thing the prompt spelled out as a rule rather than a
# requirement: "Adding a repository means adding one, not replacing what is already
# configured."
#
# Only the invariant goes red. That is the point of an invariant: the work was
# done and the machine is worse than it was.
# expect-fail: baseos-repo-intact
set -euo pipefail

sudo dnf -y install tree < /dev/null
sudo dnf -y install /var/tmp/rhcsa-packages/telnet-*.rpm < /dev/null

# The right answer, in its own file, exactly as the task asked.
sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF

sudo dnf -y install whois < /dev/null

# The tidying. "Two files for one disc is untidy - put them together." The
# together-file is written with a single >, so what was in it is gone: the
# [rhcsa-baseos] stanza, the only definition on this host that pointed at
# /mnt/rhcsa-dvd/BaseOS.
sudo tee /etc/yum.repos.d/rhcsa-dvd.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF
sudo rm -f /etc/yum.repos.d/rhcsa-appstream.repo

# The check that passes, and it is the reason this survives review: a repository is
# listed, it is enabled, and the three packages are installed. Nothing in this
# output mentions the repository that used to be there.
sudo dnf repolist --enabled < /dev/null
rpm -q tree telnet whois

# The command that would have shown it, if anyone had thought to ask: tree is
# installed, so try something else from BaseOS. `dnf -q repoquery dos2unix` on a
# host with the BaseOS repository configured prints its name; here it prints
# nothing.
sudo dnf -q repoquery dos2unix < /dev/null || true
