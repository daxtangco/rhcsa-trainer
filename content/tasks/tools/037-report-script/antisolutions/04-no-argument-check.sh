#!/usr/bin/env bash
# The script never asks whether it was given a list. Run properly it is correct;
# run with no argument it dies of its own accord - `set -u` trips on `$1` and bash
# exits 1 with `$1: unbound variable` on stderr.
#
# This is the fixture that decides how no-arg-usage has to be written. On "exit
# status is non-zero and stderr is not empty" this script PASSES, because a shell
# dying on an unbound variable satisfies both halves - and so does the baseline,
# where the script does not exist at all and `timeout` exits 127 with a complaint
# of its own. The prompt therefore asks for status 2 in as many words and the
# checkpoint grades that exact number, which is the only version of this check that
# tells a deliberate usage message apart from an accident.
# expect-fail: no-arg-usage
set -euo pipefail

sudo tee /usr/local/bin/rhcsa-account-report >/dev/null <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

# No arity check, no usage message. The redirect at the bottom is the first thing
# that touches $1.
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
done < "$1"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
sudo restorecon /usr/local/bin/rhcsa-account-report
