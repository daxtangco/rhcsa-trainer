import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Already something Windows can open: `C:\...`, `C:/...`, or a `\\host\share` UNC. */
const WINDOWS_FORM = /^([A-Za-z]:[\\/]|\\\\)/

/**
 * Converts a host path into the form `vmrun.exe` can open.
 *
 * WSL does not translate path arguments when it launches a Windows program.
 * `vmrun.exe copyFileFromHostToGuest ... /tmp/rhcsa-stage-x/script.sh` hands
 * vmrun that string verbatim, and it is not a path on Windows. Measured with
 * PowerShell `Test-Path`: `/tmp/rhcsa-probe/script.sh` is False, the
 * `wslpath -w` form of the same file is True and a Windows program reads it.
 *
 * This delegates to `wslpath` instead of rewriting the path, because only
 * wslpath knows the mount table, and the shape of a path does not imply its
 * mapping. `/mnt/c` is a real drive mount and becomes `C:\`; `/mnt/d` on a
 * machine with no D: drive is an ordinary WSL directory and becomes a
 * `\\wsl.localhost` UNC path (measured). Inferring `D:\` from the `/mnt/d`
 * prefix would produce a path that silently does not exist — the same class of
 * bug this function exists to fix. Preferring the drive letter when there is
 * one also matters for throughput: `scripts/provision.sh` copies a 10 GB ISO,
 * and a real drive path avoids sending it through the 9P share.
 */
export async function toWindowsPath(p: string): Promise<string> {
  if (WINDOWS_FORM.test(p)) return p

  // Not WSL: either vmrun is native Windows and callers already hold Windows
  // paths, or there is no vmrun at all. Nothing to convert either way.
  if (!process.env.WSL_DISTRO_NAME) return p

  try {
    const { stdout } = await execFileAsync('wslpath', ['-w', p])
    const converted = stdout.trim()
    return converted.length > 0 ? converted : p
  } catch {
    // A missing or failing wslpath should not become the error the caller
    // sees. Pass the path through and let vmrun report what it could not
    // open — that message names the actual file, which is the more useful
    // diagnostic than one invented here.
    return p
  }
}
