#!/usr/bin/env bash
# The per-account answer, and the one the task is teaching: give the account a
# shell, give it a password, and put PS1 in the one startup file that BOTH kinds
# of interactive shell read.
#
# ~/.bashrc is read directly by an interactive non-login shell and, on a stock
# RHEL home directory, reached by a login shell too because the skeleton
# .bash_profile sources it. That is why one line in one file satisfies both
# prompt checkpoints, and why ~/.bash_profile - the file that looks equally
# reasonable - satisfies only one of them.
#
# `\w` is the whole point of the value below: the RHEL default prompt is
# `[\u@\h \W]\$ ` and `\W` is only the last component of the path.
set -euo pipefail
sudo usermod -s /bin/bash oncall
echo 'oncall:Rh9-Oncall-9d41' | sudo chpasswd
sudo -u oncall tee -a /home/oncall/.bashrc >/dev/null <<'PROMPT'
PS1='[\u@\h \w]\$ '  # rhcsa041
PROMPT
