#!/usr/bin/env bash
# Built on the wrong base image. The ticket names
# registry.access.redhat.com/ubi9/ubi and this build starts FROM
# registry.access.redhat.com/ubi9/ubi-minimal - the reasonable-sounding
# substitution ("the minimal one is smaller and it is still UBI 9") that produces
# an image with a different userspace: no dnf, no bash guaranteed, a different
# package set, and a lineage that has nothing to do with the image the platform
# team standardised on.
#
# The base image the ticket asked for IS retrieved and left in place, and both
# answers are read off it, so this is not "forgot half the task": it is one wrong
# word in one FROM line, which is how this mistake actually arrives.
#
# Why this fixture exists: without it, derived-from-base is never exercised
# through its OWN comparison. antisolutions/01 fails it via the grader's
# both-images-present guard (no image answers to rhcsa-ubi:v1 there at all) and
# every other fixture passes it, so replacing the layer-prefix comparison with an
# unconditional ck_pass would have kept the whole bank green.
#
# It also documents a real property of the grader rather than a defect in it:
# containerfile-authored PASSES here, because that checkpoint asks the text
# question - is there a build file, and does its FROM name the UBI 9 base image -
# and "registry.access.redhat.com/ubi9/ubi-minimal" does contain that name.
# Tightening it to reject ubi-minimal would be the wrong repair: a FROM line can
# name the base by digest, by image ID or through a build argument, so the text
# can never be the authority on lineage. derived-from-base is that authority, it
# reads the layer stack of the image that was actually produced, and this fixture
# is what proves the two checkpoints are independent instead of one check written
# twice.
#
# Cost, stated: this fixture pulls a second base image (~100 MB) on top of the one
# every other fixture here pulls. That is the price of breaking the lineage check
# with a plausible image rather than with `FROM scratch`, which would also fail
# containerfile-authored and would model a mistake nobody makes.
#
# One checkpoint fails. The tag is right, the label is on the image, the stamp
# file is baked into a layer, the default command is right, and both answers
# describe the base image the ticket named.
# expect-fail: derived-from-base
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest
WRONG_BASE=registry.access.redhat.com/ubi9/ubi-minimal:latest

podman pull "$BASE"

cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE")
id=$(podman image inspect --format '{{.Id}}' "$BASE")
printf 'default command: %s\nimage id: %s\n' "${cmd% }" "$id" > /home/student/ubi9-facts.txt

mkdir -p /home/student/rhcsa-build
printf 'BUILD-7731\n' > /home/student/rhcsa-build/stamp.txt
# COPY rather than RUN, so the build needs no shell in the base image at all:
# ubi-minimal's userspace is not this fixture's subject and a `RUN echo` failing
# there would break the fixture for a reason that has nothing to do with lineage.
# The whole defect is the FROM line.
cat > /home/student/rhcsa-build/Containerfile <<EOF
FROM $WRONG_BASE
LABEL io.rhcsa.owner=student
COPY stamp.txt /etc/rhcsa-build.txt
CMD ["/bin/cat", "/etc/rhcsa-build.txt"]
EOF

# The build pulls ubi-minimal itself; no separate pull, so a registry failure is
# reported once, by the command that needed the image.
podman build -t rhcsa-ubi:v1 /home/student/rhcsa-build
