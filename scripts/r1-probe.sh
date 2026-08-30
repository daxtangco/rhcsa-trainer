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

vmx=${1:-}

hdr "VMnet8 subnet discovery (host-only — no VM required)"
say "This answers R1's core question — does WSL2 route into the VMnet8 subnet"
say "at all — without depending on any guest being up. Diagnostic only: it"
say "does not set this script's exit code."

host_ip=""
host_ip_src=""
nat_ip=""
nat_ip_src=""

ipconfig_out=$(ipconfig.exe 2>/dev/null | tr -d '\r')
host_ip=$(printf '%s\n' "$ipconfig_out" \
  | awk '/VMware Network Adapter VMnet8/{f=1} f && /IPv4 Address/{print; exit}' \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')
[[ -n "$host_ip" ]] && host_ip_src="ipconfig.exe (VMware Network Adapter VMnet8)"

natconf='/mnt/c/ProgramData/VMware/vmnetnat.conf'
if [[ -r "$natconf" ]]; then
  nat_ip=$(grep -im1 '^ip *=' "$natconf" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')
  [[ -n "$nat_ip" ]] && nat_ip_src="$natconf"
fi

subnet_of() { printf '%s\n' "$1" | cut -d. -f1-3; }

if [[ -z "$host_ip" && -z "$nat_ip" ]]; then
  say "warn: could not discover the VMnet8 subnet from either source."
  say "      ipconfig.exe's VMnet8 block and $natconf both came up empty."
  say "      Continuing — this section is diagnostic, not a gate."
else
  [[ -n "$host_ip" ]] && say "host adapter (from $host_ip_src): $host_ip"
  [[ -n "$nat_ip" ]] && say "NAT gateway (from $nat_ip_src): $nat_ip"

  if [[ -n "$host_ip" && -n "$nat_ip" ]]; then
    if [[ "$(subnet_of "$host_ip")" != "$(subnet_of "$nat_ip")" ]]; then
      say "warn: the two sources disagree on the subnet ($(subnet_of "$host_ip").0/24"
      say "      vs $(subnet_of "$nat_ip").0/24). VMnet8 has likely been"
      say "      reconfigured since; treat every hardcoded address downstream as"
      say "      suspect."
    else
      say "ok: both sources agree on subnet $(subnet_of "$host_ip").0/24"
    fi
  fi

  if [[ -n "$host_ip" ]]; then
    say ""
    say "ip route get $host_ip:"
    ip route get "$host_ip" 2>&1 | sed 's/^/  /'
    say ""
    hdr "host-routing (no guest involved)"
    if ping -c 3 -W 2 "$host_ip" >/dev/null 2>&1; then
      say "ok: WSL2 reached the VMnet8 host adapter ($host_ip) with 0% loss."
      say "This proves WSL2 routes into the VMnet8 subnet at the IP layer — R1's"
      say "core question. It does NOT prove a guest inside that subnet accepts"
      say "inbound TCP; guest-side firewalld is a separate matter, checked below"
      say "once a VM is up."
    else
      say "FAIL: WSL2 could not reach the VMnet8 host adapter ($host_ip)."
      say "This is host-routing evidence against R1, independent of any guest."
    fi
  fi
fi

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

if [[ -z "$vmx" ]]; then
  # vmrun list prints a count line first, then one .vmx path per line.
  matches=$(printf '%s\n' "$running" | grep -ic '\.vmx')
  if [[ "$matches" -gt 1 ]]; then
    say "warn: $matches VMs are running; auto-picking the first one listed."
  fi
  vmx=$(printf '%s\n' "$running" | grep -i '\.vmx' | head -n1 | tr -d '\r')
fi

if [[ -z "$vmx" ]]; then
  say "FAIL: no VM is running. Start one in VMware Workstation and re-run."
  say "usage: $0 ['C:\\path\\to\\vm.vmx']"
  exit 1
fi
say "subject: $vmx"

hdr "guest IP via open-vm-tools"
# -wait blocks until VMware Tools reports an IP - forever, if tools were
# never installed. Bound it so an absent guest agent is a clean FAIL instead
# of a script that hangs until the user notices and Ctrl-C's it.
ip=$(timeout 60 "$VMRUN" getGuestIPAddress "$vmx" -wait 2>&1 | tr -d '\r')
say "reported: $ip"

if [[ ! $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  say "FAIL: no usable IP. open-vm-tools/vmtoolsd is probably not running in"
  say "      the guest (or took over 60s to report). Install it, then re-run."
  say "      Without it, only the vmrun transport is available - which is"
  say "      supported, just slower."
  exit 1
fi

hdr "WSL's own network addresses"
say "WSL2 is its own Hyper-V guest behind its own NAT; VMnet8 is a Windows host"
say "adapter and is expected to be invisible from inside WSL. Its absence below"
say "is not a fault — these are WSL's own addresses, not VMnet8's."
ip -4 addr show | grep -E 'inet ' | sed 's/^/  /'
say ""
say "WSL routing table:"
ip route | sed 's/^/  /'
say ""
say "ip route get $ip (shows which interface WSL uses to reach the guest):"
ip route get "$ip" 2>&1 | sed 's/^/  /'

hdr "ICMP"
# Keep the output, not just the exit status: an unclaimed address and a
# claimed-but-silent one both fail this ping, but only the unclaimed one
# leaves an ICMP error behind, and the TCP check below can't tell them
# apart on its own.
ping_out=$(ping -c 3 -W 2 "$ip" 2>&1)
ping_rc=$?
icmp_no_claim=no
if [[ $ping_rc -eq 0 ]]; then
  # Anything answering the ping means the address is claimed - full stop.
  # "Nothing claims this address" is false by definition here, even if an
  # earlier packet in the same burst logged a transient ICMP error (e.g. a
  # guest finishing its boot mid-ping). The raw dump is only evidence on the
  # failure paths below, so it stays there and only there.
  say "ok: ping $ip"
else
  printf '%s\n' "$ping_out" | sed 's/^/  /'
  if printf '%s' "$ping_out" | grep -qE '\+[1-9][0-9]* errors|Destination (Host|Net) Unreachable'; then
    icmp_no_claim=yes
  fi
  if [[ $icmp_no_claim == yes ]]; then
    say "ping got an ICMP error above (a '+N errors' count or a Destination"
    say "Unreachable line) - nothing at $ip is claiming that address at all."
    say "That's independent evidence the TCP check below can't produce on its"
    say "own, and it outranks a silent TCP timeout: a spent ICMP error budget"
    say "looks identical to a real firewall drop at the TCP layer."
  else
    say "warn: ping showed plain packet loss with no ICMP error. Not conclusive"
    say "      by itself - Windows Firewall commonly drops ICMP while still"
    say "      forwarding TCP - but combined with a silent TCP timeout below,"
    say "      this combination is the firewall signature."
  fi
fi

hdr "TCP/22"
# bash's /dev/tcp needs no extra tooling, unlike nc. Capture both the exit
# code and stderr - one bare else can't tell "refused" from "dropped" apart,
# and those mean opposite things for R1.
tcp_stderr=$(mktemp)
timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22" 2>"$tcp_stderr"
tcp_rc=$?
tcp_err=$(cat "$tcp_stderr")
rm -f "$tcp_stderr"

reachable=no
tcp_outcome=""
if [[ $tcp_rc -eq 0 ]]; then
  say "ok: TCP/22 open on $ip"
  reachable=yes
  tcp_outcome=open
elif [[ $tcp_rc -eq 124 ]]; then
  # A silent TCP timeout alone is ambiguous - it is produced both by a real
  # firewall drop AND by an ordinary unclaimed address, because the Windows
  # NAT/vswitch path rate-limits ICMP Destination-Unreachable replies and the
  # ICMP check above (which runs first) already spent that address's budget.
  # Do NOT "fix" this by retrying the connect: a retry only ever sees the
  # already-spent budget, so it biases every result toward "dropped" - the
  # wrong direction. ICMP's own evidence, captured above before the budget
  # was spent, is what actually tells the two apart, so it outranks a silent
  # TCP timeout here.
  if [[ $icmp_no_claim == yes ]]; then
    say "TCP/22 on $ip timed out silently, but ping's ICMP error (above) shows"
    say "nothing claims $ip at all. That outranks the silent timeout: this is"
    say "an unclaimed address, not evidence of a firewall."
    tcp_outcome=unreachable
  else
    say "FAIL: the connection attempt to $ip:22 timed out with no error at all,"
    say "      and ping showed plain loss with no ICMP error either - something"
    say "      is there and swallowing packets. This is the firewall signature."
    tcp_outcome=dropped
  fi
elif printf '%s' "$tcp_err" | grep -qi 'connection refused'; then
  say "$tcp_err" | sed 's/^/  /'
  say "TCP/22 on $ip was refused: routed, guest is up, but nothing is listening"
  say "on port 22. That is a missing sshd, not a network problem."
  tcp_outcome=refused
elif printf '%s' "$tcp_err" | grep -qiE 'no route to host|host is unreachable'; then
  say "$tcp_err" | sed 's/^/  /'
  say "Nothing answered at $ip. Inconclusive - usually the wrong IP or a guest"
  say "that has not finished booting, not evidence of a firewall."
  tcp_outcome=unreachable
else
  say "FAIL: cannot open TCP/22 on $ip (rc=$tcp_rc)"
  [[ -n "$tcp_err" ]] && say "$tcp_err" | sed 's/^/  /'
  tcp_outcome=unknown
fi

hdr "SSH banner"
if [[ $reachable == yes ]]; then
  # An SSH banner is one short CRLF-terminated line (~20-40 bytes). Reading
  # a fixed byte count blocks until that many bytes arrive or the timeout
  # kills it; read one line instead and return as soon as it shows up.
  banner=$(timeout 5 bash -c "exec 3<>/dev/tcp/$ip/22; IFS= read -r -t 3 line <&3; printf '%s' \"\$line\"" 2>/dev/null | tr -d '\r')
  say "banner: ${banner:-<none>}"
else
  say "skipped: TCP/22 not open (outcome: $tcp_outcome)"
fi

hdr "verdict"
case "$tcp_outcome" in
  open)
    say "R1 RESOLVED: WSL2 can reach a VMnet8 guest on TCP/22."
    say "SshTransport is the default; VmrunTransport stays as the fallback for"
    say "tasks that deliberately break networking."
    exit 0
    ;;
  refused)
    say "R1 RESOLVED: the network path is fine - WSL2 reached the guest and the"
    say "guest actively refused the connection. Only sshd is missing, which is a"
    say "checklist gap (enable openssh-server in the guest), not a transport"
    say "decision. SshTransport is still the intended default; it just cannot be"
    say "demonstrated end-to-end against this guest today."
    exit 1
    ;;
  unreachable)
    say "R1 INCONCLUSIVE: nothing answered at $ip, even though host-routing to"
    say "the VMnet8 subnet may be fine (see above). Usually the wrong IP or a"
    say "guest still finishing boot. Re-run once the guest is confirmed up, or"
    say "pass its .vmx explicitly."
    exit 1
    ;;
  dropped)
    say "R1 CONFIRMED AS A PROBLEM: TCP/22 timed out with no error at all, and"
    say "ping showed plain loss with no ICMP error either - something between"
    say "WSL2 and $ip is silently swallowing the packets. Distinct from"
    say "'refused' (the guest is up and nothing is listening) and from"
    say "'unreachable' (nothing claims the address at all): this is the"
    say "firewall signature. Try these, in order of preference:"
    say ""
    say "0. Re-run this probe once more before changing anything. Confirming the"
    say "   same result twice costs nothing and rules out a one-off blip before"
    say "   you touch Windows Firewall."
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
    ;;
  unknown|"")
    say "R1 INCONCLUSIVE: this probe did not determine an outcome for TCP/22"
    say "(tcp_outcome='$tcp_outcome') - that is not the same as R1 being"
    say "confirmed against your network. Re-run and read the TCP/22 section"
    say "above for what actually happened."
    exit 1
    ;;
  *)
    say "BUG: r1-probe.sh reached tcp_outcome='$tcp_outcome', which no case arm"
    say "above names. This is a bug in the probe, not a verdict about your"
    say "network - please report it with the full output above."
    exit 1
    ;;
esac
