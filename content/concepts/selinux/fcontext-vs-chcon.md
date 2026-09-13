---
id: selinux.fcontext-vs-chcon
title: The file context database, and why chcon is not a fix
rhel: 9
objectives: [selinux.contexts.restore, selinux.contexts.identify]
sources: [r9:ch22, r10:ch22]
prerequisites: [selinux.labels-now-vs-policy]
---
There are two labels on every file — the one written on the inode and the one
the policy would assign — and `restorecon` is the bridge between them. That much
is the other card. This one is about the database on the policy side: how to put
a rule in it that says what you mean, how to apply it, and the specific ways
people get it wrong.

A rule is added with `sudo semanage fcontext -a -t TYPE 'PATHSPEC'`, and
**PATHSPEC is a regular expression matched against the whole path**, not a shell
glob. That single fact explains most of the confusion around this command.
`'/srv/reports(/.*)?'` is the idiomatic form because it matches the directory
itself *and* everything beneath it; `'/srv/reports/.*'` matches the contents but
not the directory, so the tree ends up correct and its own top level does not.
A plain `/srv/reports/status.sh` with no metacharacters is a perfectly good rule
for exactly one file. Quote the spec — `(`, `)`, `.` and `*` all mean something
to the shell too.

Your rules go into the local file contexts and take precedence over the ones the
distribution ships, which is what makes them work at all: `/srv(/.*)?` is var_t
by default, and your rule for a path underneath it wins. See only your own
additions with `sudo semanage fcontext -l -C`. That `-C` listing is worth
knowing well — on a machine somebody else has been fixing, it is the shortest
answer to "what did they do to this box".

`-m` modifies an existing rule and `-d` deletes one, and `-d` needs **the same
path spec that created it, character for character**. A regex you retype
slightly differently is a rule you cannot delete. There is also an equivalence
form, `semanage fcontext -a -e /var/www/cgi-bin /srv/reports`, meaning "label
this tree the way you label that one" — often the more honest statement of
intent, since it survives the distribution changing its mind about which type
belongs there. It is deleted by naming both paths: `-d -e /var/www/cgi-bin
/srv/reports`.

Adding a rule changes nothing on disk. `sudo restorecon -Rv /srv/reports` is the
step that writes it, and `-v` is not decoration: it prints each label it
changes, so silence means it changed nothing, and silence when you expected
output is the fastest way to notice that your regex does not match what you
thought. `-F` forces the *whole* context rather than just the type, which is
what you need after restoring files from a backup that carried foreign user and
role fields. For the whole filesystem there is `sudo fixfiles -F onboot` or
`touch /.autorelabel` and a reboot; that is the "full relabel" that any fix
worth keeping has to survive.

Which is the whole case against `chcon`. It writes the type onto the inode and
tells the database nothing, so the fix works, survives reboots, and then
evaporates the first time anything relabels — a policy update, a `restorecon`
somebody else runs, a full relabel after an unrelated repair. Nothing in any
config file will explain the outage. Use `chcon` to test a hypothesis in ten
seconds; use `semanage fcontext` and `restorecon` for anything that has to be
true tomorrow.

The inverse mistake is just as common and more convincing: add the rule, forget
`restorecon`. The rule is right there in `semanage fcontext -l -C`, so the work
looks done, and the kernel keeps refusing because the only thing it ever consults
is the label on the inode.

Finally, know what happens to files you have not touched yet. A **new** file
inherits the type of the directory it is created in, so a rule on the tree keeps
tomorrow's files right without further work — the real argument for labelling the
directory rather than the one file in it. `cp` creates a new file and it inherits
from the destination; `mv` moves the label from the source along with the file;
`cp -a` and `cp --preserve=context` deliberately drag the old label with it.
After any of those, `restorecon` on the destination is the cheap habit, and
`ls -Z` plus `matchpathcon` — not "the service works" — is how you confirm you
are done.
