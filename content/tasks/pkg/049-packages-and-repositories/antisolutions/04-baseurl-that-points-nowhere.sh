#!/usr/bin/env bash
# Three packages installed, and a repository file whose baseurl names a directory
# that does not exist. One letter: Appstream, not AppStream.
#
# It gets away with it because the candidate never used the repository. whois's
# package files are on the disc and `dnf install` takes a path, so both were named
# by hand, dependencies and all - a perfectly good local install, and the one the
# second requirement asked for in a different context. The repository file was
# written afterwards, from memory, to satisfy the third requirement on paper, and
# nothing tested it.
#
# Two things worth noticing about the machine this leaves behind. Paths on Linux
# are case-sensitive, so /mnt/rhcsa-dvd/Appstream is not a typo dnf can forgive.
# And `skip_if_unavailable` defaults to False, which means this one bad stanza
# makes EVERY subsequent dnf command on this host fail, not just commands that
# name this repository - the next person to run `dnf install anything` gets
# "Failed to download metadata for repo 'rhcsa-appstream'" and has to work out
# which of the files under /etc/yum.repos.d is lying. It is also why this task's
# grader runs no dnf at all: it reads the configuration and the rpm database, both
# of which still answer on a host in this state.
#
# The installs come first and the broken file last, deliberately: written the
# other way round the script could not have installed anything.
# expect-fail: appstream-repo-defined, appstream-repo-gpgcheck
set -euo pipefail

sudo dnf -y install tree < /dev/null
sudo dnf -y install /var/tmp/rhcsa-packages/telnet-*.rpm < /dev/null

# whois and whois-nls, by path, straight off the disc. Unquoted on purpose - the
# two file names have to reach dnf as two arguments. dnf resolves what is left
# (libidn2, alternatives) from the BaseOS repository, which is the difference
# between this and `rpm -i`, and the reason this leg genuinely works.
sudo dnf -y install $(sudo find /mnt/rhcsa-dvd/AppStream -type f -name 'whois-*.rpm') < /dev/null

# The paperwork. Never read by anything, and wrong.
sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/Appstream
enabled=1
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF

# All three names present, which is the evidence the candidate stops at.
rpm -q tree telnet whois
