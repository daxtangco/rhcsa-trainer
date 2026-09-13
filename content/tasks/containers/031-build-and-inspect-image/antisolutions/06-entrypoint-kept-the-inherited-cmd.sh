#!/usr/bin/env bash
# ENTRYPOINT was set and CMD was left alone, so the image runs
# `cat /bin/bash` and prints a binary.
#
# This is the trap the concept card containers.containerfile-layers names
# explicitly: setting ENTRYPOINT does not clear the CMD inherited from the base
# image, and the runtime concatenates the two. The base image's CMD is
# ["/bin/bash"], so the effective default command of this image is
# /bin/cat /bin/bash - which is why the grader reads Entrypoint and Cmd joined
# rather than reading Cmd alone. Set both, or set only CMD.
#
# It looks right in isolation: `podman image inspect --format '{{.Config.Cmd}}'`
# shows [/bin/bash] and the student who checks `{{.Config.Entrypoint}}` sees
# [/bin/cat], so each half is plausible on its own. Only `podman run` with no
# arguments - or reading the two together, which is what the runtime does - shows
# the answer is wrong.
#
# Why this fixture exists: without it, default-cmd-prints-stamp is never
# exercised through its OWN comparison. antisolutions/01 fails it via the
# both-images-present guard, and every other fixture passes it, so replacing the
# comparison with an unconditional ck_pass would have kept every fixture green.
#
# One checkpoint fails. The stamp file IS baked in, the label IS on the image, the
# tag and the lineage are right and both answers are correct - including
# facts-default-cmd, which asks about the BASE image's default command and is
# still /bin/bash regardless of what this build did to its own.
# expect-fail: default-cmd-prints-stamp
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

podman pull "$BASE"

cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
id=$(podman image inspect --format '{{.Id}}' "$BASE")
printf 'default command: %s\nimage id: %s\n' "${cmd% }" "$id" > /home/student/ubi9-facts.txt

mkdir -p /home/student/rhcsa-build
# The whole defect is the last line: ENTRYPOINT instead of CMD, with the base
# image's CMD left in place to be appended to it as an argument.
cat > /home/student/rhcsa-build/Containerfile <<'EOF'
FROM registry.access.redhat.com/ubi9/ubi:latest
LABEL io.rhcsa.owner=student
RUN echo BUILD-7731 > /etc/rhcsa-build.txt
ENTRYPOINT ["/bin/cat"]
EOF

podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build
