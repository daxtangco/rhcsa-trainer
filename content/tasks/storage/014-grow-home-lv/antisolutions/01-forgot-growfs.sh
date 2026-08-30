#!/usr/bin/env bash
# The single most common real mistake: the volume grew, the filesystem did not.
# df still shows 8 GiB. Wrong in both verdicts.
# expect-fail: fs-home-size
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
