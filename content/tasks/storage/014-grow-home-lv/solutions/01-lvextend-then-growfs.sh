#!/usr/bin/env bash
# The two-step path: grow the volume, then grow the filesystem inside it.
set -euo pipefail
sudo lvextend -L 12G /dev/rhel/home
sudo xfs_growfs /home
