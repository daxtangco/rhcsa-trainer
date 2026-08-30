---
id: systemd.enabled-vs-started
title: Started, enabled, and why they are unrelated
rhel: 9
objectives: [systemd.services.enable]
sources: [r9:ch11, r10:ch11]
---
**Started** means the unit is running right now. **Enabled** means it will be
started at the next boot. They are independent: a unit can be any of the four
combinations, and three of them are bugs somebody is going to hit.

```
systemctl start sshd     # running now, nothing about boot
systemctl enable sshd    # will start at boot, not running now
systemctl enable --now sshd     # both
systemctl is-active sshd ; systemctl is-enabled sshd   # ask about each
```

`enable` does one concrete thing: it reads the unit's `[Install]` section and
creates a symlink under `/etc/systemd/system/<target>.wants/`. That is the whole
mechanism. It follows that a unit file with no `[Install]` section cannot be
enabled — `systemctl enable` reports `The unit files have no installation
config` — and that `is-enabled` returning `static` means exactly that: the unit
exists, it is fine, and nothing will ever pull it in by name.

`is-enabled` has more answers than yes and no, and they are worth recognising:
`enabled` (a symlink in `/etc`), `enabled-runtime` (a symlink in `/run`, which
disappears at reboot — `enable --runtime` did this), `disabled`, `static` (no
`[Install]`), `masked` (symlinked to `/dev/null`, which makes the unit
unstartable even by hand), and `indirect`.

**Masking is the one to remember for troubleshooting.** `systemctl mask foo`
makes `start` fail with a message about the unit being masked; `disable` alone
never does that. If a service refuses to start and the error mentions masking,
`systemctl unmask` is the fix and no amount of editing the unit file will help.

The habit worth building: after any change to a service, run both checks. "It
works" is `is-active`. "It will still work on Monday" is `is-enabled`. Nearly
every graded systemd question is really asking for the second one, and nearly
every wrong answer satisfies only the first.
