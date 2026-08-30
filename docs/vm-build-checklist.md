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
7. Firmware: **BIOS**. If the wizard does not offer a firmware choice, finish
   the wizard without powering on, then set it in **VM → Settings → Options →
   Advanced → Firmware type → BIOS**, and confirm it is BIOS **before the
   first power-on**. This is worth checking rather than assuming: firmware
   type cannot be changed after the guest is installed without breaking the
   boot path, which makes it the one setting in this document whose omission
   costs a full reinstall.
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

4. Check the IP address — this confirms DHCP worked over NAT, which is worth
   seeing before you leave the console. `provision.sh` (Task 19) does not need
   you to write it down: it discovers the guest's IP itself and records it.

   ```bash
   ip -4 addr show scope global
   ```

5. Install passwordless `sudo` for `student`, **at the console, not over
   ssh** — `sudo` prompts for `student`'s password the first time, and the
   console is the only place that prompt can be answered:

   ```bash
   printf 'student ALL=(ALL) NOPASSWD: ALL\n' | sudo tee /etc/sudoers.d/rhcsa-trainer >/dev/null
   sudo chmod 0440 /etc/sudoers.d/rhcsa-trainer
   sudo visudo -cf /etc/sudoers.d/rhcsa-trainer
   sudo -n true && echo "passwordless sudo is in effect"
   ```

   **The `visudo -cf` check is not decoration.** A malformed drop-in can lock
   `sudo` out of the machine entirely. If it does not print `parsed OK`, fix or
   remove the file before logging out of the console — that is the last moment
   this can be fixed without falling back to `golden`.

   `sudo -n true` printing `passwordless sudo is in effect` is the proof it
   worked. After this, every `sudo` in the guest — including every grader,
   setup script, solution and anti-solution the app runs — needs no password,
   and nothing in the project works without it. `scripts/provision.sh` (Task
   19) does the rest of the guest configuration — the ssh key, the local
   repo, the packages — automatically, so there is nothing else to run by
   hand here.

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

`provision.sh` (Task 19) needs two values it cannot discover on its own, and
you set only those two — nothing else. If `.env.local` does not exist yet,
running `provision.sh` writes a commented template for you and stops, telling
you to fill in exactly these two keys and re-run:

```
RHCSA_VMX=C:\VMs\rhcsa-lab\rhcsa-lab.vmx
RHCSA_GUEST_PASSWORD=<student's password>
```

`RHCSA_VMX` is the path to the `.vmx` file, Windows-style, as shown above.
`RHCSA_GUEST_PASSWORD` is the password you set for `student` in step 2.6.

Everything else is handled for you:

- `RHCSA_VM_IP` is discovered by `provision.sh` itself, over `vmrun`, and
  appended to `.env.local` automatically. You never type an IP address.
- `RHCSA_SSH_USER` defaults to `student`. Only set it if you named the study
  user something else, which this checklist does not tell you to do.

The file lives at the repo root and is git-ignored — it will never be
committed. But a git-ignored plaintext password is still a plaintext
password, and this one protects nothing outside your own machine: it is a
throwaway credential for a local lab VM that nothing else can reach. Choose a
password for `student` that you use nowhere else, and never reuse it
elsewhere. If you would rather not write it to disk at all, `provision.sh`
also reads it from an exported shell variable — export it yourself right
before running the script:

```bash
read -rsp 'student password: ' RHCSA_GUEST_PASSWORD && export RHCSA_GUEST_PASSWORD
```

Nothing in this project needs your Red Hat account credentials, and your Red
Hat account password must not go in any file in this repo.

## Done

You should now have: a RHEL 9 VM named `rhcsa-lab`, `/var` on its own 2 GB LV,
`/home` on an 8 GB LV, ~15 GB of free extents in VG `rhel`, SELinux enforcing,
`open-vm-tools` running, and a powered-off `golden` snapshot.

Next: `scripts/r1-probe.sh`, then `scripts/provision.sh`.
