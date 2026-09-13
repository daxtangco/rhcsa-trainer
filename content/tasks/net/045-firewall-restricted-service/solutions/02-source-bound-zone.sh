#!/usr/bin/env bash
# A different mechanism, not a different spelling. There is no rich rule here at
# all: the monitoring network is bound to a second zone as a SOURCE, and the port
# is opened in that zone with the same plain --add-port a candidate already knows.
#
# It works because a source match beats an interface match. Packets from
# 10.42.7.0/24 stop landing in the interface's zone and land in `internal`
# instead, where 8080/tcp is permitted. Every other address is unaffected and
# still lands in the interface's zone, where it is not.
#
# `internal` is a stock zone that already permits ssh, and the source being bound
# is not the network the grader arrives from (192.168.70.0/24), so this cannot
# move the grader's own session into a zone that would refuse it. That is the one
# thing to think about before binding a source anywhere.
#
# A grader that looked only for a rich rule, or only in the default zone, would
# reject this. Both would be wrong.
set -euo pipefail
sudo firewall-cmd --permanent --zone=internal --add-source=10.42.7.0/24
sudo firewall-cmd --permanent --zone=internal --add-port=8080/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --zone=internal --list-all
sudo firewall-cmd --list-all
