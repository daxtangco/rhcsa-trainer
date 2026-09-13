---
id: sys.time-zones-and-the-rtc
title: Three different clocks, and which one the question is about
rhel: 9
objectives: [sys.time.chrony]
sources: [r9:ch25, r10:ch25]
prerequisites: []
---
There are three clocks on this machine and people call all of them "the clock",
which is why time questions get answered in the wrong place.

1. **The system clock.** The kernel's idea of now, counted in seconds since the
   epoch, always UTC internally. This is what `date` reads and what every
   timestamp in every log comes from.
2. **The time zone.** Not a clock at all — a *rendering rule*. It converts the
   system clock's UTC into the local wall time you see, and it is a system-wide
   setting held in `/etc/localtime`.
3. **The RTC (real-time clock, "hardware clock").** The battery-backed counter on
   the board. Its only job is to give the kernel a starting value at boot, before
   any time service is running.

```
timedatectl                       # all three at once, plus the NTP state
timedatectl list-timezones | grep -i tokyo
timedatectl set-timezone Asia/Tokyo
ls -l /etc/localtime              # a symlink into /usr/share/zoneinfo
```

`/etc/localtime` **must be a symlink** to a file under `/usr/share/zoneinfo`, and
the path under that directory *is* the zone name: `Asia/Tokyo` is
`/usr/share/zoneinfo/Asia/Tokyo`. So the classic route
`ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime` is equivalent to
`timedatectl set-timezone` and is worth knowing for the day `systemd-timedated`
is not answering. What is *not* equivalent is copying the zone file over
`/etc/localtime`. `date` will print the right time, so it feels like it worked —
but `timedatectl` then reports the zone as `n/a`, and every tool that asks
systemd rather than glibc is wrong. Symlink, not copy.

**`LocalRTC` is the trap.** `timedatectl set-local-rtc 1` does not change your
time zone, your system clock or what `date` prints. It changes a single claim
recorded in `/etc/adjtime`: whether the number in the RTC is UTC or local wall
time. It exists for machines that dual-boot Windows, and systemd's own manual
page recommends against it in every other case — because local time is ambiguous
for one hour a year at the DST fallback, and because anything that reads the RTC
assuming UTC is now silently wrong. The tell is `RTC in local TZ: yes` in
`timedatectl` output and the word `LOCAL` on the last line of `/etc/adjtime`.

If a question says "set the time zone", the answer is `set-timezone`. If it says
"leave the hardware clock in UTC", it is telling you not to go near
`set-local-rtc`. Read `date`'s output as the *result*, never as the setting: two
completely different changes can make it look identical, and only one of them is
what was asked for.

`hwclock` is still there and still works (`hwclock --systohc` writes the system
clock into the RTC, `--hctosys` the other way), but on a systemd host you rarely
need it: `timedatectl` writes the RTC for you whenever it has reason to, and a
running time service keeps the RTC updated on its own if `rtcsync` is set.
