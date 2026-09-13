#!/usr/bin/env bash
# telnet's files are on the disk and /usr/bin/telnet runs. The package is not
# installed.
#
# A package file is an archive with a header on the front, and there are tools that
# will unpack the archive part straight into the filesystem. `rpm2archive - <
# file.rpm | tar -xzC /` does it in one line; `rpm2cpio file.rpm | cpio -idmv` is
# the older spelling of the same idea and works here too - cpio IS installed on a
# Minimal Install, not by name but because kernel-core requires dracut >= 027 and
# dracut requires cpio, so anything that boots has it. rpm2archive is used here
# because it is one tool rather than two and it is what rpm 4.16 ships for the
# purpose; the choice is style, not capability. The
# candidate who does this has usually met it as a rescue trick - pulling one
# missing library out of a package on a system too broken to run a transaction -
# and has not noticed that outside a rescue it skips everything an installation
# is.
#
# What was skipped: no row in the rpm database, so `rpm -q telnet` says "not
# installed", `rpm -V` can never check these files, dnf will not upgrade them and
# will happily install the real package over the top of them later; no dependency
# check; and no SELinux labelling, because the files arrive as whatever tar decided
# rather than as what the policy says that path should be. Scriptlets were skipped
# too, though not visibly here: `rpm -qp --scripts` on telnet-0.17-85.el9 prints
# nothing, so this package has none to skip. That is luck, not a property of the
# method - it is why the trick appears to work on the package the prompt happens to
# stage, and why a candidate who generalises from it gets bitten by the next one.
#
# Everything else in this fixture is right, including the repository, which is why
# there is exactly one red line - and it is the line that says what "installed"
# means on this operating system.
# expect-fail: telnet-installed
set -euo pipefail

sudo dnf -y install tree < /dev/null

sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF

sudo dnf -y install whois < /dev/null

# The mistake. rpm2archive turns the package into a gzipped tar stream on standard
# output; tar unpacks it at / as root. `rpm -qpl` on telnet-0.17-85.el9 lists seven
# paths and only four of them are files: /usr/bin/telnet, its manual page,
# /usr/share/doc/telnet/README and a /usr/lib/.build-id symlink, the other three
# being the directories those sit in. It overwrites nothing another package owns,
# so nothing here breaks. That is precisely why the mistake is easy to keep.
staged=$(ls /var/tmp/rhcsa-packages/telnet-*.rpm)
rpm2archive - < "$staged" | sudo tar -xzC /

# The candidate's proof, and it is real as far as it goes: the program is there and
# it runs. `command -v` and a version string are what a human checks, and neither
# of them has ever consulted the rpm database.
command -v telnet
ls -l /usr/bin/telnet

# The question nobody asked, whose answer is "package telnet is not installed".
# `|| true` because this fixture is meant to finish, not to stop here.
rpm -q telnet || true

# And the label to compare with a real install's, on a machine where it would have
# mattered: a file unpacked by tar into / is not labelled by the policy for that
# path unless something restores it.
ls -Z /usr/bin/telnet
