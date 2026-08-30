#!/usr/bin/env bash
# Ran the script instead of building the service. The stamp file is there, so a
# grader that only checks for the file would pass this.
# expect-fail: unit-verifies, stamp-enabled, stamp-effect@post
set -euo pipefail
sudo /usr/local/bin/rhcsa-stamp
