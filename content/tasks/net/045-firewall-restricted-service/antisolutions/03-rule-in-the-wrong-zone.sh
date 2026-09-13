#!/usr/bin/env bash
# The correct rule, made permanent, reloaded - and put in a zone nothing lands
# in. `work` has no interface bound to it and no source bound to it, so its rule
# set filters exactly nothing, and `firewall-cmd --permanent --zone=work
# --list-all` prints the rule looking perfectly correct. The concept card calls
# this the most convincing wrong answer firewalld offers.
#
# Why a candidate does it: they read that restriction is done "in another zone",
# remember that `internal` or `work` is the zone for trusted traffic, and put the
# rule there without binding anything to it. The missing step is the source
# binding that would have made the zone the destination for those packets -
# solutions/02 is this same answer with that one line present.
#
# It also proves the grader is not satisfied by finding its rule anywhere: a
# grader that grepped all zones for the source address would pass this fixture.
# expect-fail: source-allowed-runtime, source-allowed-permanent
set -euo pipefail
sudo firewall-cmd --permanent --zone=work --add-rich-rule='rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept'
sudo firewall-cmd --reload
sudo firewall-cmd --permanent --zone=work --list-all
