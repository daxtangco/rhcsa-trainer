#!/usr/bin/env bash
# Right idea, wrong direction in time. PS1 goes into /etc/skel/.bashrc - the file
# that becomes a new account's ~/.bashrc - so the answer is correct for every
# account created from now on and does nothing at all for the account the ticket
# is about. oncall's home directory was made last week and holds its own copy of
# .bashrc, which is not a link to the skeleton and never consults it again.
#
# The reason this is a believable answer and not a straw man: /etc/skel really is
# where you configure "what a shell looks like for users here", and a student who
# has just read useradd(8) has skel fresh in mind. Nothing about the result looks
# wrong either - the file was edited, the syntax is right, and a shell started as
# a brand new test user would show the required prompt.
#
# Both prompt checkpoints fail and both login checkpoints pass, which is the
# signature that separates this from antisolutions/01: there the prompt reached one
# of the two shells, here it reaches neither. other-prompts-unchanged still passes,
# because student's home directory is as old as oncall's and equally untouched by a
# skeleton edit - so this fixture also proves that checkpoint is not simply
# reporting "a file under /etc changed".
# expect-fail: prompt-login, prompt-nonlogin
set -euo pipefail
sudo usermod -s /bin/bash oncall
echo 'oncall:Rh9-Oncall-9d41' | sudo chpasswd
sudo tee -a /etc/skel/.bashrc >/dev/null <<'PROMPT'
PS1='[\u@\h \w]\$ '  # rhcsa041
PROMPT
