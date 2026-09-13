#!/usr/bin/env bash
# Grader for pkg/049-packages-and-repositories.
#
# READ-ONLY. content/lib/assert.sh is prepended by loadTaskScripts, so its
# helpers are already in scope - do not source it. The exit code is ignored; only
# the JSONL the helpers emit is read.
#
# ---------------------------------------------------------------------------
# WHY THIS GRADER RUNS NO dnf AT ALL, which is the one decision here worth
# defending at length, because "ask dnf whether the repository works" is the
# obvious design and it is wrong twice over.
#
#   1. It is not read-only. Every dnf command that touches a repository loads
#      that repository's metadata and WRITES it under /var/cache/dnf. A grader
#      that primes the cache changes the machine it is measuring, and it changes
#      it in the direction that makes the next measurement faster and the next
#      student's `dnf install` unrepresentative. Every other grader in this bank
#      keeps its hands off the system; there is no reason for this one to be the
#      exception, least of all for a fact it can read off a file.
#   2. It cannot answer the question anyway. `--repo=<id>` and
#      `--enablerepo=<id>` OVERRIDE `enabled=0` in the repository file (dnf(8),
#      OPTIONS: "--enablerepo=<repoid>  Temporarily enable additional
#      repositories for the purpose of the current dnf command", and `--repo` is
#      "basically a shortcut for --disablerepo="*" --enablerepo=<repoid>"), so a
#      dnf probe aimed at one repository reports it as
#      usable whether or not the configuration enables it - which is exactly the
#      mistake antisolutions/03 makes and exactly the one this task exists to
#      catch. And a probe that does NOT name the repository is at the mercy of
#      every other repository on the box: `skip_if_unavailable` defaults to False
#      (dnf.conf(5)) and RHEL 9 also writes it out explicitly - `grep
#      skip_if_unavailable /etc/dnf/dnf.conf` on dnf-data-4.14.0-34.el9_8 says
#      `False` - so one broken baseurl anywhere makes every dnf command exit
#      non-zero, and antisolutions/04 leaves precisely that machine behind. A
#      grader whose measurements all fail because of the fixture's unrelated typo
#      reports a mess instead of a mistake.
#
# So the repository questions are answered from the CONFIGURATION TEXT, parsed
# the way dnf parses it, and the "does it actually work" question is answered by
# a package: whois is in the disc's AppStream directory and in no repository this
# guest has at baseline, so whois-installed is a fact about the rpm database that
# only a working AppStream repository (or a candidate naming both package files
# by hand, which is also a legitimate local install) can produce. Two cheap,
# read-only, independent statements instead of one expensive ambiguous one.
#
# WHAT THIS GRADER DELIBERATELY CANNOT PROVE: that telnet was installed from the
# file staged in /var/tmp/rhcsa-packages rather than from somewhere else. rpm's
# database has no field for where a package came from, and dnf's own record
# (`dnf repoquery --installed --qf '%{from_repo}'`) only covers transactions dnf
# itself performed - measured on RHEL 9.8, that query prints an empty origin for
# bash, which anaconda installed - so an entirely correct `rpm -Uvh
# /var/tmp/rhcsa-packages/telnet-*.rpm` has nothing to show for itself and
# grading the dnf value would fail a right answer. `rpm -q` is therefore what
# telnet-installed asks, the prompt says plainly where the file is, and the
# provenance is on the honour system.
#
# There is a second reason it has to be, and it is worth being honest about: the
# task requires a repository serving the disc's AppStream directory, and telnet is
# IN that directory. The moment the candidate satisfies the third requirement,
# `dnf install telnet` starts working too. A grader insisting the package file was
# the source would be insisting on an order of operations the prompt never asked
# for. It is the one requirement in this task that is stated and not measured, and
# saying so here is better than pretending otherwise.
# ---------------------------------------------------------------------------
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start:
#   baseos-repo-intact       - the DVD's BaseOS repository, which setup.sh
#     proves is working before the student touches anything.
#     antisolutions/06 exists to prove it is really probed.
#   control-packages-intact  - see the unprobed-invariant note below.
# baseline-fail: tree-installed, telnet-installed, whois-installed, appstream-repo-defined, appstream-repo-gpgcheck
#
# No fixture probes control-packages-intact and none can: the honest way to break
# it is to remove openssh-server or NetworkManager, and either one ends the run by
# taking away the channel the verdict travels over. It is declared instead.
# unprobed-invariant: control-packages-intact
set -uo pipefail

# Spelled identically in setup.sh and in every fixture. If these ever disagree
# the task becomes unsatisfiable for every answer.
DVD=/mnt/rhcsa-dvd
DVD_BASEOS=$DVD/BaseOS
DVD_APPSTREAM=$DVD/AppStream
DNF_CONF=/etc/dnf/dnf.conf
REPO_DIR=/etc/yum.repos.d

# The packages, one per source. tree comes from the configured BaseOS
# repository, telnet from the staged package file, whois from the repository the
# student defines.
REPO_PKG=tree
FILE_PKG=telnet
NEW_REPO_PKG=whois

# Packages whose removal would break this guest or the harness.
#
# firewalld is deliberately NOT here, and not for the reason it might look like:
# it IS present on a Minimal Install - `dnf group info core` lists firewalld under
# Mandatory Packages, and net/045-firewall-restricted-service grades a running
# firewalld on this same guest, so the bank already depends on it. It is left out
# because nothing this task asks for goes anywhere near it: none of tree, telnet
# or whois has firewalld in its dependency closure in either direction (measured
# with `dnf repoquery --requires --resolve --recursive` and `--whatrequires`
# against RHEL 9 BaseOS and AppStream), so a firewalld row here would be a
# checkpoint no answer to this task can move. The five below are the ones a
# removal-happy candidate could plausibly reach for on a packaging question.
CONTROL_PKGS=(openssh-server NetworkManager systemd dnf rpm)

# --------------------------------------------------------------- ini reading
# Where dnf reads repository definitions from: "DNF by default uses the global
# configuration file at /etc/dnf/dnf.conf and all *.repo files found under
# /etc/yum.repos.d" (dnf.conf(5), DESCRIPTION), and repository sections are legal
# in BOTH - measured on RHEL 9.8 with dnf 4.14.0, a `[inconf]` section written
# into a main configuration file is listed by `dnf repolist` exactly like one in
# a .repo file. So both are parsed here. A student who put the definition
# somewhere unusual but working is not penalised for it.
#
# NOT covered, and named rather than hidden. Every one of these was measured
# against libdnf on RHEL 9.8 rather than assumed:
#
#   - `reposdir` in [main] can move the directory this reads. Would under-detect a
#     working answer; nothing in the prompt suggests it and no shipped fixture
#     does it.
#   - a definition in a file whose name does not end in .repo is invisible to dnf
#     and to this parser alike, so the two agree by accident and no answer is
#     misgraded.
#   - CONTINUATION LINES. libdnf takes an indented line with no `=` in it as more
#     of the preceding value: `baseurl=file:///mnt/x` followed by an indented
#     `file:///mnt/y` parses to the two-element list ['file:///mnt/x',
#     'file:///mnt/y']. This parser skips any line without an `=`, so it sees only
#     the first. UNDER-detects - a candidate who wrapped `baseurl=` so that
#     AppStream landed on the second line would fail appstream-repo-defined with a
#     working repository. Neither solution wraps it and a one-URL baseurl is far
#     too short to invite wrapping, so this is a limit rather than a live risk.
#   - WHOLE-FILE REJECTION. A `key=value` before any section header, or an
#     unclosed `[`, makes libdnf discard the WHOLE file - `Warning: failed loading
#     '/path/t.repo', skipping.` and `No repositories available` - taking the
#     valid stanzas in the same file down with it. This parser reads those
#     stanzas and would credit a repository dnf never loaded. That is the wrong
#     direction, so it is worth saying why it is survivable: it can only happen to
#     a candidate whose own file is malformed, and for them `dnf install whois`
#     failed, so whois-installed is still red. The functional checkpoint exists to
#     be the half of the verdict that no text parser can fake.
#   - DUPLICATE SECTION IDS. dnf merges two `[dup]` stanzas into ONE repository,
#     last value winning per key (measured: `enabled=1` then a second `[dup]` with
#     `enabled=0` yields one disabled repository). This parser emits two rows. The
#     checks below ask "does ANY enabled row name the directory", so the two agree
#     except when the duplicate disables what the first enabled, where this is
#     more generous than dnf - and again whois-installed is the backstop.
conf_files=()
[[ -f $DNF_CONF ]] && conf_files+=("$DNF_CONF")
for f in "$REPO_DIR"/*.repo; do
  [[ -f $f ]] && conf_files+=("$f")
done

# One row per section: section, file, baseurl, enabled, gpgcheck, separated by
# ASCII US (\037), values as written. US rather than a tab because bash collapses
# runs of IFS WHITESPACE: with IFS=$'\t' a section carrying no baseurl produces
# two adjacent tabs, `read` treats them as one separator, and every field after
# it shifts left - so a repository with `enabled=0` and no baseurl would be read
# as having baseurl=0. US is not whitespace, so empty fields survive.
#
# Parsed to dnf's rules, which are not quite ini's:
#
#   - a comment is a line whose first non-blank character is # or ; . An INLINE #
#     is NOT a comment: measured, `enabled=0 # keep this off` makes dnf report
#     `invalid boolean value '0 # keep this off'` and fall back to the default, so
#     the value here is the rest of the line and the boolean reader below decides
#     what dnf would have made of it.
#   - keys are lower case and matched exactly. Measured, `Enabled=0` and
#     `BaseUrl=...` are silently ignored by dnf 4.14.0 - the repository came out
#     enabled and its name defaulted to its id - so a parser that accepted them
#     would pass a file dnf does not read.
#   - whitespace around `=` is allowed: `enabled = 0` disables the repository.
#
# A tab or a US inside a value is replaced, because either one would shift the
# fields after it.
#
# `sudo` so that a student who tightened the mode on their own repository file is
# still graded on its contents; `timeout` because a grader may not hang, and a
# path under /etc/yum.repos.d that is a fifo rather than a file would hang awk
# for ever. awk reads every file to EOF, which is what content/lib/assert.sh
# requires of a pipeline consumer.
dump=''
if (( ${#conf_files[@]} > 0 )); then
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
fi

# dnf_true VALUE FALLBACK  -> exit 0 if dnf would read VALUE as true.
#
# The accepted spellings are 1, 0, True, False, yes, no (dnf.conf(5), "boolean"),
# and measured on 4.14.0 they are case-insensitive and `on`/`off` work too.
# Anything else is NOT an error a candidate can rely on seeing: dnf prints
# `Invalid configuration value: enabled=maybe ...; invalid boolean value 'maybe'`
# on stderr and then USES THE DEFAULT. Measured - a repository with
# `enabled=maybe` is listed as enabled. So an unparseable value falls through to
# FALLBACK here, exactly as it does there.
dnf_true() {
  local v=${1,,} fallback=$2
  case $v in
    1|true|yes|on) return 0 ;;
    0|false|no|off) return 1 ;;
  esac
  [[ $fallback == true ]]
}

# baseurl_names LIST PATH -> exit 0 if any entry in LIST is PATH.
#
# baseurl is a list of URLs, so every entry is considered. `file://` is stripped
# (`file:///mnt/x` -> `/mnt/x`), a bare path is accepted as written, and trailing
# slashes are ignored, because `file:///mnt/rhcsa-dvd/AppStream/` and
# `/mnt/rhcsa-dvd/AppStream` are the same directory and dnf treats them so.
#
# The comparison is otherwise LITERAL, and that is a deliberate limit: a student
# who reached the same directory by another route - a bind mount, a symlink, a
# second copy - fails this checkpoint. The prompt names the path in as many words
# for that reason.
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

# ------------------------------------------------------- the three packages
# rpm, not `dnf list installed`: the rpm database is where "installed" is
# recorded, the question needs no metadata and no repository, and a machine whose
# repositories are broken - which is exactly what antisolutions/04 leaves behind
# - can still answer it. `timeout` because rpm waits for the database lock.
tree_q=$(timeout 20 rpm -q "$REPO_PKG" 2>&1)
tree_rc=$?
ck tree-installed "$REPO_PKG is installed, from the DVD's BaseOS repository" "$tree_rc" \
  "rpm -q $REPO_PKG said: $tree_q"

# Provenance is not graded here - see the header. This is "telnet is installed",
# no more.
telnet_q=$(timeout 20 rpm -q "$FILE_PKG" 2>&1)
telnet_rc=$?
ck telnet-installed "$FILE_PKG is installed (its package file was staged in /var/tmp/rhcsa-packages)" "$telnet_rc" \
  "rpm -q $FILE_PKG said: $telnet_q. Extracting a package's payload with rpm2archive or rpm2cpio puts the files on disk and installs nothing: the database is what this reads"

# whois is the functional half of the repository question: at baseline no
# repository on this guest offers it, so an installed whois means either the
# student's own AppStream repository worked or they named the package files on
# the disc by hand. Both are correct answers to "install from the local file
# system" and neither is possible without doing something right.
whois_q=$(timeout 20 rpm -q "$NEW_REPO_PKG" 2>&1)
whois_rc=$?
ck whois-installed "$NEW_REPO_PKG is installed, which needs the DVD's AppStream directory" "$whois_rc" \
  "rpm -q $NEW_REPO_PKG said: $whois_q"

# ------------------------------------------------------ the repository files
# Fail closed. An unreadable configuration is not an invariant that happens to
# hold: it is a measurement that did not happen, and reporting it as a pass would
# hide a broken guest behind three green lines.
if [[ -z $dump ]]; then
  detail="read no section from ${#conf_files[@]} configuration file(s) under $REPO_DIR plus $DNF_CONF"
  ck_fail appstream-repo-defined "an enabled repository serves $DVD_APPSTREAM" "$detail"
  ck_fail appstream-repo-gpgcheck "that repository checks package signatures" "$detail"
  ck_fail baseos-repo-intact "the DVD's BaseOS repository is still configured and still readable" "$detail"
else
  # The [main] section of the main configuration file is not a repository: it
  # carries the DEFAULTS. gpgcheck is one of the options dnf.conf(5) lists under
  # "OPTIONS FOR BOTH [MAIN] AND REPO" - "The value provided in the main section
  # is used for all repositories as the default value, which repositories can
  # then override in their configuration" - and RHEL 9 ships
  # /etc/dnf/dnf.conf with gpgcheck=1 in it (dnf-data-4.14.0-34.el9_8). So a
  # student who writes no gpgcheck line at all still gets signature checking, and
  # gets it honestly; what appstream-repo-gpgcheck really catches is the habit of
  # writing gpgcheck=0 to make an install stop complaining. The rpm-level
  # backstop does not save them from that either: %_pkgverify_level is `digest`
  # in /usr/lib/rpm/macros on RHEL 9, so gpgcheck=0 is honoured rather than
  # overridden.
  main_gpg=false
  while IFS=$'\037' read -r sec file _burl _en gpg; do
    [[ $sec == main && $file == "$DNF_CONF" ]] || continue
    dnf_true "$gpg" false && main_gpg=true
  done <<<"$dump"

  as_on=0 as_gpg=0 as_where='' as_gpgval='' as_off=''
  bo_on=0 bo_where=''
  while IFS=$'\037' read -r sec file burl en gpg; do
    [[ -n $sec ]] || continue
    # Skip the defaults section itself, but only in the main configuration file:
    # a .repo file is free to hold a repository whose id happens to be `main`.
    [[ $sec == main && $file == "$DNF_CONF" ]] && continue

    if baseurl_names "$burl" "$DVD_APPSTREAM"; then
      if dnf_true "$en" true; then
        as_on=1
        as_where="[$sec] in $file"
        as_gpgval=$gpg
        dnf_true "$gpg" "$main_gpg" && as_gpg=1
      else
        as_off="[$sec] in $file names $DVD_APPSTREAM but is disabled (enabled=$en)"
      fi
    fi

    if baseurl_names "$burl" "$DVD_BASEOS"; then
      dnf_true "$en" true && { bo_on=1; bo_where="[$sec] in $file"; }
    fi
  done <<<"$dump"

  # "Enabled in its own configuration, not merely for the length of one command"
  # is the prompt's wording, and this is what enforces it. An absent `enabled`
  # line counts as enabled: dnf.conf(5) says the default is True and measured it
  # is - a stanza with no enabled line is listed as enabled - so requiring the
  # line would fail a correct minimal repository file.
  detail="no enabled repository definition names $DVD_APPSTREAM"
  [[ -n $as_off ]] && detail=$as_off
  (( as_on == 1 ))
  ck appstream-repo-defined "an enabled repository serves $DVD_APPSTREAM" $? "$detail"

  gpg_detail="no enabled repository for $DVD_APPSTREAM, so nothing could be asked about its signature checking"
  (( as_on == 1 )) && gpg_detail="$as_where has gpgcheck=${as_gpgval:-<unset>} and the [main] default is gpgcheck=$main_gpg, so dnf would install from it without verifying signatures"
  (( as_gpg == 1 ))
  ck appstream-repo-gpgcheck "the repository serving $DVD_APPSTREAM checks package signatures" $? "$gpg_detail"

  # The invariant, and it is two facts because either one alone is worthless: the
  # definition still exists and is enabled, AND the directory it names is still
  # readable. A candidate who overwrote /etc/yum.repos.d/rhcsa-dvd.repo instead
  # of adding a file loses the first (antisolutions/06); one who unmounted the
  # disc to "have a look at the ISO" loses the second, and would take the
  # repository they just defined with it.
  bo_detail="no enabled repository definition names $DVD_BASEOS - the definition this guest was built with, in $REPO_DIR/rhcsa-dvd.repo, is gone or disabled"
  if (( bo_on == 1 )); then
    bo_detail="$bo_where names $DVD_BASEOS but $DVD_BASEOS/repodata/repomd.xml cannot be read: the disc is not mounted at $DVD any more"
  fi
  # `sudo test`, because root is who dnf reads a repository as, and a grader that
  # asked whether *student* can read the disc would answer a different question.
  repomd_ok=0
  timeout 10 sudo test -r "$DVD_BASEOS/repodata/repomd.xml" && repomd_ok=1
  [[ $bo_on -eq 1 && $repomd_ok -eq 1 ]]
  ck baseos-repo-intact "the DVD's BaseOS repository is still configured and still readable" $? "$bo_detail"
fi

# ------------------------------------------------------------- the invariant
# Nothing was removed to make room. A candidate who reads "install these three"
# and reaches for a removal has not failed a checkpoint about the three; they
# have broken the machine, and this is the line that says so.
missing=''
for pkg in "${CONTROL_PKGS[@]}"; do
  timeout 20 rpm -q "$pkg" &>/dev/null || missing+=" $pkg"
done
[[ -z $missing ]]
ck control-packages-intact "no package this guest depends on was removed" $? \
  "no longer installed:$missing"
