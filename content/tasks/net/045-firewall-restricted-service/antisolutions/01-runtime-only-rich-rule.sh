#!/usr/bin/env bash
# The right rule, in the right zone, in the wrong copy of the configuration.
#
# This is the single most common way this objective is failed, and it is the one
# that feels most finished: `firewall-cmd --list-rich-rules` prints the rule,
# `--list-all` prints the rule, and every test the candidate can think of
# passes. The permanent copy has never heard of it, so the next `--reload` -
# theirs, somebody else's, or the one every boot performs - discards it.
#
# source-allowed-permanent is wrong immediately. source-allowed-runtime is right
# until the machine comes back, which is exactly why one phase per file would not
# be enough to express this answer.
# expect-fail: source-allowed-permanent, source-allowed-runtime@post
set -euo pipefail
sudo firewall-cmd --add-rich-rule='rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept'
sudo firewall-cmd --list-rich-rules
