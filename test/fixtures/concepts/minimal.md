---
id: systemd.enabled-versus-started
title: Enabled and started are different things
rhel: 9
objectives: [systemd.services.manage]
---
`systemctl start` runs a unit now. `systemctl enable` creates the symlink that
makes it run at boot. Neither implies the other, so a service can be running
and still be absent after a reboot — which is precisely what the exam checks,
because the exam reboots before grading.
