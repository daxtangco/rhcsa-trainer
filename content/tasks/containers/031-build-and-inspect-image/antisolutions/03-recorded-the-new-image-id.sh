#!/usr/bin/env bash
# The answer file records the wrong image. `podman images` after a build lists
# the new image first, so the ID nearest the top of the screen is the one the
# student just built, not the base image the ticket asked about.
#
# Everything else is correct, including the base image's default command, so this
# fixture isolates one checkpoint. The same code path grades the other half of
# this confusion - recording the NEW image's default command, /bin/cat, instead of
# the base image's /bin/bash - so a grader that read either answer off the wrong
# image is caught by one fixture or the other.
# expect-fail: facts-image-id
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

podman pull "$BASE"

mkdir -p /home/student/rhcsa-build
cat > /home/student/rhcsa-build/Containerfile <<'EOF'
FROM registry.access.redhat.com/ubi9/ubi:latest
LABEL io.rhcsa.owner=student
RUN echo BUILD-7731 > /etc/rhcsa-build.txt
CMD ["/bin/cat", "/etc/rhcsa-build.txt"]
EOF

podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build

# The default command is read from the base image, which is right. The ID is read
# from the image that was just built, which is the defect.
cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
id=$(podman image inspect --format '{{.Id}}' localhost/rhcsa-ubi:v1)
printf 'default command: %s\nimage id: %s\n' "${cmd% }" "$id" > /home/student/ubi9-facts.txt
