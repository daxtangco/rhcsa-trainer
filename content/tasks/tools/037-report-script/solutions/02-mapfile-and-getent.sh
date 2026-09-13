#!/usr/bin/env bash
# Route 2, equally correct, and different from solutions/01 in every choice it
# makes: the list is slurped into an array with `mapfile` instead of streamed
# through `read`, the lookup is `getent passwd` piped into `cut` instead of
# `id -u`, the comparison is an arithmetic `(( ))` instead of `[[ -lt ]]`, the
# usage check counts arguments with `test` instead of `[[ ]]`, and the file is put
# in place with `install` from a temp file instead of `tee` plus `chmod`.
#
# The point of the pair is that a grader over-fitted to either one fails the
# other. In particular this script's report is produced by `echo`, its fields are
# separated by a single space it never guarantees, and it never mentions the
# string "user" outside the two `echo` lines - so a grader that grepped the
# student's source for `id -u`, for `while`, or for a printf format would reject a
# correct answer.
set -euo pipefail

TMP=$(mktemp)
cat > "$TMP" <<'EOF'
#!/bin/bash
# Report which of the names in a list are local accounts, and which of those are
# service accounts. Usage: rhcsa-account-report LISTFILE

if test "$#" -ne 1; then
  echo "usage: $(basename "$0") LISTFILE" >&2
  exit 2
fi

# mapfile reads the whole file into an array, one line per element, -t dropping
# the newlines. A final line with no newline after it is still an element, which
# is what makes this route immune to the bug the `read` loop has to guard
# against. An empty file yields an empty array, so the loop below runs zero times
# and the script exits 0 with nothing printed.
mapfile -t names < "$1"

for name in "${names[@]}"; do
  test -n "$name" || continue

  # The account database, as a line of colon-separated fields, or nothing at all.
  # Capturing it rather than testing an exit status means one lookup answers both
  # questions - does it exist, and what is its UID.
  entry=$(getent passwd "$name")
  if test -z "$entry"; then
    echo "$name missing"
    continue
  fi

  uid=$(printf '%s\n' "$entry" | cut -d: -f3)
  if (( uid >= 1000 )); then
    echo "$name user $uid"
  else
    echo "$name system $uid"
  fi
done
EOF

# install does the copy and the mode in one step, which is why it exists, and it
# creates the destination rather than carrying the source over: a new file under
# /usr/local/bin takes that directory's default type, so the temp file's SELinux
# context does not follow it the way it would through `mv`. That is why there is no
# restorecon on this route and solutions/01 has one - `tee` also creates the file,
# so 01's restorecon is belt and braces too.
sudo install -m 0755 "$TMP" /usr/local/bin/rhcsa-account-report
rm -f "$TMP"
