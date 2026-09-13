#!/usr/bin/env bash
# Route 2: the same three packages, reached by naming the source explicitly at
# every step. tree is installed from one repository and one repository only, the
# staged package file is installed by rpm itself with its signature checked by
# hand first, and the new repository is written with the other spellings
# dnf.conf(5) accepts, to show that `enabled=1` is a convention and not a
# grammar.
#
# Genuinely independent of route 1, not a reworded copy: the package file is
# installed by rpm, which resolves no dependencies and imports nothing, so this
# route only works because the checks below prove in advance that it can. That is
# the trade dnf hides - and the reason `dnf install ./file.rpm` is the better
# habit is easier to see once you have done it the other way.
#
# What is deliberately NOT here:
#   - No `rpm -i` for whois. Its package file is on the disc and rpm could
#     install it, but it needs whois-nls, libidn2 and /usr/sbin/update-alternatives,
#     and hunting a dependency tree by hand is what a repository exists to stop
#     you doing. The requirement was a repository anyway.
#   - No `--nodeps` and no `--force`, at all, ever. They are how a working rpm
#     database is turned into a lie: the package is recorded as installed, the
#     thing it needed is not there, and nothing tells you until the program runs.
#   - No removal, no update, no upgrade. See route 1.
set -euo pipefail

# 1. tree, from the disc's BaseOS repository and from nothing else. `--disablerepo
#    '*'` first, then `--enablerepo` for the one wanted: the pair is the idiom for
#    "install exactly from here", and on a machine with several repositories it is
#    how you keep a package from arriving out of the wrong one.
#
#    Both flags name the repository by its ID - the word in square brackets in
#    /etc/yum.repos.d/rhcsa-dvd.repo - not by its name= label. `sudo dnf repolist`
#    prints the ids in its first column, which is what that column is for.
#
#    Note what this does NOT prove: --enablerepo would have turned the repository
#    on even if its file said enabled=0, so a successful install here says the
#    packages are reachable, not that the configuration is right. `dnf repolist
#    --enabled`, with no flags overriding anything, is the command that answers
#    the second question.
sudo dnf -y --disablerepo='*' --enablerepo=rhcsa-baseos install tree < /dev/null

# 2. telnet, by rpm, from the staged file.
#
# First: is the file what it says it is? `rpmkeys --checksig` verifies the
# package's digests and its signature against the keys in the rpm database, and
# it is worth knowing because `dnf install ./some.rpm` does NOT do this by
# default - localpkg_gpgcheck is off unless it is turned on - and neither does
# `rpm -i`, beyond checking the digests. On a file that came from a disc it is a
# formality; on a file that arrived by other means it is the whole question.
staged=$(ls /var/tmp/rhcsa-packages/telnet-*.rpm)
rpmkeys --checksig "$staged"

# What is in it, before installing it: name, version, and the fact that it really
# is telnet and not telnet-server. `-p` is "this is a package file, not an
# installed package name", and every -q switch works with it.
rpm -qp --qf 'about to install: %{name}-%{version}-%{release}.%{arch}\n' "$staged"

# Would it install? `--test` does the checks without the installing - rpm(8): "Do
# not install the package, simply check for and report potential conflicts" - so a
# missing dependency or a file another package owns is reported here with nothing
# changed. It is a dry run of the CHECKS and not of the transaction: no scriptlet
# runs, so a package whose %pre is what fails still passes --test. telnet needs
# only the C library and libtinfo, both of which are on any machine that has a
# shell, so this passes - but on the exam the answer to "rpm says failed
# dependencies" is to install the dependency or use dnf, never --nodeps.
sudo rpm -Uvh --test "$staged"

# -U rather than -i: upgrade-or-install. It does the same thing as -i on a
# package that is absent and the right thing on one that is not, which makes it
# the safer habit. -v -h are the progress lines; they are why anyone types -Uvh
# as one word.
sudo rpm -Uvh "$staged"

# 3. The repository, written with the other legal spellings. dnf.conf(5) lists
#    the accepted booleans as 1, 0, True, False, yes and no, so `enabled=yes` and
#    `gpgcheck=yes` mean exactly what route 1's 1s mean. Worth having seen once:
#    real .repo files in the wild use all of them, and a candidate who thinks only
#    `1` counts will misread one.
#
#    printf rather than a heredoc, and a second file rather than an edit to
#    rhcsa-dvd.repo. One repository per file, named after the repository, is the
#    convention /etc/yum.repos.d exists to support - and it means this definition
#    can be deleted later without touching the one the host arrived with.
#
#    The key line is the same as route 1's. A repository with gpgcheck on and no
#    gpgkey works only where the key is already imported; naming the key file
#    makes the definition portable to a machine where it is not.
printf '%s\n' \
  '[dvd-appstream]' \
  'name=AppStream directory of the RHEL 9 DVD at /mnt/rhcsa-dvd' \
  'baseurl=file:///mnt/rhcsa-dvd/AppStream' \
  'enabled=yes' \
  'gpgcheck=yes' \
  'gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release' |
  sudo tee /etc/yum.repos.d/dvd-appstream.repo > /dev/null

sudo restorecon -v /etc/yum.repos.d/dvd-appstream.repo

# Enabled according to the FILE, with no flag on this command line propping it
# up. This is the check that distinguishes a repository that is configured from
# one that a --enablerepo made work once.
sudo dnf repolist --enabled < /dev/null

# 4. whois, from it. Named as a package, so dnf chooses the repository - and the
#    only repository that has it is the one written above.
sudo dnf -y install whois < /dev/null

# The verdict, and where dnf thinks each one came from. `%{from_repo}` is dnf's
# own record and it only covers what dnf itself installed: tree and whois name
# their repository, and telnet's origin comes out EMPTY here, because rpm put it
# there and rpm keeps no such record. That empty field is the point - it is why
# this task's grader asks `rpm -q` whether telnet is installed and does not try to
# prove where it came from.
rpm -q tree telnet whois whois-nls
sudo dnf -q repoquery --installed --qf '%{name} came from %{from_repo}' tree telnet whois < /dev/null
