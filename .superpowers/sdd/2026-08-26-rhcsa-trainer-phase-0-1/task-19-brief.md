### Task 19: `provision.sh` — configure the VM and capture the `clean` snapshot

Everything the checklist did not do by hand. Runs once, idempotently, from WSL.

**Files:**
- Create: `scripts/provision.sh`
- Create: `scripts/guest-provision.sh` (the part that runs inside the VM)
- Create: `.env.local` — a commented template, written only if absent, git-ignored and never committed

**Interfaces:**
- Consumes: `.env.local` (T15 §6); `vmrun.exe`.
- Produces: the `clean` **live** snapshot every task reset reverts to; the SSH key at `~/.ssh/rhcsa_lab`; the ISO-backed local `dnf` repo; `/etc/sudoers.d/rhcsa-trainer`, which is what makes every guest-side `sudo` in the whole project non-interactive; **zero spare disks** attached.

**Blocked on:** the VM existing.

**Design notes.**
- **Zero spare disks in Phase 1.** The Phase 1 task set works entirely inside the existing VG's free extents. Adding spare disks now means capturing them into `clean`, and a spare disk with stale partition tables makes later exercises non-deterministic. Phase 2 adds them with `vmware-vdiskmanager` when a task needs one.
- The local repo is ISO-backed and **copied into the VM's own disk**, not a host mount. A host-mounted ISO disappears if the `.vmx` CD-ROM device is detached, and then every `dnf` in every task fails.
- `clean` is captured **with memory, while running** — that is what makes resets ~5 s.
- The script never handles Red Hat credentials. `subscription-manager` is not run at all.
- **Passwordless `sudo` is arranged here, and nothing in the project works without it.** Both transports connect as `student`, and every grader, setup script, solution and anti-solution calls `sudo` on a connection with no TTY. RHEL 9's default `%wheel ALL=(ALL) ALL` would prompt, and since the script itself arrives on ssh's stdin the prompt would consume the rest of it — so correct student work would grade as failure on every task in the bank. Enabling root SSH was rejected in Task 15 for good reason, and there is no way to answer a `sudo` prompt when the script *is* stdin. A NOPASSWD drop-in for one unprivileged account in a disposable local lab VM is the standard arrangement, and it is also what the real exam gives you: on the RHCSA you get the root password, not a sudo prompt to fight.

- [ ] **Step 1: Write `scripts/guest-provision.sh`**

This runs inside the VM. It is delivered over the transport, so it must be idempotent.

```bash
#!/usr/bin/env bash
# Runs INSIDE the lab VM. Idempotent: safe to run repeatedly.
#
# Delivered by scripts/provision.sh. Needs a working sudo, which the checklist
# guaranteed by putting `student` in wheel.
set -euo pipefail

log() { printf '[guest] %s\n' "$*"; }

# --------------------------------------------------------- 0. sudo, no TTY
# Everything after this point — and every grader, setup script and solution the
# app will ever run — reaches root through sudo with no TTY to answer a prompt.
# RHEL 9's default %wheel rule asks for a password, and because our scripts
# arrive on ssh's stdin, sudo's prompt would eat the rest of the script and the
# failure would look like a broken grader. So: install the rule, validate it,
# and prove it works before continuing.
printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
sudo visudo -cf /etc/sudoers.d/rhcsa-trainer   # a malformed drop-in can lock out sudo entirely
sudo -n true || { echo "FATAL: passwordless sudo is not in effect for student" >&2; exit 1; }
log "passwordless sudo installed and verified"

# ---------------------------------------------------------------- ssh key
PUBKEY=${RHCSA_PUBKEY:?RHCSA_PUBKEY must be passed in}
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qxF "$PUBKEY" "$HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$PUBKEY" >> "$HOME/.ssh/authorized_keys"
  log "installed trainer public key"
else
  log "trainer public key already present"
fi
# SELinux mislabels a hand-made ~/.ssh, and then sshd silently refuses the key.
# This is the single most common cause of "key installed but still prompted".
sudo restorecon -R "$HOME/.ssh"

# ------------------------------------------------------------- local repo
# An ISO-backed repo inside the VM's own disk. No subscription, no network,
# and it cannot vanish when the CD-ROM device is detached.
ISO_MNT=/var/lib/rhcsa-repo
if ! mountpoint -q "$ISO_MNT"; then
  if [[ -f /var/lib/rhcsa-dvd.iso ]]; then
    sudo mkdir -p "$ISO_MNT"
    # fstab entry makes it survive reboots, which the grader's verdict B needs.
    if ! grep -q "$ISO_MNT" /etc/fstab; then
      echo "/var/lib/rhcsa-dvd.iso $ISO_MNT iso9660 loop,ro,nofail 0 0" | sudo tee -a /etc/fstab >/dev/null
    fi
    sudo systemctl daemon-reload
    sudo mount "$ISO_MNT"
    log "mounted local DVD image at $ISO_MNT"
  else
    log "WARNING: /var/lib/rhcsa-dvd.iso is missing; skipping local repo"
  fi
fi

if mountpoint -q "$ISO_MNT"; then
  sudo tee /etc/yum.repos.d/rhcsa-local.repo >/dev/null <<EOF
[rhcsa-baseos]
name=RHCSA local BaseOS
baseurl=file://$ISO_MNT/BaseOS
enabled=1
gpgcheck=0

[rhcsa-appstream]
name=RHCSA local AppStream
baseurl=file://$ISO_MNT/AppStream
enabled=1
gpgcheck=0
EOF
  log "wrote /etc/yum.repos.d/rhcsa-local.repo"
fi

# -------------------------------------------------------------- packages
# Only what the Phase 1 tasks and the graders need. Deliberately short: every
# package pre-installed here is one the exam might expect you to install
# yourself, so this list stays minimal on purpose.
PKGS=(
  open-vm-tools   # how vmrun learns the guest IP
  policycoreutils-python-utils  # semanage, needed to *check* SELinux contexts
  lvm2
  xfsprogs
  e2fsprogs
  bash-completion
  vim-enhanced
  man-db
  tar
  psmisc
)
sudo dnf install -y "${PKGS[@]}"
sudo systemctl enable --now vmtoolsd

# --------------------------------------------------------------- hygiene
sudo hostnamectl set-hostname rhcsa-lab
sudo systemctl enable --now sshd

# The graders never read shell history, but a student reading their own history
# after a reset is confusing, so start each snapshot from empty.
: > "$HOME/.bash_history" || true
history -c 2>/dev/null || true

# ---------------------------------------------------------------- report
log "--- state ---"
getenforce
findmnt -no SOURCE /var
sudo vgs --noheadings -o vg_name,vg_free
sudo lvs --noheadings -o lv_name,lv_size
lsblk -no NAME,SIZE,TYPE
log "guest provisioning complete"
```

The bootstrap sequencing is the one subtlety. This script's *own* `sudo` calls still need a password the first time, because the drop-in it installs does not exist yet. That is why Task 15's checklist tells the user to run it once from the VM console, where a password prompt is answerable. Every run after that — including every run `provision.sh` drives over `vmrun` — is silent.

- [ ] **Step 2: Write `scripts/provision.sh`**

```bash
#!/usr/bin/env bash
# Configure the lab VM from WSL and capture the `clean` snapshot.
#
# Idempotent. Run it again after changing guest-provision.sh; it will re-run
# the guest part and re-capture `clean`.
#
# Never touches your Red Hat credentials. subscription-manager is not used.
set -euo pipefail

cd "$(dirname "$0")/.."

# ------------------------------------------------------------------ 0. env
# Nothing earlier in the plan can create .env.local usefully: RHCSA_VM_IP is
# discovered by provisioning, and RHCSA_VMX and RHCSA_GUEST_PASSWORD are known
# only to the user. So this is the first place with a real value to write, and
# it writes a commented template with every key present and only the discovered
# ones filled. The `:?` guards below then name exactly what is still missing.
if [[ ! -f .env.local ]]; then
  cat > .env.local <<'EOF'
# Local lab configuration. Git-ignored. Never commit this file.
#
# Only you can supply these two - see docs/vm-build-checklist.md:
RHCSA_VMX=
RHCSA_GUEST_PASSWORD=
#
# Discovered by scripts/provision.sh; leave blank and it will fill this in:
RHCSA_VM_IP=
#
# Optional overrides; the defaults are usually right:
RHCSA_SSH_USER=student
#RHCSA_SSH_PORT=22
#RHCSA_SSH_KEY=
#RHCSA_TRANSPORT=
#RHCSA_ISO=
EOF
  echo "wrote a template .env.local - fill in RHCSA_VMX and RHCSA_GUEST_PASSWORD, then re-run"
fi

# shellcheck disable=SC1091
[[ -f .env.local ]] && set -a && . ./.env.local && set +a

: "${RHCSA_VMX:?set RHCSA_VMX in .env.local - see docs/vm-build-checklist.md}"
: "${RHCSA_GUEST_PASSWORD:?set RHCSA_GUEST_PASSWORD (the student password) in .env.local - see docs/vm-build-checklist.md}"
VMRUN=${RHCSA_VMRUN:-'/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'}
SSH_USER=${RHCSA_SSH_USER:-student}
KEY=${RHCSA_SSH_KEY:-$HOME/.ssh/rhcsa_lab}
ISO=${RHCSA_ISO:-/mnt/c/ISO/rhel-9.6-x86_64-dvd.iso}

log() { printf '\n[provision] %s\n' "$*"; }
guest() { "$VMRUN" "$1" "$RHCSA_VMX" -gu "$SSH_USER" -gp "$RHCSA_GUEST_PASSWORD" "${@:2}"; }

# ------------------------------------------------------------------ 1. key
log "SSH key"
if [[ ! -f $KEY ]]; then
  mkdir -p "$(dirname "$KEY")"
  ssh-keygen -t ed25519 -N '' -C 'rhcsa-trainer' -f "$KEY"
  echo "generated $KEY"
else
  echo "reusing $KEY"
fi
PUBKEY=$(cat "$KEY.pub")

# ---------------------------------------------------------------- 2. power
log "power on"
"$VMRUN" start "$RHCSA_VMX" nogui || true
"$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait

# --------------------------------------------------------- 3. spare disks
# Deliberately none. See the design note in this task: a spare disk captured
# into `clean` carries stale partition tables into every future reset. Phase 2
# attaches them per-task with vmware-vdiskmanager.
log "spare disks: none by design (Phase 1)"

# ------------------------------------------------------------------ 4. ISO
log "local repo payload"
if [[ -f $ISO ]]; then
  # ~10 GB, so only copy it once.
  if guest runProgramInGuest /usr/bin/test -f /var/lib/rhcsa-dvd.iso 2>/dev/null; then
    echo "guest already has /var/lib/rhcsa-dvd.iso"
  else
    echo "copying $ISO into the guest (this takes several minutes)"
    guest copyFileFromHostToGuest "$ISO" /tmp/rhcsa-dvd.iso
    guest runProgramInGuest /usr/bin/bash -c \
      "sudo mv /tmp/rhcsa-dvd.iso /var/lib/rhcsa-dvd.iso && sudo chmod 0444 /var/lib/rhcsa-dvd.iso"
  fi
else
  echo "WARNING: $ISO not found. Set RHCSA_ISO. Skipping the local repo -"
  echo "         dnf will not work in the guest until this is fixed."
fi

# ---------------------------------------------------------------- 5. guest
log "guest provisioning"
guest copyFileFromHostToGuest scripts/guest-provision.sh /tmp/guest-provision.sh
guest runProgramInGuest /usr/bin/bash -c \
  "RHCSA_PUBKEY='$PUBKEY' bash /tmp/guest-provision.sh"
guest deleteFileInGuest /tmp/guest-provision.sh || true

# ------------------------------------------------------------------ 6. ssh
log "SSH check"
IP=$("$VMRUN" getGuestIPAddress "$RHCSA_VMX" -wait | tr -d '\r')
if ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       -o UserKnownHostsFile="$HOME/.ssh/rhcsa_known_hosts" \
       -i "$KEY" "$SSH_USER@$IP" 'echo ssh-ok' 2>/dev/null | grep -q ssh-ok; then
  echo "ssh works: $SSH_USER@$IP"
  if ! grep -q '^RHCSA_VM_IP=' .env.local 2>/dev/null; then
    echo "RHCSA_VM_IP=$IP" >> .env.local
    echo "recorded RHCSA_VM_IP in .env.local"
  fi
else
  echo "ssh did NOT work. The vmrun transport still functions, so this is not"
  echo "fatal. See docs/r1-findings.md for the ranked fallbacks."
fi

# ------------------------------------------------------------ 7. snapshot
log "clean snapshot"
existing=$("$VMRUN" listSnapshots "$RHCSA_VMX" | tr -d '\r')
printf '%s\n' "$existing" | sed 's/^/  /'

if printf '%s\n' "$existing" | grep -qx 'golden'; then
  echo "golden present - good, that is the fallback of last resort"
else
  echo "WARNING: no 'golden' snapshot. Create one from a powered-off state:"
  echo "  \"\$VMRUN\" stop '$RHCSA_VMX' soft && \"\$VMRUN\" snapshot '$RHCSA_VMX' golden"
fi

if printf '%s\n' "$existing" | grep -qx 'clean'; then
  echo "replacing the existing 'clean' snapshot"
  "$VMRUN" deleteSnapshot "$RHCSA_VMX" clean
fi

# Taken WHILE RUNNING, so memory is included and reverts take ~5s instead of
# a 30s+ cold boot. This is the single biggest factor in how many tasks get
# attempted per session.
"$VMRUN" snapshot "$RHCSA_VMX" clean
echo "captured 'clean' (live, memory included)"

log "done"
echo "verify a revert round-trip:"
echo "  \"\$VMRUN\" revertToSnapshot '$RHCSA_VMX' clean && \"\$VMRUN\" start '$RHCSA_VMX' nogui"
```

- [ ] **Step 3: Syntax-check both scripts**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
chmod +x scripts/provision.sh scripts/guest-provision.sh
bash -n scripts/provision.sh && bash -n scripts/guest-provision.sh && echo "syntax ok"
```
Expected: `syntax ok`.

- [ ] **Step 4: Verify the guardrails fire without a VM**

Run: `cd /home/daxtangco/rhcsa-trainer && bash scripts/provision.sh; echo "exit=$?"`

There are two outcomes and both are correct, so know which one you are looking at. If `.env.local` is **absent**, the script writes the template, prints `wrote a template .env.local`, and then stops at `set RHCSA_VMX in .env.local`. If `.env.local` is **present** but the password is blank — the common case, because Task 15 §6 tells the user to fill in the paths — it gets past `RHCSA_VMX` and stops at `set RHCSA_GUEST_PASSWORD (the student password) in .env.local` instead. Either way it stops at the *first* missing variable with a message naming `.env.local` and `docs/vm-build-checklist.md` — not a bash error, and **not** a half-provisioned VM.

- [ ] **Step 5: ACCEPTANCE (deferred until the VM exists)**

```bash
cd /home/daxtangco/rhcsa-trainer
read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD && echo
bash scripts/provision.sh
```

Then verify the things that matter, in order. **Check 0 first** — if it fails, nothing else is worth measuring:

```bash
VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
VMX=$(grep '^RHCSA_VMX=' .env.local | cut -d= -f2-)
IP=$(grep '^RHCSA_VM_IP=' .env.local | cut -d= -f2-)

# 0. Passwordless sudo is in effect. This must print exactly 0.
ssh student@"$IP" -o BatchMode=yes sudo -n id -u

# 1. A revert round-trip is fast and lands on a working machine.
time "$VMRUN" revertToSnapshot "$VMX" clean
time "$VMRUN" start "$VMX" nogui
ssh -i ~/.ssh/rhcsa_lab -o UserKnownHostsFile=~/.ssh/rhcsa_known_hosts \
    student@"$(grep '^RHCSA_VM_IP=' .env.local | cut -d= -f2-)" \
    'uptime; getenforce; findmnt -no SOURCE /var; sudo vgs -o vg_free --noheadings'

# 2. dnf works offline.
ssh -i ~/.ssh/rhcsa_lab student@... 'sudo dnf -y install tree && which tree'

# 3. The layout the Phase 1 lab needs still holds after the revert.
ssh -i ~/.ssh/rhcsa_lab student@... 'df -h /home /var; sudo lvs'
```

Expected: check 0 prints `0`; the revert completes in roughly 5 seconds; `Enforcing`; `/dev/mapper/rhel-var`; non-zero `vg_free`; `tree` installs with no network; `/home` at 8 G and `/var` at 2 G.

**If check 0 prints anything other than `0`, stop.** The sudoers drop-in is missing or malformed, and no grader in the bank will work until it is fixed — every guest-side script calls `sudo` on a connection with no TTY, so a prompt there does not fail cleanly, it silently eats the rest of the script. Re-run `guest-provision.sh` from the VM console and watch its `passwordless sudo installed and verified` line.

**If the revert takes 30 s or more, the snapshot was captured powered-off.** Power the VM on, wait for it to settle, and re-run the snapshot step — this is worth fixing, because it is the difference between 15 and 40 attempted tasks in an evening.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add scripts/provision.sh scripts/guest-provision.sh && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): provision the lab VM and capture the clean snapshot

The DVD image is copied into the guest's own disk rather than host-mounted, so
dnf cannot break when the CD-ROM device is detached. clean is captured live so
reverts take ~5s. No spare disks in Phase 1: a spare disk baked into clean
carries stale partition tables into every reset. restorecon on ~/.ssh is not
optional - a mislabelled authorized_keys makes sshd refuse the key silently."
```

---

