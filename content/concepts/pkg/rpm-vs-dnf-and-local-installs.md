---
id: pkg.rpm-vs-dnf-and-local-installs
title: What "installed" means, and what actually checks a signature
rhel: 9
objectives: [pkg.dnf.install]
sources: [r9:ch9, r10:ch9]
prerequisites: [pkg.repos-and-dnf]
---
**A package is installed when there is a row for it in the rpm database**, under
`/var/lib/rpm`. Not when its files are on the disk. The two usually happen
together, and every confusing package problem is a case where they did not:

```
rpm -q telnet          # the database. "not installed" is a database answer
command -v telnet      # the filesystem. a different question entirely
```

That is why unpacking a package instead of installing it is a trap rather than a
shortcut. `rpm2archive - < pkg.rpm | tar -xzC /` (or the older
`rpm2cpio pkg.rpm | cpio -idmv`, on a machine that has `cpio`) puts the payload
on disk and records nothing: no dependency check, no `%post` scriptlet, no
SELinux labelling of the new paths, no `rpm -V` afterwards, and no upgrade path.
It has one legitimate use — rescuing one file out of a package on a system too
broken to run a transaction — and outside that it is a way to own files nothing
manages.

Installing a package file you already have is the case worth drilling, because
there are two commands and they are not equivalent:

```
sudo rpm -Uvh ./pkg.rpm        # no repositories consulted; missing deps = refusal
sudo dnf install ./pkg.rpm     # same file, deps resolved from the enabled repos
```

`rpm -U` is upgrade-or-install and is the better habit than `-i`. Its real
limitation is that it resolves nothing, so on any package with dependencies you
have not already got, `dnf install <path>` is the answer to "install from the
local file system". Two rpm switches make the difference visible: `rpm -qp`
queries a *file* rather than an installed name (`rpm -qp --qf '%{name}
%{version}\n' pkg.rpm`, `-qpl` for its file list), and **`--test` does the
checking without the installing** — rpm(8): "Do not install the package, simply
check for and report potential conflicts" — so `rpm -Uvh --test pkg.rpm` reports
missing dependencies and file conflicts while changing nothing. It is a dry run of
the *checks*, not of the whole transaction: no scriptlet runs, so a package whose
`%pre` is what fails will still pass `--test`. `--nodeps` and `--force` exist to make that
refusal go away; using them turns the database into a document that disagrees with
the machine.

**Signature checking is not one setting.** Three separate things, and knowing
which is which saves an exam question:

- **`gpgcheck` in a repository stanza** — packages from *that repository* must
  carry a signature that verifies. It is also settable in `[main]` of
  `/etc/dnf/dnf.conf`, where it becomes the default for every repository, and
  RHEL 9 ships that file with `gpgcheck=1`. So a stanza with no `gpgcheck` line
  inherits the check; it takes a deliberate `gpgcheck=0` to switch it off.
- **`localpkg_gpgcheck`** — the same question for a package file named on the
  command line, and its default is off. `dnf install ./pkg.rpm` does not check
  the signature unless you turn this on or pass `--setopt=localpkg_gpgcheck=1`.
- **the rpm keyring** — what a signature is checked *against*. Keys are packages
  of a sort: `rpm -qa 'gpg-pubkey*'` lists them, `sudo rpm --import <keyfile>`
  adds one. `gpgkey=` in a repository file names a key so dnf can offer to
  import it; where the key is already imported, the line changes nothing.
  `rpmkeys --checksig pkg.rpm` asks the question by hand, and is the way to check
  a file before going anywhere near a transaction.

The booleans in a `.repo` file are read more literally than they look. Keys are
lower case and matched exactly — `Enabled=0` is silently ignored, and the
repository stays enabled. `1`, `0`, `True`, `False`, `yes` and `no` are all
accepted. An unrecognised value is **not** an error you can rely on noticing: dnf
prints `invalid boolean value` on stderr and uses the default, so
`enabled=0 # for now` leaves the repository *on*, because there are no inline
comments — a comment is a line starting with `#` or `;`, and everything after the
`=` is the value.

Finally, **`enabled=1` and `--enablerepo` are not the same claim.**
`--enablerepo=<id>` and `--repo=<id>` override `enabled=0` for one command, and
`--repofrompath=<id>,<path>` invents a repository that is in no file at all. All
three are useful, and all three will make a broken configuration look like a
working one. The evidence that a repository is configured is
`sudo dnf repolist --enabled` with no flags propping it up; `--all` shows the
disabled ones too, and `dnf repoquery --repo <id> <name>` asks whether a
particular repository really offers a particular package.
