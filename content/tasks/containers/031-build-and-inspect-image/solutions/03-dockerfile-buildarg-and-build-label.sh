#!/usr/bin/env bash
# A third correct route, and the reason there is a third: MIN_SOLUTIONS is 2
# (src/engine/validate/harness.ts:46), so with only 01 and 02 this task sat
# exactly on the floor. Solution 02 needs skopeo AND buildah, two packages that
# are not part of a minimal install - skopeo is installed by setup.sh from the
# DVD - so one missing package or one removed subcommand took the task below the
# floor and turned the lint red. This route uses nothing but podman and no
# deprecated subcommand, so it is the one that cannot be taken away.
#
# Deliberately different from solution 01 at every point a grader could be
# over-fitted to (risk R4), and different from solution 02 too:
#   - the build file is named Dockerfile, not Containerfile, which podman accepts
#     and which the grader must accept as well
#   - the FROM value comes from a build argument, so the file alone cannot tell
#     anyone which image this is built on: `FROM ${BASE}` is unresolvable text and
#     only the layer stack of the finished image answers the question
#   - the stamp file is written with `RUN printf ... >` rather than `echo` or COPY
#   - the label is set on the COMMAND LINE with `podman build --label`, so an
#     image-label check that grepped the build file would fail this correct answer
#   - the default command is split across ENTRYPOINT and CMD, which is the other
#     correct way to write it and the shape antisolutions/06 gets wrong by
#     stopping halfway
#   - the answer file records what `podman image inspect` prints verbatim,
#     brackets and all, plus the ID in its `sha256:` spelling
set -euo pipefail

BASE=registry.access.redhat.com/ubi9/ubi:latest
BUILD_DIR=/home/student/rhcsa-build

podman pull "$BASE"

# `{{.Config.Cmd}}` on a Go slice prints [/bin/bash] - the exact string a student
# reading the concept card's example would paste. The square brackets are Go's,
# not part of the command, and copying them is a fair answer rather than a wrong
# one, so they are left in.
cmd=$(podman image inspect --format '{{.Config.Cmd}}' "$BASE")
# The ID with the prefix podman uses when it qualifies a digest. Same 64 hex
# characters as the bare form; either is the image ID.
id=$(podman image inspect --format '{{.Id}}' "$BASE")
case $id in
  sha256:*) ;;
  *) id="sha256:$id" ;;
esac

# A layout of the student's own choosing, which is what the prompt allows. Nothing
# about the file is a fixed format the grader depends on.
{
  printf 'UBI 9 base image (registry.access.redhat.com/ubi9/ubi:latest)\n'
  printf '  default command when started with no arguments: %s\n' "$cmd"
  printf '  image id: %s\n' "$id"
} > /home/student/ubi9-facts.txt

mkdir -p "$BUILD_DIR"
cat > "$BUILD_DIR/Dockerfile" <<'EOF'
# ARG before FROM is the one place a build argument may appear above it, and it is
# how a build file is parameterised without hardcoding a registry.
ARG BASE=registry.access.redhat.com/ubi9/ubi:latest
FROM ${BASE}
RUN printf 'BUILD-7731\n' > /etc/rhcsa-build.txt
# Both halves set. ENTRYPOINT alone would leave the base image's CMD in place as
# an argument to cat, which is antisolutions/06.
ENTRYPOINT ["/bin/cat"]
CMD ["/etc/rhcsa-build.txt"]
EOF

# --label writes into the image config, exactly as a LABEL instruction would;
# --build-arg supplies the FROM value, which the ARG default above would have
# supplied anyway - passed explicitly because that is how this route is used.
podman build \
  --file "$BUILD_DIR/Dockerfile" \
  --build-arg "BASE=$BASE" \
  --label io.rhcsa.owner=student \
  -t rhcsa-ubi:v1 \
  "$BUILD_DIR"
