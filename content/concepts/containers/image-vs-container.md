---
id: containers.image-vs-container
title: An image is a file, a container is a process
rhel: 9
objectives: [containers.images.inspect, containers.podman.manage]
sources: [r9:ch26]
---
An **image** is data at rest: a stack of read-only filesystem layers plus one
small JSON document, the image *config*. A **container** is what you get when a
runtime takes an image, adds a thin writable layer on top and starts a process
inside it. Almost every early container mistake is one of these two things being
treated as the other.

The config is the half people forget, and it is the half the exam asks about.
It records what should happen when someone starts a container from this image
and says nothing else: the default command (`Cmd`), the entry point
(`Entrypoint`), environment variables (`Env`), labels (`Labels`), declared ports
(`ExposedPorts`), the working directory and the user. None of it is enforced at
build time — it is a note the image carries for whoever runs it later. That is
why "inspect the image" is a *reading* exercise:

```
podman image inspect --format '{{.Config.Cmd}}' registry.access.redhat.com/ubi9/ubi
podman image inspect --format '{{.Config.Labels}}' ubi9/ubi
podman image inspect --format '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}' ubi9/ubi
```

`podman inspect` on its own is polymorphic — hand it a name and it guesses
whether you meant an image or a container, which is convenient until the two
share a name. `podman image inspect` and `podman inspect --type container` say
which you meant. They return genuinely different documents: the image one is the
config above, the container one is runtime state — its PID, its mounts, its
network, and a copy of the image config it was started from.

Two objects, two listings, two id spaces. `podman images` lists images and
`podman ps` lists *running* containers; `podman ps -a` includes the stopped ones,
and forgetting the `-a` is why "I already removed that container" is usually
wrong. The `IMAGE ID` column is a 12-character truncation of the config digest —
`podman images --no-trunc` shows all 64 — and it is not the tag. A tag is a
movable label pointing at an ID, so one image can wear several tags, and
`podman tag` creating a "new" image creates nothing at all.

The consequence that costs people work: **a running container cannot change its
image.** Install a package, edit a file, write a log — all of it lands in that
container's writable layer, the image is untouched, and `podman rm` throws the
lot away. If you want the change to persist you either commit the container to a
new image (`podman commit`, fine for a rescue, poor as a habit because nothing
records how you got there) or you write a Containerfile and build. The same
asymmetry explains `podman rmi` refusing to remove an image that is "in use": a
stopped container still references it, so `podman ps -a` then `podman rm` comes
first.

The mirror-image mistake is believing a file the container can see is part of the
image. A bind mount, a volume and a file you touched inside a running container
all show up under `cat` exactly like a baked-in file does. Copy that image to
another machine and the file is gone, because it was never in a layer. When you
need to know what an image really contains, ask the image — `podman image diff
<base> <derived>` lists what the newer one added — rather than asking a container
you have already mounted things into.

One more separation worth naming early: your images and root's images are two
different stores. `podman images` as yourself reads
`~/.local/share/containers`, `sudo podman images` reads `/var/lib/containers`,
and an image pulled in one is invisible in the other. That is its own topic, but
it is the first thing to check when an image you definitely pulled cannot be
found.
