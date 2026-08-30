---
id: net.nm-connections-are-the-config
title: NetworkManager connections, not interfaces
rhel: 9
objectives: [net.services.autostart]
sources: [r9:ch24, r10:ch24]
---
On RHEL the network is not configured by editing an interface. It is configured
by editing a **connection profile**, and NetworkManager applies the profile to a
device. Two different things with two different names, and every confusing
`nmcli` session comes from conflating them.

- A **device** is hardware: `ens160`. `nmcli device status` lists them.
- A **connection** is a saved set of settings that can be applied to a device:
  `ens160`, `Wired connection 1`, whatever it was named at install. `nmcli
  connection show` lists them. The profile is a keyfile under
  `/etc/NetworkManager/system-connections/`.

A device can have several profiles available and at most one active. This is why
`ip addr add` "works" and then vanishes — you changed the device, not the
profile, and NetworkManager will overwrite it at the next opportunity. On RHEL,
`ip` is a diagnostic tool. `nmcli` is the configuration tool.

The four commands that cover most of it:

```
nmcli connection show                          # what profiles exist
nmcli connection show "ens160"                 # every setting, one per line
nmcli connection modify "ens160" ipv4.addresses 192.168.1.50/24 \
      ipv4.gateway 192.168.1.1 ipv4.method manual
nmcli connection up "ens160"                   # apply the change now
```

`modify` writes the profile to disk immediately and does **not** apply it. `up`
applies it. So a change that has no effect usually just needs `up` — and a
change that works but disappears at reboot was made with `ip` instead of
`nmcli`, or was made to a profile that is not the one that comes up at boot.

**`connection.autoconnect` is the one to check when a machine boots with no
network.** Set to `no`, the profile is perfectly correct and NetworkManager
simply never applies it; the machine comes up with a link and no address, and
nothing in the profile looks wrong. Read it with
`nmcli -g connection.autoconnect connection show "<name>"` and fix it with
`nmcli connection modify "<name>" connection.autoconnect yes`.

`-g` is worth knowing generally: it prints one field with no padding and no
header, which makes it the right way to ask a specific question rather than
grepping the human-readable output. And `nmcli connection reload` re-reads the
keyfiles from disk, which is what you need if you edited one by hand instead of
going through `nmcli`.
