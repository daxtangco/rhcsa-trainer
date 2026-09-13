#!/usr/bin/env bash
# Grader for net/046-key-based-ssh-login.
#
# READ-ONLY. Changes nothing on the guest. The exit code is ignored; only the
# JSONL the checkpoint helpers write to stdout is read. content/lib/assert.sh is
# prepended by loadTaskScripts, so those helpers are already in scope - do not
# source it. (Their names are left unspelled in every comment in this file on
# purpose: the id extractor documented in docs/r1-findings.md reads comment text
# as readily as code, so prose that looks like a call invents a checkpoint.)
#
# ---------------------------------------------------------------------------
# The safety rule, observed here as in every other file of this task: the harness
# grades this guest over ssh as `student`, with the key in
# /home/student/.ssh/authorized_keys. Nothing in this file writes to, chmods,
# chowns, moves or deletes anything under /home/student/.ssh - it reads those two
# paths and nothing more. Nothing here edits /etc/ssh/sshd_config or
# /etc/ssh/sshd_config.d/*, and nothing signals, restarts or reloads sshd:
# `sshd -T` only prints the effective configuration. Nothing here touches
# firewalld or the NIC.
#
# The one ssh CLIENT invocation below carries `-o UserKnownHostsFile=/dev/null`
# for that same reason and not for host-key hygiene: without it the connection
# would create /home/student/.ssh/known_hosts, and a grader that writes inside
# the directory it is grading is a grader that can end the exercise.
# ---------------------------------------------------------------------------
#
# What is deliberately NOT graded, so nobody adds it later thinking it was
# forgotten:
#
#   - Which key type was used, how long it is, where exactly under student's
#     ~/.ssh it lives, or what its comment says. ed25519 and rsa are equally
#     correct and spec 6.5 rule 1 forbids grading the mechanism.
#   - How the public key got into deploy's file. ssh-copy-id over a password
#     login, a copy made under sudo, a file written as deploy itself and a line
#     appended by hand are all the same end state, and the two shipped solutions
#     take two of those routes.
#   - Whether deploy's password still works, and whether PasswordAuthentication
#     is on. Turning password authentication off is a perfectly good habit and a
#     real exam objective elsewhere, but it is a change to the SERVER, this task
#     forbids those, and a grader that rewarded it would be inviting the one edit
#     that can cost the harness its own way in.
#   - Whether the student ALSO gave themselves an ~/.ssh/config entry. Harmless,
#     and the login probe already measures the only thing that matters.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: student-keypair, deploy-authorized-key, deploy-key-perms, deploy-key-context, deploy-key-login
#
# Two invariants are emitted here and knowingly not probed by any fixture in this
# task. Both declarations live on the single line below because the parser rejects
# a second header of this kind, and the reasoning for each is at the checkpoint
# itself, in sections 8 and 9.
# unprobed-invariant: sshd-key-auth-intact, student-channel-intact
set -uo pipefail

# Spelled identically in setup.sh.
TARGET_USER=deploy
TARGET_HOME=/home/deploy
TARGET_SSH_DIR=/home/deploy/.ssh
TARGET_AK=/home/deploy/.ssh/authorized_keys

STUDENT_USER=student
STUDENT_SSH_DIR=/home/student/.ssh
STUDENT_AK=/home/student/.ssh/authorized_keys

# The probe, character for character as setup.sh asserts it fails at baseline.
# Every option is load-bearing; the reasons are in setup.sh's copy, and the two
# that matter most are BatchMode (without it a rejected key asks for deploy's
# password and this grader hangs until the harness kills it) and -n plus
# `< /dev/null` (this script arrives on ssh's stdin, and a client that inherited
# it would eat the rest of the file).
SSH_OPTS=(-n
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=10
  -o PreferredAuthentications=publickey
  -o NumberOfPasswordPrompts=0
  -o LogLevel=ERROR)

# Every base64 key blob in some text or in some files, one per line.
#
# The blob is compared and not the fingerprint, and not the whole line: a line in
# authorized_keys may carry options in front of the type (`from="10.0.0.0/8"
# ssh-ed25519 AAAA...`) and a comment after the blob, and `ssh-keygen -y` writes
# a different comment from the one in the .pub file. The blob is the key itself
# and the only field that has to match. Compared as a WHOLE FIELD, never as a
# substring, for the reason sys/040's grader spells out about addresses.
#
# awk reads to EOF, so none of these is the `producer | grep -q` SIGPIPE trap
# content/lib/assert.sh documents.
BLOB_AWK='
  /^[[:space:]]*#/ { next }
  {
    for (i = 1; i <= NF; i++)
      if ($i ~ /^AAAA[A-Za-z0-9+\/=]+$/ && length($i) > 60) print $i
  }'

# --- fail closed ----------------------------------------------------------
# Without these three tools nothing below can be measured, and bash's empty-set
# arithmetic would report the pleasant answer: an empty blob list intersects
# nothing, an unreadable mode reads as 0 and passes a "no group write" test, and a
# `restorecon` that is not there prints no relabel lines - so a grader missing its
# instruments would call an untouched machine correct. Everything fails instead,
# invariants included, the same way storage/014 and files/036 fail closed on their
# own inputs.
missing=
command -v ssh >/dev/null || missing="$missing ssh"
command -v ssh-keygen >/dev/null || missing="$missing ssh-keygen"
command -v restorecon >/dev/null || missing="$missing restorecon"
if [[ -n $missing ]]; then
  detail="the grader is missing the tools it measures with:${missing}. openssh, openssh-clients and policycoreutils are what provide them, and setup.sh installs them from the DVD repo - so either setup did not run or the repo is not mounted"
  ck_fail student-keypair "student holds an SSH keypair whose private key needs no passphrase" "$detail"
  ck_fail deploy-authorized-key "deploy's authorized_keys holds the public key of student's keypair" "$detail"
  ck_fail deploy-key-perms "deploy owns its home, its .ssh directory and its authorized_keys, and no other user can reach them" "$detail"
  ck_fail deploy-key-context "deploy's SSH directory and authorized_keys carry the SELinux contexts the policy specifies" "$detail"
  ck_fail deploy-key-login "student can log in as $TARGET_USER on this host with no password and no prompt" "$detail"
  ck_fail deploy-no-private-key "no private key was left anywhere in deploy's SSH directory" "$detail"
  ck_fail selinux-enforcing "SELinux is still in Enforcing mode" "$detail"
  ck_fail sshd-key-auth-intact "the SSH server still accepts public keys and still enforces StrictModes" "$detail"
  ck_fail student-channel-intact "student's own ~/.ssh and authorized_keys are as they were" "$detail"
  exit 0
fi

# --- 1. student's own keypair --------------------------------------------
# "A keypair student can actually use", which is three claims in one and all
# three are the student's work: the private key is in student's ~/.ssh, student
# can read it, and it is not encrypted.
#
# `-P ''` is what makes this safe to run: on an encrypted key `ssh-keygen -y`
# PROMPTS for the passphrase, and a grader that prompts on a channel with no
# terminal is a grader that hangs. With an empty passphrase supplied it fails
# immediately instead, which is exactly the answer wanted - a key the automation
# in the prompt cannot use without a human.
#
# The public key that comes back out on success is derived from the private key,
# so it is proof the pair belongs together; the private key material itself is
# never printed anywhere in this file.
#
# authorized_keys is excluded from the candidate list, and that exclusion is
# load-bearing rather than tidy: student's authorized_keys holds the HARNESS's
# public key, and a candidate who copied that into deploy's file would have
# installed a key they hold no private half of. Counting it here would have
# handed that answer a green deploy-authorized-key.
priv_blobs=
priv_seen=
priv_encrypted=
# Private keys student can read but the ssh CLIENT will not touch, which is a
# third state and not a shade of the other two. Collected here, used only by the
# login diagnosis in section 5: `ssh-keygen -y` does not care what mode a key file
# is, so a key with group or other bits set satisfies student-keypair honestly
# while `ssh` prints UNPROTECTED PRIVATE KEY FILE and offers nothing. Measured on
# RHEL 9.8 / OpenSSH 9.9p1: mode 0644 on the private key, everything else correct,
# and the login is refused with no hint about which end was at fault.
priv_open=
while read -r cand; do
  [[ -n $cand ]] || continue
  priv_seen="$priv_seen $(basename "$cand")"
  # `< /dev/null` again: belt to -n's braces, and here it also means an
  # ssh-keygen that decided to ask something cannot consume the loop's input.
  # Tested in the `if` itself rather than through `$?` on the line after: an
  # assignment's exit status is the command substitution's, but any line inserted
  # between the two would silently overwrite it.
  if pub_text=$(timeout 10 ssh-keygen -y -P '' -f "$cand" 2>/dev/null < /dev/null) &&
     [[ -n $pub_text ]]; then
    priv_blobs="$priv_blobs
$(awk "$BLOB_AWK" <<<"$pub_text")"
    # Recorded, never graded. student-keypair asks whether student HOLDS a usable
    # key; the mode of the file is the client's objection and belongs to the login.
    cand_mode=$(stat -c '%a' "$cand" 2>/dev/null)
    if [[ -n ${cand_mode:-} ]] && (( 8#$cand_mode & 077 )); then
      priv_open="$priv_open $(basename "$cand")=$cand_mode"
    fi
  elif grep -qsF -e 'PRIVATE KEY-----' "$cand"; then
    # Only files that really are private keys are named as unusable ones. Everything
    # else in ~/.ssh - config, known_hosts, whatever else lives there - also fails
    # to be a key, and listing those as "encrypted" would send a student looking for
    # a passphrase on their known_hosts file. The same distinction feeds the
    # passphrase diagnosis on the login checkpoint below, which is why it is drawn
    # here rather than in the message.
    priv_encrypted="$priv_encrypted $(basename "$cand")"
  fi
done < <(find "$STUDENT_SSH_DIR" -maxdepth 1 -type f \
             ! -name '*.pub' ! -name 'authorized_keys' 2>/dev/null | sort)

priv_blobs=$(sort -u <<<"$priv_blobs" | awk 'NF')
if [[ -n $priv_blobs ]]; then
  ck_pass student-keypair "student holds an SSH keypair whose private key needs no passphrase"
else
  ck_fail student-keypair "student holds an SSH keypair whose private key needs no passphrase" \
    "no usable private key in $STUDENT_SSH_DIR. Files considered:${priv_seen:- none}; unusable (encrypted, or not a private key student can read):${priv_encrypted:- none}. A key protected by a passphrase cannot be used by an unattended job, and a key generated under sudo belongs to root and cannot be read by student"
fi

# --- 2. the public key that was installed for deploy ---------------------
# Read under sudo because a correct authorized_keys is mode 0600 and owned by
# deploy: "the grader could not read it" must never be graded as "there is no key
# in it". awk on a FILE, so there is no producer for anything to kill.
ak_blobs=
if sudo test -f "$TARGET_AK"; then
  ak_blobs=$(sudo awk "$BLOB_AWK" "$TARGET_AK" 2>/dev/null | sort -u)
fi

# The public keys student is entitled to claim: the ones derived from a private
# key above, plus the ones sitting in an id_*.pub-style file. Both are needed and
# neither is enough. Without the derived set, a candidate could install any public
# key text they found. Without the .pub files, a candidate whose private key is
# encrypted would fail this checkpoint as well as student-keypair, and then a
# passphrase-protected key would look like two unrelated mistakes instead of the
# one it is - which is precisely the fixture antisolutions/03 exists to isolate.
pub_file_blobs=
while read -r pf; do
  [[ -n $pf ]] || continue
  pub_file_blobs="$pub_file_blobs
$(awk "$BLOB_AWK" "$pf" 2>/dev/null)"
done < <(find "$STUDENT_SSH_DIR" -maxdepth 1 -type f -name '*.pub' 2>/dev/null | sort)

student_blobs=$(sort -u <<<"$priv_blobs
$pub_file_blobs" | awk 'NF')

matched=no
if [[ -n $ak_blobs && -n $student_blobs ]]; then
  # Exact line intersection. comm needs both inputs sorted and both are.
  [[ -n $(comm -12 <(printf '%s\n' "$student_blobs") <(printf '%s\n' "$ak_blobs")) ]] && matched=yes
fi

if [[ $matched == yes ]]; then
  ck_pass deploy-authorized-key "deploy's authorized_keys holds the public key of student's keypair"
else
  ak_state=missing
  # `sudo stat -c %s`, NOT `sudo wc -c < "$TARGET_AK"`: a redirection is performed
  # by the shell that writes it, which here is student's, so the `<` would try to
  # open a 0600 file owned by deploy as student and hand `wc` nothing at all. The
  # sudo would have looked like it covered the read and the byte count would have
  # come out empty in the one message a student reads when this checkpoint is red.
  sudo test -f "$TARGET_AK" && ak_state="present, $(sudo stat -c %s "$TARGET_AK" 2>/dev/null) bytes, $(printf '%s' "$ak_blobs" | awk 'NF { n++ } END { print n + 0 }') public key(s) in it"
  ck_fail deploy-authorized-key "deploy's authorized_keys holds the public key of student's keypair" \
    "$TARGET_AK is $ak_state, and none of the keys in it is one of student's ($(printf '%s' "$student_blobs" | awk 'NF { n++ } END { print n + 0 }') found in $STUDENT_SSH_DIR). The file must hold the PUBLIC half - the .pub file, or the single line 'ssh-keygen -y' prints - and it must be the public half of the key student will connect with"
fi

# --- 3. the permissions StrictModes cares about --------------------------
# THE lesson of this task, and the reason it is a checkpoint of its own rather
# than being left implicit inside the login: a candidate who chmods 775 so that
# "deploy can get at it" has a file with the right content in the right place and
# a login that fails, and sshd tells them nothing about why.
#
# What is required of each path, and why that and not more:
#   $TARGET_HOME     owned by deploy, no write for group or other. sshd walks up
#                    from authorized_keys and refuses any parent a third party
#                    could replace.
#   $TARGET_SSH_DIR  owned by deploy, and no group or other bits AT ALL (0700).
#   $TARGET_AK       owned by deploy, and no group or other bits at all (0600 or
#                    0400).
# The last two are stricter than sshd's own rule, which only forbids the write
# bits, and that is deliberate: the prompt asks for files "accessible to nobody
# but deploy", every manual page and every exam objective says 0700 and 0600, and
# an authorized_keys the whole machine can read is a list of who may enter.
# sshd's opinion is graded separately and by sshd itself, in deploy-key-login.
#
# Ownership by deploy rather than "deploy or root", which is what sshd accepts:
# the prompt asks for it in as many words, an account that cannot manage its own
# authorized_keys is a half-finished hand-over, and grading the stated
# requirement is what makes the checkpoint readable.
perm_bad=
perm_seen=
check_perm() {
  local path=$1 mask=$2
  local owner mode
  read -r owner mode < <(sudo stat -c '%U %a' "$path" 2>/dev/null)
  if [[ -z ${owner:-} || -z ${mode:-} ]]; then
    perm_bad="$perm_bad $path(absent)"
    return
  fi
  perm_seen="$perm_seen $path=$owner:$mode"
  [[ $owner == "$TARGET_USER" ]] || perm_bad="$perm_bad $path(owner $owner)"
  (( 8#$mode & mask )) && perm_bad="$perm_bad $path(mode $mode)"
  return 0
}
check_perm "$TARGET_HOME" 022
check_perm "$TARGET_SSH_DIR" 077
check_perm "$TARGET_AK" 077

if [[ -z $perm_bad ]]; then
  ck_pass deploy-key-perms "deploy owns its home, its .ssh directory and its authorized_keys, and no other user can reach them"
else
  ck_fail deploy-key-perms "deploy owns its home, its .ssh directory and its authorized_keys, and no other user can reach them" \
    "wrong:${perm_bad}. Found:${perm_seen:- nothing}. Wanted $TARGET_HOME owned by $TARGET_USER and not writable by group or other, $TARGET_SSH_DIR owned by $TARGET_USER mode 0700, $TARGET_AK owned by $TARGET_USER mode 0600. The SSH server checks the directories above a key file as well as the file itself, and it refuses the key in silence"
fi

# --- 4. the SELinux label -----------------------------------------------
# The failure that looks exactly like the permissions one and is not: correct
# modes, correct owner, correct key, and sshd still refuses, because the file
# carries the label of wherever it came from. `mv` moves a label along with the
# file (content/concepts/selinux/fcontext-vs-chcon.md), so a key staged outside the
# home tree and moved into place arrives wearing that other label, and the policy
# has nothing to say about sshd reading it.
#
# "Outside the home tree" is deliberately not spelled /tmp. Measured against the
# guest's own policy build (selinux-policy-targeted-38.1.75-2.el9_8) on 2026-09-14:
# a file carried in from /tmp keeps user_tmp_t and sshd reads it anyway, because
# `allow domain tmpfile:file { ... read }` and `allow sshd_t user_tmp_type:file
# { ... open ... }` between them grant it. The staging directory that does produce
# the classic refusal is /root - see the header of
# antisolutions/04-moved-from-root-home-then-setenforce.sh, which carries the
# sesearch queries and the reasoning. This checkpoint is unaffected either way: it
# asks whether the labels are what the policy specifies, not whether a denial
# happens to follow.
#
# Asked as "would restorecon change anything here", which is the same question the
# policy answers and needs no hardcoded type name in this file - so it stays
# correct if the shipped file_contexts ever changes its mind. `-n` makes it a
# dry run: this is the read-only way to ask, and it is the command a student
# should reach for before believing the labels are right.
#
# The happy path does NOT need a restorecon. A directory created with mkdir under
# /home/deploy gets ssh_home_t from the policy's named transition for `.ssh`, and
# a file created inside it inherits that - so `mkdir` plus a redirect, or
# ssh-copy-id, or a `cp` into the directory, all land correctly labelled. Only
# answers that carry a label in from somewhere else (`mv`, `cp -a`,
# `cp --preserve=context`, a tar unpacked with --selinux) get this wrong, which is
# why a fixture has to work at it to fail this checkpoint.
#
# Absence is decided BEFORE restorecon is asked, and that ordering is the reason
# this checkpoint is red at baseline rather than accidentally green: at baseline
# there is no ~deploy/.ssh at all, and "there is nothing here to be labelled
# wrongly" is not the same claim as "the labels are right". Deciding it here also
# means this checkpoint never depends on what exit status restorecon happens to
# return for a path that does not exist.
ctx_out=
ctx_rc=0
ctx_missing=
sudo test -d "$TARGET_SSH_DIR" || ctx_missing="$ctx_missing $TARGET_SSH_DIR"
sudo test -f "$TARGET_AK" || ctx_missing="$ctx_missing $TARGET_AK"
if [[ -z $ctx_missing ]]; then
  ctx_out=$(sudo timeout 20 restorecon -nv "$TARGET_HOME" "$TARGET_SSH_DIR" "$TARGET_AK" 2>&1)
  ctx_rc=$?
fi
ctx_ls=$(sudo ls -Zd "$TARGET_HOME" "$TARGET_SSH_DIR" "$TARGET_AK" 2>&1 | tr '\n' ' ')
if [[ -n $ctx_missing ]]; then
  ck_fail deploy-key-context "deploy's SSH directory and authorized_keys carry the SELinux contexts the policy specifies" \
    "there is nothing here to be labelled yet - missing:${ctx_missing}. Create deploy's SSH directory and authorized_keys file first; the labels are checked once they exist"
elif (( ctx_rc == 0 )) && [[ -z $(grep -i relabel <<<"$ctx_out") ]]; then
  ck_pass deploy-key-context "deploy's SSH directory and authorized_keys carry the SELinux contexts the policy specifies"
else
  ck_fail deploy-key-context "deploy's SSH directory and authorized_keys carry the SELinux contexts the policy specifies" \
    "a dry-run relabel exited $ctx_rc and reported: $(printf '%s' "${ctx_out:-nothing}" | tr '\n' ' ' | cut -c1-240). Now: ${ctx_ls:-unreadable}. The policy wants ssh_home_t under a home directory's .ssh; a file moved in from somewhere else keeps that other label, and for most of them - /root, a data directory, anything unlabelled - sshd is not allowed to read it"
fi

# --- 5. the login itself -------------------------------------------------
# The only checkpoint that asks sshd rather than the filesystem, and the only one
# that can be satisfied by nothing except the whole answer being right. It is run
# the way the unattended job in the prompt would run it: as student, in a session
# with no terminal, no agent and nothing to type into.
#
# Run last of the five goal checkpoints on purpose. Everything above is already
# captured, so the detail below can name the likely cause instead of saying
# "Permission denied" and leaving the student to guess which of the four
# preconditions it was.
#
# Probed twice when the first attempt never reached authentication, and that retry
# is not defensive padding - it is a measured property of the server this grader
# runs against. OpenSSH 9.8 introduced PerSourcePenalties, on by default in RHEL 9's
# build, which makes sshd REFUSE NEW CONNECTIONS from a source address that has just
# accumulated failed authentications (authfail:5s each, roughly 15s of accumulated
# penalty before it activates). Every failed key attempt this task is about is a
# failed authentication from 127.0.0.1, so a fixture that fails the login two or
# three times - or a student who has just been retrying by hand - can arrive here
# and be refused before sshd ever looks at the key. Measured on RHEL 9.8 /
# OpenSSH 9.9p1: the symptom is `kex_exchange_identification: read: Connection
# reset by peer` and a ~20s block, which is neither "the key is wrong" nor "the
# guest is broken" and would have been graded as the first.
#
# `Permission denied` in the output is the marker of a connection that DID reach
# authentication and was answered: that is a real verdict about the key and is never
# retried. Anything else - a reset, a timeout, a refused connection - is retried
# once after a wait longer than the observed penalty. Worst case here is
# 25 + 22 + 25 = 72s of the 120s this transport allows one exec, and everything else
# in this grader is sub-second.
#
# The here-string carries no producer, so `grep -q` on it is not the SIGPIPE trap
# content/lib/assert.sh documents.
login_probe() { timeout 25 ssh "${SSH_OPTS[@]}" "$TARGET_USER@localhost" true 2>&1 < /dev/null; }
login_out=$(login_probe)
login_rc=$?
login_retried=
if (( login_rc != 0 )) && ! grep -qF 'Permission denied' <<<"$login_out"; then
  # Read before the retry overwrites it: this sentence is about the FIRST attempt.
  login_retried=" The first attempt never reached authentication ($(printf '%s' "${login_out:-no output}" | tr '\n' ' ' | cut -c1-80)), so this was probed a second time after a 22s wait; if both attempts were reset rather than denied, the cause is sshd's PerSourcePenalties refusing a source address that has accumulated failed logins, not this key."
  sleep 22
  login_out=$(login_probe)
  login_rc=$?
fi
if (( login_rc == 0 )); then
  ck_pass deploy-key-login "student can log in as $TARGET_USER on this host with no password and no prompt"
else
  # The diagnosis is ordered by what is actually wrong, and the SELinux case is
  # named as a context problem rather than folded into a complaint about
  # permissions - a candidate told "check the permissions" on a correctly-chmodded
  # file will re-chmod it and get nowhere.
  # The default hint covers the case where every file on disk checks out, which on
  # this task means the client never offered the key: ssh tries the default
  # identity filenames and nothing else, so a key called deploy_key is not offered
  # by a plain login at all. This probe is deliberately plain - no -i, no config -
  # because that is what the prompt asks for.
  hint="every file checks out, so the client is not offering the key. ssh only tries its default identity names (id_ed25519, id_rsa and the rest) unless it is told otherwise, so a key file with a name of its own needs an IdentityFile line in student's own ~/.ssh/config - or a default name"
  if [[ $matched != yes ]]; then
    hint="deploy's authorized_keys does not hold the public half of a key student can use, so there is nothing for sshd to accept"
  elif [[ -n $perm_bad ]]; then
    hint="the modes or ownership are wrong (${perm_bad# }), and with StrictModes on sshd ignores the key rather than reporting it"
  elif (( ctx_rc != 0 )) || [[ -n $(grep -i relabel <<<"$ctx_out") ]]; then
    hint="the modes are right, so this is the SELinux context and not the permissions: the policy would relabel these paths, which means sshd is being denied read access to a file whose modes look perfect. Contexts now: ${ctx_ls:-unreadable}"
  elif [[ -n $priv_open ]]; then
    # Ahead of the passphrase branch because it is the stronger claim: this key
    # reached ssh-keygen fine, so nothing above this line is red, and the refusal
    # comes from the CLIENT before a single packet is sent.
    hint="student's private key file is readable or writable by somebody other than student (${priv_open# }), and the ssh CLIENT refuses to use a key like that at all - it prints 'UNPROTECTED PRIVATE KEY FILE' and ignores it, so no key is ever offered and the server's answer is the same Permission denied as if none existed. chmod 0600 the private key"
  elif [[ -z $priv_blobs && -n $priv_encrypted ]]; then
    # Both halves of that test are needed. An encrypted key sitting in ~/.ssh is
    # only the explanation when there is no usable key at all - a candidate who
    # keeps a passphrase-protected key for their own use AND generated a
    # passphrase-less one for the job has done nothing wrong, and blaming the
    # passphrase would send them to fix the wrong file.
    hint="student's private key is protected by a passphrase (${priv_encrypted# }), and a batch session has nowhere to type it - an agent loaded in some other shell does not travel to this one"
  fi
  ck_fail deploy-key-login "student can log in as $TARGET_USER on this host with no password and no prompt" \
    "the client exited $login_rc and said: $(printf '%s' "${login_out:-no output}" | tr '\n' ' ' | cut -c1-200). Diagnosis: $hint.${login_retried}"
fi

# --- 6. the private key stayed where it belongs -------------------------
# An invariant: it holds on an untouched machine, where deploy has no .ssh at all,
# so it cannot be a baseline failure. It exists because the single most common way
# to get this task "working" wrongly is to copy the private key over as well, or
# instead - and both are a real incident, not a style point: the automation's
# private key now sits in an account whose password is written in the ticket.
# antisolutions/02 does exactly the `instead` half, which is what anchors this id.
#
# grep on FILES under a directory, so there is no producer for -l to kill (the
# SIGPIPE trap content/lib/assert.sh documents). A missing directory yields no
# match and passes, which is the honest reading of "deploy holds no private key"
# rather than a vacuous pass over something unreadable: sudo can read everything
# there, and the perms checkpoint above independently reports the directory's
# absence.
leaked=$(sudo grep -rlF -e 'PRIVATE KEY-----' "$TARGET_SSH_DIR" 2>/dev/null | tr '\n' ' ')
if [[ -z $leaked ]]; then
  ck_pass deploy-no-private-key "no private key was left anywhere in deploy's SSH directory"
else
  ck_fail deploy-no-private-key "no private key was left anywhere in deploy's SSH directory" \
    "these files under $TARGET_SSH_DIR contain private key material: ${leaked% }. authorized_keys takes the PUBLIC half - the .pub file. A private key copied into another account is a private key you no longer control, and sshd cannot authenticate anyone with it either"
fi

# --- 7. SELinux is still Enforcing --------------------------------------
# An invariant, and the one that catches the answer that "works": a candidate who
# hits the label problem, cannot see it, and reaches for `setenforce 0` has a
# login that works perfectly until the next boot. antisolutions/04 is that
# candidate, which is what anchors this id - and it is the reason this task's
# second verdict is worth collecting at all.
#
# Fails closed: an empty or unexpected answer is not "Enforcing".
enforce=$(getenforce 2>&1)
if [[ $enforce == Enforcing ]]; then
  ck_pass selinux-enforcing "SELinux is still in Enforcing mode"
else
  ck_fail selinux-enforcing "SELinux is still in Enforcing mode" \
    "getenforce reports '${enforce:-nothing}'. Turning SELinux off is not a fix for a mislabelled file: /etc/selinux/config still says enforcing, so the next boot brings the denial back with nothing on the running system to explain it"
fi

# --- 8. the server was not weakened ------------------------------------
# An invariant, and knowingly unprobed: the fixture that would exercise it is the
# candidate who answers the StrictModes problem with `StrictModes no` and a
# restart of sshd. That fixture was CONSIDERED AND REJECTED, and the reason is
# worth recording where the next author will read it - it is the most instructive
# mistake in this whole subject and it is a landmine. It has to restart the very
# daemon the harness is being graded through, from a config file it has just
# edited, on a machine where a mistake in that edit is not a red checkpoint but a
# guest nobody can reach again. Grading the setting is free; demonstrating it is
# not. (Declared unprobed in the header at the top of this file, with the other
# one: the parser accepts a single header of that kind per grader, so the two
# declarations share one line and the reasoning stays next to the checkpoint.)
#
# Two witnesses, and the second is not decoration. `sshd -T` is the right question
# - it is the running server's own effective answer - but this checkpoint must not
# be hostage to one command on a guest where the grader cannot repair anything: if
# it cannot be run, the fallback asks the configuration files whether anything
# DISABLES either setting, and reports which witness answered. That is fail-closed
# with respect to the thing being asserted (a weakening edit) without being
# fail-closed with respect to the instrument.
#
# "Could not be read" is decided by whether the two settings are IN the output,
# not by whether the output is empty: `sshd -T` prints its complaint on the same
# stream when it declines to run at all (no host keys, no privilege separation
# directory, an unreadable include), and a non-empty error message is not an
# answer about StrictModes. Treating it as one would report a weakened server on a
# guest where nothing had been weakened.
sshd_eff=
[[ -x /usr/sbin/sshd ]] && sshd_eff=$(sudo timeout 20 /usr/sbin/sshd -T 2>&1)
sshd_said=$(grep -iE '^(pubkeyauthentication|strictmodes)[[:space:]]' <<<"$sshd_eff")
if [[ -n $sshd_said ]] && grep -qix 'pubkeyauthentication yes' <<<"$sshd_said" &&
   grep -qix 'strictmodes yes' <<<"$sshd_said"; then
  ck_pass sshd-key-auth-intact "the SSH server still accepts public keys and still enforces StrictModes"
elif [[ -z $sshd_said ]]; then
  # grep over FILES with a glob that may match nothing; -s keeps an unreadable or
  # absent path quiet, and the -r on the drop-in directory is what makes the
  # absent-directory case a clean no-match.
  weakened=$(sudo grep -risE '^[[:space:]]*(PubkeyAuthentication[[:space:]]+no|StrictModes[[:space:]]+no)' \
      /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null | tr '\n' ' ')
  if [[ -z $weakened ]]; then
    ck_pass sshd-key-auth-intact "the SSH server still accepts public keys and still enforces StrictModes" \
      "the effective server configuration could not be read ($(printf '%s' "${sshd_eff:-no output}" | tr '\n' ' ' | cut -c1-120)), so this was answered from /etc/ssh/sshd_config and /etc/ssh/sshd_config.d instead, which say nothing disables either setting"
  else
    ck_fail sshd-key-auth-intact "the SSH server still accepts public keys and still enforces StrictModes" \
      "the effective server configuration could not be read, and the configuration files disable one of them: ${weakened% }"
  fi
else
  ck_fail sshd-key-auth-intact "the SSH server still accepts public keys and still enforces StrictModes" \
    "the running server reports: $(printf '%s' "$sshd_said" | tr '\n' ' '). This task is about one account's files; a key that only works because the server stopped checking is not key-based authentication configured, it is a machine with its checks turned off"
fi

# --- 9. the harness's own way in ---------------------------------------
# An invariant, and the reason this grader can be trusted at all. Knowingly
# unprobed, for the reason troubleshooting/028's student-intact records and more
# sharply: an anti-solution that damaged student's own key would destroy the
# channel every verdict arrives over, so the harness could not tell "correctly
# broken" from "unreachable". No fixture in this task goes near it, and the
# prompt tells the student not to either.
#
# It is not decoration even so. `grade()` retries the post-reboot run over vmrun
# when the ssh channel has died, and a candidate who chmodded their way through
# this task with a recursive command on their own home directory arrives there:
# this line is then the difference between a verdict that says what happened and
# one that says the guest went away. Declared unprobed in the header at the top of
# this file.
chan_bad=
read -r chan_owner chan_mode < <(stat -c '%U %a' "$STUDENT_SSH_DIR" 2>/dev/null)
[[ ${chan_owner:-} == "$STUDENT_USER" ]] || chan_bad="$chan_bad dir-owner=${chan_owner:-absent}"
if [[ -n ${chan_mode:-} ]]; then
  (( 8#$chan_mode & 022 )) && chan_bad="$chan_bad dir-mode=$chan_mode"
else
  chan_bad="$chan_bad dir-mode=unreadable"
fi
read -r ak_owner ak_mode < <(stat -c '%U %a' "$STUDENT_AK" 2>/dev/null)
[[ ${ak_owner:-} == "$STUDENT_USER" ]] || chan_bad="$chan_bad file-owner=${ak_owner:-absent}"
if [[ -n ${ak_mode:-} ]]; then
  (( 8#$ak_mode & 022 )) && chan_bad="$chan_bad file-mode=$ak_mode"
else
  chan_bad="$chan_bad file-mode=unreadable"
fi
[[ -s $STUDENT_AK ]] || chan_bad="$chan_bad file-empty"
[[ -n $(awk "$BLOB_AWK" "$STUDENT_AK" 2>/dev/null) ]] || chan_bad="$chan_bad no-key-in-file"

if [[ -z $chan_bad ]]; then
  ck_pass student-channel-intact "student's own ~/.ssh and authorized_keys are as they were"
else
  ck_fail student-channel-intact "student's own ~/.ssh and authorized_keys are as they were" \
    "wrong:${chan_bad}. This is how the harness reaches this machine, and this task asked for a SECOND account's files to be changed, not student's. If this line is red, whatever else is red below or above it is the smaller problem"
fi

exit 0
