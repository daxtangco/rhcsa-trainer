#!/usr/bin/env bash
# One rich rule in the zone the interface is already in. The rule carries the
# whole answer: who (source address), what (port 8080/tcp), and the action
# (accept). Nothing is denied anywhere, because nothing has to be - every other
# address still lands in this zone, which does not permit 8080.
#
# No --zone, which means the default zone. setup.sh has proved this guest's NIC
# is in the default zone and that its NetworkManager profile does not pin
# another one, so "the default zone" and "the zone that filters inbound traffic"
# are the same zone here.
#
# The two read-back commands are part of the answer, not decoration: they are how
# you find out whether the rule landed in the zone you meant.
set -euo pipefail
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.42.7.0/24" port port="8080" protocol="tcp" accept'
sudo firewall-cmd --reload
sudo firewall-cmd --list-rich-rules
sudo firewall-cmd --list-all
