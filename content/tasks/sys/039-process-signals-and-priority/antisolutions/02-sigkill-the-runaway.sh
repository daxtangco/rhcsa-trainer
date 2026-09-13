#!/usr/bin/env bash
# `kill -9` as a reflex. The runaway is gone, which is what everybody checks, and
# the job never got to run the handler that records its own shutdown - so the
# record the ticket asked for does not exist and nothing about the machine looks
# wrong.
#
# This is the fixture that proves purge-graceful grades an effect rather than the
# existence of a dead process. SIGKILL is not delivered to the program at all:
# the kernel destroys the process, no handler runs, no cleanup happens. On a real
# job that is a half-written file or a lock nobody releases.
#
# Declared for both verdicts, not @pre, and that is the point of this fixture.
# A student who asked politely has the record in /var and still has it after the
# reboot; this fixture never will, because SIGKILL gave the handler no chance and
# no later shutdown can write a record on behalf of a process that is already
# gone. So the grader has no "the boot changed, so pass" branch (see grade.sh
# section 2): verdict B is the verdict the student is scored on, and a vacuous
# pass there would hand `kill -9` a clean sheet.
#
# Everything else here is deliberately correct.
# expect-fail: purge-graceful
set -euo pipefail

# -KILL, not -TERM. The bracket keeps the pattern from matching the sudo running
# it; see solutions/01 for why that is necessary in a script.
sudo pkill -KILL -f '[r]hcsa-lab-purge'
sleep 2

sudo mkdir -p /etc/systemd/system/rhcsa-lab-metrics.service.d
printf '[Service]\nNice=10\n' | sudo tee /etc/systemd/system/rhcsa-lab-metrics.service.d/10-nice.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart rhcsa-lab-metrics.service
