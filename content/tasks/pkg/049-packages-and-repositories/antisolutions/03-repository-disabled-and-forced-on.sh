#!/usr/bin/env bash
# The repository file says enabled=0, and the install works anyway because the
# command line turned it on. So the candidate's own evidence says "done".
#
# This is the mistake the third requirement's wording exists to catch - "enabled
# in its own configuration, not merely for the length of one command" - and it is
# not a silly one. `--enablerepo` OVERRIDES enabled=0, so every check the
# candidate is likely to run is a check with the flag still on it, and every one
# of them passes. Tomorrow's `dnf install` without the flag says "No match for
# argument", and the repository that was tested and working is invisible.
#
# The habit behind it is a real and sometimes correct one: a repository kept off
# and enabled per command is how you stop a third-party repository from silently
# replacing your distribution's packages. It is the wrong shape for a repository
# that is meant to be this host's source of software, and the requirement said so.
#
# Both repository checkpoints go red, and the second one for a reason worth
# following: gpgcheck=1 is right there in the file, but nothing was asked about
# the signature checking of a repository that is not on. There is no repository to
# ask about.
# expect-fail: appstream-repo-defined, appstream-repo-gpgcheck
set -euo pipefail

sudo dnf -y install tree < /dev/null
sudo dnf -y install /var/tmp/rhcsa-packages/telnet-*.rpm < /dev/null

sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=0
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF

# Works. Installs whois, resolves whois-nls, verifies the signature, exits 0 - and
# proves nothing about the file above, because the flag is what enabled the
# repository. `--repo rhcsa-appstream` and `--repofrompath` would have hidden it
# just as well.
sudo dnf -y --enablerepo=rhcsa-appstream install whois < /dev/null

# The check that would have caught it, and the candidate does run it - with the
# flag still attached, because that is how they just installed the package. With
# the flag the repository is listed as enabled. Without it, it is not listed at
# all: `sudo dnf repolist --enabled` on its own is the command that tells the
# truth here, and `sudo dnf repolist --all` shows it sitting there disabled.
sudo dnf repolist --enabled --enablerepo=rhcsa-appstream < /dev/null
rpm -q tree telnet whois
