### Task 22: Four more tasks — users, SELinux, systemd, troubleshooting

**Files:**
- Create: `content/tasks/users/006-team-provisioning/` (`task.yaml`, `setup.sh`, `grade.sh`, 3 solutions, 2 antisolutions — `03-primary-group-only.sh` is a correct answer and therefore a solution, so this directory still contributes 6 fixtures and the `18/18` arithmetic is unchanged)
- Create: `content/tasks/selinux/019-httpd-alt-port/` (same shape)
- Create: `content/tasks/systemd/017-boot-time-service/` (same shape)
- Create: `content/tasks/troubleshooting/028-restore-remote-access/` (same shape)
- Create: `content/concepts/users/shadow-aging-fields.md`
- Create: `content/concepts/users/sudoers-and-wheel.md`
- Create: `content/concepts/selinux/labels-now-vs-policy.md`
- Create: `content/concepts/selinux/ports-are-labeled-too.md`
- Create: `content/concepts/net/firewalld-runtime-vs-permanent.md`
- Create: `content/concepts/systemd/enabled-vs-started.md`
- Create: `content/concepts/systemd/unit-file-anatomy.md`
- Create: `content/concepts/net/nm-connections-are-the-config.md`

**Interfaces:**
- Consumes: every convention established in Task 21 — `assert.sh` helpers, the `# baseline-fail:` and `# expect-fail:` headers, `@post` phases, `rhcsa validate`
- Produces: the five-task bank Task 23's API serves and Task 25's exit criterion draws from

**Why these four.** Together they cover the four *shapes* of RHCSA question, so the conventions get stress-tested before twenty more tasks copy them: pure state (users), multi-subsystem composition (SELinux + firewall + httpd), persistence-is-the-whole-point (systemd), and recovery with the network gone (troubleshooting, which is the only task that forces `transport: vmrun`).

**Objective ids.** Every `objectives:` value below is the id Task 13's transcription is expected to produce. If a transcription used a different id, **change the task's `task.yaml` and its concept cards to match `objectives.yaml`** — do not add an id to `objectives.yaml` to suit a task. `rhcsa coverage` reports any mismatch as `problem: ... maps to unknown objective`.

- [ ] **Step 1: `content/tasks/users/006-team-provisioning/`**

`task.yaml`:

```yaml
id: users/006-team-provisioning
title: Provision the devops team
chapter: 6
scope: exam-objective
rhel: 9
objectives:
  - users.accounts.manage
  - users.groups.manage
  - users.password.aging
  - users.sudo.configure
requires_concepts:
  - users.shadow-aging-fields
  - users.sudoers-and-wheel
difficulty: 2
time_budget: 600
weight: high
editions: [r9, r10]
reboot_check: false
requires_disks: 0
transport: ssh
prompt: |
  Three people are joining the devops team.

  - Create a group named devops with GID 5000.
  - Create users alice and bob. Both must be members of devops in
    addition to their own primary groups.
  - Create a user carol whose account expires on 2027-06-30 and who is a
    member of devops.
  - alice must be forced to change her password at least every 30 days.
  - Every member of devops must be able to run any command with sudo.

  Do not change anything about the student account.
```

**`reboot_check: false` is deliberate.** Everything here lives in `/etc/passwd`, `/etc/shadow`, `/etc/group` and `/etc/sudoers*`, which are files on disk — there is no runtime-only way to create a user. A reboot check would add ninety seconds to each of six fixtures to prove nothing. Reserve the reboot for tasks where a wrong answer can look right, which is why the other three tasks in this batch all set it `true`.

`setup.sh`:

```bash
#!/usr/bin/env bash
# Remove any prior attempt so the task is repeatable, and prove the names are
# free before the student is told to create them.
set -uo pipefail

for u in alice bob carol; do
  if id "$u" &>/dev/null; then
    sudo userdel -r "$u" 2>/dev/null || sudo userdel "$u"
  fi
done
getent group devops &>/dev/null && sudo groupdel devops
sudo rm -f /etc/sudoers.d/devops

# The task says not to touch student; make sure it starts correct so the
# invariant checkpoint means something.
sudo usermod -aG wheel student

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

`grade.sh`:

```bash
#!/usr/bin/env bash
# Graded end state. student-intact passes before any work is done: it is an
# invariant, there to catch an answer that solves the task destructively.
# baseline-fail: group-gid, alice-in-devops, bob-in-devops, carol-in-devops, carol-expiry, alice-maxdays, sudo-devops
set -uo pipefail

gid=$(getent group devops | cut -d: -f3)
[ "$gid" = "5000" ]
ck group-gid "group devops exists with GID 5000" $? "gid=${gid:-none}"

# id -nG lists every group, primary and secondary, whatever mechanism put the
# user there. Written out three times rather than looped, because every ck call
# must have a literal id - see the note below.
in_devops() { id -nG "$1" 2>/dev/null | tr ' ' '\n' | grep -qx devops; }

in_devops alice
ck alice-in-devops "alice is a member of devops" $?
in_devops bob
ck bob-in-devops "bob is a member of devops" $?
in_devops carol
ck carol-in-devops "carol is a member of devops" $?

# Field 8 of /etc/shadow is the expiry date in days since the epoch.
# 2027-06-30 is what the prompt asks for; compare as a date, not as a string,
# so any correct spelling of the date passes.
want=$(date -u -d 2027-06-30 +%s)
days=$(sudo getent shadow carol | cut -d: -f8)
got=$([ -n "$days" ] && echo $((days * 86400)) || echo "")
[ -n "$got" ] && [ "$got" = "$want" ]
ck carol-expiry "carol's account expires 2027-06-30" $? "shadow field 8=${days:-empty}"

max=$(sudo getent shadow alice | cut -d: -f5)
[ "$max" = "30" ]
ck alice-maxdays "alice must change her password every 30 days" $? "maxdays=${max:-empty}"

# sudo -l -U asks the real sudoers parser what alice may run, so it does not
# matter whether the rule is in /etc/sudoers or a file in /etc/sudoers.d.
sudo sudo -l -U alice 2>/dev/null | grep -qE '\(ALL(:ALL)?\)[[:space:]]+(NOPASSWD:[[:space:]]*)?ALL'
ck sudo-devops "members of devops may run any command with sudo" $?

id -nG student | tr ' ' '\n' | grep -qx wheel
ck student-intact "the student account is untouched and still in wheel" $?

exit 0
```

**Every checkpoint id is written as a literal in the grader — never a variable,
never interpolated — so the masked total can be derived without running
anything.** No loops, no `"${var}-suffix"`. That total is what the Lab screen
shows *before* the student has been graded, and Task 23's `countCheckpoints`
derives it by static inspection over `ck`, `ck_pass`, `ck_fail` and `ck_skip`.
Emitting one id from several branches is normal and does not change the total:
the count is of distinct ids, not of call sites, which is exactly what an
`if`/`else` pair reporting the same checkpoint two ways requires. A generated id
is what breaks it, and a wrong count is worse than no count. A helper function
is the right way to avoid the repetition, as above.

`solutions/01-useradd-usermod-chage.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo usermod -aG devops alice
sudo usermod -aG devops bob
sudo usermod -aG devops carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
sudo visudo -c
```

`solutions/02-groupmembers-at-creation.sh`:

```bash
#!/usr/bin/env bash
# Independent in three ways: membership is set when the account is created,
# aging is set with passwd instead of chage, and the sudo rule is appended to
# /etc/sudoers instead of dropped into /etc/sudoers.d. All three are correct,
# and each one breaks a grader that greps for a command or a file.
set -euo pipefail
sudo groupadd --gid 5000 devops
sudo useradd -G devops alice
sudo useradd -G devops bob
sudo useradd -G devops -e 2027-06-30 carol
sudo passwd -x 30 alice

# Edit a copy and let visudo validate it before it goes live: a broken
# /etc/sudoers locks everyone out of sudo.
sudo cp /etc/sudoers /tmp/sudoers.new
printf '%%devops ALL=(ALL) ALL\n' | sudo tee -a /tmp/sudoers.new >/dev/null
sudo visudo -c -f /tmp/sudoers.new
sudo install -m 0440 -o root -g root /tmp/sudoers.new /etc/sudoers
```

`solutions/03-primary-group-only.sh`:

This one is a **solution**, not an anti-solution, and the distinction is the
whole point of it. It makes `devops` each user's *primary* group instead of a
secondary one, and everything passes — so it belongs in `solutions/`, where the
harness requires every checkpoint to pass, rather than in `antisolutions/`,
where a missing `# expect-fail:` header is a fatal parse error and where the
file would be asserting the opposite of what it demonstrates.

```bash
#!/usr/bin/env bash
# Made devops each user's *primary* group instead of adding it as a secondary
# one. Everything passes, which is the point: this is a correct answer that a
# naive grader might reject, so it is here to prove the grader accepts it.
#
# A third genuinely independent path: id -nG lists primary groups too. If
# validate reports a failure here, the membership checkpoints are testing the
# mechanism rather than the end state - fix the grader, not this file.
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd -g devops alice
sudo useradd -g devops bob
sudo useradd -g devops -e 2027-06-30 carol
sudo chage -M 30 alice
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
```

`antisolutions/02-no-group-no-sudo.sh`:

```bash
#!/usr/bin/env bash
# Created the accounts and stopped. sudo-devops fails as a consequence of the
# missing membership, not on its own - which is worth seeing, because it shows
# the checkpoints are not independent of each other.
# expect-fail: alice-in-devops, bob-in-devops, carol-in-devops, sudo-devops
set -euo pipefail
sudo groupadd -g 5000 devops
sudo useradd alice
sudo useradd bob
sudo useradd carol
sudo chage -E 2027-06-30 carol
sudo chage -M 30 alice
```

`antisolutions/03-aging-skipped.sh`:

```bash
#!/usr/bin/env bash
# The half of this task that leaves no visible trace: accounts and sudo are
# right, password aging was never touched. Also uses the wrong GID, because a
# grader that only counts "does the group exist" is a common mistake.
# expect-fail: group-gid, carol-expiry, alice-maxdays
set -euo pipefail
sudo groupadd devops
sudo useradd -G devops alice
sudo useradd -G devops bob
sudo useradd -G devops carol
printf '%%devops ALL=(ALL) ALL\n' | sudo tee /etc/sudoers.d/devops >/dev/null
sudo chmod 0440 /etc/sudoers.d/devops
```

- [ ] **Step 2: `content/tasks/selinux/019-httpd-alt-port/`**

`task.yaml`:

```yaml
id: selinux/019-httpd-alt-port
title: Serve a directory on a non-standard port
chapter: 22
scope: instrumental
rhel: 9
objectives:
  - selinux.context.manage
  - selinux.port.manage
  - net.firewall.configure
  - pkg.install
requires_concepts:
  - selinux.labels-now-vs-policy
  - selinux.ports-are-labeled-too
  - net.firewalld-runtime-vs-permanent
difficulty: 4
time_budget: 900
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: ssh
prompt: |
  The directory /srv/web already contains an index.html. Publish it with
  Apache on TCP port 82.

  - Install and run the httpd service, and make sure it comes back after a
    reboot.
  - Apache must serve /srv/web, not the default document root.
  - The labelling must be correct in a way that survives a full relabel of
    the filesystem, not just until the next one.
  - Port 82/tcp must be reachable from other machines, permanently.

  Leave SELinux in enforcing mode.
```

**`scope: instrumental`.** Configuring Apache is not an EX200 objective — nobody grades your `httpd.conf`. Labelling files, labelling ports, and opening the firewall are. Apache is here because it is the shortest path to a situation where SELinux and firewalld both have to be right, and because the failure is silent in three different ways. The `scope` field is what stops the objective-coverage report from crediting this task with teaching Apache.

`setup.sh`:

```bash
#!/usr/bin/env bash
# Idempotent: undo any previous attempt, then stage the content.
set -uo pipefail

sudo systemctl disable --now httpd &>/dev/null
sudo dnf -y remove httpd &>/dev/null
sudo rm -rf /etc/httpd

sudo semanage port -d -t http_port_t -p tcp 82 &>/dev/null
sudo semanage fcontext -d '/srv/web(/.*)?' &>/dev/null
sudo semanage fcontext -d /srv/web &>/dev/null
sudo firewall-cmd --permanent --remove-port=82/tcp &>/dev/null
sudo firewall-cmd --reload &>/dev/null

sudo mkdir -p /srv/web
printf 'RHCSA-MARKER-8842\n' | sudo tee /srv/web/index.html >/dev/null
sudo chmod 0755 /srv/web
sudo chmod 0644 /srv/web/index.html
# Default label for /srv is var_t, which Apache may not read. Leave it wrong
# on purpose - fixing it is the task.
sudo restorecon -R /srv/web

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

`grade.sh`:

```bash
#!/usr/bin/env bash
# Seven checkpoints, because this task fails silently in more than one way and
# each way needs its own verdict.
#
# Note what is NOT here: nothing greps httpd.conf. Where the DocumentRoot is
# written is not the objective and not the end state - "curl returns the file"
# is.
# baseline-fail: httpd-enabled, page-served, port-labeled, context-now, context-permanent, firewall-runtime, firewall-permanent
set -uo pipefail

systemctl is-enabled httpd &>/dev/null
ck httpd-enabled "httpd is enabled at boot" $? "is-enabled=$(systemctl is-enabled httpd 2>&1)"

# The grader runs inside the guest, and firewalld does not filter loopback, so
# this proves Apache serves the right directory and nothing about the firewall.
# That is why the firewall has checkpoints of its own.
body=$(curl -s --max-time 10 http://localhost:82/ 2>/dev/null)
printf '%s' "$body" | grep -q RHCSA-MARKER-8842
ck page-served "http://localhost:82/ returns the file from /srv/web" $? "got=${body:0:60}"

sudo semanage port -l 2>/dev/null | awk '$1=="http_port_t" && $2=="tcp"' | grep -qw 82
ck port-labeled "82/tcp is labelled http_port_t in policy" $?

now=$(stat -c %C /srv/web/index.html 2>/dev/null)
printf '%s' "$now" | grep -q httpd_sys_content_t
ck context-now "/srv/web/index.html is labelled httpd_sys_content_t right now" $? "context=${now:-none}"

# matchpathcon asks the policy what the label *should* be. It follows both a
# type rule and an equivalence rule, so it accepts either mechanism - and it
# fails for chcon, which changes the label without changing the policy.
want=$(matchpathcon -n /srv/web/index.html 2>/dev/null | tr -d ' ')
printf '%s' "$want" | grep -q httpd_sys_content_t
ck context-permanent "policy would relabel /srv/web to httpd_sys_content_t" $? "matchpathcon=${want:-none}"

sudo firewall-cmd --list-ports 2>/dev/null | grep -qw 82/tcp
ck firewall-runtime "82/tcp is open in the running firewall" $?

sudo firewall-cmd --permanent --list-ports 2>/dev/null | grep -qw 82/tcp
ck firewall-permanent "82/tcp is open in the permanent firewall config" $?

# Invariant: an answer that turns SELinux off is not an answer.
[ "$(getenforce)" = "Enforcing" ]
ck selinux-enforcing "SELinux is still enforcing" $? "getenforce=$(getenforce)"

exit 0
```

`solutions/01-semanage-fcontext-type.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo dnf -y install httpd

sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF

sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -Rv /srv/web

sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload

sudo systemctl enable --now httpd
```

`solutions/02-drop-in-and-equivalence.sh`:

```bash
#!/usr/bin/env bash
# Independent in three ways:
#   - config goes in a conf.d drop-in, so httpd.conf is untouched
#   - the label comes from an *equivalence* rule, so nothing in the fcontext
#     database mentions httpd_sys_content_t at all
#   - the firewall is changed at runtime and then committed with
#     runtime-to-permanent, so --permanent never appears
# A grader that greps for httpd_sys_content_t in semanage fcontext -l, or for
# --permanent in history, rejects this. Both would be wrong.
set -euo pipefail
sudo dnf -y install httpd

sudo tee /etc/httpd/conf.d/rhcsa-alt.conf >/dev/null <<'EOF'
Listen 82
<VirtualHost *:82>
    DocumentRoot "/srv/web"
    <Directory "/srv/web">
        Require all granted
    </Directory>
</VirtualHost>
EOF
sudo sed -i 's|^Listen 80$|#Listen 80|' /etc/httpd/conf/httpd.conf

sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -e /var/www/html /srv/web
sudo restorecon -R /srv/web

sudo firewall-cmd --add-port=82/tcp
sudo firewall-cmd --runtime-to-permanent

sudo systemctl enable httpd
sudo systemctl start httpd
```

`antisolutions/01-chcon-only.sh`:

```bash
#!/usr/bin/env bash
# The reason context-permanent exists. chcon writes the label onto the inode,
# so everything works and keeps working across reboots - until something runs
# restorecon or the filesystem is relabelled, and then the site breaks with no
# change to any config file.
#
# Note that this anti-solution passes the reboot check. A reboot is not the
# only kind of durability, and this is the case that proves it.
# expect-fail: context-permanent
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage port -a -t http_port_t -p tcp 82
sudo chcon -R -t httpd_sys_content_t /srv/web
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable --now httpd
```

`antisolutions/02-runtime-firewall-only.sh`:

```bash
#!/usr/bin/env bash
# firewall-cmd without --permanent. Open now, closed after a reboot - and the
# page still loads from inside the machine either way, which is exactly how
# people convince themselves it worked.
# expect-fail: firewall-permanent, firewall-runtime@post
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage port -a -t http_port_t -p tcp 82
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo firewall-cmd --add-port=82/tcp
sudo systemctl enable --now httpd
```

`antisolutions/03-forgot-port-label.sh`:

```bash
#!/usr/bin/env bash
# Everything right except the port label, so httpd cannot bind and
# systemctl start fails. The error message says "Permission denied" on a
# perfectly free port, which is the single most confusing SELinux failure
# there is.
#
# httpd-enabled still passes: enable succeeds even though start does not.
# expect-fail: port-labeled, page-served
set -euo pipefail
sudo dnf -y install httpd
sudo sed -i 's|^Listen 80$|Listen 82|' /etc/httpd/conf/httpd.conf
sudo sed -i 's|^DocumentRoot "/var/www/html"|DocumentRoot "/srv/web"|' /etc/httpd/conf/httpd.conf
sudo tee -a /etc/httpd/conf/httpd.conf >/dev/null <<'EOF'
<Directory "/srv/web">
    Require all granted
</Directory>
EOF
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/web(/.*)?'
sudo restorecon -R /srv/web
sudo firewall-cmd --permanent --add-port=82/tcp
sudo firewall-cmd --reload
sudo systemctl enable httpd
sudo systemctl start httpd || true
```

- [ ] **Step 3: `content/tasks/systemd/017-boot-time-service/`**

`task.yaml`:

```yaml
id: systemd/017-boot-time-service
title: Run a script at every boot
chapter: 11
scope: exam-objective
rhel: 9
objectives:
  - systemd.units.manage
  - systemd.units.create
  - boot.target.set
requires_concepts:
  - systemd.enabled-vs-started
  - systemd.unit-file-anatomy
difficulty: 3
time_budget: 600
weight: medium
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: ssh
prompt: |
  /usr/local/bin/rhcsa-stamp already exists and works: it writes a file to
  /run when it runs.

  - Create a systemd service named rhcsa-stamp.service that runs it once at
    every boot.
  - The service must start automatically. Nobody is going to run it by hand.
  - Make sure the system boots to a text login, not a graphical one.

  Leave sshd alone.
```

**Why the stamp file lives in `/run`.** `/run` is a tmpfs — it is empty on every boot. So a marker there cannot have been left behind by a manual `systemctl start`: if the file is present *after* the reboot, the unit ran at boot. That turns the ordinary two-verdict harness into a real test of "did you enable it, or did you just start it", which is the single most common systemd mistake and one that no amount of `systemctl status` inspection reveals.

`setup.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

sudo systemctl disable --now rhcsa-stamp.service &>/dev/null
sudo rm -f /etc/systemd/system/rhcsa-stamp.service
sudo rm -f /run/rhcsa-stamp
sudo systemctl daemon-reload

sudo tee /usr/local/bin/rhcsa-stamp >/dev/null <<'EOF'
#!/usr/bin/env bash
printf 'stamped\n' > /run/rhcsa-stamp
EOF
sudo chmod 0755 /usr/local/bin/rhcsa-stamp
sudo restorecon /usr/local/bin/rhcsa-stamp

sudo systemctl set-default multi-user.target &>/dev/null
sudo systemctl enable sshd &>/dev/null

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

Note that `setup.sh` sets the default target to `multi-user.target` — the value the prompt asks for. That looks wrong, and it is not: the checkpoint for it is therefore an **invariant**, listed below but absent from `# baseline-fail:`. The point of the instruction is that a student who reaches for `systemctl set-default graphical.target` out of habit breaks something that was already right, and the anti-solution proves the grader notices.

`grade.sh`:

```bash
#!/usr/bin/env bash
# baseline-fail: unit-verifies, stamp-enabled, stamp-effect
set -uo pipefail

unit=/etc/systemd/system/rhcsa-stamp.service
# systemd-analyze verify is the real parser: it catches a missing [Install]
# section, a typo'd directive, and an ExecStart that does not exist.
sudo systemd-analyze verify rhcsa-stamp.service &>/dev/null
ck unit-verifies "rhcsa-stamp.service exists and systemd accepts it" $? \
  "unit_file=$([ -f "$unit" ] && echo present || echo missing)"

# is-enabled covers enabled and enabled-runtime, and also "static" - which is
# why the grep is anchored: a static unit is not what was asked for.
state=$(systemctl is-enabled rhcsa-stamp.service 2>&1)
printf '%s' "$state" | grep -qx enabled
ck stamp-enabled "rhcsa-stamp.service is enabled" $? "is-enabled=$state"

# Before the reboot this only proves the unit can run. After the reboot, /run
# has been wiped, so the file can only exist because systemd ran the unit at
# boot - which is the actual requirement.
[ -f /run/rhcsa-stamp ]
ck stamp-effect "/run/rhcsa-stamp exists (after the reboot: it ran at boot)" $?

target=$(systemctl get-default 2>&1)
[ "$target" = "multi-user.target" ]
ck default-target "the system boots to multi-user.target" $? "get-default=$target"

systemctl is-enabled sshd &>/dev/null
ck sshd-intact "sshd is still enabled" $?

exit 0
```

`solutions/01-oneshot-multiuser.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rhcsa-stamp.service
```

`solutions/02-simple-sysinit.sh`:

```bash
#!/usr/bin/env bash
# Independent: Type=simple instead of oneshot, wanted by sysinit.target instead
# of multi-user.target, and enabled with `systemctl enable` plus a separate
# start rather than `enable --now`. All correct - the unit still runs once at
# every boot - and it fails any grader that diffs the unit file against an
# expected text.
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Boot stamp
DefaultDependencies=no
After=local-fs.target
Requires=local-fs.target

[Service]
Type=simple
ExecStart=/usr/local/bin/rhcsa-stamp

[Install]
WantedBy=sysinit.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable rhcsa-stamp.service
sudo systemctl start rhcsa-stamp.service
```

`antisolutions/01-started-not-enabled.sh`:

```bash
#!/usr/bin/env bash
# The unit is perfect and it was started by hand. Everything looks right in
# systemctl status. Nothing survives the reboot.
# expect-fail: stamp-enabled, stamp-effect@post
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl start rhcsa-stamp.service
```

`antisolutions/02-faked-the-end-state.sh`:

```bash
#!/usr/bin/env bash
# Ran the script instead of building the service. The stamp file is there, so a
# grader that only checks for the file would pass this.
# expect-fail: unit-verifies, stamp-enabled, stamp-effect@post
set -euo pipefail
sudo /usr/local/bin/rhcsa-stamp
```

`antisolutions/03-broke-the-target.sh`:

```bash
#!/usr/bin/env bash
# Did the service correctly and then changed the default target it was never
# asked to change. default-target is an invariant, so this is the fixture that
# proves invariants are actually evaluated.
# expect-fail: default-target
set -euo pipefail
sudo tee /etc/systemd/system/rhcsa-stamp.service >/dev/null <<'EOF'
[Unit]
Description=Write a boot stamp to /run

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rhcsa-stamp.service
sudo systemctl set-default graphical.target
```

**Safety note on anti-solution 03.** `set-default graphical.target` on a Server install is safe: `graphical.target` pulls in `multi-user.target` and, with no display manager installed, the machine still ends at a text login and stays reachable. It is the mildest available way to break an invariant, which is why it was chosen over anything involving `rescue.target`.

- [ ] **Step 4: `content/tasks/troubleshooting/028-restore-remote-access/`**

`task.yaml`:

```yaml
id: troubleshooting/028-restore-remote-access
title: Nobody can SSH to this machine
chapter: 26
scope: exam-objective
rhel: 9
objectives:
  - net.ssh.configure
  - net.firewall.configure
  - net.nm.configure
  - systemd.units.manage
requires_concepts:
  - systemd.enabled-vs-started
  - net.firewalld-runtime-vs-permanent
  - net.nm-connections-are-the-config
difficulty: 4
time_budget: 900
weight: high
editions: [r9, r10]
reboot_check: true
requires_disks: 0
transport: vmrun
prompt: |
  This machine has stopped accepting SSH connections and you are at the
  console. Somebody changed three things.

  Restore remote access so that it works now and after a reboot:

  - sshd must be running and must start at boot.
  - The firewall must allow ssh, permanently.
  - The machine's network connection must come up on its own at boot.

  Find the three problems yourself. Do not reinstall anything.
```

**This is the only task in Phase 1 that requires `transport: vmrun`, and that is the entire reason it exists.** `setup.sh` disables `sshd` and closes the firewall, so the SSH control plane is gone before the student types anything. If the grader could only reach the guest over SSH, this whole family of RHCSA questions — the ones where you are handed a broken machine — would be unbuildable. Running it once proves the dual control plane is real under the conditions it was designed for, not just when `sshd` is stopped by hand during Task 18's acceptance.

`setup.sh`:

```bash
#!/usr/bin/env bash
# Break three things, and record the connection name so grade.sh does not have
# to guess it. Idempotent: every step is already the desired end state on a
# second run.
set -uo pipefail

conn=$(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)
if [ -z "$conn" ]; then
  conn=$(nmcli -t -f NAME connection show 2>/dev/null | head -1)
fi
printf '%s\n' "$conn" | sudo tee /etc/rhcsa-conn >/dev/null

# 1. the service
sudo systemctl disable --now sshd &>/dev/null
# 2. the firewall
sudo firewall-cmd --permanent --remove-service=ssh &>/dev/null
sudo firewall-cmd --reload &>/dev/null
# 3. the connection - autoconnect only, so the network stays up until the next
#    boot. Taking the interface down here would make the break obvious and
#    would also strand the student's own console session if they are on one.
sudo nmcli connection modify "$conn" connection.autoconnect no &>/dev/null

sudo usermod -aG wheel student &>/dev/null

cat /dev/null > ~/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
exit 0
```

`grade.sh`:

```bash
#!/usr/bin/env bash
# Four goal checkpoints, all of which must hold in both verdicts, plus one
# invariant.
#
# There is deliberately no "does the machine have an IP" checkpoint. It would
# pass before the reboot and fail after it for the autoconnect case, and a
# checkpoint whose meaning changes between the two verdicts is a checkpoint
# nobody can interpret. net-autoconnect tests the same thing by reading the
# configuration, in both phases, unambiguously.
# baseline-fail: sshd-enabled, sshd-listening, firewall-ssh, net-autoconnect
set -uo pipefail

systemctl is-enabled sshd &>/dev/null
ck sshd-enabled "sshd is enabled at boot" $? "is-enabled=$(systemctl is-enabled sshd 2>&1)"

# ss over systemctl is-active: what matters is that something is listening on
# 22, not which unit put it there.
ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'
ck sshd-listening "something is listening on TCP 22" $?

# --permanent covers both verdicts: if it is in the permanent config it is in
# the runtime config after the reboot, and the runtime check below would be
# redundant with sshd-listening before it.
# Both spellings count. --add-service=ssh and --add-port=22/tcp are equally
# correct answers, and spec 6.5 rule 1 forbids grading the mechanism, so
# accepting only the named service would fail a correct solution.
perm=$(sudo firewall-cmd --permanent --list-all 2>/dev/null)
grep -qw ssh <<<"$perm" || grep -qw 22/tcp <<<"$perm"
ck firewall-ssh "the firewall permits ssh permanently" $?

conn=$(cat /etc/rhcsa-conn 2>/dev/null)
auto=$(nmcli -g connection.autoconnect connection show "$conn" 2>/dev/null)
[ "$auto" = "yes" ]
ck net-autoconnect "connection '$conn' comes up automatically" $? "autoconnect=${auto:-unknown}"

id -nG student | tr ' ' '\n' | grep -qx wheel
ck student-intact "the student account is still in wheel" $?

exit 0
```

`solutions/01-systemctl-firewallcmd-nmcli.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
```

`solutions/02-by-port-and-keyfile.sh`:

```bash
#!/usr/bin/env bash
# Independent in all three fixes: the firewall gets the port rather than the
# named service, autoconnect is set by editing the keyfile and reloading rather
# than through nmcli, and sshd is enabled and started as two operations.
# --add-port=22/tcp is a correct way to permit ssh, and this file adds *only*
# the port - not the named service as well - so its independence from solution
# 01 is real. The checkpoint accepts either spelling out of --list-all.
set -euo pipefail
sudo systemctl enable sshd
sudo systemctl start sshd

sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --reload

conn=$(cat /etc/rhcsa-conn)
# NAME,FILENAME in list mode, then pick the row out with awk. FILENAME is a
# list-mode field: the profile-mode form of `connection show` takes
# <setting>.<property> and cannot return it, so `-g FILENAME connection show
# "$conn"` fails - and under `set -euo pipefail` that aborts the whole script.
file=$(sudo nmcli -g NAME,FILENAME connection show | awk -F: -v c="$conn" '$1==c{print $2; exit}')
sudo sed -i '/^autoconnect=/d' "$file"
sudo sed -i "/^\[connection\]/a autoconnect=true" "$file"
sudo nmcli connection reload
```

`antisolutions/01-started-not-enabled.sh`:

```bash
#!/usr/bin/env bash
# Fixed all three symptoms for right now. After the reboot sshd is gone again,
# which is what @post is expressing: the service is not enabled, so nothing is
# listening.
# expect-fail: sshd-enabled, sshd-listening@post
set -euo pipefail
sudo systemctl start sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
```

`antisolutions/02-runtime-firewall-only.sh`:

```bash
#!/usr/bin/env bash
# The firewall is open in the running config and nowhere else. Note that
# sshd-listening still passes after the reboot: sshd binds regardless of what
# firewalld does, so a student testing with `ss -ltn` from the console sees a
# healthy machine that no other host can reach. That is the failure this
# checkpoint exists for.
# expect-fail: firewall-ssh
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --add-service=ssh
sudo nmcli connection modify "$(cat /etc/rhcsa-conn)" connection.autoconnect yes
```

`antisolutions/03-network-left-manual.sh`:

```bash
#!/usr/bin/env bash
# The two obvious problems fixed and the third missed, because the network is
# working right now and gives no reason to look. After the reboot the machine
# has no address and is unreachable no matter how healthy sshd is.
# expect-fail: net-autoconnect
set -euo pipefail
sudo systemctl enable --now sshd
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
sudo nmcli connection up "$(cat /etc/rhcsa-conn)"
```

**Expected duration.** Six fixtures, each with a revert and a reboot, all over `vmrun` (which is slower than SSH because every command round-trips a file into the guest). Budget 20–25 minutes for this task's `validate` run and do not interpret slowness as a hang.

- [ ] **Step 5: Write the concept cards for the users and SELinux tasks**

`content/concepts/users/shadow-aging-fields.md`:

```markdown
---
id: users.shadow-aging-fields
title: Reading /etc/shadow
rhel: 9
objectives: [users.password.aging, users.accounts.manage]
sources: [r9:ch6, r10:ch6]
---
Password aging looks like a pile of unrelated commands until you see that all
of them write to the same nine colon-separated fields of one line in
`/etc/shadow`. Learn the line and the commands stop mattering.

```
student:$6$xxxx:19800:0:30:7:14:20000:
   1      2       3   4  5 6  7    8  9
```

1. **username**
2. **hashed password** — `!` or `!!` at the front means locked, `*` means the
   account can never log in with a password, empty means no password at all
3. **last change**, in days since 1 Jan 1970
4. **minimum days** before the password may be changed again
5. **maximum days** the password is valid — this is `chage -M`
6. **warning days** before expiry
7. **inactive days** after expiry before the account is disabled
8. **account expiry date**, again in days since the epoch — this is `chage -E`
9. unused

Two of these are constantly confused. **Field 5 expires the password**: the
user is forced to choose a new one and can still get in. **Field 8 expires the
account**: the user cannot log in at all, no matter what the password is. A
question about a contractor's last day means field 8. A question about a
security policy means field 5.

Three ways to write the same thing:

```
chage -M 30 alice        # field 5
passwd -x 30 alice       # field 5, same result
chage -E 2027-06-30 carol   # field 8, converted to days for you
```

Read it back with `chage -l alice`, which prints the fields as dates, or with
`getent shadow alice` if you want to see the raw numbers. `getent` needs root —
`/etc/shadow` is mode 000 by design.

The gotcha worth remembering: `chage -E` accepts a date, but field 8 stores a
day count, so a value of `0` does not mean "never" — it means 1 Jan 1970, and
the account is expired. "Never" is `-1`, written as `chage -E -1`.
```

`content/concepts/users/sudoers-and-wheel.md`:

```markdown
---
id: users.sudoers-and-wheel
title: How sudo decides
rhel: 9
objectives: [users.sudo.configure]
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
```

`content/concepts/selinux/labels-now-vs-policy.md`:

```markdown
---
id: selinux.labels-now-vs-policy
title: The label on the file and the label the policy wants
rhel: 9
objectives: [selinux.context.manage]
sources: [r9:ch22, r10:ch22]
---
There are two answers to "what is the SELinux context of this file", and
knowing which one you are looking at is most of SELinux troubleshooting.

**The label right now** is stored in an extended attribute on the inode. See it
with `ls -Z`, `stat -c %C`, or `ps -Z` for processes. `chcon` writes this
attribute directly.

**The label the policy wants** comes from a database of path patterns, most of
it shipped by the distribution and the rest of it yours. See what the policy
would assign with `matchpathcon /path` (or `semanage fcontext -l` to read the
rules themselves). `semanage fcontext -a` adds to this database.

`restorecon` is the bridge: it asks the policy what the label should be and
writes that onto the inode. `restorecon -Rv /srv/web` after a `semanage
fcontext -a` is the normal two-step, and the reason for the two steps is that
the first one changes what *should* be true and the second makes it true.

This is why `chcon` is a trap. It works. The site comes up. It survives
reboots. And then someone runs `restorecon`, or the filesystem gets relabelled
after a policy update, or a file is created fresh in that directory — and the
label reverts to whatever the policy says, because the policy never knew about
your change. A `chcon` fix is a fix with a fuse on it. Use `chcon` to test a
hypothesis in ten seconds; use `semanage fcontext` + `restorecon` to fix
anything you intend to keep.

Two more things worth knowing. A **file inherits the label of the directory it
is created in**, which is why copying a file into a directory gives it the
right label and moving one in with `mv` does not — `mv` preserves the
attribute. And an **equivalence rule**, `semanage fcontext -a -e /var/www/html
/srv/web`, says "label this tree exactly the way you label that one". It is
shorter and more accurate than reproducing a set of type rules by hand, and it
is a completely legitimate answer that looks nothing like the type-rule answer.

When a service cannot read a file it plainly has Unix permission to read, the
sequence is: `ls -Z` the file, `matchpathcon` the file, and if they disagree run
`restorecon`. If they agree and it still fails, the problem is not the file
label — look at `ausearch -m AVC -ts recent` and at the booleans.
```

`content/concepts/selinux/ports-are-labeled-too.md`:

```markdown
---
id: selinux.ports-are-labeled-too
title: Ports have SELinux types
rhel: 9
objectives: [selinux.port.manage]
sources: [r9:ch22, r10:ch22]
prerequisites: [selinux.labels-now-vs-policy]
---
SELinux does not only label files. TCP and UDP port numbers are labelled too,
and a confined service may only bind a port whose type its policy allows.
`httpd` is allowed `http_port_t`, which by default covers 80, 443, 8080 and a
few others. Port 82 is not in that list.

So this happens:

```
# systemctl start httpd
Job for httpd.service failed.
# journalctl -u httpd
(98)Address already in use: AH00072: make_sock: could not bind to 0.0.0.0:82
```

Nothing is using port 82. `ss -ltn` shows it free. The message is wrong because
Apache is reporting a generic bind failure for a permission denial it does not
understand. This is the most misleading error in the whole SELinux surface, and
recognising it — a bind failure on a port that is demonstrably free — is worth
more than any command.

The fix is one line:

```
semanage port -a -t http_port_t -p tcp 82
```

`-a` adds, `-m` modifies an existing entry, `-d` deletes. List what is already
labelled with `semanage port -l`, and narrow it with
`semanage port -l | grep http`. There is no "restorecon for ports": the policy
database *is* the state, so unlike file contexts this is a one-step change and
it is permanent as soon as you make it.

The habit: when a service refuses to start on a port you chose yourself, and
the port is free, check `semanage port -l` before you check anything else. When
the port is one the service already owns, SELinux is not your problem.
```

- [ ] **Step 6: Write the concept cards for the firewall, systemd and NetworkManager tasks**

`content/concepts/net/firewalld-runtime-vs-permanent.md`:

```markdown
---
id: net.firewalld-runtime-vs-permanent
title: firewalld keeps two copies of everything
rhel: 9
objectives: [net.firewall.configure]
sources: [r9:ch25, r10:ch25]
---
firewalld holds two configurations at once. The **runtime** configuration is
what is filtering packets this second. The **permanent** configuration is what
will be loaded at the next boot or reload. `firewall-cmd` writes to one or the
other, never both, and which one depends on a flag that is easy to forget.

```
firewall-cmd --add-service=ssh                # runtime only - gone at reboot
firewall-cmd --permanent --add-service=ssh    # permanent only - not active yet
firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload   # both
firewall-cmd --add-service=ssh && firewall-cmd --runtime-to-permanent # both
```

The last two are equally correct and it is worth being fluent in both.
`--permanent` then `--reload` is the one to reach for when you know what you
want. `--runtime-to-permanent` is the one for when you have been experimenting:
it commits whatever is currently working, which is exactly the situation where
retyping the commands with `--permanent` invites a typo.

**`--reload` discards the runtime configuration** and replaces it with the
permanent one. That is the point of it, and it is also the trap: any change you
made without `--permanent` disappears the moment you reload for an unrelated
reason. A rule that works and then vanishes an hour later was a runtime rule.

Read the two copies separately and compare them — this is the single most
useful firewalld diagnostic:

```
firewall-cmd --list-all               # runtime
firewall-cmd --permanent --list-all   # permanent
```

If they differ, you have found the bug. Note that `--list-all` prints services
*and* ports, while `--list-services` prints only services — so a rule added as
`--add-port=22/tcp` is invisible to `--list-services` even though it permits
ssh perfectly well. Two spellings, one effect: `--add-service=ssh` looks up the
port in `/usr/lib/firewalld/services/ssh.xml`, and `--add-port=22/tcp` says it
directly. Prefer the service name when one exists, because it stays right if
the service's ports ever change.

Everything above is per-zone, and every command silently means `--zone=public`
unless you say otherwise. `firewall-cmd --get-active-zones` tells you which
zone your interface is actually in, and a rule added to the wrong zone has no
effect at all while looking perfectly correct in `--list-all`.
```

`content/concepts/systemd/enabled-vs-started.md`:

```markdown
---
id: systemd.enabled-vs-started
title: Started, enabled, and why they are unrelated
rhel: 9
objectives: [systemd.units.manage]
sources: [r9:ch11, r10:ch11]
---
**Started** means the unit is running right now. **Enabled** means it will be
started at the next boot. They are independent: a unit can be any of the four
combinations, and three of them are bugs somebody is going to hit.

```
systemctl start sshd     # running now, nothing about boot
systemctl enable sshd    # will start at boot, not running now
systemctl enable --now sshd     # both
systemctl is-active sshd ; systemctl is-enabled sshd   # ask about each
```

`enable` does one concrete thing: it reads the unit's `[Install]` section and
creates a symlink under `/etc/systemd/system/<target>.wants/`. That is the whole
mechanism. It follows that a unit file with no `[Install]` section cannot be
enabled — `systemctl enable` reports `The unit files have no installation
config` — and that `is-enabled` returning `static` means exactly that: the unit
exists, it is fine, and nothing will ever pull it in by name.

`is-enabled` has more answers than yes and no, and they are worth recognising:
`enabled` (a symlink in `/etc`), `enabled-runtime` (a symlink in `/run`, which
disappears at reboot — `enable --runtime` did this), `disabled`, `static` (no
`[Install]`), `masked` (symlinked to `/dev/null`, which makes the unit
unstartable even by hand), and `indirect`.

**Masking is the one to remember for troubleshooting.** `systemctl mask foo`
makes `start` fail with a message about the unit being masked; `disable` alone
never does that. If a service refuses to start and the error mentions masking,
`systemctl unmask` is the fix and no amount of editing the unit file will help.

The habit worth building: after any change to a service, run both checks. "It
works" is `is-active`. "It will still work on Monday" is `is-enabled`. Nearly
every graded systemd question is really asking for the second one, and nearly
every wrong answer satisfies only the first.
```

`content/concepts/systemd/unit-file-anatomy.md`:

```markdown
---
id: systemd.unit-file-anatomy
title: Writing a service unit
rhel: 9
objectives: [systemd.units.create]
sources: [r9:ch11, r10:ch11]
prerequisites: [systemd.enabled-vs-started]
---
A service unit is an ini file with three sections, and you can write a working
one from memory once you know what each section is for.

```ini
[Unit]
Description=Write a boot stamp to /run
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rhcsa-stamp
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

`[Unit]` is metadata and ordering. `Description` is what `systemctl status`
prints. `After=` and `Before=` control *order* only; `Requires=` and `Wants=`
control *whether* something else gets pulled in. Mixing those up produces a
unit that starts too early rather than one that fails, which is harder to spot.

`[Service]` is the process. `Type=simple` is the default and means "ExecStart is
the daemon; consider it started as soon as it is forked". `Type=oneshot` means
"ExecStart is a job that exits", and is what you want for a script — pair it
with `RemainAfterExit=yes` so the unit shows as `active (exited)` rather than
flapping to inactive the instant it finishes. `Type=forking` is for old daemons
that background themselves. `ExecStart` must be an **absolute path**; there is
no shell, so pipes and globs do not work unless you invoke a shell explicitly.

`[Install]` is only read by `systemctl enable`, and `WantedBy=` names the target
whose `.wants` directory gets the symlink. `multi-user.target` is the normal
answer. Leave this section out and the unit cannot be enabled at all.

Where the file goes matters: **`/etc/systemd/system/` for anything you write**.
`/usr/lib/systemd/system/` belongs to packages and your file there will be
overwritten by an update. A file in `/etc` with the same name overrides the one
in `/usr/lib` entirely; if you only want to change one directive of a packaged
unit, use `systemctl edit foo` instead, which creates a drop-in under
`/etc/systemd/system/foo.service.d/override.conf` and leaves the rest alone.

Two commands after every edit. `systemctl daemon-reload` — systemd caches unit
files and will keep using the old one until you say this. And
`systemd-analyze verify foo.service`, which parses the unit the way systemd
does and reports typo'd directives, a missing `[Install]`, and an `ExecStart`
path that does not exist. It costs a second and catches the mistakes that
otherwise show up as a failed boot.
```

`content/concepts/net/nm-connections-are-the-config.md`:

```markdown
---
id: net.nm-connections-are-the-config
title: NetworkManager connections, not interfaces
rhel: 9
objectives: [net.nm.configure]
sources: [r9:ch24, r10:ch24]
---
On RHEL the network is not configured by editing an interface. It is configured
by editing a **connection profile**, and NetworkManager applies the profile to a
device. Two different things with two different names, and every confusing
`nmcli` session comes from conflating them.

- A **device** is hardware: `ens160`. `nmcli device status` lists them.
- A **connection** is a saved set of settings that can be applied to a device:
  `ens160`, `Wired connection 1`, whatever it was named at install. `nmcli
  connection show` lists them. The profile is a keyfile under
  `/etc/NetworkManager/system-connections/`.

A device can have several profiles available and at most one active. This is why
`ip addr add` "works" and then vanishes — you changed the device, not the
profile, and NetworkManager will overwrite it at the next opportunity. On RHEL,
`ip` is a diagnostic tool. `nmcli` is the configuration tool.

The four commands that cover most of it:

```
nmcli connection show                          # what profiles exist
nmcli connection show "ens160"                 # every setting, one per line
nmcli connection modify "ens160" ipv4.addresses 192.168.1.50/24 \
      ipv4.gateway 192.168.1.1 ipv4.method manual
nmcli connection up "ens160"                   # apply the change now
```

`modify` writes the profile to disk immediately and does **not** apply it. `up`
applies it. So a change that has no effect usually just needs `up` — and a
change that works but disappears at reboot was made with `ip` instead of
`nmcli`, or was made to a profile that is not the one that comes up at boot.

**`connection.autoconnect` is the one to check when a machine boots with no
network.** Set to `no`, the profile is perfectly correct and NetworkManager
simply never applies it; the machine comes up with a link and no address, and
nothing in the profile looks wrong. Read it with
`nmcli -g connection.autoconnect connection show "<name>"` and fix it with
`nmcli connection modify "<name>" connection.autoconnect yes`.

`-g` is worth knowing generally: it prints one field with no padding and no
header, which makes it the right way to ask a specific question rather than
grepping the human-readable output. And `nmcli connection reload` re-reads the
keyfiles from disk, which is what you need if you edited one by hand instead of
going through `nmcli`.
```

- [ ] **Step 7: Check the content loads and every reference resolves**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
node src/cli/index.ts coverage; echo "exit=$?"
```

Expected: `tasks: 5`, `concepts: 10`, `untaught concepts: 0`, no `problem:` lines, `exit=0`.

`untaught concepts: 0` proves every card written above is reachable from some task's `requires_concepts`. A `problem: ... maps to unknown objective` line means an id in a `task.yaml` or a card's `objectives:` does not exist in `objectives.yaml` — fix the task or the card to match the transcription, not the other way round.

- [ ] **Step 8: Syntax-check every script and cross-check every declared id**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
find content/tasks -name '*.sh' -print0 | while IFS= read -r -d '' f; do
  bash -n "$f" || echo "SYNTAX ERROR: $f"
done
echo "syntax pass complete"
```
Expected: no `SYNTAX ERROR` lines.

Then, for each of the four new tasks, confirm no fixture declares a checkpoint the grader never emits:

```bash
cd /home/daxtangco/rhcsa-trainer
for T in content/tasks/*/*; do
  emitted=$(grep -oE '^[[:space:]]*ck(_pass|_fail|_skip)? [a-z0-9][a-z0-9-]*' "$T/grade.sh" | awk '{print $NF}' | sort -u)
  declared=$(grep -hoE '^# (expect|baseline)-fail:.*' "$T/grade.sh" "$T"/antisolutions/*.sh 2>/dev/null \
    | sed 's/^# [a-z]*-fail://' | tr ',' '\n' | sed 's/@.*//' | tr -d ' ' | sort -u)
  missing=$(comm -13 <(echo "$emitted") <(echo "$declared"))
  [ -n "$missing" ] && printf 'UNDECLARED-ID %s: %s\n' "$T" "$(echo $missing)"
done
echo "id cross-check complete"
```
Expected: no `UNDECLARED-ID` lines. The alternation matters: the graders reach for `ck_pass`, `ck_fail` and `ck_skip` as often as bare `ck`, and a pattern that matched only `ck ` would call a genuinely undeclared id clean. This works only because every emitter's id is a literal — the same property `countCheckpoints` relies on in Task 23.

- [ ] **Step 9: ACCEPTANCE — validate the three SSH tasks**

These three share a transport, so one run covers them. Eighteen fixtures with reverts and (for two of the three) reboots: budget 35–45 minutes.

```bash
cd /home/daxtangco/rhcsa-trainer
node --env-file-if-exists=.env.local src/cli/index.ts validate \
  users/006-team-provisioning \
  selinux/019-httpd-alt-port \
  systemd/017-boot-time-service
echo "exit=$?"
```

Expected: `transport: ssh`, then `ok` for all 18 fixtures, `18/18 fixtures ok`, `exit=0`.

Read failures with the table from Task 21, Step 12. Three failures specific to this batch and what they mean:

| Failure | Diagnosis |
|---|---|
| `users` `antisolution/01-primary-group-only`: `expected pass, got fail` | the membership checkpoints are testing `groups`/`/etc/group` rather than effective membership. `id -nG` is the fix; a primary group is a real membership. |
| `selinux` `antisolution/01-chcon-only`: `context-permanent: expected fail, got pass` | `matchpathcon` is reading the inode instead of the policy — most likely the command was replaced with `ls -Z`. This is the checkpoint the whole task is built around; do not weaken it. |
| `systemd` `solution/02-simple-sysinit`: `stamp-effect: expected pass, got fail` after the reboot | a unit wanted by `sysinit.target` with `DefaultDependencies=no` ordered itself before `/run` was ready. Add `After=local-fs.target` — it is already in the file, so if this fires, check the file was written verbatim. |

- [ ] **Step 10: ACCEPTANCE — validate the vmrun task on its own**

Run it separately: it is the only task that needs `vmrun`, and mixing it in would force all 24 fixtures through the slower transport.

```bash
cd /home/daxtangco/rhcsa-trainer
export RHCSA_GUEST_PASSWORD='<the student account password>'
node --env-file-if-exists=.env.local src/cli/index.ts validate troubleshooting/028-restore-remote-access
echo "exit=$?"
```

Expected: **`transport: vmrun`** on the first line — if it says `ssh`, the `require` derivation from `task.transport` in Task 21's `validate` command is not working and the rest of the run is meaningless. Then `ok` for all 6 fixtures, `6/6 fixtures ok`, `exit=0`.

If this run fails with `guest did not come back within 120000ms`, the guest is fine and the wait is too short — `sshd` being disabled does not slow a boot, but a machine with `connection.autoconnect no` can spend time waiting on `network-online.target`. Raise `VmController.waitForGuest`'s `timeoutMs` rather than changing the task.

**This step is the proof that the dual control plane earns its keep.** It is the first time the grader runs on a machine that SSH cannot reach, and every troubleshooting task in Phase 2 depends on it working.

- [ ] **Step 11: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/tasks content/concepts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): four tasks covering the four shapes of RHCSA question

users: pure on-disk state, so reboot_check is false - a reboot would spend 90
seconds per fixture proving something that cannot be non-persistent.

selinux: the case where a reboot check is not enough. chcon survives reboots
and dies at the next relabel, so context-permanent asks matchpathcon what the
policy would assign rather than what the inode currently says.

systemd: the stamp file is written to /run, which is a tmpfs. A marker there
after the reboot can only have been left by systemd starting the unit at boot,
which is what separates 'enabled' from 'started by hand'.

troubleshooting: transport vmrun. setup.sh disables sshd and closes the
firewall, so this task cannot be graded over SSH at all - it is the first proof
that the dual control plane works under the conditions it exists for.

Eight concept cards, one per mechanism the four tasks depend on."
```

---

