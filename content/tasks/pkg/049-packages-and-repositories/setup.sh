#!/usr/bin/env bash
# Prepare the system for pkg/049-packages-and-repositories.
#
# Builds the machine the prompt describes, which is this guest with one thing
# taken away and one thing added:
#
#   - taken away: the [rhcsa-appstream] stanza scripts/guest-provision.sh:135
#     writes into /etc/yum.repos.d/rhcsa-dvd.repo. Without it the DVD's AppStream
#     directory is a directory full of packages that nothing on this host can
#     install from, which is what gives "define a repository" something to be
#     FOR. With it, the third requirement would be a five-line file with no
#     consequence, and a candidate could pass whois-installed without writing it.
#   - added: one package file, telnet's, copied off the disc into
#     /var/tmp/rhcsa-packages. That is the "from the local file system" half of
#     the objective, and a staged file is the only honest way to have it on a
#     guest with no network.
#
# It also removes tree, telnet and whois if they are installed (and whois-nls
# with them where nothing else requires it), so every goal checkpoint starts red,
# and PROVES all of it before exiting.
#
# Runs as student over ssh stdin: passwordless sudo, no TTY, no login shell.
#
# SAFETY. Nothing here touches sshd, tcp/22, the NIC, /home or
# /home/student/.ssh; nothing here stops, disables or restarts any unit; nothing
# here powers the guest off. It runs no `dnf update`, no `dnf upgrade`, no `dnf
# distro-sync` and no `dnf remove` - the removal below is `rpm -e`, which never
# cascades: rpm refuses rather than pulling anything else out with it.
#
# The removal set, measured against RHEL 9 BaseOS and AppStream with `dnf
# repoquery --whatrequires` (rhel-9.8, dnf 4.14.0):
#
#   tree     - no reverse dependencies at all. BaseOS.
#   telnet   - no reverse dependencies at all. AppStream. (telnet-server is a
#              separate package and is not touched.)
#   whois    - no reverse dependencies at all. AppStream.
#   whois-nls - NOT dependency-free: `mkpasswd` requires `whois-nls = <exact
#              version>` as well as whois does. mkpasswd is in AppStream, is in
#              no group a Minimal Install pulls in, and nothing
#              scripts/guest-provision.sh installs requires it - so on the guest
#              this bank builds it is absent and whois-nls comes out cleanly.
#              But it is not guaranteed absent, so removing whois-nls is
#              BEST-EFFORT below rather than required: no checkpoint grades it,
#              and a guest where mkpasswd is installed must not be a guest where
#              every fixture of this task aborts in setup.
#
# None of the four is in the `Core` group - `dnf group info core` lists 48
# Mandatory packages and none of them is tree, telnet, whois or whois-nls - so
# removing them at baseline is meaningful and takes nothing structural with it.
#
# `dnf repoquery --requires --resolve --recursive` on all three closures contains
# no openssh, no NetworkManager, no firewalld, no systemd and no kernel. glibc,
# bash and ncurses-libs are in there, but only as requirements this guest already
# satisfies at the disc's own version, so no install a solution performs can turn
# into an upgrade of one. The packages a solution's `dnf install` can genuinely
# ADD are whois's: whois-nls, libidn2, libunistring and alternatives, all four in
# the disc's BaseOS or AppStream and all four leaves.
#
# IDEMPOTENT, and it has to be: the harness reverts the `clean` snapshot before
# every fixture, but a human studying in the Lab screen re-runs setup by hand on
# a machine they have already been changing. Removing a stanza that is already
# gone, removing a package that is already absent and re-staging a file are all
# repeatable, and the staging directory is rebuilt from scratch rather than added
# to, so a second run cannot leave two package files where the prompt promises
# one.
#
# `set -uo pipefail` without -e, following net/045 and files/036: this file is
# full of commands that legitimately fail on a re-run (there is no package to
# remove, no stanza to delete). The commands that MUST work are wrapped in
# `need`, because a silent failure here stages the wrong machine and every
# checkpoint result afterwards is a lie.
set -uo pipefail

fail() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }
need() { "$@" || fail "FAILED: $*"; }

# Spelled identically in grade.sh and in every fixture. If these ever disagree
# the task becomes unsatisfiable for every answer.
DVD=/mnt/rhcsa-dvd
DVD_BASEOS=$DVD/BaseOS
DVD_APPSTREAM=$DVD/AppStream
DNF_CONF=/etc/dnf/dnf.conf
REPO_DIR=/etc/yum.repos.d
REPO_FILE=$REPO_DIR/rhcsa-dvd.repo
KEY_FILE=$DVD/RPM-GPG-KEY-redhat-release
STAGE_DIR=/var/tmp/rhcsa-packages

REPO_PKG=tree
FILE_PKG=telnet
NEW_REPO_PKG=whois
# whois requires it at an exact version, so `rpm -e whois-nls` on its own is
# refused and the two have to be named in one call. Taken away too, so that a
# solver's `dnf install whois` really does resolve a dependency - which is half of
# what that leg demonstrates - but BEST-EFFORT, not required: see the SAFETY note
# and the two-pass removal below.
NEW_REPO_PKG_DEP=whois-nls

# The id of the section provision.sh writes for the AppStream directory. Removed
# below, by name: a stanza-aware delete rather than a line-based one, because
# `sed -i '/AppStream/d'` would leave the header behind and turn the file into
# something dnf reads as a repository with no baseurl.
APPSTREAM_SECTION=rhcsa-appstream
BASEOS_SECTION=rhcsa-baseos

# Red Hat's release key, as rpm names it once imported: gpg-pubkey-<keyid>-<time>.
# `rpm -qa 'gpg-pubkey*'` on a RHEL 9 host with the disc's key imported lists
# gpg-pubkey-fd431d51-4ae0493b, "Red Hat, Inc. (release key 2)", which is the key
# every package on the DVD is signed with.
RELEASE_KEY_ID=fd431d51

ARCH=$(uname -m)
[[ -n $ARCH ]] || fail "uname -m printed nothing, so the package files on the disc cannot be found by name"

# --- tooling every checkpoint depends on ----------------------------------
# Convention for every task in this bank: verify every precondition the goal
# checkpoints depend on, not only the ones this script needs to run. A
# precondition that only guards the script leaves the checkpoints free to pass or
# fail for reasons that have nothing to do with the student.
for tool in rpm rpmkeys dnf awk find findmnt timeout install mktemp; do
  command -v "$tool" >/dev/null \
    || fail "$tool is missing, and every checkpoint in this task is decided either by the rpm database or by the text of a repository file; see docs/vm-build-checklist.md"
done
# rpm2archive is not used by this task's solutions - it is what
# antisolutions/05 extracts a package with instead of installing it, and the
# fixture is meaningless if it is absent. It ships in the `rpm` package, so it is
# on any machine that has rpm at all; checked anyway, because a fixture that
# silently skipped its own mistake would report a pass.
command -v rpm2archive >/dev/null \
  || fail "rpm2archive is missing even though it ships in the rpm package; antisolutions/05 cannot run without it"

# --- the disc, which everything here depends on ---------------------------
findmnt -no TARGET "$DVD" &>/dev/null \
  || fail "$DVD is not a mount point, so this guest has no package source at all: check that the RHEL 9 DVD ISO is attached and connected to the VM and that /etc/fstab still carries the UUID line scripts/guest-provision.sh wrote (docs/vm-build-checklist.md section 3, First boot)"
for d in "$DVD_BASEOS" "$DVD_APPSTREAM"; do
  sudo test -r "$d/repodata/repomd.xml" \
    || fail "$d/repodata/repomd.xml cannot be read, so $d is not a usable repository directory; the disc mounted at $DVD is not a RHEL 9 binary DVD (docs/vm-build-checklist.md section 3, First boot)"
done
sudo test -r "$KEY_FILE" \
  || fail "$KEY_FILE is missing from the disc; the prompt tells the student that key file is there, and a repository written with gpgkey= pointing at it would fail"

# --- the repository this guest arrived with -------------------------------
sudo test -f "$REPO_FILE" \
  || fail "$REPO_FILE does not exist, so this guest has no DVD repository and neither tree nor anything else can be installed; re-run scripts/provision.sh (docs/vm-build-checklist.md section 3, First boot)"

# --- the signing key -----------------------------------------------------
# whois-installed is only reachable if a repository with gpgcheck=1 can verify
# the disc's packages, and that needs the release key in the rpm database.
# provision.sh imports it (scripts/guest-provision.sh:150); this repairs the case
# where it did not, then proves it, because "the student's correct repository
# file produced a GPG error" is a failure that looks like the student's fault and
# is not.
key_installed() {
  rpm -qa --qf '%{version}\n' 'gpg-pubkey*' 2>/dev/null |
    awk -v w="$RELEASE_KEY_ID" '$0 == w { hit = 1 } END { exit hit ? 0 : 1 }'
}
if ! key_installed; then
  sudo rpm --import "$KEY_FILE" &>/dev/null < /dev/null
  key_installed \
    || fail "Red Hat's release key ($RELEASE_KEY_ID) is not in the rpm database and 'rpm --import $KEY_FILE' did not put it there; a repository with gpgcheck=1 could not install anything from the disc"
fi

# --- take the AppStream repository away -----------------------------------
# Stanza-aware, and it keeps everything else in the file byte for byte. Written
# to a temporary file and checked BEFORE it replaces the real one: a half-written
# repository file is a guest where no dnf command works at all, and this script
# would rather fail than produce one.
tmp=$(mktemp) || fail "could not create a temporary file"
sudo awk -v drop="$APPSTREAM_SECTION" '
  /^[ \t]*\[/ {
    s = $0
    sub(/^[ \t]*\[/, "", s)
    sub(/\].*$/, "", s)
    skip = (s == drop)
  }
  !skip
' "$REPO_FILE" > "$tmp"

grep -q "^\[$BASEOS_SECTION\]" "$tmp" \
  || fail "after removing the [$APPSTREAM_SECTION] stanza there is no [$BASEOS_SECTION] section left in $REPO_FILE, so this guest's repository file is not the one scripts/guest-provision.sh writes; refusing to install a file that would leave dnf with no repository"
if grep -q "^\[$APPSTREAM_SECTION\]" "$tmp"; then
  fail "the [$APPSTREAM_SECTION] stanza is still in the rewritten copy of $REPO_FILE, so the section-aware delete above did not work"
fi

# install, not mv: the file is created fresh at its own path, so it takes the
# SELinux type the policy specifies for /etc/yum.repos.d rather than the tmp_t a
# file carried in from /tmp would wear. restorecon afterwards is belt and braces,
# the same habit net/045 and files/036 keep.
need sudo install -o root -g root -m 0644 "$tmp" "$REPO_FILE"
rm -f "$tmp"
sudo restorecon "$REPO_FILE" &>/dev/null

# --- take the three packages away ----------------------------------------
# `rpm -e`, not `dnf remove`: rpm needs no repository metadata, so this costs no
# seconds and cannot be affected by the repository stanza that has just been
# taken out; it never cascades, where `dnf remove` would (RHEL 9 ships
# clean_requirements_on_remove=True in /etc/dnf/dnf.conf, so `dnf remove whois`
# also takes whatever came in with it); and its dependency check is the safety
# net - if anything on this guest ever did require one of these, rpm refuses and
# nothing is removed. One call with every installed name, because whois requires
# whois-nls at an exact version and `rpm -e whois-nls` on its own is refused while
# whois is still there.
#
# Two passes, and the split is the mkpasswd finding in the SAFETY note above.
# Pass one asks for whois-nls too, which is what a clean guest gives. If rpm
# refuses the whole set - the only realistic cause is a package outside this task
# requiring whois-nls - pass two asks for just the three the checkpoints are
# about, and whois-nls is left where it is. Leaving it costs nothing: no
# checkpoint reads it, and `dnf install whois` installs whois over the top of an
# already-present whois-nls without complaint.
graded=("$REPO_PKG" "$FILE_PKG" "$NEW_REPO_PKG")

# Pass one: everything in the removal set that is actually installed.
wide=()
for pkg in "${graded[@]}" "$NEW_REPO_PKG_DEP"; do
  rpm -q "$pkg" &>/dev/null && wide+=("$pkg")
done
if (( ${#wide[@]} > 0 )) && ! sudo rpm -e "${wide[@]}" &>/dev/null < /dev/null; then
  # Pass two: the graded three only. rpm removed nothing in pass one - it refuses
  # the whole transaction or none of it - so this is not a partial state.
  narrow=()
  for pkg in "${graded[@]}"; do
    rpm -q "$pkg" &>/dev/null && narrow+=("$pkg")
  done
  if (( ${#narrow[@]} > 0 )); then
    sudo rpm -e "${narrow[@]}" &>/dev/null < /dev/null \
      || fail "'rpm -e ${narrow[*]}' failed even with $NEW_REPO_PKG_DEP left alone, so the goal checkpoints cannot be made to start red; run it by hand to see which dependency rpm objected to"
  fi
fi

# Only the three that are graded. whois-nls is deliberately not asserted absent:
# see the two-pass note above.
for pkg in "${graded[@]}"; do
  rpm -q "$pkg" &>/dev/null \
    && fail "$pkg is still installed after the removal above, so its checkpoint would pass with no work done; reset the lab (snapshot revert)"
done

# --- stage the one package file -------------------------------------------
# Rebuilt rather than topped up. A leftover from an earlier hand-run - or from a
# student who copied whois's package file in here while solving it - would hand
# the next student a directory that solves half the task for them.
sudo rm -rf "$STAGE_DIR"
need sudo install -o root -g root -m 0755 -d "$STAGE_DIR"

# Found by pattern, not by version: the DVD's telnet is 1:0.17-85.el9 today and
# the point release will move it. `telnet-[0-9]*` rather than `telnet-*` because
# the latter also matches telnet-server, which is a different package with a
# socket unit in it and has no business on this guest. The architecture comes
# from uname so that an i686 build of the same package on the disc cannot be
# picked instead. `find` rather than a path like AppStream/Packages/, because
# nothing in this repo has verified the disc's directory layout and a `find` does
# not need to.
staged_src=$(sudo find "$DVD_APPSTREAM" -type f -name "$FILE_PKG-[0-9]*.$ARCH.rpm" 2>/dev/null | sort | tail -n1)
[[ -n $staged_src ]] \
  || fail "no file named $FILE_PKG-<version>.$ARCH.rpm was found anywhere under $DVD_APPSTREAM, so there is nothing to stage and telnet-installed would be unreachable; the disc mounted at $DVD is not a complete RHEL 9 binary DVD"
need sudo install -o root -g root -m 0644 "$staged_src" "$STAGE_DIR/"

staged=$STAGE_DIR/${staged_src##*/}
[[ -r $staged ]] \
  || fail "$staged is not readable after copying it from $staged_src"

# It is the package it claims to be, and its signature verifies against the key
# imported above. The second check is the interesting one: it proves, before the
# student starts, that the disc's packages and this guest's keyring agree - which
# is the precondition whois-installed and appstream-repo-gpgcheck both rest on.
staged_name=$(rpm -qp --qf '%{name}' "$staged" 2>/dev/null)
[[ $staged_name == "$FILE_PKG" ]] \
  || fail "$staged reports its name as '${staged_name:-nothing}' rather than $FILE_PKG, so the file staged for the student is not the package the prompt says it is"
rpmkeys --checksig "$staged" &>/dev/null \
  || fail "'rpmkeys --checksig $staged' failed, so the disc's packages do not verify against this guest's keyring and a correct repository with gpgcheck=1 would refuse to install anything"

# The same question asked of the package the student has to reach THROUGH a
# repository, because that is the one gpgcheck actually applies to.
whois_src=$(sudo find "$DVD_APPSTREAM" -type f -name "$NEW_REPO_PKG-[0-9]*.$ARCH.rpm" 2>/dev/null | sort | tail -n1)
[[ -n $whois_src ]] \
  || fail "no file named $NEW_REPO_PKG-<version>.$ARCH.rpm was found under $DVD_APPSTREAM, so whois-installed would be unreachable however correct the student's repository file was"
rpmkeys --checksig "$whois_src" &>/dev/null \
  || fail "'rpmkeys --checksig $whois_src' failed, so a repository serving $DVD_APPSTREAM with gpgcheck=1 could not install $NEW_REPO_PKG"

# --- prove dnf sees exactly what the prompt says it sees ------------------
# One metadata load, three facts, and it is the only dnf command in this task's
# setup: tree is offered, telnet is not, whois is not. Asked through dnf rather
# than inferred from the file, because "the repository file looks right" and "dnf
# can read that repository" are different claims and the prompt makes the second
# one.
#
# `< /dev/null` because dnf reads stdin and this script's stdin is the rest of the
# script. `timeout 60`, and the number is chosen against a ceiling rather than
# against dnf: the whole of this script is one ssh command and the runner cuts
# those off at 120 seconds (src/engine/vm/ssh.ts), so a bound that let dnf run to
# 90 could spend the script's entire budget here and report nothing at all. 60
# leaves room for this script to fail in words. A cold cache on this guest parses
# BaseOS's metadata off the disc in a fraction of it. stderr is captured too, so a
# failure can quote dnf's own words back.
avail=$(timeout 60 sudo dnf -q repoquery --qf '%{name}' "$REPO_PKG" "$FILE_PKG" "$NEW_REPO_PKG" 2>&1 < /dev/null)
offered() {
  awk -v w="$1" '$0 == w { hit = 1 } END { exit hit ? 0 : 1 }' <<<"$avail"
}
offered "$REPO_PKG" \
  || fail "'dnf repoquery $REPO_PKG' did not list $REPO_PKG, so no enabled repository on this guest offers it and tree-installed would be unreachable; check that $REPO_FILE still points at the disc mounted at $DVD (docs/vm-build-checklist.md section 3, First boot). dnf said: ${avail:0:400}"
offered "$FILE_PKG" \
  && fail "an enabled repository still offers $FILE_PKG, so the student could install it without ever touching the file staged in $STAGE_DIR; check $REPO_DIR for a second repository definition covering $DVD_APPSTREAM"
offered "$NEW_REPO_PKG" \
  && fail "an enabled repository already offers $NEW_REPO_PKG, so whois-installed could pass without the student defining a repository at all; check $REPO_DIR for a leftover definition covering $DVD_APPSTREAM"

# --- verify every goal checkpoint fails, and every invariant passes -------
# The parser below is grade.sh's, copied verbatim, and it must stay that way: an
# enumeration wider or narrower than the grader's would make these assertions
# meaningless. A precondition that measures something other than what the
# checkpoint measures is not a precondition. Both the separator and the
# comment/whitespace/case rules are explained in grade.sh, at length; the short
# version is that this is how dnf reads these files and not how ini is usually
# read.
conf_files=()
[[ -f $DNF_CONF ]] && conf_files+=("$DNF_CONF")
for f in "$REPO_DIR"/*.repo; do
  [[ -f $f ]] && conf_files+=("$f")
done
(( ${#conf_files[@]} > 0 )) \
  || fail "there is no $DNF_CONF and no *.repo file under $REPO_DIR, so dnf has no configuration at all"

dump=$(timeout 20 sudo awk '
  function emit() {
    if (sec != "") printf "%s\037%s\037%s\037%s\037%s\n", sec, file, baseurl, enabled, gpgcheck
    sec = ""; baseurl = ""; enabled = ""; gpgcheck = ""
  }
  FNR == 1 { emit(); file = FILENAME }
  /^[ \t]*[#;]/ { next }
  /^[ \t]*\[/ {
    emit()
    s = $0
    sub(/^[ \t]*\[/, "", s)
    sub(/\].*$/, "", s)
    sec = s
    file = FILENAME
    next
  }
  sec == "" { next }
  {
    eq = index($0, "=")
    if (eq == 0) next
    key = substr($0, 1, eq - 1)
    val = substr($0, eq + 1)
    gsub(/^[ \t]+|[ \t]+$/, "", key)
    gsub(/^[ \t]+|[ \t]+$/, "", val)
    gsub(/[\t\037]/, " ", val)
    if (key == "baseurl") baseurl = val
    else if (key == "enabled") enabled = val
    else if (key == "gpgcheck") gpgcheck = val
  }
  END { emit() }
' "${conf_files[@]}" 2>/dev/null)
[[ -n $dump ]] \
  || fail "read no repository section out of ${#conf_files[@]} configuration file(s), so this script cannot tell whether the goal checkpoints start red"

dnf_true() {
  local v=${1,,} fallback=$2
  case $v in
    1|true|yes|on) return 0 ;;
    0|false|no|off) return 1 ;;
  esac
  [[ $fallback == true ]]
}

baseurl_names() {
  awk -v want="$2" '
    {
      n = split($0, u, /[ ,\t]+/)
      for (i = 1; i <= n; i++) {
        v = u[i]
        if (v == "") continue
        if (v ~ /^file:\/\//) sub(/^file:\/\//, "", v)
        else if (v ~ /^file:/) sub(/^file:/, "", v)
        sub(/\/+$/, "", v)
        if (v == want) hit = 1
      }
    }
    END { exit hit ? 0 : 1 }' <<<"$1"
}

baseos_on=0
while IFS=$'\037' read -r sec file burl en _gpg; do
  [[ -n $sec ]] || continue
  [[ $sec == main && $file == "$DNF_CONF" ]] && continue
  if baseurl_names "$burl" "$DVD_APPSTREAM" && dnf_true "$en" true; then
    fail "[$sec] in $file is an enabled repository serving $DVD_APPSTREAM, so appstream-repo-defined would pass with no work done; remove that definition or reset the lab (snapshot revert)"
  fi
  if baseurl_names "$burl" "$DVD_BASEOS" && dnf_true "$en" true; then
    baseos_on=1
  fi
done <<<"$dump"

(( baseos_on == 1 )) \
  || fail "no enabled repository definition names $DVD_BASEOS, so the baseos-repo-intact invariant would fail for every fixture including both solutions; re-run scripts/provision.sh"

# control-packages-intact is an invariant and it is also the channel this task is
# graded over: prove it holds before the student starts, so a failure afterwards
# can only mean the student broke it.
for pkg in openssh-server NetworkManager systemd dnf rpm; do
  rpm -q "$pkg" &>/dev/null \
    || fail "$pkg is not installed, so the control-packages-intact invariant would fail for every fixture; this guest was not built to docs/vm-build-checklist.md"
done

# The grader never reads history, but a student who reverts and sees their own
# previous commands has been given a hint nobody offered them.
cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
