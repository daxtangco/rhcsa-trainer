---
id: storage.autofs-maps
title: Automount maps - two files, one service, and nothing mounted until touched
rhel: 9
objectives: [storage.autofs.configure, storage.nfs.mount]
sources: [r9:ch24, r10:ch24]
prerequisites: [storage.nfs-client-mounts, systemd.enabled-vs-started]
---
`autofs` mounts a share the moment somebody uses it and unmounts it again when
nobody has for a while. Nothing is mounted at boot, which is the point: a laptop
with fifty possible shares mounts the one you asked for. It is configured in
**two** files, and every autofs question on the exam is really asking whether you
know that.

**File one, the master map.** `/etc/auto.master`, or — equivalently, because that
file carries a `+dir:/etc/auto.master.d` line — any file called `*.autofs` in
`/etc/auto.master.d/`. The suffix is not decoration: `man 5 auto.master` says
"Files in that directory must have a `.autofs` suffix", so a drop-in you called
`archive.conf` is read by nothing at all. One line per automounted directory:
where the mounts will appear, then the map that describes them.

```
/nfsdata      /etc/auto.nfsdata
```

**File two, the map itself.** One line per share. The key is a *relative* name
that will appear under the master map's directory, then mount options beginning
with `-`, then the same `server:/export` you would have typed by hand:

```
archive      -fstype=nfs,rw      nfsstore.example.com:/export/archive
```

`-fstype=nfs` is optional here, but not for the reason you might guess: it has
nothing to do with the colon. NFS is autofs's **default** filesystem type, so
`man 5 autofs` describes `-fstype=` as the option "used to specify a filesystem
type if the filesystem is not of the default NFS type". Write it anyway and the
line documents itself; you need it for real when the location is a device
(`-fstype=ext4 :/dev/sdb1` — note the bare leading colon on a local device).

That pair makes `/nfsdata/archive` work. It is called an **indirect** map, and
`automount` owns the whole `/nfsdata` directory: it creates the directory if it
is missing (`man 5 auto.master`: "as with `mkdir -p`"), mounts an `autofs`
filesystem over it, and removes a directory it created when that filesystem is
unmounted. A **direct** map is the other shape — the master map's first field is
the literal `/-` and the map file's keys are absolute paths:

```
/-                    /etc/auto.direct
/nfsdata/archive      -fstype=nfs   nfsstore.example.com:/export/archive
```

Both are correct. Indirect maps also take **wildcards**, which direct maps cannot
— a direct map's keys are mount points the daemon installs triggers on when it
starts, and a `*` names no path to install one on — and which systemd's own
`.automount` units cannot either. That is the reason the exam covers autofs:
`*  -rw  server:/users/&` mounts `/users/anna` from `server:/users/anna` for any
name at all, `*` standing for what was asked for and `&` for the same text on the
server.

Now the two mistakes. The first: **the service.** A map file nothing has read is
a text file. `systemctl enable --now autofs` reads it and makes it come back at
the next boot; a bare `start` gets you today only, and an `enable` with no
`--now` gets you tomorrow only.

Rereading a map after you edit it is the part that is usually taught wrong.
`man 5 autofs` is exact about it: "Indirect maps ... can be changed on the fly and
the automounter will recognise those changes on the next operation it performs on
that map. Direct maps require a HUP signal be sent to the daemon to refresh their
contents **as does the master map**." So editing `/etc/auto.nfsdata` and touching
the path again is enough; adding or changing a line in `/etc/auto.master`, in an
`/etc/auto.master.d/*.autofs` drop-in, or in any direct map is **not**, and you
owe the daemon a `systemctl reload autofs` (its `ExecReload` is literally
`kill -HUP`). Reloading unnecessarily costs nothing, so reloading always is a fine
habit — believing an indirect-map edit needs it is what sends people hunting for a
syntax error that is not there.

The second: **nothing is mounted until it is touched.** `ls /nfsdata` comes back
empty on a perfectly working configuration, because until something asks for
`archive` by name there is nothing there to list. On RHEL 9 that is not even a
maybe: the shipped `/etc/autofs.conf` sets `browse_mode = no`, which is the
setting that would otherwise pre-create the map's keys as visible directories. So
test by using the path —
`ls /nfsdata/archive`, or `cd` into it — and only then ask `findmnt` or
`mount` what happened. The evidence you are looking for is two entries: an
`autofs` filesystem on the directory the master map named, and a mount of the
share on the path you actually touched. When neither appears, `journalctl -u autofs`
and running `automount -f -v` in the foreground will tell you which of the two
files it disliked.

**Why that second entry may not say `nfs`.** `automount` works out how far away
each server in a map entry is, and when the answer is "that server is this
machine" it does not speak NFS to itself — it bind-mounts the exported directory,
so `findmnt` reports the local filesystem's type and a source like
`/dev/mapper/rhel-root[/export/archive]`. `man 5 auto.master` documents the switch
that turns this off: the `nobind` pseudo-option exists "to prevent bind mounting of
local NFS filesystems", written without a leading dash and usable in the master map
entry or on an individual map entry. You will only ever meet this on a lab machine
that exports to itself — against a real remote server the same two files give you a
real `nfs` mount — but on such a machine a correct map looks wrong if you are
grepping for the word `nfs`. Nothing about the map needs changing.
