### Task 15: VM build checklist

The one document a human executes by hand. Everything after it is automated.

**Files:**
- Create: `docs/vm-build-checklist.md`
- Modify: `README.md` (link it from a "Getting started" section)

**Interfaces:**
- Consumes: nothing.
- Produces: the VM contract every later task assumes — VM name `rhcsa-lab`, `.vmx` path, study user `student`, free VG extents, BIOS firmware, NAT networking, `open-vm-tools` installed.

**Blocked on:** the RHEL 9 binary DVD ISO. Write the document now; execute it when the ISO lands.

- [ ] **Step 1: Write the checklist**

`docs/vm-build-checklist.md`:

```markdown
# RHCSA lab VM build checklist

One-time manual build. Everything after this is scripted. Budget 45 minutes.

## Before you start

Download **RHEL 9 binary DVD** (not the boot ISO — the binary DVD carries the
package payload, which lets `provision.sh` build a local `dnf` repository with
no subscription and no network):

1. Sign in at <https://developers.redhat.com/products/rhel/download> with your
   own Red Hat account. A **Red Hat Developer Subscription for Individuals** is
   free and entitles one system.
2. Download `rhel-9.x-x86_64-dvd.iso` (~10 GB).
3. Save it to `C:\ISO\` so it is reachable from both Windows and WSL at
   `/mnt/c/ISO/`.

Nothing in this project needs your Red Hat credentials. Do not put them in a
file in this repo.

## Why these settings

Every non-default choice below exists to make a specific RHCSA objective
practisable. Do not "simplify" them.

| Setting | Value | Why |
|---|---|---|
| Firmware | **BIOS**, not UEFI | GRUB recovery and `grub2-install` behave the way the exam objectives describe. UEFI changes the commands. |
| Disk | 40 GB, single file, not pre-allocated | Room for spare-disk exercises; single file keeps snapshots fast. |
| Memory | 4096 MB | Enough for containers plus a desktop-free install. |
| CPUs | 2 | `tuned` and `systemd` work is more realistic than on 1. |
| Network | **NAT (VMnet8)** | Reachable from WSL2 without bridging to your corporate LAN. Risk R1 verifies this. |
| Snapshot memory | **on** | Live snapshots restore in ~5 s. Cold boot is 30 s+. |

## 1. Create the VM

1. VMware Workstation → **File → New Virtual Machine → Custom (advanced)**.
2. Hardware compatibility: leave the default.
3. **Installer disc image file**: `C:\ISO\rhel-9.x-x86_64-dvd.iso`.
4. If VMware offers *Easy Install*, **decline it** — it creates its own
   partitioning and user, and you need custom partitioning.
5. Guest OS: **Linux → Red Hat Enterprise Linux 9 64-bit**.
6. Name: **`rhcsa-lab`**. Location: `C:\VMs\rhcsa-lab`.
7. Firmware: **BIOS**.
8. Processors: 1 processor, **2 cores**.
9. Memory: **4096 MB**.
10. Network: **NAT**.
11. I/O controller: LSI Logic (default). Disk type: **SCSI**.
12. Disk: **Create a new virtual disk**, **40 GB**, **store as a single file**,
    do **not** allocate all space now.
13. Finish. Do not power on yet.

## 2. Partition during installation

Power on. In Anaconda:

1. **Language**: English. **Time**: your zone.
2. **Software Selection**: **Server** (not "Server with GUI", not "Minimal
     Install" — Minimal omits tools several objectives need).
3. **Installation Destination** → select the 40 GB disk → **Custom** → **Done**.
4. Click **Click here to create them automatically**, then adjust to this
   layout. **This layout is not optional** — the Phase 1 LVM lab depends on it.

   | Mount point | Type | Size | Notes |
   |---|---|---|---|
   | `/boot` | standard partition, xfs | 1 GB | outside LVM, as usual |
   | `/` | LVM, xfs | 12 GB | |
   | `/home` | LVM, xfs | **8 GB** | shrinkable later — this is the lab's source |
   | `/var` | LVM, xfs | **2 GB** | **must be its own LV** — the lab grows it |
   | swap | LVM | 2 GB | |

   Total allocated ≈ 25 GB of 40 GB. **Leave the remaining ~15 GB as free
   extents in the volume group** — do not grow `/` to fill the disk. Spare
   extents are what make `lvextend`, snapshot, and new-LV exercises possible.

   Volume group name: **`rhel`** (Anaconda's default). LV names:
   `root`, `home`, `var`, `swap`.
5. **Root Password**: set one you will remember; **allow root SSH login is not
   needed** — leave it off.
6. **User Creation**: create user **`student`**, tick **"Make this user
   administrator"** (this puts them in `wheel`, which `sudo` needs).
7. Begin installation. Reboot when prompted.

## 3. First boot

Log in as `student` at the console.

1. Accept the licence if prompted.
2. Confirm the layout is what you asked for:

   ```bash
   lsblk
   sudo vgs                 # VFree should show roughly 15 GB
   sudo lvs                 # root, home, var, swap
   findmnt /var             # must show /dev/mapper/rhel-var, not /dev/mapper/rhel-root
   df -h /home /var
   getenforce               # must print Enforcing
   ```

   **If `findmnt /var` shows the root LV, `/var` was not created separately.**
   Do not continue — the Phase 1 lab cannot work. Reinstall with the correct
   layout; it is faster than fixing it afterwards.

3. Install the guest tools, which is how `vmrun` learns the guest's IP:

   ```bash
   sudo dnf install -y open-vm-tools
   sudo systemctl enable --now vmtoolsd
   ```

   `dnf` needs a repo. If the machine is unregistered and has no repo yet, mount
   the DVD (still attached) and use it:

   ```bash
   sudo mkdir -p /mnt/dvd
   sudo mount /dev/sr0 /mnt/dvd
   sudo tee /etc/yum.repos.d/dvd.repo >/dev/null <<'EOF'
   [dvd-baseos]
   name=DVD BaseOS
   baseurl=file:///mnt/dvd/BaseOS
   enabled=1
   gpgcheck=0

   [dvd-appstream]
   name=DVD AppStream
   baseurl=file:///mnt/dvd/AppStream
   enabled=1
   gpgcheck=0
   EOF
   sudo dnf install -y open-vm-tools
   ```

   `provision.sh` (Task 19) makes this repo permanent by copying the ISO into
   the VM's disk; this mount is only to get `open-vm-tools` in place.

4. Note the IP address — `provision.sh` needs it once:

   ```bash
   ip -4 addr show scope global
   ```

5. Run `scripts/guest-provision.sh` (Task 19) **from the VM console, not over
   ssh**; it will ask for `student`'s password once and never again. Its first
   act is to install `/etc/sudoers.d/rhcsa-trainer`, and after that every
   `sudo` in the guest — including every grader, setup script and solution the
   app runs — needs no password. The console is the only place that first
   prompt can be answered, which is why this step is not automated.

## 4. Verify from the WSL host

In WSL:

```bash
VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
"$VMRUN" list
"$VMRUN" getGuestIPAddress 'C:\VMs\rhcsa-lab\rhcsa-lab.vmx' -wait
ping -c 3 <that-ip>
```

If `getGuestIPAddress` reports an error, `vmtoolsd` is not running. If `ping`
fails but `vmrun list` works, that is **risk R1** — see `scripts/r1-probe.sh`
(Task 16), which enumerates the fallbacks. The project still works over the
`vmrun` transport with no networking at all, so this is not a blocker.

## 5. Snapshots

**Power the VM off first for `golden`.** A powered-off snapshot is the one you
can always fall back to.

```bash
"$VMRUN" stop 'C:\VMs\rhcsa-lab\rhcsa-lab.vmx' soft
"$VMRUN" snapshot 'C:\VMs\rhcsa-lab\rhcsa-lab.vmx' golden
```

`provision.sh` (Task 19) creates the `clean` snapshot — the live,
memory-included one used for ~5 s task resets — after it finishes configuring
the machine.

**Never delete `golden`.** It is the only way back if `clean` is captured in a
broken state.

## 6. Record the paths

Write the values you used into `.env.local` at the repo root (git-ignored):

```
RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx
RHCSA_VM_IP=192.168.x.y
RHCSA_SSH_USER=student
RHCSA_GUEST_PASSWORD=<student's password>
```

Before running `provision.sh`, put `RHCSA_VMX` and `RHCSA_GUEST_PASSWORD` in
`.env.local` at the repo root. Nothing else in this project needs credentials,
and your Red Hat account password must not go in any file in this repo.

## Done

You should now have: a RHEL 9 VM named `rhcsa-lab`, `/var` on its own 2 GB LV,
`/home` on an 8 GB LV, ~15 GB of free extents in VG `rhel`, SELinux enforcing,
`open-vm-tools` running, and a powered-off `golden` snapshot.

Next: `scripts/r1-probe.sh`, then `scripts/provision.sh`.
```

- [ ] **Step 2: Add a Getting started section to the README**

Append to `README.md`:

```markdown
## Getting started

1. Build the lab VM once by hand: [`docs/vm-build-checklist.md`](docs/vm-build-checklist.md).
   You need a RHEL 9 binary DVD ISO from your own Red Hat Developer account.
2. Check that WSL can reach it: `bash scripts/r1-probe.sh`.
3. Configure it: `bash scripts/provision.sh`.
4. Check the content bank loads: `node src/cli/index.ts coverage`.
```

- [ ] **Step 3: Verify the checklist is self-consistent**

Read it start to finish and confirm three things by inspection:
- every value in the "Record the paths" section appears earlier in the document
- the partition table totals ~25 GB against a 40 GB disk, leaving free extents
- the `/var`-on-its-own-LV requirement is stated as a hard stop, since the Phase 1 lab cannot function otherwise

No automated test — this document is executed by a human.

- [ ] **Step 4: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add docs/vm-build-checklist.md README.md && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "docs: VM build checklist

Every non-default setting is justified against a specific objective. The
partition layout is a hard requirement, not a suggestion: /var must be its own
LV and the VG must keep free extents, or the Phase 1 LVM lab cannot run."
```

---

