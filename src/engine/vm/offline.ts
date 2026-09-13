import type { LadderMode } from '../disclosure/ladder.ts'
import type { ExecResult, LabTransport } from './transport.ts'

/**
 * Enforced offline mode — spec section 10.3.
 *
 * > In drill and exam modes the VM's default route is dropped. Package tasks
 * > continue to work because section 4.2 configures a local ISO-backed dnf
 * > repository.
 * >
 * > **Honest limit:** this cannot stop the user opening a browser on the host.
 * > It is a habit device, not a cage.
 *
 * The habit is the deliverable: `curl`, internet `dnf` and a pasted URL all
 * fail, so `man` and `/usr/share/doc` become the path of least resistance.
 * Nothing here tries to be a cage, and nothing here should be hardened as if it
 * were one.
 *
 * ## Why this is not literally `ip route del default`
 *
 * Read from the host side alone, the spec's one sentence looks like it breaks the
 * app's own control channel (`docs/r1-findings.md`, 2026-08-30):
 *
 * - the guest sits on VMware VMnet8 NAT, `192.168.70.0/24`, gateway `.2`
 * - the WSL host running this app is on its own Hyper-V NAT, `172.22.96.0/20`
 *   (`eth0` was `172.22.101.110`)
 * - `ip route get <guest>` from WSL answers `via 172.22.96.1 dev eth0` —
 *   **different subnets**, so a reply would have to leave the guest by its default
 *   route, and dropping that route would take `SshTransport`, the grader and the
 *   xterm.js terminal bridge with it. Risk R1 in spec section 17, from the other
 *   direction.
 *
 * **Measured from inside the guest, that conclusion is false — in the lucky
 * direction.** Windows SNATs WSL's traffic on the way out onto VMnet8, so the
 * guest never sees a `172.22.x.x` address at all (2026-09-13, guest `.130`):
 *
 *     SSH_CONNECTION=192.168.70.1 55044 192.168.70.130 22
 *     ip route get 192.168.70.1  ->  192.168.70.1 dev ens160 src 192.168.70.130
 *
 * No `via`. The ssh client appears as the VMnet8 host adapter, **on-link** on the
 * guest's own `/24`, reached without consulting the default route — so dropping
 * that route cannot break ssh on this topology at all. `enforceOffline` takes its
 * "peer needs no route of its own" branch here, adds nothing, records nothing, and
 * offline mode is free.
 *
 * Which raises the fair question of why the preserve machinery exists. Because
 * that is a fact about one host's VMware NAT and one Windows build's SNAT, not a
 * property of this design: bridged networking, a NAT port-forward, a second NIC,
 * or running the app anywhere other than WSL all put the client back off-subnet —
 * and two of those are R1's own ranked fallbacks in `docs/r1-findings.md`. So the
 * script *asks* the guest which case it is in rather than encoding either answer.
 * The favourable topology is exploited, not depended on, and the unfavourable one
 * is handled without hardcoding `172.22.96.0/20` — see the peer derivation below,
 * which is the thing that must never become a constant.
 *
 * What it does in that off-subnet case: install a **more specific route back to
 * the live ssh client** through whatever gateway currently carries it, *then* drop
 * the default route. The control channel survives; every internet destination
 * has no route at all. A host route to one private address confers no internet
 * access, so `curl https://…`, internet `dnf` and a connection to an external
 * resolver still fail — which is precisely the habit being trained.
 *
 * ## What is deliberately *not* enforced
 *
 * - **DNS resolution may still work.** VMware's NAT gateway (`192.168.70.2`) is
 *   a DNS forwarder and stays on-link, so a name may still resolve; the
 *   *connection* to the resolved address is what fails. Breaking resolution
 *   would mean editing `/etc/resolv.conf`, a persistent change that a snapshot
 *   taken while offline mode was applied would carry into the reset baseline.
 *   A habit device must not leak into the golden image. UNVERIFIED against the
 *   guest — see the module's report.
 * - **NetworkManager may put the default route back.** A DHCP renewal or a link
 *   event re-applies the connection's IP configuration, and the VMware DHCP
 *   lease is shorter than an exam. `nmcli connection modify … ipv4.never-default
 *   yes` would survive that, but it bounces the connection (killing ssh
 *   mid-command) and writes persistent config, so it is rejected for the same
 *   reason as `/etc/resolv.conf`. The mitigation is that `enforceOffline` is
 *   idempotent and cheap: a caller may re-apply it at any point in a session.
 *
 * ## The vmrun transport
 *
 * `VmrunTransport` reaches the guest through `open-vm-tools`, not the network,
 * so offline mode neither helps nor hurts it: applying, querying and restoring
 * all work over vmrun, and vmrun keeps working while the guest is offline. Two
 * consequences worth stating rather than leaving implicit. First, `SSH_CONNECTION`
 * is unset over vmrun (the script runs from `vmtoolsd`, which has no ssh
 * session), so the peer cannot be read from the environment there. Second, the
 * terminal bridge holds its *own* ssh connection to the guest even when the
 * engine is on vmrun — so an enforcement driven over vmrun that preserved
 * nothing would silently kill the student's terminal. The guest script therefore
 * falls back to the peers of established connections to sshd.
 *
 * ## Recovery is not a transaction, and this does not pretend otherwise
 *
 * The guest script adds the preserve route *before* deleting the default route,
 * and aborts without deleting anything if that add fails. Every remaining
 * failure window is in the harmless direction — extra host route, guest still
 * online — except one: if the delete lands and the preserved route turns out not
 * to carry the replies after all, ssh is gone, and nothing inside the guest can
 * repair a control channel through a control channel that no longer works. That
 * window is enforcement's alone: restoration refuses to open a second one, and
 * keeps the preserve route whenever the default route it recorded has not come
 * back. The recovery path there is `vmrun revertToSnapshot clean` (`VmController.revert`),
 * which restores the routing table along with everything else, or a reboot,
 * which lets DHCP re-lease the default route. That is the honest answer and it
 * is the reason the state file lives on tmpfs: both of those recoveries clear it.
 */

/**
 * Guided mode is not a `LadderMode` (see `disclosure/ladder.ts`), so the set of
 * modes a session can be in is that union plus `'guided'` — structurally the
 * same union as `server/session.ts`'s `SessionMode`, which is what a caller will
 * be holding. Imported as a *type* only, so `engine/vm` gains no runtime
 * dependency on `engine/disclosure`.
 */
export type TrainingMode = 'guided' | LadderMode

/**
 * Which modes train the offline habit. Exhaustive by construction, the same way
 * `config.ts`'s `KINDS` and `app.ts`'s `MODES` are: a fifth mode fails to
 * typecheck until this table says whether it goes offline, which is better than
 * a new mode silently inheriting `false`.
 *
 * Practice is deliberately online. Section 9.1 makes it the untimed mode with
 * the full disclosure ladder available; a mode that withholds nothing else has
 * no reason to withhold the internet. Guided mode is showing the student the
 * command to type, so there is nothing to look up.
 */
const OFFLINE_BY_MODE: Record<TrainingMode, boolean> = {
  guided: false,
  practice: false,
  drill: true,
  exam: true,
}

/** Whether spec section 10.3 applies to `mode`. */
export function offlineRequiredFor(mode: TrainingMode): boolean {
  return OFFLINE_BY_MODE[mode]
}

/**
 * The exec seam alone, not the whole `LabTransport`.
 *
 * `server/lab.ts`'s `LabRuntime` already exposes `exec(script)` and deliberately
 * exposes nothing else about the transport it wraps, so a caller in the server
 * can pass the runtime it is already holding instead of reaching through it for a
 * transport it has no other reason to know about. `LabTransport`, `LabRuntime`
 * and `FakeTransport` all satisfy this structurally, which is the point: this
 * module needs one capability and asking for more would force a call site to
 * grow.
 */
export type GuestExec = Pick<LabTransport, 'exec'>

/**
 * `'unknown'` is not a third condition of the guest — it is the honest reading
 * when the script's own read-back never arrived (sudo refused, the transport
 * died, `bash` never ran the script). Collapsing that into `'online'` would
 * report a machine nobody looked at.
 */
export type OfflineState = 'online' | 'offline' | 'unknown'

export interface OfflineOutcome {
  /** `false` when the guest script did not complete. `errors` says why. */
  ok: boolean
  /** Read back from the guest's routing table, never echoed from intent. */
  state: OfflineState
  /** Whether the guest still carries the state file `enforceOffline` writes. */
  enforced: boolean
  /** Whether this call actually changed the guest. Idempotent no-ops report `false`. */
  changed: boolean
  /**
   * The host routes keeping the control channel alive, read back out of the
   * guest's state file rather than echoed from what was attempted — so a route
   * listed here is one the guest is recorded as carrying.
   */
  preserved: string[]
  /**
   * Default routes the guest reports **now**, after whatever this call did. A
   * successful `enforceOffline` therefore reports none, and what it removed is
   * in `notes`: this field answers "is there a way out of here" rather than
   * "what happened", and one field cannot honestly do both.
   */
  defaultRoutes: string[]
  /**
   * The guest's own FIB answer for an off-subnet address after the change:
   * `null` when the kernel says the destination is unreachable — offline mode
   * holding — or the route that still carries it.
   */
  internetRoute: string | null
  /** Non-fatal diagnostics, plus any line of guest output this parser did not recognise. */
  notes: string[]
  /** Fatal diagnostics. Empty whenever `ok`. */
  errors: string[]
}

/**
 * Where the guest records what it removed, so `restoreNetwork` puts back exactly
 * that rather than a reconstruction of it.
 *
 * On tmpfs on purpose. Every event that resets the routing table also clears
 * `/run`: a reboot (DHCP re-leases the default route) and a revert to the
 * powered-on `clean` snapshot (restores the whole running kernel, `/run`
 * included). A path under `/tmp` would survive a reboot and then claim the guest
 * is offline while the default route was already back — a stale claim is worse
 * than no claim, because `restoreNetwork` would act on it.
 */
export const OFFLINE_STATE_FILE = '/run/rhcsa-offline.state'

export interface OfflineScriptOptions {
  /**
   * The guest's sshd port, used only to find the terminal bridge's peers when
   * `SSH_CONNECTION` is unavailable (the vmrun case). Comes from
   * `VmConfig.sshPort`; defaults to 22.
   */
  sshPort?: number
}

/**
 * Validated rather than trusted, because it is interpolated into a shell script.
 * `loadVmConfig` already range-checks `RHCSA_SSH_PORT`, but these builders are
 * exported and a caller may pass a number from anywhere — and the failure mode
 * of an unchecked value here is shell injection into a script that runs as root
 * via sudo, which is worth one branch.
 */
function sshPortLiteral(opts: OfflineScriptOptions): string {
  const port = opts.sshPort ?? 22
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`offline mode: sshPort must be a port number, got ${JSON.stringify(port)}`)
  }
  return String(port)
}

/**
 * The preamble every one of the three scripts shares: the state-file seam, the
 * one-key-per-line output protocol, and the read-back that decides what state
 * the guest is actually in.
 *
 * POSIX sh constructs throughout, even though both transports run `bash`. The
 * scripts are short enough that nothing is gained by bash-only syntax, and
 * `sh`-compatible text is what a reader can paste into a rescue shell when the
 * guest is in the state that made them want to.
 */
function preamble(): string {
  return `set -u

# The one testability seam, and the only reason this is not a literal path: the
# guest never sets RHCSA_OFFLINE_STATE, so it reads ${OFFLINE_STATE_FILE} there,
# while test/vm-offline/ runs this exact script text on the host against a
# temporary directory and stub \`ip\`/\`ss\`/\`sudo\` shell functions. Same bargain
# as \`Runner\` in vmrun.ts: one seam, so no test needs a hypervisor.
STATE="\${RHCSA_OFFLINE_STATE:-${OFFLINE_STATE_FILE}}"

# One key per line, so the host-side parser is a split rather than a grammar and
# an unrecognised line is noise rather than a failure — parseVerdict's rule, for
# parseVerdict's reason: this is a shell script on a real machine and it will emit
# stray warnings.
say() { printf 'rhcsa-offline: %s\\n' "$*"; }

# RFC 5737 TEST-NET-3. \`ip route get\` is a FIB lookup inside the kernel and sends
# no packet at all, so this contacts nothing and names no real operator's address;
# it exists purely to ask the routing table whether an off-subnet destination
# still has a path.
PROBE=203.0.113.1

report_state() {
  # Read back from the kernel rather than echoing what we intended — the rule
  # VmStateStore.#write follows, for the same reason: the routing table is what
  # the student's curl will consult, not this script's opinion of it.
  d4=$(ip -4 route show default 2>/dev/null | head -n 1)
  d6=$(ip -6 route show default 2>/dev/null | head -n 1)
  if [ -n "$d4" ]; then say "default=$d4"; fi
  if [ -n "$d6" ]; then say "default=$d6"; fi
  if [ -z "$d4" ] && [ -z "$d6" ]; then
    say 'state=offline'
  else
    say 'state=online'
  fi
  probe=$(ip route get "$PROBE" 2>&1 | head -n 1)
  case "$probe" in
    *unreachable*) say 'internet=unreachable' ;;
    *) say "internet=$probe" ;;
  esac
  if [ -f "$STATE" ]; then
    say 'enforced=yes'
    # The preserve routes, read back out of the record rather than echoed by
    # whoever added them. This is also what makes offlineStatus informative: it
    # can name the routes holding the control channel open without having been
    # the call that created them.
    while read -r kind value; do
      if [ "$kind" = added ]; then say "preserved=$value"; fi
    done < "$STATE"
  else
    say 'enforced=no'
  fi
}
`
}

/**
 * Drop the guest's default route while keeping the control channel alive.
 *
 * Idempotent, and the check that makes it so is the *first* thing it does: a
 * guest with no default route is already offline — because this ran before,
 * because a snapshot was reverted mid-provision, or because networking is
 * genuinely broken — and in that case the script adds nothing, records nothing
 * and exits 0. That ordering matters beyond tidiness: adding preserve routes
 * before discovering there was nothing to disable would leave host routes behind
 * with no state file naming them.
 */
export function enforceOfflineScript(opts: OfflineScriptOptions = {}): string {
  return `${preamble()}
if [ -z "$(ip -4 route show default 2>/dev/null)$(ip -6 route show default 2>/dev/null)" ]; then
  say 'note=already offline: the guest has no default route, so there was nothing to drop'
  report_state
  say 'changed=no'
  exit 0
fi

NL='
'
records=''
add_record() { records="$records$1$NL"; }

# Written before the first delete rather than after the last one. The file
# records what has already happened plus what is about to, so every interleaving
# a kill can produce leaves restoreNetwork with *more* information than it needs
# rather than less: a default route re-added when one is already present fails
# benignly, and so does deleting a preserve route that was never added.
flush_state() {
  if [ -n "$records" ]; then
    printf '%s' "$records" | sudo tee "$STATE" >/dev/null
  fi
}

peers=''
add_peer() {
  case " $peers " in
    *" $1 "*) return 0 ;;
  esac
  peers="$peers $1"
}

# sshd sets SSH_CONNECTION from the accepted socket's peer, which makes it the
# authoritative answer to "who must still be able to receive our replies": it
# names the client of *this very command* — the connection SshTransport, the
# grader and the terminal bridge all ride on. No other source on the guest can
# say that. \`who\` lists login sessions (and none for a \`bash -s\` exec), \`ss\`
# lists sockets without saying which one is ours.
#
# This is also why the peer is not a constant. The WSL host's eth0 address comes
# from DHCP — measured 172.22.101.110 on 2026-08-30 (docs/r1-findings.md) — and
# it changes across host reboots, so a hardcoded 172.22.96.0/20 would be a habit
# device that silently bricks the control channel one reboot later.
conn="\${SSH_CONNECTION:-}"
if [ -n "$conn" ]; then
  add_peer "\${conn%% *}"
fi

# Unset over the vmrun transport, which runs this from vmtoolsd with no ssh
# session at all. vmrun needs no guest networking, so offline mode neither helps
# nor hurts it — but the xterm.js terminal bridge holds its own ssh connection to
# the guest even then, and dropping the default route with nothing preserved
# would kill it. These are that connection's peers. Weaker evidence than
# SSH_CONNECTION (anything talking to sshd shows up here), which is why it
# supplements rather than replaces it. \$NF is the peer column with or without
# ss's State column, which a state filter suppresses.
for p in $(ss -Htn state established "( sport = :${sshPortLiteral(opts)} )" 2>/dev/null \\
  | awk '{print $NF}' | sed -e 's/:[0-9][0-9]*$//' -e 's/^\\[//' -e 's/\\]$//'); do
  case "$p" in
    *:*) add_peer "$p" ;;
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) add_peer "$p" ;;
  esac
done

changed=no

for p in $peers; do
  case "$p" in
    *:*) plen=128 ;;
    *) plen=32 ;;
  esac
  # A /\$plen host route to the address actually observed, not the peer's subnet.
  # The guest cannot know the client's prefix length — nothing on this side of
  # the link carries it — so any subnet form would be a guessed constant, which
  # is the mistake this whole derivation exists to avoid. One host route is also
  # sufficient: spec section 1 says one user, one VM, localhost.
  r=$(ip route get "$p" 2>/dev/null | head -n 1)
  case "$r" in
    *' via '*) ;;
    *)
      # On-link, loopback, or no route at all. Nothing to preserve: a
      # destination that never used the default route cannot be affected by
      # dropping it. On the lab guest this is the arm that fires, and it was
      # measured rather than hoped for - Windows SNATs WSL's traffic to the VMnet8
      # host adapter, so the client arrives as 192.168.70.1 and is on-link, which
      # makes offline mode free here. The via-branch above is for the topologies
      # where it is not.
      say "note=peer $p needs no route of its own ($r)"
      continue
      ;;
  esac
  gw="\${r#* via }"; gw="\${gw%% *}"
  dev="\${r#* dev }"; dev="\${dev%% *}"
  if [ -z "$gw" ] || [ -z "$dev" ]; then
    say "note=peer $p: no gateway and device could be read out of: $r"
    continue
  fi
  # Derived, not assumed to be VMware's 192.168.70.2: that address is a fact
  # about one host's VMware install, and the guest can simply be asked instead.
  spec="$p/$plen via $gw dev $dev"
  if [ -n "$(ip route show "$p/$plen" 2>/dev/null)" ]; then
    # Somebody else's route. It already preserves the peer, and restore must not
    # delete a route this script did not create — so this is deliberately not
    # recorded, which also means report_state will not list it as preserved.
    say "note=peer $p already had a route of its own ($p/$plen); left alone and not recorded"
    continue
  fi
  # Unquoted on purpose: $spec is several argv words.
  if ! out=$(sudo ip route add $spec 2>&1); then
    say "error=could not add the route that keeps the control channel alive ($spec): $out"
    # Abort with the default route untouched. The whole safety property of this
    # script is that the specific route exists before the general one goes away;
    # continuing here would trade the app's control channel for a habit device.
    flush_state
    report_state
    say 'changed=no'
    exit 1
  fi
  add_record "added $spec"
  changed=yes
done

flush_state

drop_defaults() {
  fam="$1"
  n=0
  # Bounded, and the bound is not paranoia about the loop: NetworkManager
  # re-applying the connection puts the default route straight back, and a
  # script that spun on that would hang the session that called it. Four
  # attempts, then say so.
  while [ "$n" -lt 4 ]; do
    n=$((n + 1))
    line=$(ip "$fam" route show default 2>/dev/null | head -n 1)
    if [ -z "$line" ]; then return 0; fi
    add_record "default $fam $line"
    flush_state
    # \`ip route del default\`, not a del of the full line recorded above: the
    # show form carries attributes (proto, src, pref) that add accepts and del
    # does not reliably, and there is nothing to disambiguate — deleting "the
    # default route" until there is none is exactly the intent.
    if ! out=$(sudo ip "$fam" route del default 2>&1); then
      say "error=could not drop the $fam default route ($line): $out"
      return 1
    fi
    changed=yes
    say "note=dropped default route ($fam): $line"
  done
  say "error=the $fam default route came back after 4 deletes; something is re-adding it (NetworkManager, dhclient)"
  return 1
}

rc=0
drop_defaults -4 || rc=1
drop_defaults -6 || rc=1
report_state
say "changed=$changed"
exit "$rc"
`
}

/**
 * Put back what `enforceOfflineScript` removed.
 *
 * Restoration is deliberately independent of the app: everything it needs is in
 * the guest's own state file, so it works over either transport and does not
 * depend on the process that applied offline mode still existing. What it cannot
 * do is invent a default route it has no record of — see the no-state branch,
 * which names the snapshot revert rather than guessing.
 *
 * It carries the mirror of `enforceOfflineScript`'s abort, and the mirror matters
 * for the same reason the original does: if the recorded default route does not
 * come back, the preserve route is **kept**, the state file is kept, and this
 * exits non-zero. Removing it there would turn a recoverable degraded guest —
 * offline, but still reachable — into the one state nothing inside the guest can
 * repair, and it would do so on exactly the path this module already flags as
 * unverified (that `ip route add` swallows an `ip route show` line verbatim).
 */
export function restoreNetworkScript(): string {
  return `${preamble()}
if [ ! -f "$STATE" ]; then
  if [ -n "$(ip -4 route show default 2>/dev/null)$(ip -6 route show default 2>/dev/null)" ]; then
    say 'note=nothing to restore: no offline state was recorded and the guest has a default route'
    report_state
    say 'changed=no'
    exit 0
  fi
  say 'error=the guest has no default route and no record of what removed it, so nothing here can reconstruct one. Not recoverable from inside the guest: revert to the clean snapshot (VmController.revert), or reboot and let DHCP re-lease the route.'
  report_state
  say 'changed=no'
  exit 1
fi

changed=no

# Default routes go back first, mirroring enforce's ordering for the mirror
# image of its reason: at no instant is the reply path to the ssh client worse
# than it already was.
#
# No pipe into either loop: a \`while read\` on the far side of a pipe runs in a
# subshell, and \$changed set there would be discarded.
while read -r kind fam value; do
  if [ "$kind" != default ]; then continue; fi
  # Re-added verbatim as \`ip route show\` stated it, so an attribute this code
  # never thought about (metric, proto, src, pref) comes back too. UNVERIFIED
  # that \`ip route add\` accepts every such line against the real guest; a
  # rejection is reported here rather than swallowed, and the fallbacks are a
  # reboot or a snapshot revert.
  if out=$(sudo ip "$fam" route add $value 2>&1); then
    changed=yes
    say "note=restored default route ($fam): $value"
  else
    say "note=default route not re-added ($fam $value): $out"
  fi
done < "$STATE"

# Read back from the kernel rather than inferred from whether \`ip route add\`
# reported success, for report_state's reason: NetworkManager may have re-added
# the default route itself on a DHCP renewal, in which case the add above failed
# with \`File exists\` and the guest is online regardless. "Did the add command
# work" and "is there a way out of here" are different questions, and only the
# second one decides whether the preserve route is still load-bearing.
have_default() { [ -n "$(ip "$1" route show default 2>/dev/null | head -n 1)" ]; }

kept=no
while read -r kind value; do
  if [ "$kind" != added ]; then continue; fi
  dest="\${value%% *}"
  case "$dest" in
    *:*) fam=-6 ;;
    *) fam=-4 ;;
  esac
  if ! have_default "$fam"; then
    # The mirror of enforce's abort, and the reason this loop is not simply the
    # inverse of that one: never take the specific route away while the general
    # one is missing. Deleting it here would cut the ssh connection this script is
    # running over, and nothing inside the guest can repair a control channel
    # through a control channel that no longer exists - the single unrecoverable
    # state this module is built to stay out of. Leaving behind a host route the
    # guest may no longer need is the cheaper mistake by a wide margin, and the
    # state file stays too, so a later restoreNetwork can retry instead of
    # meeting the "no record of what removed it" branch above.
    say "error=keeping the preserve route $value: the $fam default route is not back, so removing it now would leave no path to the ssh client at all. Retry restoreNetwork once the default route is up, or reboot / revert to the clean snapshot."
    kept=yes
    continue
  fi
  if out=$(sudo ip route del $value 2>&1); then
    changed=yes
    say "note=removed preserve route: $value"
  else
    say "note=preserve route was already gone ($value): $out"
  fi
done < "$STATE"

if [ "$kept" = yes ]; then
  report_state
  say "changed=$changed"
  exit 1
fi

sudo rm -f "$STATE"
report_state
say "changed=$changed"
`
}

/** Ask, change nothing. Safe to call in any mode and over either transport. */
export function offlineStatusScript(): string {
  return `${preamble()}
report_state
say 'changed=no'
`
}

const LINE_PREFIX = 'rhcsa-offline: '

/**
 * Parse one guest run's output.
 *
 * Never throws, for `parseVerdict`'s reason: the producer is a shell script on a
 * machine whose whole purpose is being broken by a student, and an unparseable
 * line must not destroy the rest of the report. Unrecognised lines land in
 * `notes`.
 */
export function parseOfflineReport(r: ExecResult): OfflineOutcome {
  const preserved: string[] = []
  const defaultRoutes: string[] = []
  const notes: string[] = []
  const errors: string[] = []
  let state: OfflineState = 'unknown'
  let enforced = false
  let changed = false
  let internetRoute: string | null = null

  for (const raw of r.stdout.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith(LINE_PREFIX)) {
      if (line !== '') notes.push(line)
      continue
    }
    const body = line.slice(LINE_PREFIX.length)
    const eq = body.indexOf('=')
    if (eq < 0) {
      notes.push(body)
      continue
    }
    const key = body.slice(0, eq)
    const value = body.slice(eq + 1)
    switch (key) {
      case 'state':
        // Only the two the guest can actually observe. An unexpected value is
        // noise, and leaves `state` at 'unknown' — which is what a caller must
        // treat "the read-back never arrived" as anyway.
        if (value === 'online' || value === 'offline') state = value
        else notes.push(body)
        break
      case 'enforced':
        enforced = value === 'yes'
        break
      case 'changed':
        changed = value === 'yes'
        break
      case 'preserved':
        preserved.push(value)
        break
      case 'default':
        defaultRoutes.push(value)
        break
      case 'internet':
        // `null` is the *good* outcome here, which is why the field is named for
        // the route rather than for a boolean: 'unreachable' is the guest's own
        // words for offline mode holding.
        internetRoute = value === 'unreachable' ? null : value
        break
      case 'note':
        notes.push(value)
        break
      case 'error':
        errors.push(value)
        break
      default:
        notes.push(body)
    }
  }

  const ok = r.code === 0 && state !== 'unknown'
  if (!ok && errors.length === 0) {
    // The script never got far enough to say anything. Name that, rather than
    // returning a clean-looking outcome nobody measured. `stderr` has already
    // been through makeRunner/makeSshRunner, so no credential can ride along.
    const why = r.stderr.trim()
    errors.push(
      why.length > 0
        ? `offline-mode script exited ${r.code} without reporting a state: ${why}`
        : `offline-mode script exited ${r.code} without reporting a state`,
    )
  }

  return {
    ok,
    state,
    enforced,
    changed,
    preserved,
    defaultRoutes,
    internetRoute,
    notes,
    errors,
  }
}

/**
 * Apply spec section 10.3 to the guest. Idempotent: safe to call again at any
 * point in a session, which is the mitigation for NetworkManager re-adding the
 * default route on a DHCP renewal.
 *
 * Does not throw on a guest-side failure, and that is a deliberate policy call:
 * offline mode is a habit device, so a machine that refused to go offline is a
 * degraded session, not a lost one. Refusing to open the session would cost the
 * student the practice to protect a nicety. The caller decides what to do with
 * `ok === false`; it must not be ignored silently, because a student told they
 * are offline while they are not has been lied to.
 */
export async function enforceOffline(
  t: GuestExec,
  opts: OfflineScriptOptions = {},
): Promise<OfflineOutcome> {
  return parseOfflineReport(await t.exec(enforceOfflineScript(opts)))
}

/** Undo `enforceOffline`. Idempotent, and independent of who applied it. */
export async function restoreNetwork(t: GuestExec): Promise<OfflineOutcome> {
  return parseOfflineReport(await t.exec(restoreNetworkScript()))
}

/** What the guest's routing table says right now. Changes nothing. */
export async function offlineStatus(t: GuestExec): Promise<OfflineOutcome> {
  return parseOfflineReport(await t.exec(offlineStatusScript()))
}
