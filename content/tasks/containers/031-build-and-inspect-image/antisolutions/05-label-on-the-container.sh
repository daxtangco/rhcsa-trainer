#!/usr/bin/env bash
# The label was attached to a container instead of to the image: the
# image-vs-container confusion again, one level up from antisolutions/02's
# build-time-against-run-time version of it. The Containerfile records no LABEL
# at all; the student ran `podman create --label io.rhcsa.owner=student` after
# the build, saw the label in `podman inspect`, and stopped looking.
#
# It is convincing from the inside. `podman inspect <container>` prints
# "io.rhcsa.owner": "student" under .Config.Labels - the *container's* config,
# which is a copy of the image config with the run-time overrides applied - so
# the exact format string a student would reach for shows the label they asked
# for. Push the image anywhere, or start a second container from it, and the
# label is not there, because it never was: run-time metadata dies with the
# container's writable layer.
#
# Why this fixture exists: without it, image-label is never exercised through its
# OWN comparison. antisolutions/01 fails it via the grader's both-images-present
# guard (nothing answers to rhcsa-ubi:v1 there, so there is no image to read a
# label off) and every other fixture passes it. Replacing the label comparison in
# grade.sh with an unconditional ck_pass would have kept the whole bank green,
# which is the difference between a checkpoint and a decoration.
#
# Exactly one checkpoint may fail here. The tag, the lineage, the baked-in stamp
# file, the default command, the Containerfile and both answers are all correct,
# so anything else failing means the grader is measuring the wrong thing.
# expect-fail: image-label
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

podman pull "$BASE"

cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
id=$(podman image inspect --format '{{.Id}}' "$BASE")
printf 'default command: %s\nimage id: %s\n' "${cmd% }" "$id" > /home/student/ubi9-facts.txt

mkdir -p /home/student/rhcsa-build
# The whole defect: no LABEL instruction. Everything else is the correct answer.
cat > /home/student/rhcsa-build/Containerfile <<'EOF'
FROM registry.access.redhat.com/ubi9/ubi:latest
RUN echo BUILD-7731 > /etc/rhcsa-build.txt
CMD ["/bin/cat", "/etc/rhcsa-build.txt"]
EOF

podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build

# The student's belief, staged so a grader that read a *container's* config
# instead of the image's would pass this fixture and be caught. `create`, not
# `run`: nothing needs to execute for the label to show up in `podman inspect`,
# and a container that never starts cannot occupy a port or write anything.
#
# Tolerant on purpose. The graded defect is the missing LABEL in the image above,
# which is already in place; if `podman create` fails on some guest, this fixture
# still fails image-label and nothing else, so aborting here under `set -e` would
# turn a representative detail into a broken fixture.
podman create --name labelled --label io.rhcsa.owner=student localhost/rhcsa-ubi:v1 >/dev/null 2>&1 || true
