#!/usr/bin/env bash
# The mistake this whole task exists to detect, and the one a real student makes
# because their own test agreed with them.
#
# PS1 goes into ~oncall/.bash_profile. The student then checks it with
# `su - oncall`, sees the new prompt, and is finished - a login shell reads
# ~/.bash_profile, so that test passes and will keep passing forever. The next
# administrator arrives with `su oncall`, gets an interactive shell that is NOT a
# login shell, and that shell reads ~/.bashrc and nothing from profile. The prompt
# is simply not there, and nothing anywhere reported a problem.
#
# Everything else here is deliberately correct - the shell, the password, and no
# other account touched - so a green login half and a green prompt-login prove the
# grader is distinguishing the two kinds of interactive shell rather than failing
# this fixture wholesale. That distinction is the only difference between this file
# and solutions/01: one word of the filename.
#
# It is also why grading the prompt by grepping a file would certify this as
# correct: the string is in a startup script in the right home directory, owned by
# the right account, in the file half the internet would tell you to use.
# expect-fail: prompt-nonlogin
set -euo pipefail
sudo usermod -s /bin/bash oncall
echo 'oncall:Rh9-Oncall-9d41' | sudo chpasswd
sudo -u oncall tee -a /home/oncall/.bash_profile >/dev/null <<'PROMPT'
PS1='[\u@\h \w]\$ '  # rhcsa041
PROMPT
