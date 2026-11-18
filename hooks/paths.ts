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
  'heic',
  'heif',
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
// In a Unix shell a character with a backslash before it is part of the word: `my\ shot.png`.
const UNIX_TOKEN = /"([^"\n]+)"|'([^'\n]+)'|((?:\\.|\S)+)/g
const LEADING = /^[([{"'`<]+/
const TRAILING = '.,;:)]}"\'`>'

/**
 * `text` without the run of `chars` at its end. A loop, not `/[...]+$/`: on a
 * long run that is not at the end, that expression starts again from each
 * character of the run, and 80,000 dots in a command's output took it seconds.
 */
export function trimEnd(text: string, chars: string): string {
  let end = text.length
  while (end > 0 && chars.includes(text[end - 1]!)) end--

  return text.slice(0, end)
}

function bare(token: string): string | undefined {
  let path = trimEnd(token.replace(LEADING, ''), TRAILING)
  if (path.includes('://')) return undefined
  // `--out=plot.png`: the path is what follows the last `=`.
  const equals = path.lastIndexOf('=')
  if (equals >= 0) path = path.slice(equals + 1).replace(LEADING, '')

  return isImagePath(path) ? path : undefined
}

/**
 * The image paths `text` names, in order of appearance, each once.
 *
 * `unixShell`: the text is read as a Unix shell reads it, where a backslash
 * escapes the character after it (`my\ shot\ \(1\).png`) and is taken off an
 * unquoted word. Not on Windows, where a backslash parts folders.
 */
export function scanImagePaths(text: string, unixShell = false): string[] {
  // A Windows path keeps its backslashes wherever it is read.
  const unescaped = (word: string) =>
    unixShell && !DRIVE.test(word) && !word.startsWith('\\\\') ? word.replace(/\\(.)/g, '$1') : word

  const found: string[] = []
  const add = (path: string | undefined) => {
    if (path !== undefined && !found.includes(path)) found.push(path)
  }

  for (const match of text.matchAll(unixShell ? UNIX_TOKEN : TOKEN)) {
    const quoted = match[1] ?? match[2]
    if (quoted === undefined) {
      add(bare(unescaped(match[3]!)))
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
      // A drive is as far up as a path goes.
      const last = out.at(-1)
      if (last !== undefined && !/^[A-Za-z]:$/.test(last)) out.pop()
      continue
    }
    out.push(part)
  }

  const joined = out.join(separator)
  if (isUnc) return '\\\\' + joined

  return isRooted ? separator + joined : joined
}

/**
 * `path` as an absolute path, in the style of `cwd` (or its own drive's).
 * `home` is the person's home folder, which a leading `~/` stands for.
 */
export function resolvePath(path: string, cwd: string, home?: string): string {
  const isWindowsCwd = DRIVE.test(cwd) || cwd.startsWith('\\\\')

  if (home !== undefined && path.startsWith('~/')) path = home + path.slice(1)
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
  const parts = absolutePath.replaceAll('\\', '/').split('/')
  const encoded = parts.map((part, index) =>
    index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part),
  )
  const joined = encoded.join('/')

  return joined.startsWith('/') ? `file://${joined}` : `file:///${joined}`
}
