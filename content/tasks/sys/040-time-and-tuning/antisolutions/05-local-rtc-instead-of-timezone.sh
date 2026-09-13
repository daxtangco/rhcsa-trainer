#!/usr/bin/env bash
# Wrong scope: the ticket asked about the system's time zone, and this answer
# changed how the hardware clock is interpreted instead.
#
# The two get confused constantly, because on a single-boot Linux machine they
# both sound like "make the clock local". They are not the same thing at all:
#
#   The time zone is a system setting - /etc/localtime, what `date` prints, what
#   every log line and every cron expression is relative to.
#   LocalRTC is a statement about the BATTERY-BACKED clock on the board: whether
#   the number in it is UTC or wall time. It is there for machines that dual-boot
#   Windows, and systemd's own documentation calls it a bad idea otherwise.
#
# So this fixture leaves the zone at the template's UTC - `date` still prints UTC,
# the Tokyo team still reads logs an hour out at every handover - while writing
# LOCAL into /etc/adjtime, which is precisely what the ticket said not to touch.
# The damage is real and delayed: the RTC is now ambiguous across a DST boundary,
# anything that reads it assuming UTC is wrong, and `date` looks fine the whole
# time.
#
# Both failures persist across the reboot - /etc/adjtime is a file and the zone was
# never set - so neither carries a phase. rtc-utc is the invariant this fixture
# exists to break; everything else here is correct, so the two red lines are
# unambiguous.
# expect-fail: timezone-set, rtc-utc
set -euo pipefail

# NOT `timedatectl set-timezone Asia/Tokyo`. No --adjust-system-clock either, so
# the system clock is left exactly where it is and only the RTC's interpretation
# changes; the host stays safe to grade, and every other checkpoint stays honest.
sudo timedatectl set-local-rtc 1

# The rest of the hand-over, done correctly.
sudo sed -i -E 's/^[[:space:]]*(server|pool|peer)[[:space:]]/#&/' /etc/chrony.conf
printf 'server 192.0.2.10 iburst\n' | sudo tee -a /etc/chrony.conf >/dev/null
sudo systemctl enable --now chronyd
sudo systemctl restart chronyd

sudo systemctl enable --now tuned
sudo tuned-adm profile throughput-performance

# The tell is in the last line of /etc/adjtime, and in timedatectl's
# "RTC in local TZ: yes" warning - neither of which anybody looks at unless they
# already suspect it.
timedatectl
sudo tail -n1 /etc/adjtime
