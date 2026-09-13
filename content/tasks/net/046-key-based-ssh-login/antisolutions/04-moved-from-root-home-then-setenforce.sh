#!/usr/bin/env bash
# The answer that works today and will not work tomorrow, and the reason this task
# collects a second verdict at all.
#
# The story runs in two moves, and both are things people really do:
#
#   1. The key is assembled in root's own home directory and moved into place.
#      Perfectly normal - you are already running sudo, /root is where root's
#      scratch files go, `mv` when it is ready. But a label belongs to the inode,
#      and `mv` carries it: the file arrives in /home/deploy/.ssh still labelled
#      admin_home_t, and nothing in the policy lets sshd read that type. The modes
#      are right, the owner is right, the key is right, and the login is refused.
#      (`cp -a` and `cp --preserve=context` do the same thing for the same reason;
#      `cp` on its own, or a redirect, would have been correct here, because a file
#      CREATED in that directory is labelled by the policy rather than by its
#      history.)
#
#   2. The candidate cannot see it - `ls -l` shows nothing wrong - remembers that
#      SELinux exists, and turns it off. The login starts working immediately, which
#      is the worst possible feedback: it confirms the diagnosis and rewards the
#      wrong fix. `setenforce 0` changes the running kernel only; /etc/selinux/config
#      still says enforcing, so the next boot brings the denial back with a machine
#      that now looks untouched.
#
# The fix that was skipped is one command - `restorecon -R -v /home/deploy/.ssh` -
# and the way to see the problem before guessing is the same command with -n.
#
# ---------------------------------------------------------------------------
# WHY /root AND NOT /tmp, WHICH IS THE VERSION EVERY BOOK TEACHES
#
# This fixture staged the key in /tmp until 2026-09-14, on the strength of the
# oldest SELinux story there is: a file moved in from /tmp keeps user_tmp_t and
# sshd cannot read it. On RHEL 9 that story is FALSE, and this fixture is how it
# was caught - it reported `verdict B deploy-key-login: expected fail, got pass`
# against the guest, which is to say the login worked perfectly under Enforcing
# with a user_tmp_t authorized_keys.
#
# The shipped policy says why. Queried against the guest's own build,
# selinux-policy-targeted-38.1.75-2.el9_8, policy.33:
#
#   allow domain tmpfile:file { append getattr ioctl lock read };
#   allow sshd_t user_tmp_type:file { create link map open relabelfrom relabelto
#                                     rename setattr unlink watch watch_reads write };
#
# user_tmp_t carries both attributes and sshd_t is a domain, so the union of those
# two rules hands sshd exactly open + read + getattr on the file. There is no
# denial to find. The blanket tmpfile rule is the modern half; the folklore
# predates it, which is why a decade of notes and a good many books still teach a
# refusal that no longer happens.
#
# admin_home_t was chosen by asking the same policy the same question rather than
# by picking another plausible directory. `sesearch -A -s sshd_t -t admin_home_t
# -c file -p read,open` returns nothing at all, and the only thing sshd_t may do
# with the type is traverse it: `allow sshd_t file_type:dir { getattr open search }`.
# Note where the boundary falls, because it is the interesting part of the lesson -
# /root/.ssh is ssh_home_t by file_contexts, which is exactly why root's own key
# logins work; what is denied is a file that sat in /root WITHOUT being under
# /root/.ssh. default_t, var_t and unlabeled_t answer the same way and would have
# served equally well; /root wins on being the likeliest place a real
# administrator actually builds the file.
#
# If this fixture ever reports the login passing in verdict B again, re-run that
# sesearch against the policy the guest is running before touching anything else
# here. It is the cheap half of the diagnosis, it needs no guest, and the answer
# is a property of the shipped policy rather than of this content.
# ---------------------------------------------------------------------------
#
#   deploy-key-context is wrong in both verdicts: nothing here ever relabels the
#     file, so it carries no phase.
#   selinux-enforcing is wrong NOW and right again after the reboot, because the
#     config file was never edited: @pre. That asymmetry is the whole lesson - the
#     evidence of the wrong fix disappears at exactly the moment its consequences
#     arrive.
#   deploy-key-login is right NOW, because SELinux is not enforcing, and wrong after
#     the reboot: @post. A candidate who only ever tested it today has no way to
#     know.
# expect-fail: deploy-key-context, selinux-enforcing@pre, deploy-key-login@post
set -euo pipefail

umask 0077
ssh-keygen -t ed25519 -N '' -C 'student@lab deploy automation' -f "$HOME/.ssh/id_ed25519" < /dev/null

# The scratch build, in the place a sudo session naturally reaches for. `cp` rather
# than `cp -a`, so the copy is labelled by the policy for where it lands: everything
# created in /root is admin_home_t, which is correct for /root and wrong everywhere
# else.
sudo cp "$HOME/.ssh/id_ed25519.pub" /root/deploy-authorized_keys
sudo ls -Z /root/deploy-authorized_keys

# The directory is MADE here, so its own label is correct - which is what makes this
# fixture precise: only the file that was moved in is wrong.
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh

# The move that carries the label across. No restorecon follows it, and that
# omission is the entire defect.
sudo mv /root/deploy-authorized_keys /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 0600 /home/deploy/.ssh/authorized_keys

# Read these two lines side by side during a validation run: the modes and the owner
# are indistinguishable from the model answer, and the context is not.
sudo ls -lZ /home/deploy/.ssh
sudo restorecon -n -v /home/deploy/.ssh /home/deploy/.ssh/authorized_keys || true

# The refusal, and the message that says nothing useful.
timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost true < /dev/null || true

# Where the real answer was available all along, for whoever thinks to look. This is
# read-only and it names the file and the context in one line.
#
# `< /dev/null` is not decoration, and leaving it off cost this fixture a validation
# run. ausearch reads its events from STDIN whenever stdin is not a terminal, and
# this script arrives on bash's stdin (src/engine/vm/ssh.ts pipes it into `bash -s`),
# so without the redirect ausearch swallowed every line below it. bash then reached
# end-of-input and exited 0 - a fixture that reported success while never running its
# own second half, which is why the run came back saying SELinux was still Enforcing
# after a `setenforce 0` that had never executed. Reproduced on the host on
# 2026-09-14: the same heredoc with and without the redirect prints one line or two,
# and exits 0 either way. Every child that might read stdin in this bank carries this.
sudo ausearch -m avc -ts recent < /dev/null 2>/dev/null | tail -n 20 || true

# The wrong fix. Runtime only - /etc/selinux/config is not touched, which is why
# this survives exactly until the next boot.
sudo setenforce 0

# And now it works, which is the trap. `|| true` even here, where success is what
# this fixture is asserting: a fixture that exits non-zero is a run with no verdict
# at all, and the mismatch is the grader's to report rather than this script's to
# crash on.
timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost true < /dev/null || true
getenforce
