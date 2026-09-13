#!/usr/bin/env bash
# Every line of the list is treated as a name, including the empty ones. `id -u ''`
# fails, so each blank line in the list contributes a spurious report line whose
# name is the empty string - ` missing`, which looks like nothing much in a
# terminal and is an extra record to anything parsing the file.
#
# The mistake is invisible on a tidy list and immediate on a real one: the sample
# list the audit team sent has a blank line in the middle of it, so this script
# produces four lines for three names on the first input the student is handed.
# expect-fail: blank-lines
set -euo pipefail

sudo tee /usr/local/bin/rhcsa-account-report >/dev/null <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 1 ]]; then
  printf 'usage: %s LISTFILE\n' "${0##*/}" >&2
  exit 2
fi

while IFS= read -r name || [[ -n $name ]]; do
  # The missing `[[ -n $name ]] || continue` is the whole fixture.
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
