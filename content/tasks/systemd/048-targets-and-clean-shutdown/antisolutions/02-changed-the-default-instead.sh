#!/usr/bin/env bash
# Answered "make the next boot graphical" with `set-default`, which is the wrong
# tense: it changes every boot from now on, not the next one. Everything else is
# correct.
#
# What makes this the sharpest fixture in the set is that it *works*. The machine
# really does come up in graphical.target after the reboot, so
# graphical-target-active is green in both verdicts and nothing about the running
# system gives the answer away. Two checkpoints disagree with it and only two:
# boot-arg-pinned, because the boot loader entry was never touched, and
# default-target-unchanged, because tomorrow's boot was changed and the task said
# not to. That is also why default-target-unchanged is a probed invariant here
# rather than an unprobed one.
#
# Safe on this guest for the same reason systemd/017's antisolutions/03 is safe:
# graphical.target pulls in multi-user.target, and with no display manager
# installed the machine still ends at a text login and stays reachable over ssh.
# expect-fail: boot-arg-pinned, default-target-unchanged
set -euo pipefail
sudo systemctl set-default graphical.target
sudo shutdown -c
sudo systemctl disable rhcsa-maintenance-window.service
sudo systemctl isolate graphical.target
