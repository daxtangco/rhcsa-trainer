#!/usr/bin/env bash
# Equally correct, and deliberately different in every part:
#   chsh instead of usermod for field 7, and /usr/bin/bash rather than /bin/bash,
#     so a grader that string-matched one spelling would wrongly reject this
#   passwd --stdin instead of chpasswd for the password
#   the prompt lives in /etc/bashrc behind a guard instead of in the account's own
#     ~/.bashrc, so the file the student edited proves nothing about the answer
#   the working directory comes from $PWD rather than from the `\w` escape, and
#     the value is expanded at prompt time by promptvars rather than by bash's
#     prompt escapes
#
# The guard is what keeps this a correct answer rather than the anti-solution in
# antisolutions/02: /etc/bashrc is read by every interactive shell on the host, so
# an unguarded PS1 here would change root's prompt and student's too, which the
# prompt forbids. Guarded, it changes exactly one account's prompt - by a
# different route than solution 01 takes, which is the point of shipping both.
set -euo pipefail
sudo chsh -s /usr/bin/bash oncall
echo 'Rh9-Oncall-9d41' | sudo passwd --stdin oncall
sudo tee -a /etc/bashrc >/dev/null <<'PROMPT'
if [ "$(id -un)" = oncall ]; then PS1='\u@\h:$PWD\$ '; fi  # rhcsa041
PROMPT
