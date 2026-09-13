#!/usr/bin/env bash
# The real confusion this task exists to detect: build time against run time.
#
# The Containerfile records metadata only - a LABEL and a CMD - so the image
# gains no filesystem layer of its own, and /etc/rhcsa-build.txt is created on
# the HOST with the intention of bind-mounting it in later with
# `podman run -v /etc/rhcsa-build.txt:/etc/rhcsa-build.txt`. Every check a
# student is likely to run agrees with them: `podman run rhcsa-ubi:v1` with that
# -v prints the stamp, `podman image inspect` shows the label and the right
# default command, and `cat /etc/rhcsa-build.txt` on the host shows the content.
# Ship the image anywhere else and it prints "No such file or directory".
#
# Only one checkpoint may fail here, and that is the point: the label, the
# default command, the tag, the lineage, the Containerfile and both answers are
# all correct, so a grader that failed anything else would be measuring the wrong
# thing. The host file is created deliberately, to catch a grader that looked at
# /etc/rhcsa-build.txt on the guest instead of inside the image.
# expect-fail: stamp-file-baked
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

podman pull "$BASE"

cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
id=$(podman image inspect --format '{{.Id}}' "$BASE")
printf 'default command: %s\nimage id: %s\n' "${cmd% }" "$id" > /home/student/ubi9-facts.txt

# The stamp lives on the host, ready to be mounted in at run time. Nothing about
# it is part of the image.
printf 'BUILD-7731\n' | sudo tee /etc/rhcsa-build.txt >/dev/null

mkdir -p /home/student/rhcsa-build
cat > /home/student/rhcsa-build/Containerfile <<'EOF'
FROM registry.access.redhat.com/ubi9/ubi:latest
LABEL io.rhcsa.owner=student
CMD ["/bin/cat", "/etc/rhcsa-build.txt"]
EOF

podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build
