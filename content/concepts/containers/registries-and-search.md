---
id: containers.registries-and-search
title: Reading an image name, and finding one you can actually pull
rhel: 9
objectives: [containers.images.registry, containers.podman.manage]
sources: [r9:ch26]
prerequisites: [containers.image-vs-container]
---
A full image reference has four parts, and every confusion about pulling images
comes from one of them being left out:

```
registry.access.redhat.com / ubi9  / ubi        : latest
registry host                namespace repository  tag
```

The tag may be replaced by a digest — `ubi9/ubi@sha256:1f2e…` — and that is the
one form that cannot change under you. A **tag is a movable pointer**: whoever
owns the repository can move `:latest` to a new image tomorrow, and `latest` is
just a conventional name with no promise attached, not "the newest thing". If you
need the same bytes twice, name the digest.

Leave the registry off and podman has to guess. It consults
`unqualified-search-registries` in `/etc/containers/registries.conf` and tries
each host in order, so `podman pull ubi9/ubi` may resolve to
registry.access.redhat.com on one machine and somewhere else entirely on the
next — a real supply-chain problem, not a style objection. The habit worth
building is to write the registry out in full, in Containerfiles especially. The
same file is where an administrator blocks a registry, adds a mirror, or defines
a short-name alias, so it is the first file to read when a pull resolves to
something surprising.

Red Hat runs two registries and they behave differently.
**registry.access.redhat.com** serves the UBI images and needs no credentials at
all; it is where `ubi9/ubi`, `ubi9/ubi-minimal` and the language runtimes live.
**registry.redhat.io** carries the fuller product catalogue and requires
`podman login` with a Red Hat account or a service-account token. An
unauthenticated pull from it fails with a 401 or an "unauthorized" message, and
reading that as a broken network is a classic way to lose twenty minutes. Note
too that credentials are per-user: `podman login` writes an `auth.json` under
your own `XDG_RUNTIME_DIR`, so logging in as yourself does nothing for
`sudo podman`.

`podman search` queries a registry's search API, and two things about it surprise
people. It returns **repositories, not tags** — so it answers "is there something
called nginx here", never "which versions can I get". And it only works against
registries that implement search: registry.access.redhat.com does, quay.io
partly, and a plain internal registry often not at all, in which case an empty
result means nothing about whether the image exists. For versions, ask for tags
explicitly with `podman search --list-tags registry.access.redhat.com/ubi9/ubi`
or `skopeo list-tags docker://registry.access.redhat.com/ubi9/ubi`.

**skopeo** is the tool for working on images you have not pulled. `skopeo inspect
docker://registry.access.redhat.com/ubi9/ubi:latest` reads the manifest and
labels straight from the registry, and `--config` returns the image config — the
default command, the environment, the exposed ports — without downloading a few
hundred megabytes to find out. `skopeo copy` then moves an image between
transports rather than between machines: `docker://` for a registry,
`containers-storage:` for the local podman store, `dir:` and `oci-archive:` for a
directory or a tarball. `skopeo copy docker://…/ubi9/ubi:latest
containers-storage:registry.access.redhat.com/ubi9/ubi:latest` is a `podman pull`
by another route, and copying registry-to-registry needs no local store at all.

That last point matters on a machine with no internet, which is the normal case
in an exam or on an isolated network. Images arrive from an internal registry, or
as a file — `podman save` and `podman load`, or a `skopeo copy` to
`oci-archive:` — and in both cases you are naming registries and tags by hand.
Which brings the whole card back to one habit: write the full reference, check
what you actually got with `podman images`, and confirm the local name is the one
your Containerfile says `FROM`.
