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
# FILENAME is a list-mode field: the profile-mode form of `connection show` takes
# <setting>.<property> and cannot return it, so `-g FILENAME connection show
# "$conn"` fails - and under `set -euo pipefail` that aborts the whole script.
# So look the row up in list mode, keyed on the UUID rather than on the name: a
# connection name may contain a colon (nmcli escapes it as `\:`), which breaks
# both `-F:` field splitting and the `$1==name` comparison. A UUID cannot. The
# sub() takes everything after the first colon so a colon in the path is safe too.
uuid=$(nmcli -g connection.uuid connection show "$conn")
file=$(sudo nmcli -g UUID,FILENAME connection show \
  | awk -F: -v u="$uuid" '$1==u { sub(/^[^:]*:/, ""); print; exit }')
sudo sed -i '/^autoconnect=/d' "$file"
sudo sed -i "/^\[connection\]/a autoconnect=true" "$file"
sudo nmcli connection reload

# Assert the end state this fixture claims to reach. Both seds above are no-ops
# on an ifcfg-format profile, which spells this `ONBOOT=yes` and has no
# `[connection]` section to append after: sed would exit 0 having changed
# nothing, the reload would succeed, and the fixture would report success while
# net-autoconnect failed - a tool reporting success without doing what was asked,
# inside the teaching material. Fail here instead, where it is attributable.
if [ "$(nmcli -g connection.autoconnect connection show "$conn")" != "yes" ]; then
  printf 'solutions/02: FAILED: autoconnect is still not yes after editing %s\n' "$file" >&2
  printf 'solutions/02: (an ifcfg-format profile needs ONBOOT=yes, not autoconnect=true)\n' >&2
  exit 1
fi
