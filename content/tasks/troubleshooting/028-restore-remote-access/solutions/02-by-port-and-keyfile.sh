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
