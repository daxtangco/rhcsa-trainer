#!/usr/bin/env bash
# The route the book teaches: podman for every step, a RUN that writes the stamp
# file, and an exec-form CMD.
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

podman pull "$BASE"

# Both answers come out of the local copy of the image. The trailing space is
# what `{{range}}` leaves behind, not part of the command.
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

podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build
