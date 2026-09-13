---
id: storage.nfs-client-mounts
title: Mounting somebody else's filesystem, and unmounting it again
rhel: 9
objectives: [storage.nfs.mount]
sources: [r9:ch24, r10:ch24]
prerequisites: [storage.fstab-fields-and-uuid]
---
An NFS mount is an ordinary mount whose device is a *sentence*: instead of
`/dev/sdb1` you name `server:/export/reports`. The colon is the whole syntax, and
forgetting it is the classic first mistake — `mount server/export /mnt` looks
close enough to read past and means nothing at all.

```
showmount -e nfsstore.example.com          # what does that host export?
mount -t nfs nfsstore.example.com:/export/reports /mnt/reports
mount nfsstore.example.com:/ /mnt          # NFSv4: the pseudo-root, all exports at once
findmnt /mnt/reports                       # what is actually mounted there
umount /mnt/reports
```

`-t nfs` is optional when the source contains a colon, because `mount` works the
type out for itself; write it anyway, because the fstab line needs it in field 3
and the habit carries over. The mount point is a directory you create, exactly
as for a local filesystem, and mounting over a non-empty directory hides what
was in it in exactly the same way.

**Two different questions, two different answers.** `mount` is a fact about right
now; the fact that survives a reboot is a line in `/etc/fstab` (or a systemd
`.mount` unit):

```
nfsstore.example.com:/export/reports  /mnt/reports  nfs  defaults  0 0
```

Field 5 and field 6 are `0` — dump does not back up somebody else's server, and
fsck is the server's problem, not the client's. Two options are worth
recognising: `sync`, which the exam book recommends so writes are committed to
the server rather than buffered, and `_netdev`, which used to be needed so the
mount waited for the network. On RHEL 9 it is not required any more, because
systemd already knows an `nfs` entry is a network filesystem and orders it after
`network-online.target` and inside `remote-fs.target`. Knowing *why* it is
optional is the point; adding it does no harm.

What surprises people is the failure behaviour. NFS mounts are **hard** by
default, which means that if the server disappears, every process touching the
mount blocks — forever, uninterruptibly. `df`, `ls` and tab completion all hang,
and the machine looks broken when only one directory is. So unmount before the
server goes away, reach for `umount -l` (lazy) or `umount -f` when it already
has, and remember that "target is busy" almost always means a shell is standing
in the directory: `cd` out, or ask `lsof +D /mnt/reports` who else is.

Two things belong to the *server* and are worth knowing so you can tell whose
fault a failure is. First, the firewall: an NFSv4 mount needs only tcp/2049
(`--add-service=nfs`), but `showmount` speaks the older protocol and also needs
rpcbind on 111 and mountd on 20048 — which is why `showmount` can fail against a
server you can mount from perfectly well. Second, SELinux: files reached over NFS
arrive labelled `nfs_t` rather than with their real labels, so a confined service
reading them may need a boolean (`use_nfs_home_dirs` is the one for home
directories) even though your own shell reads them without complaint.
