#!/usr/bin/env bash
# `-gt 1000` where the prompt says "1000 or above". Every account on the machine is
# classified correctly except the one whose UID is exactly 1000 - which is the
# first real person on a RHEL 9 install, and on this guest is the study account
# itself.
#
# It is the off-by-one that a script cannot show you: the report looks right, the
# service accounts are separated from the people, and the only wrong line is about
# an account whose classification you already knew and therefore did not check.
#
# uid-boundary exists for this fixture alone, which is why that probe is a
# one-line list: the failure names itself instead of hiding among four correct
# lines.
# expect-fail: uid-boundary
set -euo pipefail

sudo tee /usr/local/bin/rhcsa-account-report >/dev/null <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 1 ]]; then
  printf 'usage: %s LISTFILE\n' "${0##*/}" >&2
  exit 2
fi

while IFS= read -r name || [[ -n $name ]]; do
  [[ -n $name ]] || continue
  if uid=$(id -u "$name" 2>/dev/null); then
    # Strictly greater than 1000, so UID 1000 falls through to the system branch.
    if [[ $uid -gt 1000 ]]; then
      printf '%s user %s\n' "$name" "$uid"
    else
      printf '%s system %s\n' "$name" "$uid"
    fi
  else
    printf '%s missing\n' "$name"
  fi
done < "$1"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
sudo restorecon /usr/local/bin/rhcsa-account-report
