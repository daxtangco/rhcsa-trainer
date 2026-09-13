#!/usr/bin/env bash
# Defensive by reflex. The author decided that an empty list is a mistake worth
# complaining about, so the script prints a diagnostic and exits 1 rather than
# printing nothing and exiting 0.
#
# Everything else about it is right, and that is the point: this is the fixture for
# reading the letter of the task and missing what it is for. A report that is run
# from a timer over a directory of lists has to survive the day one of them comes
# through empty, which is why the prompt says in as many words that an empty list
# prints nothing and exits 0. "Nothing to report" is a report.
# expect-fail: empty-list
set -euo pipefail

sudo tee /usr/local/bin/rhcsa-account-report >/dev/null <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 1 ]]; then
  printf 'usage: %s LISTFILE\n' "${0##*/}" >&2
  exit 2
fi

list=$1

# Helpful, unasked for, and wrong.
if [[ ! -s $list ]]; then
  printf '%s: %s is empty, nothing to report\n' "${0##*/}" "$list" >&2
  exit 1
fi

while IFS= read -r name || [[ -n $name ]]; do
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
done < "$list"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
sudo restorecon /usr/local/bin/rhcsa-account-report
