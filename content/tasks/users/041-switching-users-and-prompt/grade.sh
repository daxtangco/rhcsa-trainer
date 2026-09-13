#!/usr/bin/env bash
# Grader for users/041-switching-users-and-prompt.
#
# READ-ONLY in the sense the contract at the top of content/lib/assert.sh means
# it: nothing this grader does changes any state any checkpoint here or in any
# other task measures. It is not literally write-free, and the one exception is
# named rather than hidden - every prompt probe below runs `su`, `su` opens a PAM
# session, and /etc/pam.d/postlogin runs a non-silent `pam_lastlog` for the `su`
# service, which stamps /var/log/lastlog for the account being probed. No task in
# this bank grades lastlog, wtmp is excluded by that module's `nowtmp` option, and
# the alternative - probing through `sudo -u` instead of `su` - would stop
# measuring the thing this task is about. The files the checkpoints do read
# (/etc/passwd, /etc/shadow, and every startup script) are untouched.
#
# The exit code is ignored; only the JSONL emitted by the assert helpers is read.
# content/lib/assert.sh is prepended by loadTaskScripts, so its helpers are
# already in scope - do not source it.
#
# THE PROMPT IS GRADED BY OBSERVATION, NOT BY READING A FILE. Nothing below greps
# ~oncall/.bashrc, /etc/bashrc or /etc/profile.d. It starts a shell the way the
# student was told the account would be reached, renders that shell's PS1, and
# looks at the result. That is the whole point of the task: a student who put PS1
# in ~/.bash_profile passes any grep and then watches the prompt vanish the
# moment somebody arrives by `su oncall` instead of `su - oncall`. A grader that
# reads files cannot tell those two answers apart, and it also rejects the
# perfectly good answer that guards a block in /etc/bashrc (spec 6.5 rule 1).
#
# Six checkpoints, because this task fails in four independent ways - an account
# with no shell, an account with no usable password, and a prompt that reaches
# one kind of interactive shell but not the other - plus two invariants that
# catch an answer which satisfies the letter of the prompt by changing the
# prompt of every account on the host.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: login-shell, login-password, prompt-login, prompt-nonlogin
set -uo pipefail

TARGET_USER=oncall
# The trainer's own account, hardcoded the way sys/035 hardcodes it: it is
# RHCSA_SSH_USER's default, it is the account docs/vm-build-checklist.md creates,
# and it is the account the prompt names when it says no other prompt may change.
CONTROL_USER=student
# Where every prompt probe stands while it renders PS1, and the choice is
# load-bearing twice over. It must be OUTSIDE every home directory, because `\w`
# renders a home directory as `~` and the whole discriminator here is `\w` (the
# full path) against `\W` (the last component only) - probing inside ~oncall
# would make the two indistinguishable. And it must be a directory every account
# on the host can enter, or the probe would fail as a permission problem and be
# graded as a wrong prompt. /usr/share/doc is 0755 and present on every RHEL 9
# install; setup.sh checks it is there rather than assuming.
PROBE_DIR=/usr/share/doc

# --- the probe ------------------------------------------------------------
# What runs INSIDE the shell being measured. Two things about it are deliberate:
#
#   ${PS1@P} is bash's prompt expansion, so what comes back is the prompt as it
#   would be printed - `\u`, `\h`, `\w`, `\$`, an embedded $PWD and a command
#   substitution all rendered. That is what makes this mechanism-agnostic: a
#   student who wrote `\w`, one who wrote $PWD and one who wrote `$(pwd)` are all
#   graded on the same rendered text. It needs bash 4.4 or newer; RHEL 9 ships
#   5.1, and setup.sh proves the transformation works on this guest before the
#   student starts rather than letting a silent empty expansion read as a wrong
#   answer.
#
#   The `cd` happens inside the measured shell, after its startup files have run,
#   so the working directory PS1 renders is $PROBE_DIR and not whatever su chose.
#
# A sentinel is printed immediately before the prompt so that render_prompt can
# throw away everything else that reached stdout first, and there is always
# something: `su` opens a PAM session, /etc/pam.d/postlogin runs a NON-silent
# `pam_lastlog` for the `su` service, and from the second probe of an account
# onwards that module prints `Last login: <date>` on stdout ahead of anything the
# measured shell produces. A student's own /etc/profile.d script that echoes is
# the same shape. None of it is prompt text, and letting it through would leave
# `[[ -z $rendered ]]` permanently false - so a shell that never started would be
# reported as a shell with a wrong prompt - and would paste PAM's output into the
# detail line the student reads. files/033's grader solves the same problem for
# the same probe shape with `| tail -n1`; a sentinel is used here instead because a
# prompt is allowed to contain a newline and `tail` would silently truncate it.
#
# Built with printf so $PROBE_DIR appears exactly once in this file. The result
# contains double quotes and no single quote, which is what lets render_prompt
# wrap it in single quotes below.
PROBE_MARK=__RHCSA041_PS1__
PROBE=$(printf 'cd %s || exit 3; printf "%%s%%s" %s "${PS1@P}"' "$PROBE_DIR" "$PROBE_MARK")

# render_prompt USER login|nonlogin -> the rendered prompt on stdout, empty on failure.
#
# The two modes are the two ways the prompt says the account will be reached, and
# they differ in exactly one thing: whether the measured shell is a login shell.
#   login    ~ `su - oncall`: reads /etc/profile and ~/.bash_profile, and ~/.bashrc
#              through it on a stock RHEL home directory
#   nonlogin ~ `su oncall`:   reads ~/.bashrc, and /etc/bashrc through it. Not
#              /etc/profile and not ~/.bash_profile. Note that this still reaches
#              /etc/profile.d/*.sh, because RHEL 9's /etc/bashrc sources that
#              directory itself inside its `if ! shopt -q login_shell` branch -
#              measured on 9.8. So the login probe is a superset of the non-login
#              one, not a different set of files.
#
# Three details that are not decoration:
#
#   `bash -ic` and not `bash -c`. PS1 is only set in an INTERACTIVE shell - bash
#   leaves it unset otherwise, and /etc/bashrc's own default is guarded on it - so
#   a non-interactive probe would render an empty prompt for every answer, correct
#   or not. -i without a tty prints a job-control warning to stderr, which is why
#   stderr is discarded here.
#
#   `su -s /bin/bash` on purpose, so these probes do NOT depend on field 7 of the
#   student's /etc/passwd entry. At the unsolved baseline oncall's shell is
#   /sbin/nologin and a plain `su - oncall` would refuse outright; the prompt
#   checkpoints would then fail for a reason login-shell already reports, and
#   would keep failing for a student who fixed the prompt and not the shell. One
#   fact per checkpoint means the prompt probes have to be blind to the shell
#   field, and -s is what makes them blind to it.
#
#   HISTFILE=/dev/null keeps this grader out of the home directories it measures.
#   An interactive bash writes its history on exit and /etc/bashrc runs
#   `history -a` at startup, either of which would create or extend
#   ~oncall/.bash_history - a grader modifying the machine it measures, which the
#   contract at the top of content/lib/assert.sh forbids. It is also the file a
#   student would find their own graded session's commands in.
#
# There is nothing for PS1 to leak in from, and the reason is the invocation
# rather than sudo: this grader runs over ssh stdin as a non-interactive shell, so
# PS1 is unset here. Do NOT lean on sudo for that - RHEL's /etc/sudoers lists PS1
# in `env_keep`, and `su` without `-l` preserves the caller's environment apart
# from HOME, SHELL, USER and LOGNAME, so an inherited PS1 would reach the measured
# shell and pre-empt /etc/bashrc's default (which only fires when PS1 is still
# bash's own `\s-\v\$ `). Nothing in the harness runs this grader interactively; if
# something ever does, that is the hole.
render_prompt() {
  local user=$1 kind=$2 out
  local -a su_opts=(-s /bin/bash) bash_opts=(-ic)
  if [[ $kind == login ]]; then
    su_opts+=(-l)
    bash_opts=(-lic)
  fi
  # The subshell's cd matters: su without -l keeps the caller's working
  # directory, and the harness may run this grader from a directory the target
  # account cannot read. timeout, because a startup file that blocks would
  # otherwise hang the whole run rather than failing one checkpoint.
  out=$(
    (
      cd "$PROBE_DIR" 2>/dev/null || cd /
      timeout 30 sudo su "${su_opts[@]}" -c "HISTFILE=/dev/null bash ${bash_opts[*]} '$PROBE'" "$user"
    ) </dev/null 2>/dev/null
  )
  # No sentinel means the probe never reached its printf, so there is no prompt to
  # report - whatever else is on stdout is PAM's or a startup file's, and returning
  # it would be reporting someone else's output as the student's answer. The first
  # occurrence, not the last, so a PS1 that happened to contain the sentinel could
  # not eat its own prompt.
  [[ $out == *"$PROBE_MARK"* ]] || return 0
  printf '%s' "${out#*"$PROBE_MARK"}"
}

# prompt_shortfall RENDERED USER -> the required facts that are missing, empty if none.
#
# Substring tests, not a pattern for one layout: the prompt tells the student to
# arrange the three facts however they like. A rendered prompt that contains the
# FQDN satisfies the host test, because the short name is a prefix of it.
prompt_shortfall() {
  local rendered=$1 user=$2 clean missing=''
  # \001 and \002 are what `\[` and `\]` become once rendered, and a coloured
  # prompt carries CSI escapes. Neither is text the student put there to be read,
  # and both can sit between the characters being searched for.
  clean=$(printf '%s' "$rendered" | tr -d '\001\002' | sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]//g')
  [[ $clean == *"$user"* ]] || missing+="the account name ($user); "
  [[ $clean == *"$HOST_SHORT"* ]] || missing+="the host name ($HOST_SHORT); "
  [[ $clean == *"$PROBE_DIR"* ]] || missing+="the whole working directory ($PROBE_DIR - a prompt built on \\W shows only its last component); "
  printf '%s' "$missing"
}

# usable_password USER -> exit 0 if that account can authenticate with a password.
#
# Field 2 of the /etc/shadow line, read through getent, which is the interface
# shadow(5) documents rather than an assumption about the file. Four states are
# not a usable password and they are four different mistakes:
#   empty      no password at all - PAM would let anyone in with no password,
#              which is not what "give it a password" asked for
#   !          locked; `!!` is the never-set form useradd writes, `!$6$...` is a
#              set password that usermod -L or passwd -l has since disabled
#   *          disabled, the form used for accounts that must never authenticate
#   not $-led  a plaintext string dropped into the hash field by `usermod -p` or
#              `chpasswd -e`. crypt(3) hashes on RHEL 9 are yescrypt or SHA-512
#              and both begin `$id$`, so nothing shipped can produce a usable
#              hash without one - and an account whose field holds a plaintext
#              cannot be logged into with that plaintext, or with anything else.
usable_password() {
  local entry hash
  entry=$(sudo getent shadow "$1" 2>/dev/null) || return 2
  [[ -n $entry ]] || return 2
  hash=$(printf '%s' "$entry" | awk -F: '{print $2}')
  case $hash in
    '' | '!'* | '*'*) return 1 ;;
    '$'*) return 0 ;;
    *) return 1 ;;
  esac
}

# is_bash_shell USER -> exit 0 if field 7 of the passwd line is an executable bash.
is_bash_shell() {
  local sh
  sh=$(getent passwd "$1" 2>/dev/null | awk -F: '{print $7}')
  [[ -n $sh && ${sh##*/} == bash && -x $sh ]]
}

HOST_SHORT=$(hostname -s 2>/dev/null)

# FAIL CLOSED, the same way storage/014 does with its size targets. An empty
# $HOST_SHORT turns `[[ $clean == *""* ]]` into a test that is TRUE for every
# string, so a grader that could not read its own hostname would report the host
# half of the prompt as satisfied by any answer at all. A missing account or a
# missing probe directory is the same shape one step earlier: nothing below could
# measure anything, and reporting passes for checkpoints that were never probed
# is the one failure this bank refuses to make.
if [[ -z $HOST_SHORT ]] || ! id "$TARGET_USER" &>/dev/null || [[ ! -d $PROBE_DIR ]]; then
  detail="grader could not establish its own preconditions: hostname -s gave '${HOST_SHORT:-empty}', account $TARGET_USER $(id "$TARGET_USER" &>/dev/null && printf exists || printf 'does not exist'), probe directory $PROBE_DIR $([[ -d $PROBE_DIR ]] && printf present || printf missing). setup.sh checks all three, so either it did not run or the account was removed after it did"
  ck_fail login-shell "oncall's login shell is bash" "$detail"
  ck_fail login-password "oncall has a password that can be typed at a login prompt" "$detail"
  ck_fail prompt-login "an interactive login shell as oncall shows the account, the host and the whole working directory in its prompt" "$detail"
  ck_fail prompt-nonlogin "an interactive shell as oncall that is not a login shell shows that same prompt" "$detail"
  ck_fail other-prompts-unchanged "the student account's own prompt is unchanged" "$detail"
  ck_fail student-login-intact "the student account can still log in: bash login shell, usable password" "$detail"
  exit 0
fi

# --- 1. the account has a shell to log in to ------------------------------
# Field 7 and nothing else. /sbin/nologin is what setup.sh leaves here, and it is
# also what `useradd -r` or a copied service-account entry leaves on a real host:
# the account is fine, authentication is fine, and login prints one line and hangs
# up. bash specifically, because the prompt asks for a Bash shell and because
# every other half of this task rests on bash's startup files - /bin/sh is bash in
# POSIX mode, which reads $ENV and neither ~/.bashrc nor ~/.bash_profile, so an
# answer of /bin/sh would take the two prompt checkpoints down with it and the
# student would be hunting the wrong bug.
if is_bash_shell "$TARGET_USER"; then
  ck_pass login-shell "oncall's login shell is bash"
else
  ck_fail login-shell "oncall's login shell is bash" \
    "getent passwd $TARGET_USER reports shell '$(getent passwd "$TARGET_USER" | awk -F: '{print $7}')'; an account whose shell is /sbin/nologin is refused at login even when its password is right"
fi

# --- 2. and a password somebody could type --------------------------------
usable_password "$TARGET_USER"
pw_state=$?
if [[ $pw_state -eq 0 ]]; then
  ck_pass login-password "oncall has a password that can be typed at a login prompt"
elif [[ $pw_state -eq 2 ]]; then
  ck_fail login-password "oncall has a password that can be typed at a login prompt" \
    "could not read $TARGET_USER's shadow entry through getent, so the password state is unknown"
else
  ck_fail login-password "oncall has a password that can be typed at a login prompt" \
    "the shadow password field for $TARGET_USER is not a crypt(3) hash: it is empty, or it starts with ! or *, or it holds a plaintext string that usermod -p or chpasswd -e wrote as though it were already encrypted"
fi

# --- 3 and 4. the prompt, in both kinds of interactive shell --------------
# Two checkpoints for one requirement, and the difference between them is the
# whole lesson: they run the same probe against the same account and differ only
# in whether the shell was started as a login shell. ~/.bashrc satisfies both on
# a stock RHEL home directory, ~/.bash_profile satisfies only the first, and the
# student is told to check both.
login_prompt=$(render_prompt "$TARGET_USER" login)
nonlogin_prompt=$(render_prompt "$TARGET_USER" nonlogin)

if [[ -z $login_prompt ]]; then
  ck_fail prompt-login "an interactive login shell as oncall shows the account, the host and the whole working directory in its prompt" \
    "an interactive login shell as $TARGET_USER produced no prompt at all. Either PS1 is empty in it, or the shell could not start: the account may have been removed, or a startup file may be exiting or blocking"
else
  miss=$(prompt_shortfall "$login_prompt" "$TARGET_USER")
  if [[ -z $miss ]]; then
    ck_pass prompt-login "an interactive login shell as oncall shows the account, the host and the whole working directory in its prompt"
  else
    ck_fail prompt-login "an interactive login shell as oncall shows the account, the host and the whole working directory in its prompt" \
      "in $PROBE_DIR the prompt renders as '${login_prompt:0:100}', which is missing ${miss}"
  fi
fi

if [[ -z $nonlogin_prompt ]]; then
  ck_fail prompt-nonlogin "an interactive shell as oncall that is not a login shell shows that same prompt" \
    "an interactive non-login shell as $TARGET_USER produced no prompt at all. Either PS1 is empty in it, or the shell could not start"
else
  miss=$(prompt_shortfall "$nonlogin_prompt" "$TARGET_USER")
  if [[ -z $miss ]]; then
    ck_pass prompt-nonlogin "an interactive shell as oncall that is not a login shell shows that same prompt"
  else
    ck_fail prompt-nonlogin "an interactive shell as oncall that is not a login shell shows that same prompt" \
      "in $PROBE_DIR the prompt renders as '${nonlogin_prompt:0:100}', which is missing ${miss}. This is the shell somebody gets from 'su $TARGET_USER' without the dash: it reads ~/.bashrc and reads nothing from ~/.bash_profile or /etc/profile"
  fi
fi

# --- 5. nobody else's prompt moved ---------------------------------------
# An invariant: it passes at the unsolved baseline, and it exists to catch the
# answer that satisfies checkpoints 3 and 4 by writing PS1 into /etc/bashrc or a
# file in /etc/profile.d, which changes the prompt of every account on the host
# including root's. That answer is not a spelling variant of the right one, it is
# a different change, and the prompt forbids it in as many words.
#
# Probed by antisolutions/02, which is why it carries no # unprobed-invariant:
# header. Graded as "student's prompt does not show what oncall's was asked to
# show" rather than as a byte comparison against a stored copy: a grader that is
# read-only cannot have stashed a before-image, and the observable difference is
# exactly the one the requirement is about. A guarded block in /etc/bashrc that
# only fires for oncall passes here, and should: it changes nobody else's prompt.
#
# The probe is a LOGIN shell for student on purpose, because a login shell reads a
# superset of what a non-login one reads: /etc/profile and ~/.bash_profile on top
# of ~/.bashrc and /etc/bashrc. /etc/profile.d is NOT the discriminator it looks
# like - RHEL 9's /etc/bashrc sources that directory itself for a non-login shell,
# so both probes would see a global answer hidden there. The login probe is chosen
# for /etc/profile, which is the one place only it can reach.
control_prompt=$(render_prompt "$CONTROL_USER" login)
if [[ -z $control_prompt ]]; then
  ck_fail other-prompts-unchanged "the student account's own prompt is unchanged" \
    "no prompt came back from an interactive login shell as $CONTROL_USER, so this could not be judged; setup.sh proves it comes back before the student starts"
elif [[ $control_prompt == *"$PROBE_DIR"* ]]; then
  ck_fail other-prompts-unchanged "the student account's own prompt is unchanged" \
    "$CONTROL_USER's prompt now renders as '${control_prompt:0:100}', which shows the working directory in full the way $TARGET_USER's was asked to. The prompt was set somewhere every account reads - /etc/bashrc or /etc/profile.d - rather than somewhere only $TARGET_USER reads"
else
  ck_pass other-prompts-unchanged "the student account's own prompt is unchanged"
fi

# --- 6. the trainer can still get in -------------------------------------
# The second invariant, and the one this whole task was designed around rather
# than towards: every command in the answer is one that could as easily have been
# aimed at the control account. `usermod -s /sbin/nologin student` and
# `passwd -l student` are one mistyped word away from the right answer, and both
# are how a real exam candidate locks themselves out of the machine they are being
# graded on.
#
# Knowingly unprobed: no anti-solution can break this safely. Locking the control
# account's password or taking away its shell is exactly the damage the checkpoint
# names, and the harness reaches this guest as that account - so a fixture that
# broke it could not be told apart from a guest that has stopped answering, which
# is design decision 1's rule. Sudo here is NOPASSWD and ssh is key-based, so a
# STUDENT who breaks it still gets graded and still gets told; it is only the
# fixture that cannot prove it. That is the risk being accepted: this checkpoint
# passes for every fixture in this task, so an unconditional pass here would
# validate green across all of them.
# unprobed-invariant: student-login-intact
usable_password "$CONTROL_USER"
control_pw=$?
if is_bash_shell "$CONTROL_USER" && [[ $control_pw -eq 0 ]]; then
  ck_pass student-login-intact "the student account can still log in: bash login shell, usable password"
else
  ck_fail student-login-intact "the student account can still log in: bash login shell, usable password" \
    "$CONTROL_USER's shell is '$(getent passwd "$CONTROL_USER" | awk -F: '{print $7}')' and its shadow password field is $([[ $control_pw -eq 0 ]] && printf 'a usable hash' || printf 'not a usable hash'). Whatever was aimed at $TARGET_USER landed here instead"
fi

exit 0
