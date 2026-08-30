#!/usr/bin/env bash
# Grew the wrong logical volume: root got the space, /home did not. Proves the
# grader looks at rhel/home specifically rather than at "did the VG shrink".
#
# Declares exactly the same ids as grade.sh's `# baseline-fail:` header, on
# purpose - this is a genuine detector, not a copy-paste accident. It would
# catch a grader that hardcoded "did the VG shrink" instead of measuring
# rhel/home specifically. That is only safe because harness.ts now checks this
# fixture's own exit code (mandate 2): if lvextend here silently failed for
# lack of free space, the machine would be indistinguishable from the
# baseline and this fixture would report ok while probing nothing.
# expect-fail: lv-home-size, fs-home-size
set -euo pipefail
sudo lvextend -r -L +4G /dev/rhel/root
