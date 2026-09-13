#!/usr/bin/env bash
# The fixture this task's whole grading design exists for: a script that does not
# look anything up. It reads /home/student/accounts.list, works the answers out by
# hand once, and writes them into a `case` table.
#
# Note how much of the task it gets right. It takes its list as an argument, it
# loops over the lines, it skips blanks, it guards the unterminated last line, it
# exits 2 with a usage message when called with nothing - and on every input the
# student can see, its report is byte-for-byte correct. mixed-list, uid-boundary,
# blank-lines, unterminated-line, empty-list and no-arg-usage all pass. A grader
# built only from the sample list would certify this as a solved task.
#
# unseen-input is what catches it, and svcbackup is the reason: setup.sh creates
# that account, the prompt never mentions it, the sample list does not contain it,
# and no other probe uses it - so there is no row for it in any table built by
# reading the machine the way a student would. The invented `nosuch...` name in the
# same probe closes the other direction: even a table copied out of `getent passwd`
# in full cannot hold a row for a name that did not exist when the table was
# written.
#
# One coupling worth naming: the `student` row below is only right because the lab
# guest's UID-1000 account is called student (docs/vm-build-checklist.md, step
# 2.6). grade.sh does not assume that - it reads the name out of getent - so on a
# guest that named its first user something else this fixture would fail
# uid-boundary as well, which is a fixture that needs updating rather than a
# grader that is wrong.
# expect-fail: unseen-input
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
  # Worked out once, by hand, from /home/student/accounts.list and `id`. No
  # command runs in this script at all.
  case $name in
    payroll)   printf 'payroll user 4101\n' ;;
    webdev)    printf 'webdev user 4102\n' ;;
    root)      printf 'root system 0\n' ;;
    student)   printf 'student user 1000\n' ;;
    ghostuser) printf 'ghostuser missing\n' ;;
    *)         printf '%s missing\n' "$name" ;;
  esac
done < "$1"
EOF

sudo chmod 0755 /usr/local/bin/rhcsa-account-report
sudo restorecon /usr/local/bin/rhcsa-account-report
