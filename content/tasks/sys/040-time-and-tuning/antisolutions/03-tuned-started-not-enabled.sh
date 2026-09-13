#!/usr/bin/env bash
# started is not enabled - the tuned half of the same old confusion.
#
# `systemctl start tuned` followed by `tuned-adm profile throughput-performance`
# leaves a machine that is genuinely tuned for throughput. The profile is applied,
# the sysctls and the CPU governor really did change, and `tuned-adm active`
# answers with the right name. Nothing on the running system hints at a problem.
#
# But the unit has no symlink in /etc/systemd/system/multi-user.target.wants, so
# at the next boot nothing starts tuned, nothing applies a profile, and the
# database sits on default tunings for however long it takes somebody to notice.
# /etc/tuned/active_profile still says throughput-performance, which is exactly
# why the grader asks tuned instead of reading that file: the file records the
# request, the daemon is the only witness to it having taken effect.
#
#   tuned-enabled is wrong in both verdicts - the symlink was never made - so it
#   carries no phase.
#   tuned-profile is right now and wrong after the reboot: @post.
# expect-fail: tuned-enabled, tuned-profile@post
set -euo pipefail

# The whole chrony half, done properly, so the failure is unambiguously tuned's.
sudo timedatectl set-timezone Asia/Tokyo
sudo sed -i -E 's/^[[:space:]]*(server|pool|peer)[[:space:]]/#&/' /etc/chrony.conf
printf 'server 192.0.2.10 iburst\n' | sudo tee -a /etc/chrony.conf >/dev/null
sudo systemctl enable --now chronyd
sudo systemctl restart chronyd

# `start`, not `enable --now`. One word missing.
sudo systemctl start tuned
sudo tuned-adm profile throughput-performance

# Both of these look completely healthy today, which is the point.
sudo tuned-adm active
systemctl is-enabled tuned || true
