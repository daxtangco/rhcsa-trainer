---
id: users.sudoers-and-wheel
title: How sudo decides
rhel: 9
objectives: [users.sudo.superuser]
sources: [r9:ch6, r10:ch6]
---
On RHEL, `sudo` reads `/etc/sudoers`, and the last line of that file is
`#includedir /etc/sudoers.d`. Both places are equally real. A rule in a file in
`/etc/sudoers.d` is not a lesser rule, and it is the one to prefer: your
changes stay separate from the package's file, and removing a grant is
`rm` rather than an edit.

A rule reads left to right:

```
%devops    ALL=(ALL)      ALL
  who   which hosts  as whom  what commands
```

`%` in front means a group; without it, a user name. `ALL=` is the host field,
a leftover from sharing one sudoers file across a fleet — on a single machine
it is always `ALL`. `(ALL)` is who you may become. The final field is the
commands, and it can be a list of absolute paths instead of `ALL`. Adding
`NOPASSWD:` before the commands drops the password prompt.

RHEL ships one grant already: `%wheel ALL=(ALL) ALL`. That is why "give this
person admin rights" is usually `usermod -aG wheel bob` and nothing else — you
almost never need to write a rule to solve that. Writing a new group's rule is
for when the grant needs to be narrower than "everything", or when the group is
not `wheel`.

**Always validate.** A syntax error in `/etc/sudoers` breaks `sudo` for
everyone, including you, and the message you get is not a helpful one. `visudo`
edits the file and refuses to install a broken version; `visudo -c` checks the
files that are already there; `visudo -c -f /path` checks a candidate before you
move it into place. `sudo -l -U bob` answers the question you actually care
about — what may this person run — by asking the same parser `sudo` uses.

Two habits that prevent the common failures: files in `/etc/sudoers.d` must be
mode `0440` and owned by root, and their names must not contain a dot or a `~`,
or the include directive skips them silently.
