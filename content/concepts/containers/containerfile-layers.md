---
id: containers.containerfile-layers
title: Build time, run time, and what a layer actually is
rhel: 9
objectives: [containers.build.containerfile]
sources: [r9:ch26]
prerequisites: [containers.image-vs-container]
---
Every instruction in a Containerfile does one of exactly two things, and knowing
which is which explains nearly all of its behaviour.

**It changes the filesystem, producing a new layer.** `RUN` executes a command
now, while the image is being built, and whatever that command left behind on
disk becomes a layer. `COPY` and `ADD` bring files in from the build context and
become a layer too.

**Or it records metadata in the image config, producing no layer.** `FROM`,
`LABEL`, `ENV`, `CMD`, `ENTRYPOINT`, `EXPOSE`, `USER`, `WORKDIR` and `VOLUME`
change nothing on disk. They write a note into the config for whoever runs the
image later.

So `RUN` happens *now* and `CMD` happens *never* — not during the build, anyway.
The two symmetrical mistakes follow directly:

- `RUN /usr/sbin/httpd` does not give you an image that serves pages. The build
  starts httpd, the build step ends, the process dies, and all you have baked in
  is whatever files httpd happened to write.
- `CMD dnf install -y httpd` does not give you an image with httpd in it. It
  gives you an image that tries to install httpd every time somebody starts a
  container from it, on whatever network that machine happens to have.

Anything that must be *in* the image goes in a `RUN`, a `COPY` or an `ADD`.
Anything that describes how to *start* it goes in `CMD` or `ENTRYPOINT`.

Both of those accept two spellings. The exec form, `CMD ["/bin/cat", "/etc/x"]`,
is a list handed straight to execve. The shell form, `CMD /bin/cat /etc/x`, is
stored as `/bin/sh -c "/bin/cat /etc/x"`, so you get a shell — and shell quoting,
and an extra process. Both work; the exec form is what you want unless you
actually need shell features. The trap is `ENTRYPOINT`: setting it does **not**
clear the `CMD` inherited from the base image, and the runtime concatenates the
two. `ENTRYPOINT ["/bin/cat"]` on top of a base whose `CMD` is `["/bin/bash"]`
runs `cat /bin/bash` and prints a binary to your terminal. Set both, or set only
`CMD`.

`COPY` reads from the **build context**, which is the directory you hand to
`podman build`, not your current directory and not the whole filesystem. A path
outside the context cannot be copied at all, which is why the file being baked in
normally sits right next to the Containerfile.

Layers are append-only and immutable, and that has two consequences people find
out the hard way. Deleting a file in a later `RUN` does not reclaim its space:
the earlier layer still holds it, so an image that downloads a tarball and
deletes it in the next instruction is still carrying the tarball — and a password
written into a layer stays readable to anyone who pulls the image, even if a
later layer removes the file. Do it in one instruction, or do not do it at all.
The upside of the same design is caching: a build reuses layers whose instruction
and inputs have not changed, so the instructions that change most often belong
last.

Building is `podman build -t myimage:v1 /path/to/context`, and `buildah bud`
takes the same arguments because it is the same engine underneath. If both a
`Containerfile` and a `Dockerfile` are present, Containerfile wins; `-f` names a
file explicitly. The tag deserves a look: an unqualified `-t myimage:v1` is
stored as `localhost/myimage:v1`, and if you leave the tag off entirely you get
`:latest` — after which every command that names `myimage:v1` reports that it
does not exist.

Afterwards, verify the image rather than your intentions. `podman history
myimage:v1` shows the instructions and which of them added a layer,
`podman image inspect` shows the config your metadata instructions wrote, and
`podman image diff <base> myimage:v1` shows the files your build really added.
If a file you expected is not in that diff, it was never in the image — you were
looking at a bind mount.
