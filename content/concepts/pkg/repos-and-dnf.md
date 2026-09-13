---
id: pkg.repos-and-dnf
title: A repository is a config file, and dnf is a solver
rhel: 9
objectives: [pkg.dnf.install]
sources: [r9:ch9, r10:ch9]
prerequisites: []
---
There are two tools and they do different jobs. **`rpm` installs a package file
you already have** and, if that package needs something else, tells you so and
stops. **`dnf` reads repository metadata, works out a set of packages that
satisfies every dependency, and installs all of them.** Every story about
"dependency hell" is somebody using the first tool for the second job. Use `rpm`
to *ask questions* about packages (`rpm -q`, `-qa`, `-qf`, `-ql`, `-V`) and `dnf`
to change what is installed.

A repository is not a service or a subscription. **It is an ini file in
`/etc/yum.repos.d/` naming a directory that contains a `repodata/`
subdirectory** — that is the whole contract:

```ini
[appstream-local]
name=RHEL 9 AppStream from the DVD
baseurl=file:///mnt/AppStream
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release
```

Five lines, and "install software from a remote repository" is usually those five
lines with an `http://` URL instead of `file://`, then `dnf install`. Writing the
file by hand always works and needs no extra package;
`dnf config-manager --add-repo <url>` writes one for you when the plugin that
provides it is installed. `dnf repolist` confirms the file was read and the
repository answered — if your new id is not in that list, the problem is the file,
not the package name.

Two facts about the metadata explain most confusing `dnf` behaviour. It is
**cached** (under `/var/cache/dnf` by default), which is the point — but it means a
`baseurl` you have just corrected can keep failing with the old error until
`dnf clean all` throws the cache away. And the **packages** it points at are
signed, so `gpgcheck=1` requires the matching key, either named by `gpgkey=` or
already imported with `rpm --import`. `gpgcheck=0` switches the check off, and it
is the right answer only when the question tells you the packages are unsigned.

Be exact about what `gpgcheck` covers, because there are two options and they are
easy to run together. `gpgcheck` is the signature check on the *packages* in the
repository. The signature on the repository's own *metadata* is a different
setting, `repo_gpgcheck`, and it defaults to off — so `gpgcheck=1` alone says
nothing about whether the metadata was verified.

The local-file case is the one worth practising, because the obvious command is
the wrong one:

```
rpm -i ./mypkg.rpm          # fails if mypkg needs anything not installed
dnf install ./mypkg.rpm     # resolves its dependencies out of the enabled repos
```

What makes the second one a local install is the **`.rpm` ending**, not the path:
dnf treats any argument ending in `.rpm` as a file, so `dnf install mypkg.rpm`
with no `./` in front is a local install too, and if that file is not there it
fails with `Could not open: mypkg.rpm` rather than searching the repositories for
a package of that name.
Writing `./` is still the better habit, because it is the form that reads as a
file to a human as well. Either way this is strictly better than `rpm -i`, which
is why "from the local file system" in an exam objective still means `dnf`.

Two commands earn their place for finding things. **`dnf provides '*/semanage'`**
answers "which package contains this command", which is the question you actually
have when a tutorial uses a binary you do not have. And `dnf search`, `dnf info`
and `dnf list installed` cover the rest. For groups, `dnf group list` and
`dnf group install "Development Tools"`.

Removal is where care is needed: **`dnf remove` takes the packages that depend on
what you named with it.** So does the transaction summary dnf prints before it
does anything — and reading that summary rather than reflexively typing `y` is the
habit. It is a complete statement of what dnf decided and why the count is larger
than you expected. `dnf history` lists past transactions and `dnf history undo
<id>` reverses one, which is the recovery path when you typed `y` too fast.

`yum` still works on RHEL 9 as a compatibility name for the same tool, so
documentation using it is not out of date in any way that matters.
