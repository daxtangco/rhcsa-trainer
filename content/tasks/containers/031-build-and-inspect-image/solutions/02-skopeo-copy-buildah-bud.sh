#!/usr/bin/env bash
# Equally correct, and deliberately different at every step that a grader could
# be over-fitted to (risk R4):
#   - the image is retrieved with `skopeo copy` into containers-storage, so
#     nothing here runs `podman pull`
#   - the image ID is read off the `podman images` listing, which prints the
#     12-character short form rather than the full digest
#   - the stamp file arrives with COPY from the build context instead of RUN
#   - CMD is written in shell form, so podman stores it wrapped in /bin/sh -c
#   - the build is done by `buildah bud`, not `podman build`, and the tag is
#     spelled with the localhost/ prefix podman would have added anyway
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest

skopeo copy "docker://$BASE" "containers-storage:$BASE"

cmd=$(podman inspect --type image --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
# The short ID as a student reading the table would copy it. The inspect form is
# a fallback so this fixture cannot fail over a column layout: either spelling of
# the ID is a correct answer, and the grader accepts any prefix of 12 or more.
short=$(podman images | awk '$1 == "registry.access.redhat.com/ubi9/ubi" && $2 == "latest" { print $3; exit }')
printf '%s\n%s\n' "${cmd% }" "${short:-$(podman image inspect --format '{{.Id}}' "$BASE")}" \
  > /home/student/ubi9-facts.txt

mkdir -p /home/student/rhcsa-build
printf 'BUILD-7731\n' > /home/student/rhcsa-build/stamp.txt
cat > /home/student/rhcsa-build/Containerfile <<'EOF'
FROM registry.access.redhat.com/ubi9/ubi
LABEL "io.rhcsa.owner"="student"
COPY stamp.txt /etc/rhcsa-build.txt
CMD /usr/bin/cat /etc/rhcsa-build.txt
EOF

buildah bud -t localhost/rhcsa-ubi:v1 \
  -f /home/student/rhcsa-build/Containerfile /home/student/rhcsa-build
