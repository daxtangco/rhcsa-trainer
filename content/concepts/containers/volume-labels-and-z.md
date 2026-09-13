---
id: containers.volume-labels-and-z
title: Bind mounts, :Z, and why the container gets a 403
rhel: 9
objectives: [containers.storage.persistent]
sources: [r9:ch26]
prerequisites: [containers.rootless-vs-rootful, selinux.labels-now-vs-policy]
---
A container's own filesystem is disposable: remove the container and everything
written inside it is gone. Persistent storage means putting a piece of the host
into the container, and there are two ways to do it that behave differently.

A **named volume** (`-v webdata:/var/www/html`) is a directory podman created and
owns, under `~/.local/share/containers/storage/volumes/` for a rootless user.
Podman labels it correctly the moment it makes it, so SELinux never comes up —
which is exactly why people who only ever used named volumes conclude that
SELinux and containers get along fine.

A **bind mount** (`-v /srv/webcontent:/var/www/html`) is a path that already
exists on the host, with a label the host gave it. This is what you want when a
human edits the files: the directory keeps its own identity, backups already
cover it, and a `vim` on the host is visible in the container immediately. It is
also where SELinux stops you.

Confined containers run as `container_t`, and policy lets `container_t` read
almost nothing except `container_file_t`. A directory under `/srv` is `var_t`; one
in a home directory is `user_home_t`. Neither is readable, so the process inside
starts fine and then cannot open the files: Apache answers **403 Forbidden**,
not 404, and `ls -l` on the host shows nothing wrong. The evidence is in the
audit log, not in the container:

```
sudo ausearch -m avc -ts recent    # denied { read } ... scontext=...container_t
ls -Zd /srv/webcontent             # unconfined_u:object_r:var_t:s0
```

The mount options that fix it are one character apart and are not
interchangeable:

- **`:z`** relabels the source to `container_file_t:s0` — no MCS categories, so
  *every* container on the box may read it. Correct for content genuinely shared
  between containers.
- **`:Z`** relabels it to `container_file_t` with a **private category pair**
  belonging to this container. Nothing else can touch it. This is the default
  choice, and podman reapplies it on every start, including the start systemd
  performs at boot.

The mistake to avoid is not forgetting the flag — you find that out in seconds.
It is **using `:Z` on a path that something else owns.** The relabel is recursive
and destructive of the old label: `-v /home/student:/data:Z` relabels the user's
entire home directory to a private container type, and `-v /var/www/html:...:Z`
breaks the host's own httpd, which can no longer read its document root. Neither
is undone by removing the container. `restorecon -R` is the repair, and the habit
is to bind-mount a directory that exists for the container and nothing else.

The alternative route is the general SELinux one: `semanage fcontext -a -t
container_file_t '/srv/webcontent(/.*)?'` followed by `restorecon -R`. It is more
typing and it is strictly better in one way — the label is written into policy, so
a full filesystem relabel keeps it, where a `:Z` label is only reapplied because
podman happens to run again.

What you must not do is make the problem disappear with
`--security-opt label=disable`. It works, it is what the internet suggests, and it
switches SELinux off for that container — so the graded requirement "SELinux
stays enforcing" is satisfied on paper while the confinement that mattered is
gone.
