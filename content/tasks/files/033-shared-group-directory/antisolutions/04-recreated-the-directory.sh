#!/usr/bin/env bash
# "It was easier to start again": the directory is removed and recreated with a
# perfect mode, and the team's notes go with it.
#
# This is the destructive answer the content-preserved invariant exists to catch.
# content-preserved passes at the unsolved baseline - the file is sitting there
# untouched - so it never appears in grade.sh's `# baseline-fail:` header, and
# without a fixture that removes the file nothing in this task would ever assert
# that the checkpoint works. Both declarations here are for both verdicts: a
# deleted file does not come back at a reboot.
#
# content-shared fails as a consequence rather than as a separate mistake, and it
# is declared for the same reason: a checkpoint whose subject no longer exists
# must report failure, not vanish from the JSONL.
#
# What this fixture proves, and what it used to only appear to prove. `chmod 3770`
# below leaves student - who is deliberately not in payroll - with no execute bit
# on /srv/payroll. While grade.sh read the file unprivileged, that alone made
# content-preserved and content-shared fail with EACCES, so this fixture validated
# green whether or not handover.txt had been deleted: the header was satisfied by
# a side effect of the mode, not by the deletion the fixture is named for. It also
# meant the same two checkpoints failed for all three *solutions*, which is how
# the confound stayed invisible - the one fixture it flattered was this one.
# grade.sh now reads $FILE through `sudo -n`, so the mode hides nothing from it,
# and the discrimination is real and visible across the fixture set: solutions/01,
# 02 and 03 all end on 3770 and content-preserved PASSES for them, this fixture
# ends on 3770 and it FAILS. The only difference between those two outcomes is
# whether the file is there. Do not "simplify" this to a laxer mode to make the
# point - a laxer mode would contradict dir-no-other and reintroduce a second
# fault into a fixture whose job is to isolate one.
# expect-fail: content-preserved, content-shared
set -euo pipefail

sudo rm -rf /srv/payroll
sudo mkdir /srv/payroll
sudo chgrp payroll /srv/payroll
sudo chmod 3770 /srv/payroll

sudo tee /etc/profile.d/payroll-umask.sh >/dev/null <<'EOF'
if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx payroll; then
    umask 007
fi
EOF
sudo chmod 0644 /etc/profile.d/payroll-umask.sh
