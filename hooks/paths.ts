// Finding image file paths in text, and putting them in a form the file
// system and a terminal link can use. Pure: nothing here touches the engine.

export const IMAGE_EXTS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'tif',
  'tiff',
  'avif',
  'ico',
]

const EXT = /\.([A-Za-z0-9]+)$/
const DRIVE = /^[A-Za-z]:[\\/]/
const GIT_BASH_DRIVE = /^\/([A-Za-z])\/(.*)$/

export function extension(path: string): string {
  return EXT.exec(path)?.[1]?.toLowerCase() ?? ''
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.includes(extension(path))
}

const TOKEN = /"([^"\n]+)"|'([^'\n]+)'|(\S+)/g
const LEADING = /^[(\[{"'`<]+/
const TRAILING = /[.,;:)\]}"'`>]+$/

function bare(token: string): string | undefined {
  let path = token.replace(LEADING, '').replace(TRAILING, '')
  if (path.includes('://')) return undefined
  // `--out=plot.png`: the path is what follows the last `=`.
  const equals = path.lastIndexOf('=')
  if (equals >= 0) path = path.slice(equals + 1).replace(LEADING, '')

  return isImagePath(path) ? path : undefined
}

/** The image paths `text` names, in order of appearance, each once. */
export function scanImagePaths(text: string): string[] {
  const found: string[] = []
  const add = (path: string | undefined) => {
    if (path !== undefined && !found.includes(path)) found.push(path)
  }

  for (const match of text.matchAll(TOKEN)) {
    const quoted = match[1] ?? match[2]
    if (quoted === undefined) {
      add(bare(match[3]!))
      continue
    }
    if (quoted.includes('://')) continue
    // A quoted path may hold spaces; a quoted sentence is read word by word.
    if (isImagePath(quoted)) add(quoted)
    else for (const word of quoted.split(/\s+/)) add(bare(word))
  }

  return found
}

export function isAbsolute(path: string): boolean {
  return DRIVE.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

function normalize(path: string, isWindows: boolean): string {
  const separator = isWindows ? '\\' : '/'
  const isUnc = isWindows && /^[\\/]{2}/.test(path)
  const isRooted = /^[\\/]/.test(path)
  const out: string[] = []

  for (const part of path.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && !/^[A-Za-z]:$/.test(out[out.length - 1]!)) out.pop()
      continue
    }
    out.push(part)
  }

  const prefix = isUnc ? '\\\\' : isRooted ? separator : ''

  return prefix + out.join(separator)
}

/** `path` as an absolute path, in the style of `cwd` (or its own drive's). */
export function resolvePath(path: string, cwd: string): string {
  const isWindowsCwd = DRIVE.test(cwd) || cwd.startsWith('\\\\')

  if (DRIVE.test(path) || path.startsWith('\\\\')) return normalize(path, true)
  if (path.startsWith('/')) {
    const drive = isWindowsCwd ? GIT_BASH_DRIVE.exec(path) : null
    if (drive) return normalize(`${drive[1]!.toUpperCase()}:/${drive[2]}`, true)

    return normalize(path, isWindowsCwd)
  }

  return normalize(`${cwd}/${path}`, isWindowsCwd)
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A `file:` address for an absolute path, for a terminal link. */
export function fileUrl(absolutePath: string): string {
  const parts = absolutePath.replace(/\\/g, '/').split('/')
  const encoded = parts.map((part, index) =>
    index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part),
  )
  const joined = encoded.join('/')

  return joined.startsWith('/') ? `file://${joined}` : `file:///${joined}`
}
