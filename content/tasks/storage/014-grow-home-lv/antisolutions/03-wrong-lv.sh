#!/usr/bin/env bash
# Grew the wrong logical volume: root got the space, /home did not. Proves the
# grader looks at rhel/home specifically rather than at "did the VG shrink".
#
# Declares exactly the same ids as grade.sh's `# baseline-fail:` header, on
# purpose - this is a genuine detector, not a copy-paste accident. It would
# catch a grader that hardcoded "did the VG shrink" instead of measuring
# rhel/home specifically. harness.ts checks this fixture's own exit code
# (mandate 2), which catches lvextend erroring outright - if there were no
# free space left in the VG for root to take, this fixture would fail loudly
# rather than probing nothing silently. But that check proves nothing about a
# run that exits 0 having grown nothing, or one that succeeds vacuously; it
# catches a fixture that errors, not one that no-ops. Neither shape is
# guarded here.
# expect-fail: lv-home-size, fs-home-size
set -euo pipefail
sudo lvextend -r -L +4G /dev/rhel/root
