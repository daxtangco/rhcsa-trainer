#!/usr/bin/env bash
# The image is right and the name is wrong: built with no tag, so podman applied
# the default `latest`. `podman images` looks convincing - there is a
# localhost/rhcsa-ubi row - and every later command that names rhcsa-ubi:v1 finds
# nothing.
#
# Every checkpoint that measures the new image is resolved through the tag the
# ticket named, so all five of them fail together. That is the honest verdict for
# this answer rather than an over-broad one: nothing in the store answers to
# rhcsa-ubi:v1, so there is no image to measure the label, the layers, the stamp
# file or the default command on. It also proves the grader compares the tag
# instead of searching for the repository name, which is the mistake a
# `grep rhcsa-ubi` implementation would make.
# expect-fail: derived-image-tagged, derived-from-base, stamp-file-baked, image-label, default-cmd-prints-stamp
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

podman pull "$BASE"

cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
id=$(podman image inspect --format '{{.Id}}' "$BASE")
printf 'default command: %s\nimage id: %s\n' "${cmd% }" "$id" > /home/student/ubi9-facts.txt

mkdir -p /home/student/rhcsa-build
cat > /home/student/rhcsa-build/Containerfile <<'EOF'
FROM registry.access.redhat.com/ubi9/ubi:latest
LABEL io.rhcsa.owner=student
RUN echo BUILD-7731 > /etc/rhcsa-build.txt
CMD ["/bin/cat", "/etc/rhcsa-build.txt"]
EOF

# The whole defect: no :v1.
podman build -t rhcsa-ubi /home/student/rhcsa-build
