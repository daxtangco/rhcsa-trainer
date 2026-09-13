#!/usr/bin/env bash
# The answer to the wrong half of the question: the port is open, permanently,
# and reachable from the monitoring network - and from every other address on
# earth. This is what a candidate produces when they read "make the reporting
# service reachable from 10.42.7.0/24" and stop at "make the reporting service
# reachable", which is the only firewall-cmd verb most people have practised.
#
# It is a genuine near miss rather than vandalism: two correct commands, the
# right port, the right copy of the configuration, a --reload, and a passing
# `firewall-cmd --list-ports`. Nothing on screen says the restriction is missing,
# because a missing restriction has nothing to print.
#
# This is the fixture that proves not-open-to-all-runtime and
# not-open-to-all-permanent are really probed: both of them PASS on an untouched
# machine, so they cannot appear in grade.sh's `# baseline-fail:` header, and
# without this file nothing anywhere would notice if they were replaced by an
# unconditional pass. source-allowed-* are expected to pass here - traffic from
# 10.42.7.0/24 really can reach the service - and that split is the point: the
# verdict reads "reachable: yes, restricted: no".
# expect-fail: not-open-to-all-runtime, not-open-to-all-permanent
set -euo pipefail
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
