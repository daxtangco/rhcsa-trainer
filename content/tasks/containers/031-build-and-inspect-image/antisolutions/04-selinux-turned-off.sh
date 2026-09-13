#!/usr/bin/env bash
# A correct build, arrived at by turning SELinux off first.
#
# This is the reflex rootless podman teaches people: a volume mount is denied,
# `setenforce 0` makes the denial go away, and the mode never gets put back. It
# leaves a machine that works today and fails its next audit, so the prompt says
# to leave SELinux enforcing and the grader checks it.
#
# Probing this rather than declaring it unprobed - the choice selinux/019 had to
# make - is safe here because `setenforce 0` is a runtime-only change and the
# harness reverts to the clean snapshot before the next fixture, before every
# session start and before every reset, so the permissive mode this leaves cannot
# reach another stage. It writes nothing persistent: /etc/selinux/config is
# untouched, so even a guest that somehow escaped the revert comes back enforcing
# at its next boot with no relabel to pay for. Nothing repairs it: per the SELinux
# state policy in setup.sh, no setup.sh in this bank repairs SELinux state, so a
# guest left permissive fails 031's staging loudly rather than being quietly put
# back - which is what makes this fixture's damage bounded instead of invisible.
# expect-fail: selinux-enforcing
set -euo pipefail

sudo setenforce 0

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

podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build
