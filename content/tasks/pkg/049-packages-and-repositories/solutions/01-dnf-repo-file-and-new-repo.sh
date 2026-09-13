#!/usr/bin/env bash
# Route 1: one tool for all three sources. dnf installs from a configured
# repository, dnf installs a package FILE when you hand it a path, and the third
# package needs nothing but five lines of ini before the same command works on it
# too.
#
# Straight-line on purpose - no loop, no case, no if at the top level: rung 4
# builds the student-facing command sketch out of the sorted-first solution file,
# so the shape of this file is part of what a student is shown. The independent
# route, which installs the package file with rpm and never lets dnf near it,
# lives in 02.
#
# What is deliberately NOT here, and the omissions are the lesson:
#   - No `dnf update`, no `dnf upgrade`, no `dnf distro-sync`. The objective's
#     sentence contains the word "update" and this task's prompt forbids it, which
#     is not a contradiction: on a host held at one patch level with one disc to
#     read, an upgrade transaction is how you turn a working machine into a
#     half-upgraded one. The commands are the same ones; the judgement about when
#     to run them is the exam skill.
#   - No `--nogpgcheck` and no gpgcheck=0. If a package will not verify, the
#     answer is to import the key that signed it, not to stop asking.
#   - No `--enablerepo` when installing whois. The repository file below says
#     enabled=1, so it needs no help from the command line - and a candidate who
#     reaches for --enablerepo here will pass their own test and fail the
#     requirement, because the flag OVERRIDES enabled=0 and hides exactly the
#     mistake it is covering up.
#   - Nothing is removed and the existing rhcsa-dvd.repo is not edited at all.
#     The new repository goes in a new file, which is what /etc/yum.repos.d is a
#     directory for.
set -euo pipefail

# 1. tree, from the repository this host already has. Nothing to configure: the
#    BaseOS stanza in /etc/yum.repos.d/rhcsa-dvd.repo already points at the disc.
#
#    `< /dev/null` on every dnf command in this file, and it is not decoration:
#    the script arrives on ssh's standard input, so a dnf that stopped to ask
#    "Is this ok [y/N]:" would read its answer out of the rest of this file. -y
#    answers the question in advance and /dev/null makes sure there is nothing
#    else for dnf to swallow.
sudo dnf -y install tree < /dev/null

# 2. telnet, from the package file staged on this host. The path is what makes
#    this a local install: given something that looks like a file name rather
#    than a package name, dnf installs THAT file and resolves its dependencies
#    from the configured repositories - which is the reason to prefer it to `rpm
#    -i` for a package whose dependencies you have not checked.
#
#    The glob picks up whatever version was staged. If it matched nothing, dnf
#    would be handed the pattern itself and would stop with an error, which is
#    the behaviour to want here.
sudo dnf -y install /var/tmp/rhcsa-packages/telnet-*.rpm < /dev/null

# 3. The repository that does not exist yet. Five keys, and every one of them is
#    doing something:
#
#      [rhcsa-appstream]  the id. dnf's own name for the repository - what
#                         --enablerepo and `dnf repolist` say, and what appears in
#                         its output. Any unique word will do.
#      name=              the human label. Not optional in spirit: dnf falls back
#                         to the id when it is missing, and a repository list full
#                         of ids is a machine nobody wants to debug.
#      baseurl=           where the packages are. `file://` plus an absolute path
#                         is three slashes in total - file:// then /mnt - and this
#                         is the line an http:// repository would differ in and
#                         nothing else.
#      enabled=1          used by every dnf command without being asked for.
#                         Leaving the line out would mean the same thing (the
#                         default is enabled), but writing it says so on purpose.
#      gpgcheck=1         every package from here must carry a signature that
#                         verifies. RHEL 9 already sets this in /etc/dnf/dnf.conf
#                         for all repositories; repeating it here means the
#                         requirement survives someone editing that file.
#      gpgkey=            the key to verify against. The disc's key is already in
#                         this host's rpm database, so this line changes nothing
#                         today - it is here because a repository definition that
#                         names its own key works on a machine where nobody
#                         imported it first, and dnf offers to import it.
#
#    `tee` because the file belongs to root and this shell is student's: a plain
#    `sudo cat > file` redirects as student and is refused. A text editor under
#    sudo is just as correct and is what you would do at a keyboard.
sudo tee /etc/yum.repos.d/rhcsa-appstream.repo > /dev/null <<'EOF'
[rhcsa-appstream]
name=RHEL 9 AppStream from the attached DVD
baseurl=file:///mnt/rhcsa-dvd/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///mnt/rhcsa-dvd/RPM-GPG-KEY-redhat-release
EOF

# Created in place by tee, so it already carries the type the policy gives files
# in /etc/yum.repos.d - this prints nothing and is here as a habit. A repo file
# written somewhere else and moved in wears the label of where it came from, and
# dnf runs as root so it would still be read; on a machine with a stricter policy
# it is the difference between a repository and a mystery.
sudo restorecon -v /etc/yum.repos.d/rhcsa-appstream.repo

# The repository is listed and enabled. Worth running BEFORE the install: it
# loads the new repository's metadata, so a typo in the baseurl or a directory
# with no repodata in it shows up here as an error about this repository, instead
# of showing up in the next command as "No match for argument: whois".
sudo dnf repolist --enabled < /dev/null

# 4. whois, from the repository that now exists. No flags naming it: if this
#    works, the file above works, which is the whole point of writing it.
sudo dnf -y install whois < /dev/null

# The verdict, from the database that decides it. One command, four names -
# whois-nls came along as a dependency and is worth seeing, because it is the
# half of `dnf install` that `rpm -i` would have refused to do for you.
rpm -q tree telnet whois whois-nls

# What to look at if any of that had failed, in the order worth looking:
#   sudo dnf repolist --all                     is the repository there and on?
#   sudo dnf -q repoquery --repo rhcsa-appstream whois
#                                               can dnf see the package in it?
#   sudo ls /mnt/rhcsa-dvd/AppStream/repodata   is the baseurl really a repository?
#   rpm -qa 'gpg-pubkey*'                       is the signing key imported?
# "No match for argument" almost always means the first or the third; "Public key
# is not installed" means the fourth, and the answer to that one is `rpm --import`.
sudo dnf -q repoquery --repo rhcsa-appstream whois < /dev/null
