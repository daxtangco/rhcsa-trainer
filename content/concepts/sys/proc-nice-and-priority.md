---
id: sys.proc-nice-and-priority
title: Nice is a share of a contended CPU, and renice does not stick
rhel: 9
objectives: [sys.proc.scheduling]
sources: [r9:ch10, r10:ch10]
prerequisites: [systemd.unit-file-anatomy]
---
A nice value runs from **-20 (greedy) to 19 (generous)**, default 0, and it is an
input to the scheduler's weighting — not a cap and not a percentage. Two facts
follow that people get wrong in opposite directions.

**It only does anything when the CPU is contended.** A nice-19 process on an idle
machine still uses 100% of a core, so "the load looks fine now" is no evidence
that a priority change worked. What nice buys is that when something else wants
the CPU, the nice process yields first.

**Only root can be greedy.** An unprivileged user may *raise* their own nice value
(be kinder) and can never lower it again, not even back to where it started, and
cannot touch another user's processes at all. So `nice -n -5` and any `renice` of
a root-owned daemon need `sudo`, while `nice -n 10` on your own job does not.

```
nice -n 10 ./batch.sh        # start it nicer
renice -n 10 -p 1234         # change one running process
renice -n 5 -u bob           # everything bob is running now
ps -o pid,ni,args -p 1234    # read it back; top's NI column, r to change it
```

**`renice` changes a process, and a process is not a configuration.** The value
lives in that process and dies with it: restart the service, or reboot, and you
are back where you started with nothing on disk to show you ever changed
anything. This is the single most common wrong answer to "make this job run at
lower priority", because it is completely correct for about a day.

Persistence has to live in whatever starts the process. For a service that means
`Nice=` in the unit's **`[Service]`** section, or a drop-in:

```
systemctl edit rhcsa-collector.service   # writes .../rhcsa-collector.service.d/override.conf
[Service]
Nice=10
```

Three details that turn a correct-looking answer into a no-op. A drop-in file must
end in `.conf` or systemd ignores it. Editing a unit file by hand does nothing
until `systemctl daemon-reload`, and even then the *running* process keeps its old
value until the unit is restarted or reniced — configuration and effect are two
separate things here. And `Nice=` in `[Unit]` is silently ignored: it configures
the process, so it belongs to `[Service]`, and the only complaint is one warning
line in the journal.

Beyond the objective, worth recognising rather than memorising: `CPUWeight=` and
`CPUQuota=` do this at cgroup level for a whole unit including its children, and
`chrt` moves a process onto a real-time policy where nice values no longer apply.
