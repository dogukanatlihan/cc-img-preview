// Opening an image in the system's default app: the command to run, and the
// rule for what a click may open. Pure.
import { isImagePath } from './paths'

export type Platform = 'win32' | 'darwin' | 'linux'

export const POWERSHELL = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']

/** The mod's Windows helper script, run with these arguments. */
export function windowsHelper(root: string, ...args: string[]): string[] {
  return [...POWERSHELL, '-File', `${root}\\helpers\\thumb.ps1`, ...args]
}

/**
 * The argument vector that opens `path` in its default app.
 *
 * On Windows this goes through the helper, which opens the path literally.
 * `explorer.exe <path>` would not do: explorer splits its argument on commas,
 * so `tool.exe,icon.png` could start `tool.exe`.
 */
export function openerArgv(platform: Platform, path: string, root: string): string[] {
  if (platform === 'win32') return windowsHelper(root, '-Open', path.replace(/\//g, '\\'))
  if (platform === 'darwin') return ['open', path]

  return ['xdg-open', path]
}

/**
 * Whether a click may open `path`: only a file the mod recorded itself, and
 * only an image, so a press never starts a program or a script.
 */
export function canOpen(path: string, recorded: ReadonlySet<string>): boolean {
  return recorded.has(path) && isImagePath(path)
}
