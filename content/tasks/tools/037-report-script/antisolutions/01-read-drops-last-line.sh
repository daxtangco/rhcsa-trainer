#!/usr/bin/env bash
# The most common real bug in a script of this shape, and the one the sample list
# is unterminated in order to expose: `while IFS= read -r name; do ...; done <
# file` with no guard on the last line.
#
# `read` returns non-zero when it hits end of file without seeing a newline - even
# though it has just put the text it read into the variable - so the loop
# condition is false and the body never runs for the final name. On a list that
# ends with a newline this script is perfect, which is exactly why the bug
# survives testing: it depends on a byte you cannot see.
#
# Everything else here is solutions/01 unchanged, so a failure can only be about
# that byte.
# expect-fail: unterminated-line
set -euo pipefail

sudo tee /usr/local/bin/rhcsa-account-report >/dev/null <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 1 ]]; then
  printf 'usage: %s LISTFILE\n' "${0##*/}" >&2
  exit 2
fi

# The missing `|| [[ -n $name ]]` is the whole fixture.
while IFS= read -r name; do
  [[ -n $name ]] || continue
  if uid=$(id -u "$name" 2>/dev/null); then
    if [[ $uid -lt 1000 ]]; then
      printf '%s system %s\n' "$name" "$uid"
    else
      printf '%s user %s\n' "$name" "$uid"
    fi
  else
    printf '%s missing\n' "$name"
  fi
done < "$1"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
sudo restorecon /usr/local/bin/rhcsa-account-report
