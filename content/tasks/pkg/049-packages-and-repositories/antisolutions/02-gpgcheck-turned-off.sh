#!/usr/bin/env bash
# All three packages installed, and the repository's signature checking switched
# off to get there.
#
# gpgcheck=0 is the most-copied line on the internet and the reason is
# sympathetic: something complained about a key, the deadline was closer than the
# curiosity, and 0 made the complaint stop. It is also the line that turns a
# repository into a directory anyone who can write to it can put a package in. On
# this host the disc's key was imported before the candidate logged in, so the
# 1 they did not write would have worked first time and cost nothing.
#
# Nothing else is wrong: tree from BaseOS, telnet from the staged file, whois
# from the new repository, which is enabled and points at exactly the right
# directory. It installs, it works, and it is the answer a reviewer would send
# back.
# expect-fail: appstream-repo-gpgcheck
set -euo pipefail

sudo dnf -y install tree < /dev/null
sudo dnf -y install /var/tmp/rhcsa-packages/telnet-*.rpm < /dev/null

# One character wrong. Note that this is not a case of forgetting the line: RHEL 9
# ships /etc/dnf/dnf.conf with gpgcheck=1 in its [main] section, so a repository
# file with NO gpgcheck line at all inherits signature checking and is correct.
# It takes a deliberate 0 here to switch it off, and that per-repository 0 beats
# the [main] 1.
sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=1
gpgcheck=0
EOF

sudo dnf -y install whois < /dev/null

# Green from every angle the candidate looks at it: the repository is listed, the
# packages are installed, and nothing anywhere says "this host now installs
# unsigned packages from that directory".
sudo dnf repolist --enabled < /dev/null
rpm -q tree telnet whois
