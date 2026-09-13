#!/usr/bin/env bash
# Route 1: generate the pair as student, put the public half in place with the one
# command that sets a file's owner and mode while it copies it, and prove the
# login works the way the unattended job will use it.
#
# Straight-line on purpose - no loop, no case, no if at the top level: rung 4
# builds the student-facing command sketch out of the sorted-first solution file,
# so the shape of this file is part of what a student is shown. The independent
# route, which does the same job without sudo touching deploy's files at all,
# lives in 02.
#
# What is deliberately NOT here, and the omissions are the lesson:
#   - No change to /etc/ssh/sshd_config, and no restart of sshd. Key
#     authentication is already on; everything this task asks for is one account's
#     own files. A server-wide edit to solve a per-account problem is the answer
#     that passes the login and fails the review.
#   - Nothing touches student's own ~/.ssh/authorized_keys, its mode, or its
#     owner. The new key is added ALONGSIDE what is already there. On this machine
#     that file is how the grader gets in, and on a real host it is how you get in.
#   - No ssh-agent. An agent is a convenience for a human at a keyboard; the job
#     in the ticket has no keyboard and no agent, which is why the key has no
#     passphrase and why the check below runs with BatchMode.
set -euo pipefail

# ed25519 because it is the modern default, small, and fast; rsa with -b 4096
# would be just as correct and 02 uses it. `-N ''` is the whole "no passphrase"
# requirement: a passphrase there is a prompt, and a prompt is what the ticket
# says cannot happen.
#
# `< /dev/null` because this script arrives on ssh's standard input: if
# ssh-keygen found a file already at that name it would ask whether to overwrite
# it and would read the answer out of the rest of this file.
ssh-keygen -t ed25519 -N '' -C 'student@lab deploy automation' -f "$HOME/.ssh/id_ed25519" < /dev/null

# deploy's .ssh, created empty and correct in one step. 0700 is the mode sshd
# insists on in spirit and every manual page states outright: the directory that
# decides who may log in as deploy is deploy's business and nobody else's.
#
# `install -d` rather than mkdir + chown + chmod because it is one command that
# cannot be half-done, and because the directory is created fresh in place -
# which is also what gets the SELinux label right without further work. The
# policy has a named rule for a directory called `.ssh` under a home directory,
# so a directory MADE here is ssh_home_t; a directory carried in from somewhere
# else is whatever it was before.
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh

# The PUBLIC half - the file ending in .pub, the only one that leaves student's
# account. 0600, owned by deploy, so deploy can manage its own key list and
# nobody else can read who is allowed in.
sudo install -m 0600 -o deploy -g deploy "$HOME/.ssh/id_ed25519.pub" /home/deploy/.ssh/authorized_keys

# Belt and braces on the labels, and a habit worth having: everything above
# created its files in place, so this should print nothing at all. When it does
# print something, that is the difference between a key sshd reads and a key it is
# not permitted to open - and nothing about the modes would have told you.
sudo restorecon -R -v /home/deploy/.ssh

# The check that matters, run the way the job will run it: no terminal, no agent,
# no password, no prompt. -n and BatchMode are what turn "it asked me for
# something" into a non-zero exit instead of a hang.
timeout 25 ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null deploy@localhost 'id -un' < /dev/null

# What to look at if that had failed, in the order worth looking:
#   sudo ls -lZ /home/deploy /home/deploy/.ssh   modes, owners AND contexts
#   sudo journalctl -u sshd -n 20                sshd's own account of the refusal
# sshd refuses a badly-owned or badly-labelled key silently to the client, so the
# client's "Permission denied (publickey)" is the same message for four different
# mistakes. The server's log is where they are told apart.
sudo ls -lZ /home/deploy/.ssh
