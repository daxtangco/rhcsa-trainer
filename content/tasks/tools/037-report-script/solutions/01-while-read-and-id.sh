#!/usr/bin/env bash
# Route 1, and the one the book's chapter 19 builds up to: a `while read` loop
# over the list, `id -u` for the lookup, `if`/`else` on the UID.
#
# Straight-line at the top level - three commands, no loop and no case - because
# rung 4 of the disclosure ladder builds its command sketch from the
# alphabetically first solution and shows the leading word of each line. The
# script being installed lives inside a quoted heredoc, which commandSketch skips
# whole, so the sketch a stuck student sees is `tee`, `chmod`, `restorecon`: the
# shape of the answer without the answer.
#
# Four things here are deliberately different from solutions/02, so the pair tests
# the grader rather than testing one author's habits twice:
#   this file                          solutions/02
#   while IFS= read -r … || [[ -n ]]   mapfile -t into an array
#   id -u                              getent passwd | cut -d: -f3
#   [[ … -lt 1000 ]]                   (( … >= 1000 ))
#   tee + chmod                        install -m 0755 from a temp file
set -euo pipefail

sudo tee /usr/local/bin/rhcsa-account-report >/dev/null <<'EOF'
#!/usr/bin/env bash
# Report which of the names in a list are local accounts, and which of those are
# service accounts. Usage: rhcsa-account-report LISTFILE
set -uo pipefail

if [[ $# -lt 1 ]]; then
  printf 'usage: %s LISTFILE\n' "${0##*/}" >&2
  exit 2
fi

list=$1
if [[ ! -r $list ]]; then
  printf '%s: cannot read %s\n' "${0##*/}" "$list" >&2
  exit 2
fi

# `IFS= read -r` so nothing in the line is stripped or unescaped, and the
# `|| [[ -n $name ]]` so the loop runs one more time when the last line of the
# file has no newline after it. Without that guard `read` returns non-zero on
# that line, the loop ends, and the name is silently dropped.
while IFS= read -r name || [[ -n $name ]]; do
  # Blank lines are not names.
  [[ -n $name ]] || continue

  # The lookup, and the conditional in one: `id -u` writes the UID on stdout and
  # exits non-zero if there is no such account, so the command substitution both
  # answers "does this exist" and produces the number.
  if uid=$(id -u "$name" 2>/dev/null); then
    if [[ $uid -lt 1000 ]]; then
      printf '%s system %s\n' "$name" "$uid"
    else
      printf '%s user %s\n' "$name" "$uid"
    fi
  else
    printf '%s missing\n' "$name"
  fi
done < "$list"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
# SELinux is Enforcing on this guest. A file created under /usr/local/bin
# inherits bin_t from its parent, so this only guarantees what is already true -
# the same belt and braces systemd/017's setup and sys/035's solutions/02 use.
sudo restorecon /usr/local/bin/rhcsa-account-report
