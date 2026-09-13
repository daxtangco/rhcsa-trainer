#!/usr/bin/env bash
# The mirror image of antisolutions/01, and the reason both are worth shipping:
# --permanent alone is as incomplete as no --permanent at all, it is just
# incomplete in the other direction. The rule is written down and nothing is
# filtering by it, because the runtime configuration is only replaced by the
# permanent one on --reload.
#
# What makes this a near miss rather than a mistake anybody would catch: the
# candidate checks their work with `firewall-cmd --permanent --list-rich-rules`,
# sees the rule, and moves on. The plain `firewall-cmd --list-rich-rules` that
# would have shown an empty runtime zone is the command they did not run.
#
# The phase suffix is the whole signal here. source-allowed-runtime fails NOW and
# passes after the reboot, because a reboot loads the permanent configuration -
# the only fixture in this task whose verdict improves on its own.
# expect-fail: source-allowed-runtime@pre
set -euo pipefail
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept'
sudo firewall-cmd --permanent --list-rich-rules
