#!/usr/bin/env bash
# Half the conditional. This script branches on "does the account exist" and then
# stops thinking: everything that exists is reported as a user, so the service
# accounts - the thing the audit team actually wanted separated out - are filed
# alongside the people.
#
# It is the shape you get from reading the prompt's three bullets as two, and it is
# also what a script written against a list of ordinary users looks like: on a list
# with no system account in it, this is a correct report.
#
# Two checkpoints catch it, and that is honest rather than sloppy: mixed-list names
# root and unseen-input names svcbackup, and those two are separate probes because
# one of them is visible to the student and the other is not. blank-lines is
# deliberately free of system accounts so that it is not a third, and so a fixture
# that fails blank-lines has failed at blank lines and nothing else.
# expect-fail: mixed-list, unseen-input
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
  # The UID is looked up and printed, and then never compared with anything.
  if uid=$(id -u "$name" 2>/dev/null); then
    printf '%s user %s\n' "$name" "$uid"
  else
    printf '%s missing\n' "$name"
  fi
done < "$1"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
sudo restorecon /usr/local/bin/rhcsa-account-report
