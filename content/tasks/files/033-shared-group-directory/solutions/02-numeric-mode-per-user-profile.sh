#!/usr/bin/env bash
# Route 2: one numeric mode for the directory, and the umask set per user in
# each account's own ~/.bash_profile.
#
# Equally correct and deliberately unlike solutions/01: 3770 in one go instead of
# three symbolic clauses, `chown :group` instead of `chgrp`, a four-digit umask
# instead of three, and nothing system-wide at all - so a grader that grepped
# /etc/profile.d for the answer would wrongly reject this.
set -euo pipefail

sudo chown :payroll /srv/payroll
# 3 = set-GID (2) + sticky (1); 770 = the group can work here and nobody else
# can look.
sudo chmod 3770 /srv/payroll

# The pre-existing file, which set-GID does nothing for.
sudo chown :payroll /srv/payroll/handover.txt
sudo chmod 0660 /srv/payroll/handover.txt

for u in dana erik; do
  # Appended, so it runs after ~/.bash_profile has sourced ~/.bashrc and after
  # /etc/profile has run - both of which set a umask of their own. Last writer
  # wins, and this is the last writer.
  printf '\n# payroll collaboration: group may write, nobody outside the group gets anything\numask 0007\n' \
    | sudo tee -a "/home/$u/.bash_profile" >/dev/null
  # tee wrote as root; hand the file back to its owner so the account keeps
  # control of its own startup file.
  sudo chown "$u:$u" "/home/$u/.bash_profile"
done
