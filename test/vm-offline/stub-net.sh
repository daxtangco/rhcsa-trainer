# Stubs for `ip`, `ss` and `sudo`, sourced ahead of the *real* text of the guest
# scripts built by src/engine/vm/offline.ts so test/vm-offline/ can drive them on
# the host with no VM anywhere in the picture.
#
# WHAT THIS PROVES. Control flow and, above all, ordering: that a preserve route
# is added before the default route is deleted, that a failed preserve aborts
# with the default route still in place, that the state file records what was
# done, and that restore is the inverse of enforce.
#
# WHAT THIS DOES NOT PROVE, and must never be read as proving. That real
# iproute2 accepts these argument forms — in particular that `ip route add` will
# swallow an `ip route show` line back verbatim. And, most of all, that a
# preserved host route actually keeps an ssh connection alive: that is a fact
# about VMware NAT and WSL's routing, and only the guest can answer it.
#
# This is not a route table. It is a tape recorder with just enough behaviour to
# reach every branch, and it is deliberately dumb: a fake that grew into a
# routing stack would let a broken script pass its own tests, which is the trap
# fake.ts warns about in the transport layer.
#
# Inputs, all file paths so that a `$( ... )` subshell's writes survive — which
# they must, because the scripts run every mutating command inside a command
# substitution to capture its stderr:
#   ROUTES   fam|prefix|rest, one route per line. Read and written.
#   GETS     addr|answer for `ip route get`. answer is DEFAULT (follow the
#            default route, or report unreachable when there is none), ONLINK,
#            or a literal line. A missing address behaves as DEFAULT.
#   OPLOG    every mutation, in order. The ordering assertions read this.
#   SS_OUT   canned `ss` output, for the vmrun case where SSH_CONNECTION is unset.
#   FAIL_ADD prefix whose `ip route add` always fails (permission-denied path).
#   FAIL_DEL prefix whose `ip route del` always fails.

: "${ROUTES:?stub-net.sh needs ROUTES}" "${GETS:?stub-net.sh needs GETS}"
: "${OPLOG:?stub-net.sh needs OPLOG}"

stub_log() { printf '%s\n' "$*" >>"$OPLOG"; }

ip_show() {
  _fam=$1
  _sel=$2
  while IFS='|' read -r f p rest; do
    if [ "$f" = "$_fam" ] && [ "$p" = "$_sel" ]; then
      printf '%s %s\n' "$p" "$rest"
    fi
  done <"$ROUTES"
}

ip_get() {
  _dst=$1
  _ans=$(awk -F'|' -v d="$_dst" '$1 == d { print $2; exit }' "$GETS")
  case "$_ans" in
    '' | DEFAULT)
      _def=$(ip_show -4 default | head -n 1)
      if [ -z "$_def" ]; then
        echo 'RTNETLINK answers: Network is unreachable' >&2
        return 2
      fi
      _gw=${_def#*via }
      _gw=${_gw%% *}
      _dev=${_def#*dev }
      _dev=${_dev%% *}
      printf '%s via %s dev %s src 192.168.70.128 uid 0\n' "$_dst" "$_gw" "$_dev"
      ;;
    ONLINK) printf '%s dev ens160 src 192.168.70.128 uid 0\n' "$_dst" ;;
    *) printf '%s\n' "$_ans" ;;
  esac
}

ip_add() {
  _fam=$1
  shift
  _pfx=$1
  shift
  if [ -n "${FAIL_ADD:-}" ] && [ "$_pfx" = "$FAIL_ADD" ]; then
    echo 'RTNETLINK answers: Operation not permitted' >&2
    return 2
  fi
  if [ -n "$(ip_show "$_fam" "$_pfx")" ]; then
    echo 'RTNETLINK answers: File exists' >&2
    return 2
  fi
  stub_log "add $_fam $_pfx $*"
  printf '%s|%s|%s\n' "$_fam" "$_pfx" "$*" >>"$ROUTES"
}

ip_del() {
  _fam=$1
  shift
  _pfx=$1
  if [ -n "${FAIL_DEL:-}" ] && [ "$_pfx" = "$FAIL_DEL" ]; then
    echo 'RTNETLINK answers: Operation not permitted' >&2
    return 2
  fi
  if [ -z "$(ip_show "$_fam" "$_pfx")" ]; then
    echo 'RTNETLINK answers: No such process' >&2
    return 2
  fi
  stub_log "del $_fam $_pfx"
  _dropped=no
  : >"$ROUTES.tmp"
  while IFS='|' read -r f p rest; do
    if [ "$_dropped" = no ] && [ "$f" = "$_fam" ] && [ "$p" = "$_pfx" ]; then
      _dropped=yes
      continue
    fi
    printf '%s|%s|%s\n' "$f" "$p" "$rest" >>"$ROUTES.tmp"
  done <"$ROUTES"
  mv "$ROUTES.tmp" "$ROUTES"
}

ip() {
  _fam=-4
  case "${1:-}" in
    -4 | -6)
      _fam=$1
      shift
      ;;
  esac
  if [ "${1:-}" != route ]; then
    echo "stub ip: only 'route' is implemented, got: $*" >&2
    return 64
  fi
  shift
  _verb=${1:-}
  shift 2>/dev/null || true
  case "$_verb" in
    show) ip_show "$_fam" "${1:-}" ;;
    get) ip_get "${1:-}" ;;
    add) ip_add "$_fam" "$@" ;;
    del) ip_del "$_fam" "$@" ;;
    *)
      echo "stub ip: unsupported verb: $_verb" >&2
      return 64
      ;;
  esac
}

# Arguments ignored on purpose: the script's filter expression is asserted as
# text by offline.test.ts, so re-implementing it here would only give the
# expression two places to be wrong.
ss() {
  if [ -n "${SS_OUT:-}" ]; then printf '%s\n' "$SS_OUT"; fi
}

# The scripts run every privileged command through sudo, and `"$@"` resolves the
# `ip` shell function above rather than /usr/sbin/ip. `sudo tee` and `sudo rm`
# reach the real binaries, which is what makes the state file behave.
sudo() { "$@"; }
