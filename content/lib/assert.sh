# Grader helper library. Sourced by every grade.sh.
#
# Contract with src/engine/grading/verdict.ts:
#   - one JSON object per line on stdout, nothing else
#   - the grader's own exit code is ignored
#   - graders are READ-ONLY: they never change the system they measure
#
# ------------------------------------------------------------------
# Trap that has cost this bank two false verdicts: `producer | grep -q` under
# `set -o pipefail`, which every grade.sh and setup.sh here sets.
#
# grep -q exits the instant it matches. The producer is then killed by SIGPIPE
# and exits 141, and pipefail reports the PIPELINE as 141 - a failure for a
# search that succeeded. Measured: `PIPESTATUS=141 0`, grep found its match and
# the pipeline still reported failure.
#
# It only fires when the match sits more than one 64 KiB pipe buffer from the end
# of the stream, so it hides completely on small output and is perfectly
# reproducible on large output. That asymmetry is what makes it dangerous: it
# passes review, passes most fixtures, and then fails one. Both real cases were
# exactly that shape - `journalctl -b | grep -q marker` in sys/035's setup, which
# aborted every fixture, and `printf '%s\n' "$diff_out" | grep -q path` in
# containers/031's grader, which failed a checkpoint for a fixture whose file was
# demonstrably present and printed a detail line asserting the opposite.
#
# Write it so the consumer reads to EOF:
#
#   cmd | grep -F -- "$pat" >/dev/null     # not: cmd | grep -qF -- "$pat"
#   [[ -n $(cmd) ]]                        # not: cmd | grep -q .
#
# `head`, `grep -m`, and `sed -n '…q'` are the same hazard. A consumer that reads
# its whole input is not - `tr`, `tail`, `wc`, and `awk` without `exit` are all
# safe, which is why every pipeline in this file is written with one.
#
# shellcheck shell=bash

# ------------------------------------------------------------------ output

# Escape a value for embedding in a JSON string.
_json_escape() {
  local s=$1
  s=${s//\\/\\\\}      # backslash first, or it doubles the others
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  s=${s//$'\b'/\\b}
  s=${s//$'\f'/\\f}
  # Any C0 control left over would make the line invalid JSON, and parseVerdict
  # files an invalid line as noise - so the checkpoint would silently vanish from
  # the verdict instead of failing, and allPassed would ignore it. detail is
  # usually captured command output, which is where an ESC or a form feed comes
  # from. Escape the remainder as \uXXXX; the guard means the loop is skipped for
  # every normal string.
  if [[ $s == *[$'\x01'-$'\x1f']* ]]; then
    local out='' i ch
    for (( i = 0; i < ${#s}; i++ )); do
      ch=${s:i:1}
      if [[ $ch == [$'\x01'-$'\x1f'] ]]; then
        printf -v ch '\\u%04x' "'$ch"
      fi
      out+=$ch
    done
    s=$out
  fi
  printf '%s' "$s"
}

_emit() {
  local status=$1 id=$2 desc=$3 detail=${4-}
  if [[ -n $detail ]]; then
    printf '{"id":"%s","desc":"%s","status":"%s","detail":"%s"}\n' \
      "$(_json_escape "$id")" "$(_json_escape "$desc")" "$status" "$(_json_escape "$detail")"
  else
    printf '{"id":"%s","desc":"%s","status":"%s"}\n' \
      "$(_json_escape "$id")" "$(_json_escape "$desc")" "$status"
  fi
}

ck_pass() { _emit pass "$1" "$2" "${3-}"; }
ck_fail() { _emit fail "$1" "$2" "${3-}"; }

# skip = could not be evaluated. NOT a pass: allPassed() treats it as not-passed.
ck_skip() { _emit skip "$1" "$2" "${3-}"; }

# ck ID DESC EXIT_STATUS [DETAIL]
# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"
ck() {
  local id=$1 desc=$2 status=$3 detail=${4-}
  if [[ $status -eq 0 ]]; then
    ck_pass "$id" "$desc"
  else
    ck_fail "$id" "$desc" "$detail"
  fi
}

# ------------------------------------------------------------------- sizes

# to_bytes SIZE -> bytes on stdout, exit 1 if unparseable.
#
# Handles what lvs, df and a student's own typing produce: 2G, 2g, 2GiB,
# 2048M, 4.00g, 1.5G, bare bytes. awk does the arithmetic because bash cannot
# multiply 1.5.
to_bytes() {
  local raw=$1
  local num unit
  if [[ ! $raw =~ ^([0-9]+(\.[0-9]+)?)[[:space:]]*([KkMmGgTt]?)(i?[Bb])?$ ]]; then
    printf 'to_bytes: cannot parse %s\n' "$raw" >&2
    return 1
  fi
  num=${BASH_REMATCH[1]}
  unit=${BASH_REMATCH[3]}
  local mult=1
  case ${unit,,} in
    k) mult=1024 ;;
    m) mult=$((1024 ** 2)) ;;
    g) mult=$((1024 ** 3)) ;;
    t) mult=$((1024 ** 4)) ;;
    '') mult=1 ;;
  esac
  awk -v n="$num" -v m="$mult" 'BEGIN { printf "%d\n", n * m }'
}

# within_pct ACTUAL EXPECTED PCT -> exit 0 if |actual-expected| <= pct% of expected.
#
# Filesystems never report their exact device size: XFS metadata makes a 4 GiB
# LV report slightly less usable space. Exact comparison fails correct answers.
within_pct() {
  local actual=$1 expected=$2 pct=$3
  awk -v a="$actual" -v e="$expected" -v p="$pct" 'BEGIN {
    if (e == 0) exit 1
    d = a - e; if (d < 0) d = -d
    exit (d <= e * p / 100) ? 0 : 1
  }'
}

# ------------------------------------------------------------- system state

# lv_size_bytes VG LV -> size in bytes. Empty output + exit 1 if absent.
lv_size_bytes() {
  local vg=$1 lv=$2 out
  out=$(sudo lvs --noheadings --nosuffix --units b -o lv_size "$vg/$lv" 2>/dev/null | tr -d ' ') || return 1
  [[ -n $out ]] || return 1
  printf '%s\n' "$out"
}

# mount_source PATH -> the device currently backing PATH, exit 1 if not a mount point.
mount_source() {
  findmnt -no SOURCE --target "$1" 2>/dev/null || return 1
}

# fs_size_bytes PATH -> the filesystem's total size in bytes.
#
# df, not lvs: this is the number that reveals a forgotten xfs_growfs.
fs_size_bytes() {
  local out
  out=$(df -B1 --output=size "$1" 2>/dev/null | tail -n1 | tr -d ' ') || return 1
  [[ -n $out ]] || return 1
  printf '%s\n' "$out"
}

# is_persistent MOUNTPOINT [FSTAB] [UNITDIR] -> exit 0 if it will mount at boot.
#
# Accepts an fstab entry OR a systemd .mount unit. Per spec 6.5 rule 1 the end
# state is graded, not the mechanism, so a student who chose a mount unit is
# not penalised for it.
is_persistent() {
  local target=$1
  local fstab=${2:-/etc/fstab}
  local unitdir=${3:-/etc/systemd/system}

  # Field 2 must equal the target exactly. A prefix match would accept
  # /var/log as evidence for /var. Field 4 must not carry noauto: that option
  # means the entry will not mount at boot, which is exactly what this
  # function promises to report. nofail is fine - it only suppresses the
  # boot error if the device is missing, it does not skip mounting.
  if [[ -r $fstab ]] && awk -v t="$target" '
        /^[[:space:]]*#/ { next }
        NF >= 2 && $2 == t && $4 !~ /(^|,)noauto(,|$)/ { found = 1 }
        END { exit found ? 0 : 1 }' "$fstab"; then
    return 0
  fi

  if [[ -d $unitdir ]]; then
    local unit
    for unit in "$unitdir"/*.mount; do
      [[ -r $unit ]] || continue
      # Compare the Where= value literally. Interpolating $target into a regex
      # would let a mount point containing '.' match some other path - and the
      # fstab branch above already compares literally, so this matches it.
      if awk -v t="$target" '
            /^[[:space:]]*Where[[:space:]]*=/ {
              v = substr($0, index($0, "=") + 1)
              gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
              if (v == t) found = 1
            }
            END { exit found ? 0 : 1 }' "$unit"; then
        return 0
      fi
    done
  fi

  return 1
}
