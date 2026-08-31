### Task 16: Answer risk R1 — can WSL2 reach a VMnet8 guest?

**This task is unblocked today.** It needs a reachable VM, not a RHEL one — the existing Ubuntu VM answers the question.

**Files:**
- Create: `scripts/r1-probe.sh`
- Create: `docs/r1-findings.md` (written by running the probe)

**Interfaces:**
- Consumes: nothing.
- Produces: the answer that decides whether `SshTransport` is the default (Task 18). If R1 fails, `VmrunTransport` becomes the primary and Task 18's `chooseTransport` still works unchanged — only its outcome differs.

- [ ] **Step 1: Write the probe**

`scripts/r1-probe.sh`:

```bash
#!/usr/bin/env bash
# Risk R1: can WSL2 reach a VMware NAT (VMnet8) guest over TCP/22?
#
# Answer this with ANY running VM. It is a question about host networking,
# not about RHEL, so the existing Ubuntu VM is a valid subject.
#
# Read-only. Starts nothing, changes nothing. Exit code is advisory:
#   0 = SSH reachable, SshTransport can be the default
#   1 = not reachable, VmrunTransport is the primary; see the fallbacks below
set -uo pipefail

VMRUN='/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'

say() { printf '%s\n' "$*"; }
hdr() { printf '\n== %s ==\n' "$*"; }

hdr "vmrun"
if [[ ! -x "$VMRUN" ]]; then
  say "FAIL: vmrun.exe not found at:"
  say "  $VMRUN"
  say "Find it with: ls /mnt/c/Program*/VMware/VMware*/vmrun.exe"
  exit 1
fi
say "ok: $VMRUN"

hdr "running VMs"
running=$("$VMRUN" list 2>&1)
say "$running"

vmx=${1:-}
if [[ -z "$vmx" ]]; then
  # vmrun list prints a count line first, then one .vmx path per line.
  vmx=$(printf '%s\n' "$running" | grep -i '\.vmx' | head -n1 | tr -d '\r')
fi

if [[ -z "$vmx" ]]; then
  say "FAIL: no VM is running. Start one in VMware Workstation and re-run."
  say "usage: $0 ['C:\\path\\to\\vm.vmx']"
  exit 1
fi
say "subject: $vmx"

hdr "guest IP via open-vm-tools"
ip=$("$VMRUN" getGuestIPAddress "$vmx" -wait 2>&1 | tr -d '\r')
say "reported: $ip"

if [[ ! $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  say "FAIL: no usable IP. open-vm-tools/vmtoolsd is probably not running in"
  say "      the guest. Install it, then re-run. Without it, only the vmrun"
  say "      transport is available - which is supported, just slower."
  exit 1
fi

hdr "WSL routing table"
ip route | sed 's/^/  /'
say ""
say "VMnet8 host adapter as WSL sees it:"
ip -4 addr show | grep -E 'inet ' | sed 's/^/  /'

hdr "ICMP"
if ping -c 3 -W 2 "$ip" >/dev/null 2>&1; then
  say "ok: ping $ip"
else
  say "warn: ping failed. Not conclusive - Windows Firewall commonly drops"
  say "      ICMP while still forwarding TCP. The port check below decides."
fi

hdr "TCP/22"
# bash's /dev/tcp needs no extra tooling, unlike nc.
if timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22" 2>/dev/null; then
  say "ok: TCP/22 open on $ip"
  reachable=yes
else
  say "FAIL: cannot open TCP/22 on $ip"
  reachable=no
fi

hdr "SSH banner"
if [[ $reachable == yes ]]; then
  banner=$(timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22; head -c 100 <&3" 2>/dev/null | tr -d '\r')
  say "banner: ${banner:-<none>}"
fi

hdr "verdict"
if [[ $reachable == yes ]]; then
  say "R1 RESOLVED: WSL2 can reach a VMnet8 guest on TCP/22."
  say "SshTransport is the default; VmrunTransport stays as the fallback for"
  say "tasks that deliberately break networking."
  exit 0
fi

say "R1 CONFIRMED AS A PROBLEM. Try these, in order of preference:"
say ""
say "1. Windows Firewall. The VMware NAT adapter may be classified as a"
say "   Public network, which blocks inbound. In an elevated PowerShell:"
say "     Get-NetConnectionProfile"
say "     Set-NetConnectionProfile -InterfaceAlias 'VMware Network Adapter VMnet8' \\"
say "       -NetworkCategory Private"
say ""
say "2. Guest firewalld. From the VM console:"
say "     sudo firewall-cmd --add-service=ssh --permanent && sudo firewall-cmd --reload"
say ""
say "3. NAT port forward. Workstation -> Edit -> Virtual Network Editor ->"
say "   VMnet8 -> NAT Settings -> Port Forwarding: host 2222 -> guest 22."
say "   Then SSH to 127.0.0.1:2222 instead. Set RHCSA_SSH_PORT=2222."
say ""
say "4. Bridged networking instead of NAT. Works, but exposes the VM to your"
say "   LAN - least preferred."
say ""
say "5. Do nothing. VmrunTransport uses runProgramInGuest and needs no network"
say "   at all. Grading works; the interactive terminal is the part that"
say "   suffers. This is a supported configuration, not a failure."
exit 1
```

- [ ] **Step 2: Make it executable and shellcheck it**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
chmod +x scripts/r1-probe.sh
bash -n scripts/r1-probe.sh && echo "syntax ok"
```
Expected: `syntax ok`.

- [ ] **Step 3: Verify it fails cleanly when no VM is running**

Run: `cd /home/daxtangco/rhcsa-trainer && bash scripts/r1-probe.sh; echo "exit=$?"`

If no VM is running, expected: the `vmrun` section succeeds, then `FAIL: no VM is running`, `exit=1`. The point of this step is that the script gives an actionable message instead of a bash error.

- [ ] **Step 4: ACCEPTANCE — run the probe against the existing Ubuntu VM**

Start the Ubuntu VM in VMware Workstation, then:

```bash
cd /home/daxtangco/rhcsa-trainer && bash scripts/r1-probe.sh; echo "exit=$?"
```

If the Ubuntu VM lacks `open-vm-tools`, install it there (`sudo apt install -y open-vm-tools`) or pass the IP-bearing VM's `.vmx` explicitly. If it has no `sshd`, the TCP/22 check will fail for a reason that is not R1 — install `openssh-server` in the guest first, otherwise the probe answers the wrong question.

- [ ] **Step 5: Record the finding**

Write `docs/r1-findings.md` with, at minimum:
- the date the probe was run and which VM was the subject
- the full probe output, in a fenced block
- the verdict: `SshTransport` default, or which fallback was adopted
- if a fallback was needed, the exact change made (firewall profile, port forward number, etc.) so it is reproducible after a Windows update undoes it

Then update spec §17's R1 row from a risk to a resolved finding, citing this file.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add scripts/r1-probe.sh docs/r1-findings.md docs/superpowers/specs && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "test(vm): probe WSL2 to VMnet8 reachability, resolving risk R1

Runs against any VM, so the existing Ubuntu guest answers it without waiting
for the RHEL ISO. Prints ranked fallbacks on failure, including the
do-nothing option: the vmrun transport needs no network at all."
```

---

