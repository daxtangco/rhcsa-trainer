---
id: containers.rootless-vs-rootful
title: Rootless containers are a different machine
rhel: 9
objectives: [containers.lifecycle.run, containers.service.run, containers.podman.manage]
sources: [r9:ch26]
---
`podman` and `sudo podman` are not the same tool pointed at the same data. They
are two independent installations that happen to share a binary. Nearly every
"but I already pulled that image" confusion comes from crossing the line between
them.

What actually differs:

```
podman info --format '{{.Store.GraphRoot}}'
# rootless: /home/student/.local/share/containers/storage
# root:     /var/lib/containers/storage
```

Images, containers, volumes, networks and the `podman ps` output all live under
that root. An image pulled with `sudo` is invisible to your own `podman`, and a
container you started is invisible to `sudo podman ps` — which is why "podman ps
shows nothing" is almost always an answer to a question about the other store.
Rootless units live in `~/.config/systemd/user`, rootful ones in
`/etc/systemd/system`. Nothing is shared.

Rootless containers work because of a **user namespace**. Inside the container,
your process believes it is UID 0; on the host it is you. The other container
UIDs come from the range allocated to your account in `/etc/subuid` and
`/etc/subgid` — typically 65536 UIDs starting at 100000 — and `podman` uses
`newuidmap`/`newgidmap` to map them. No range there means no rootless containers
at all, with an error about mapping rather than about permissions.

That mapping is where the surprises live, and they are all the same surprise
looked at from different sides:

- A file owned by you appears **owned by root** inside the container.
- A process running as UID 1001 inside the container — which is what most Red
  Hat images do, they do not run as root — is some subuid on the host, so it
  owns nothing of yours and is in none of your groups. It reads your files
  through the *other* permission bits. A bind-mounted directory at mode 0700 is
  unreadable to it no matter what SELinux says, and `/home/student` is 0700 on a
  stock RHEL 9 system, so a bind mount from your home directory fails for a
  reason that has nothing to do with containers.
- Files the container creates in a bind mount come out owned by a high, unnamed
  UID on the host. `podman unshare chown` is how you fix ownership *in the
  namespace's terms*; `--userns=keep-id` is how you avoid the problem by mapping
  your own UID straight through.

Rootless also cannot bind a privileged port. `net.ipv4.ip_unprivileged_port_start`
is 1024 on RHEL 9, so `-p 80:8080` fails and `-p 8080:8080` is what you publish;
the port inside the container is unaffected, because inside the namespace the
process is root.

**The habit worth building: decide which of the two machines you are on before
you type anything, and then never mix.** If a task says the service must not run
as root, every command — the pull, the run, the unit, the `enable` — is the
unprivileged user's, and the only `sudo` you should need is for things that are
genuinely the host's business, like a `semanage` rule or `loginctl enable-linger`
for somebody else.
