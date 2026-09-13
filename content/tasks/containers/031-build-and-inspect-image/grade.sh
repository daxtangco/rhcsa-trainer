#!/usr/bin/env bash
# Grader for containers/031-build-and-inspect-image.
#
# READ-ONLY, and unusually constrained by it. Every podman call below is an
# inspect, a listing or a diff: nothing starts a container, nothing mounts an
# image, nothing writes to either store. That rules out the obvious way to find
# out what is inside an image - run it and look - which is why `podman image
# diff` does that job, and why the answer file is graded by reading it rather
# than by re-running the student's commands. The exit code is ignored; only the
# JSONL emitted by ck_pass / ck_fail is read. assert.sh is prepended by
# loadTaskScripts, so its helpers are already in scope.
#
# Nothing here reads root's store, and that is a decision rather than an
# omission. The prompt is explicit that the work happens in the student's own
# rootless storage, so a `sudo podman images` would either grade the wrong store
# or grade both and quietly accept the answer the prompt rules out. The sudo
# reflex is named in a failure detail instead, where it costs nothing: running
# `sudo podman` on a guest that has no root store would initialise one, which is
# a change to the guest a grader is not allowed to make.
#
# Nothing here forks a shell that could read stdin, and that is checked rather
# than assumed: grade.sh is delivered to the guest on ssh stdin
# (src/engine/vm/ssh.ts:167-168), so the unread remainder of this file IS stdin
# and any child that read a line would silently delete the next line of the
# grader - the trailing checkpoints would vanish from the JSONL instead of
# failing. There is no `while read` at the top level, no `sudo`, no package
# manager and no shell fork; every grep, sed, tr and wc either names a file or
# reads a pipe, and podman's inspect, images and diff subcommands read no stdin.
# So no `< /dev/null` appears below. Add one to any command added here that could
# fork /bin/sh, following
# content/tasks/sys/035-persistent-journal-and-schedule/grade.sh:206.
#
# Ten checkpoints. Nine are impossible before the student starts - this guest
# ships zero container images (docs/vm-build-checklist.md), and setup.sh proves
# the store is empty, the answer file absent and the build directory free of any
# Containerfile. The tenth, selinux-enforcing, is the invariant.
# baseline-fail: base-image-present, facts-default-cmd, facts-image-id, containerfile-authored, derived-image-tagged, derived-from-base, stamp-file-baked, image-label, default-cmd-prints-stamp
set -uo pipefail

# The same constants setup.sh stages against; they have to change in both files
# together or the preconditions stop guarding the checkpoints. The base
# reference is fully qualified with an explicit tag because that is what the
# prompt names - and because an unqualified `ubi9/ubi` is resolved through
# unqualified-search-registries into exactly this name, so a student who pulled
# the short name is found by this lookup too.
BASE_REF=registry.access.redhat.com/ubi9/ubi:latest
FACTS=/home/student/ubi9-facts.txt
BUILD_DIR=/home/student/rhcsa-build
STAMP=/etc/rhcsa-build.txt
LABEL_KEY=io.rhcsa.owner
LABEL_VAL=student

# Collapse every run of whitespace to a single space and trim the ends. Used on
# Go template output, which ends with a trailing separator, and on the student's
# answer file, whose layout the prompt deliberately leaves free.
squeeze() { printf '%s' "$1" | tr -s '[:space:]' ' ' | sed -e 's/^ //' -e 's/ $//'; }

# --- fail closed ----------------------------------------------------------
# Nine of these ten checkpoints are answers to "what does podman say". If podman
# cannot run at all, every one of those questions returns the empty string - and
# an empty string equals another empty string, is a prefix of anything and is a
# substring of everything, so a grader that carried on would report a guest with
# no working container tooling as a correct answer. There is no safe way to
# continue past this.
#
# selinux-enforcing is failed here too, even though getenforce would still
# answer. A checkpoint that is never emitted is worse than one that fails: the
# harness counts arrivals against the number of ck calls in this file and reads a
# short run as truncated, so falling silent here would be reported as an
# incomplete grade rather than as a broken guest. The detail says why.
podman_probe=$(podman images -qa 2>&1)
if [[ $? -ne 0 ]] || ! command -v podman >/dev/null 2>&1; then
  detail="podman is unusable for student, so no image, no answer and no invariant could be evaluated: ${podman_probe:0:200}"
  ck_fail base-image-present "the UBI 9 base image is present in the rootless image store for student" "$detail"
  ck_fail facts-default-cmd "$FACTS records the default command of the base image" "$detail"
  ck_fail facts-image-id "$FACTS records the image ID of the base image" "$detail"
  ck_fail containerfile-authored "a Containerfile in $BUILD_DIR builds on the UBI 9 base image" "$detail"
  ck_fail derived-image-tagged "an image tagged rhcsa-ubi:v1 exists in the rootless image store for student" "$detail"
  ck_fail derived-from-base "rhcsa-ubi:v1 is built on top of the UBI 9 base image" "$detail"
  ck_fail stamp-file-baked "rhcsa-ubi:v1 carries $STAMP inside the image itself" "$detail"
  ck_fail image-label "rhcsa-ubi:v1 records the label $LABEL_KEY=$LABEL_VAL" "$detail"
  ck_fail default-cmd-prints-stamp "rhcsa-ubi:v1 runs cat $STAMP by default" "$detail"
  ck_fail selinux-enforcing "SELinux is still enforcing" "$detail"
  exit 0
fi

# --- 1. the base image was retrieved --------------------------------------
# `podman image inspect` on the exact name:tag, not a grep over `podman images`:
# inspect resolves names against the local store the same way the student's own
# commands do, and an exact reference cannot be satisfied by a repository whose
# name merely contains the one being looked for.
#
# .Id is podman's image ID, the digest of the image config. Two later sections
# need it, so it is read once here and normalised: some podman versions print it
# bare, some with a sha256: prefix.
base_id=$(podman image inspect --format '{{.Id}}' "$BASE_REF" 2>/dev/null | tr -d '[:space:]')
base_id=${base_id#sha256:}
base_id=${base_id,,}

if [[ -n $base_id ]]; then
  ck_pass base-image-present "the UBI 9 base image is present in the rootless image store for student"
else
  ck_fail base-image-present "the UBI 9 base image is present in the rootless image store for student" \
    "no image named $BASE_REF in the student store; an image pulled with sudo lands in the root store instead, and this task is about your own storage"
fi

# --- 2 and 3. the two facts the ticket asks for ---------------------------
# The expected answers are computed from the image that is actually present, and
# never hardcoded. A hardcoded /bin/bash would be wrong the day Red Hat changes
# the base image config, and would then fail every correct answer.
base_cmd=$(squeeze "$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$BASE_REF" 2>/dev/null)")

# Punctuation is turned into spaces rather than deleted: a student who pastes
# ["/bin/bash"] has answered the question, and deleting the comma in a
# two-element list would glue two arguments into one word matching nothing.
facts_norm=
if [[ -r $FACTS ]]; then
  facts_norm=$(squeeze "$(tr "[]\"'," " " < "$FACTS" 2>/dev/null)")
fi

if [[ ! -r $FACTS ]]; then
  ck_fail facts-default-cmd "$FACTS records the default command of the base image" \
    "no readable file at $FACTS"
  ck_fail facts-image-id "$FACTS records the image ID of the base image" \
    "no readable file at $FACTS"
elif [[ -z $base_cmd || -z $base_id ]]; then
  # Fail closed, again. With no base image there is no expected answer, and an
  # empty expected string is a substring of every file on the guest - including
  # an empty one - so continuing would hand out two passes for a file with
  # nothing in it. The detail says which half of the task comes first.
  detail="the base image is not in the student store, so the grader cannot know what the right answers are; retrieve the image first"
  ck_fail facts-default-cmd "$FACTS records the default command of the base image" "$detail"
  ck_fail facts-image-id "$FACTS records the image ID of the base image" "$detail"
else
  # Whitespace-bounded on both sides, so /usr/bin/bash does not answer a
  # question whose answer is /bin/bash. The detail names where to look and never
  # what to write: a detail quoting the expected value would be an answer key,
  # and the student reads these.
  if [[ " $facts_norm " == *" $base_cmd "* ]]; then
    ck_pass facts-default-cmd "$FACTS records the default command of the base image"
  else
    ck_fail facts-default-cmd "$FACTS records the default command of the base image" \
      "nothing in $FACTS matches the default command of the base image; it is the Cmd in the image config, and podman image inspect will show it"
  fi

  # Any hex run of 12 or more characters that is a prefix of the real ID counts.
  # 12 because that is what `podman images` prints, 64 because that is the whole
  # digest, and case-insensitively because either is a fair copy of what podman
  # showed. The unquoted expansion is the word splitting this loop needs; the
  # tokens are hex by construction, so there is nothing there to glob.
  id_match=no
  for tok in $(grep -oiE '[0-9a-f]{12,64}' "$FACTS" 2>/dev/null | tr 'A-Z' 'a-z'); do
    if [[ $base_id == "$tok"* ]]; then
      id_match=yes
      break
    fi
  done
  if [[ $id_match == yes ]]; then
    ck_pass facts-image-id "$FACTS records the image ID of the base image"
  else
    ck_fail facts-image-id "$FACTS records the image ID of the base image" \
      "no ID in $FACTS belongs to the base image; after a build the store holds more than one image, and the newest one listed is not the base"
  fi
fi

# --- 4. there is a Containerfile, and it builds on the base image ---------
# The objective is "Build a container from a Containerfile", so unlike
# selinux/019 - which deliberately greps no config file, because where the
# DocumentRoot is written is not its objective - the build file itself is part of
# the objective here. It also closes the one route that would otherwise satisfy
# every other checkpoint with no build file at all: `podman commit` on a
# hand-edited container, with --change CMD and --change LABEL, produces an image
# this grader cannot tell apart from a built one.
#
# Either name is accepted, because podman build accepts either.
cf=
for name in Containerfile Dockerfile; do
  if [[ -f $BUILD_DIR/$name ]]; then
    cf=$BUILD_DIR/$name
    break
  fi
done

if [[ -z $cf ]]; then
  ck_fail containerfile-authored "a Containerfile in $BUILD_DIR builds on the UBI 9 base image" \
    "no Containerfile and no Dockerfile in $BUILD_DIR"
else
  # Three accepted shapes for the FROM value, and the third is the interesting
  # one. A FROM naming ubi9/ubi is the ordinary answer. A FROM naming the base
  # image ID is the same answer spelled as a digest. A FROM whose value contains
  # a `$` cannot be resolved by reading the file, so it is accepted here and left
  # to derived-from-base, which measures the lineage of the image that was
  # actually produced; rejecting it would fail a legitimate
  # `ARG BASE=...` / `FROM $BASE` build for no gain, because the lineage is
  # already graded by layer stack rather than by text.
  #
  # Written as tests rather than as a `case`, because `*"${base_id:0:12}"*` with
  # an empty base_id is the pattern `**`, which matches every line - the empty
  # operand hazard this grader guards everywhere else.
  from_line=$(grep -iE '^[[:space:]]*FROM[[:space:]]+' "$cf" 2>/dev/null | head -1)
  from_ok=no
  if [[ -n $from_line ]]; then
    if [[ $from_line == *ubi9/ubi* ]]; then
      from_ok=yes
    elif [[ -n $base_id && $from_line == *"${base_id:0:12}"* ]]; then
      from_ok=yes
    elif [[ $from_line == *'$'* ]]; then
      from_ok=yes
    fi
  fi

  if [[ $from_ok == yes ]]; then
    ck_pass containerfile-authored "a Containerfile in $BUILD_DIR builds on the UBI 9 base image"
  else
    ck_fail containerfile-authored "a Containerfile in $BUILD_DIR builds on the UBI 9 base image" \
      "$cf has no FROM line naming the UBI 9 base image (first FROM seen: ${from_line:-none})"
  fi
fi

# --- 5. the new image exists under the required tag ----------------------
# podman stores a locally built unqualified name under localhost/, so
# `podman build -t rhcsa-ubi:v1` and `-t localhost/rhcsa-ubi:v1` produce the same
# image; both spellings are tried, so neither habit is penalised. The tag is
# compared and not searched for, so rhcsa-ubi:latest is not accepted in place of
# rhcsa-ubi:v1 - the ticket named a tag, and a wrongly tagged image is the
# classic reason a later `podman run rhcsa-ubi:v1` finds nothing.
derived=
for ref in localhost/rhcsa-ubi:v1 rhcsa-ubi:v1; do
  if podman image inspect --format '{{.Id}}' "$ref" >/dev/null 2>&1; then
    derived=$ref
    break
  fi
done

if [[ -n $derived ]]; then
  ck_pass derived-image-tagged "an image tagged rhcsa-ubi:v1 exists in the rootless image store for student"
else
  ck_fail derived-image-tagged "an image tagged rhcsa-ubi:v1 exists in the rootless image store for student" \
    "no image tagged rhcsa-ubi:v1 or localhost/rhcsa-ubi:v1 in the student store; podman images lists the tags that do exist"
fi

# The four remaining image checkpoints all need both images to exist. Guarding
# once here keeps each of them from comparing empty strings, which is where this
# grader would otherwise hand out passes for an empty store.
#
# This guard is also the trap the fixture set had to be built around. It is the
# branch antisolutions/01 fails through - nothing answers to rhcsa-ubi:v1 there -
# so for a while it was the ONLY branch that ever failed derived-from-base,
# image-label and default-cmd-prints-stamp, and replacing any of those three
# comparisons below with an unconditional ck_pass would have kept every fixture
# green and the lint silent. Each of the three now has a fixture that breaks it
# through its own comparison with both images present: antisolutions/07 (wrong
# base), antisolutions/05 (label on the container) and antisolutions/06
# (ENTRYPOINT kept the inherited CMD). stamp-file-baked has had antisolutions/02
# from the start.
if [[ -z $derived || -z $base_id ]]; then
  # base_id is deliberately not interpolated: it is one of the two answers the
  # student has to write into the answer file, and a detail is student-facing.
  base_state=missing
  [[ -n $base_id ]] && base_state=present
  detail="both images must exist before this can be measured: base image $base_state, rhcsa-ubi:v1 ${derived:-missing}"
  ck_fail derived-from-base "rhcsa-ubi:v1 is built on top of the UBI 9 base image" "$detail"
  ck_fail stamp-file-baked "rhcsa-ubi:v1 carries $STAMP inside the image itself" "$detail"
  ck_fail image-label "rhcsa-ubi:v1 records the label $LABEL_KEY=$LABEL_VAL" "$detail"
  ck_fail default-cmd-prints-stamp "rhcsa-ubi:v1 runs cat $STAMP by default" "$detail"
else
  # --- 6. lineage --------------------------------------------------------
  # RootFS.Layers is an image's layer stack, bottom first. Building on top of
  # something can only append to it, so the base image's layers must be a prefix
  # of the new image's. That is mechanism-agnostic in the way that matters here:
  # FROM by name, FROM by digest, FROM by image ID and a multi-stage build whose
  # final stage starts from this base all produce the same prefix, while an image
  # built on a different base - or on scratch - cannot.
  #
  # Each element is emitted with a trailing space, so the comparison cannot match
  # half a digest. Known limitation: `podman build --squash-all` rewrites the base
  # layers into one and would fail this. Nothing in the prompt asks for it and it
  # is not RHCSA material, so the check stays strict rather than being weakened
  # to a "do they share any layer" test that a sibling image of the base would
  # also satisfy.
  base_layers=$(podman image inspect --format '{{range .RootFS.Layers}}{{.}} {{end}}' "$BASE_REF" 2>/dev/null)
  derived_layers=$(podman image inspect --format '{{range .RootFS.Layers}}{{.}} {{end}}' "$derived" 2>/dev/null)
  base_n=$(printf '%s' "$base_layers" | wc -w | tr -d ' ')
  derived_n=$(printf '%s' "$derived_layers" | wc -w | tr -d ' ')

  if [[ -z $base_layers || -z $derived_layers ]]; then
    # Empty operands once more: the empty string is a prefix of everything, so
    # this must not fall through to the comparison below.
    ck_fail derived-from-base "rhcsa-ubi:v1 is built on top of the UBI 9 base image" \
      "could not read a layer stack for one of the images (base $base_n layers, rhcsa-ubi:v1 $derived_n layers)"
  elif [[ $derived_layers == "$base_layers"* ]]; then
    ck_pass derived-from-base "rhcsa-ubi:v1 is built on top of the UBI 9 base image"
  else
    ck_fail derived-from-base "rhcsa-ubi:v1 is built on top of the UBI 9 base image" \
      "the layer stack of rhcsa-ubi:v1 does not start with the base image layers ($derived_n layers against $base_n); it was built on something else"
  fi

  # --- 7. the stamp file is part of the image ----------------------------
  # `podman image diff` compares two images from the layer store without
  # starting a container, which makes it the only tool that answers "what does
  # this image contain" inside a read-only grader.
  #
  # This is the checkpoint that separates a file baked in at build time from a
  # file that only exists while a container runs: a bind mount, a volume, or a
  # touch inside a running container that was never committed. None of the three
  # appears in a diff between these two images, and all three leave a student
  # convinced the file is in the image because `podman run ... cat` printed it.
  #
  # The path alone is matched rather than insisting on a leading `A`: with the
  # base image given first an added file is reported as `A /etc/rhcsa-build.txt`,
  # but the letters and the argument order are podman's business. The residual is
  # that a `D` line would match too, which needs a student to have deleted a path
  # they never created. Anchored at both ends, so /etc/rhcsa-build.txt.bak is not
  # accepted as this file.
  diff_out=$(podman image diff "$BASE_REF" "$derived" 2>&1)
  diff_rc=$?
  if [[ $diff_rc -ne 0 ]]; then
    # Fail closed rather than falling back on the layer count. A layer count can
    # only say that *something* was added, and passing this checkpoint on that
    # basis would green-light an image whose stamp file is at the wrong path,
    # which is exactly the answer this checkpoint exists to catch.
    ck_fail stamp-file-baked "rhcsa-ubi:v1 carries $STAMP inside the image itself" \
      "podman image diff exited $diff_rc, so the grader could not read the image filesystem: ${diff_out:0:200}"
  # grep WITHOUT -q, stdout discarded, because `-q` made this checkpoint lie.
  # Under `set -o pipefail` grep -q exits at the first match, printf dies of
  # SIGPIPE, and the pipeline reports 141 - a failure for a search that found
  # what it was looking for. It only bites when the match sits more than one
  # 64 KiB pipe buffer from the end of the stream, so every fixture built on the
  # SAME base as $BASE_REF was safe (a one-layer diff is a few lines) and
  # antisolutions/07 was not: it builds on ubi-minimal, so this diff is between
  # two unrelated userspaces, runs to over a megabyte, and sorts
  # /etc/rhcsa-build.txt near the top. The result was stamp-file-baked failing
  # for a fixture whose stamp file is demonstrably in the image, with a detail
  # line confidently reporting the opposite. Without -q grep reads to EOF.
  elif printf '%s\n' "$diff_out" | grep -E '(^|[[:space:]])/etc/rhcsa-build\.txt$' >/dev/null; then
    ck_pass stamp-file-baked "rhcsa-ubi:v1 carries $STAMP inside the image itself"
  else
    ck_fail stamp-file-baked "rhcsa-ubi:v1 carries $STAMP inside the image itself" \
      "rhcsa-ubi:v1 adds $((derived_n - base_n)) layer(s) over the base image and none of them holds $STAMP; a file mounted in at run time is not part of the image"
  fi

  # --- 8. the label ------------------------------------------------------
  # Read from the image config, so it is true of the image wherever it goes -
  # unlike `podman run --label`, which labels one container and leaves the image
  # unlabelled. `index` on a nil label map yields the empty string rather than an
  # error, so an image with no labels at all fails here instead of erroring.
  label=$(squeeze "$(podman image inspect --format "{{index .Config.Labels \"$LABEL_KEY\"}}" "$derived" 2>/dev/null)")
  if [[ $label == "$LABEL_VAL" ]]; then
    ck_pass image-label "rhcsa-ubi:v1 records the label $LABEL_KEY=$LABEL_VAL"
  else
    ck_fail image-label "rhcsa-ubi:v1 records the label $LABEL_KEY=$LABEL_VAL" \
      "the $LABEL_KEY label on the image reads ${label:-unset}"
  fi

  # --- 9. what it runs by default ----------------------------------------
  # The effective default command is Entrypoint followed by Cmd, and it has to be
  # read that way rather than as Cmd alone. Setting ENTRYPOINT does not clear the
  # Cmd inherited from the base image, so an image carrying
  # ENTRYPOINT ["/bin/cat"] plus the inherited CMD ["/bin/bash"] runs
  # `cat /bin/bash` and prints a binary. Joining them is what makes that answer
  # fail while ENTRYPOINT ["/bin/cat"] with CMD ["/etc/rhcsa-build.txt"] passes,
  # which is the real runtime behaviour of both.
  #
  # `range` over a nil slice emits nothing, so an image with no Entrypoint
  # contributes nothing here instead of printing a literal [] to be parsed.
  ep=$(podman image inspect --format '{{range .Config.Entrypoint}}{{.}} {{end}}' "$derived" 2>/dev/null)
  cmd=$(podman image inspect --format '{{range .Config.Cmd}}{{.}} {{end}}' "$derived" 2>/dev/null)
  effective=$(squeeze "$ep $cmd")

  # Mechanism-agnostic across the two ways of writing a Containerfile command.
  # The exec form CMD ["/bin/cat","/etc/rhcsa-build.txt"] and the shell form
  # CMD /bin/cat /etc/rhcsa-build.txt both do what the ticket asks; the second is
  # stored as a /bin/sh -c wrapper, so the wrapper comes off before comparing.
  # /bin and /usr/bin are the same directory on UBI, so cat may be written either
  # way or with no path at all.
  normalised=$(printf '%s' "$effective" | sed -E 's#^(/usr/bin/|/bin/)?(ba|da|k|z)?sh -c ##')
  normalised=${normalised//\"/}
  normalised=${normalised//\'/}
  normalised=$(squeeze "$(printf '%s' "$normalised" | sed -E 's#^(/usr/bin/|/bin/)##')")

  if [[ $normalised == "cat $STAMP" ]]; then
    ck_pass default-cmd-prints-stamp "rhcsa-ubi:v1 runs cat $STAMP by default"
  else
    ck_fail default-cmd-prints-stamp "rhcsa-ubi:v1 runs cat $STAMP by default" \
      "the default command of the image is ${effective:-unset}; a RUN instruction executes at build time and leaves this untouched"
  fi
fi

# --- 10. the invariant ----------------------------------------------------
# Passes from the start. It is here because rootless podman is where a student
# first meets SELinux denials on volume mounts, and `setenforce 0` is the reflex
# that makes them go away. Probed by antisolutions/04 rather than declared
# unprobed: `setenforce 0` is runtime-only, so the fixture that breaks this leaves
# nothing persistent behind and the harness's revert to the clean snapshot - which
# precedes every fixture and every session start - undoes it in full. Nothing
# repairs it: per the SELinux state policy in setup.sh, no setup.sh in this bank
# repairs SELinux state, it reports and refuses, so a guest that is still
# permissive when 031 is staged fails setup loudly instead of being laundered into
# a green stage. Contrast selinux/019, where the only way to break its invariant
# risked a guest that needed a full relabel to come back.
enforce=$(getenforce 2>/dev/null)
[[ $enforce == Enforcing ]]
ck selinux-enforcing "SELinux is still enforcing" $? "getenforce=${enforce:-nothing}"

exit 0
