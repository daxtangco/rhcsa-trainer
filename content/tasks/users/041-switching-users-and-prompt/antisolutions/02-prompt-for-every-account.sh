#!/usr/bin/env bash
# The answer that satisfies the letter of the prompt and misses the point: PS1 is
# written into /etc/bashrc with no guard, so oncall gets the required prompt in
# both kinds of interactive shell - and so does student, and so does root, and so
# will every account created afterwards.
#
# This is the fixture that makes other-prompts-unchanged a real checkpoint rather
# than an unprobed invariant. prompt-login and prompt-nonlogin both PASS here, on
# purpose: the requirement about oncall's prompt is genuinely met, and if the
# grader had only those two checkpoints this would be indistinguishable from
# solutions/02 - which edits the same file, one line longer, with a guard around
# it. The single difference between a correct answer and this one is the scope it
# was applied at, and that has to be its own verdict line or the student is told
# "correct" for a change that alters every login on the host.
#
# Note what is NOT wrong here. /etc/bashrc is a legitimate place for a prompt; the
# grader accepts solutions/02 for using it. What is wrong is the absence of any
# test for who is being configured.
# expect-fail: other-prompts-unchanged
set -euo pipefail
sudo usermod -s /bin/bash oncall
echo 'oncall:Rh9-Oncall-9d41' | sudo chpasswd
sudo tee -a /etc/bashrc >/dev/null <<'PROMPT'
PS1='[\u@\h \w]\$ '  # rhcsa041
PROMPT
