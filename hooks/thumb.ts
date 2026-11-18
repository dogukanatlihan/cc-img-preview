// Turning an image file into thumbnail files, by running a program the
// system already has. A mod cannot decode an image itself, and a process's
// stdout is text, so the helper writes files and the mod reads them.
//
// Every program is started as an argument vector. A path is never put into a
// shell's command line: a file name or a temp folder may hold `&`, `,` or a
// quote, and on Windows `cmd.exe` would act on them.
import { POWERSHELL, windowsHelper } from './open'
import type { Platform } from './open'
import { extension, IMAGE_EXTS, trimEnd } from './paths'
import { boxFor, fitBox } from './pixels'
import type { Blocks, Box } from './pixels'

export type Env = {
  platform: Platform
  /** The mod's own folder: where `helpers/thumb.ps1` is. */
  root: string
  /** This session's folder under the system's temp folder. */
  tempDir: string
  tools: { ffmpeg: boolean; magick: boolean; rsvg: boolean }
}

export type ThumbRequest = {
  /** The image to read, an absolute path. */
  src: string
  /** Names the output files. */
  id: string
  /** Whether a PNG thumbnail is wanted too (pixel mode). */
  png: boolean
  /** The most cells the thumbnail may take, across and down; 80 and 40 when left out. */
  columns?: number
  rows?: number
  /** The blocks it will be drawn in, which set how many pixels a cell holds; quarter when left out. */
  blocks?: Blocks
  /**
   * Asks for the picture at full size too, for the Sixel painter: written as
   * `<id>.six.bmp`, fitted to this many pixels. Only the Windows helper writes it.
   */
  six?: { id: string; width: number; height: number }
}

export type ThumbFiles = {
  /** The original's size in pixels; 0 when the helper cannot tell. */
  width: number
  height: number
  /**
   * An uncompressed BMP that fits the box, two pixels to a cell across and
   * two or four down. For quarter blocks it is the picture at twice its width.
   */
  bmpPath: string
  pngPath?: string
  /** The size in pixels of the full-size picture, where one was asked for and written. */
  six?: { width: number; height: number }
}

/** `$.process.run`, or what stands for it in a test. */
export type RunProcess = (
  argv: readonly string[],
  init?: { stdin?: string; timeoutMs?: number },
) => Promise<{ exitCode: number | null; stdout: string }>

export type Helper = 'powershell' | 'sips' | 'ffmpeg' | 'magick' | 'rsvg'

export const TIMEOUT_MS = 5000

const WINDOWS_READS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'ico'])
const MACOS_READS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif'])
/** What `sips` reads only on a newer macOS (webp from 11, avif from 13): tried where nothing else can. */
const MACOS_READS_LATER = new Set(['webp', 'avif', 'ico'])

/**
 * The reader ImageMagick is told to use for each extension. Left to itself it
 * guesses the format from the file's content, and a file named `.png` can
 * hold one of its script formats.
 */
const MAGICK_READERS: Record<string, string> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  bmp: 'bmp',
  webp: 'webp',
  svg: 'svg',
  tif: 'tiff',
  tiff: 'tiff',
  avif: 'avif',
  ico: 'ico',
  heic: 'heic',
  heif: 'heic',
}

/**
 * Not given to ffmpeg: a phone's HEIC photo is a grid of tiles, and an ffmpeg
 * before 7.0 answers with one tile of it, a wrong picture with no error.
 */
const NOT_FFMPEG = new Set(['heic', 'heif'])

const join = (env: Pick<Env, 'platform'>, ...parts: string[]) => parts.join(env.platform === 'win32' ? '\\' : '/')

/** The program that draws an SVG here. */
function svgHelper(tools: Env['tools']): Helper | undefined {
  if (tools.magick) return 'magick'

  return tools.rsvg ? 'rsvg' : undefined
}

/** The reader the system ships, where it reads this extension. */
function shipped(platform: Platform, ext: string): Helper | undefined {
  if (platform === 'win32' && WINDOWS_READS.has(ext)) return 'powershell'

  return platform === 'darwin' && MACOS_READS.has(ext) ? 'sips' : undefined
}

/** A program the person installed that reads this extension. */
function installed(tools: Env['tools'], ext: string): Helper | undefined {
  if (tools.magick) return 'magick'

  return tools.ffmpeg && !NOT_FFMPEG.has(ext) ? 'ffmpeg' : undefined
}

/** Which program reads `src` here; undefined when none can. */
export function helperFor(env: Env, src: string): Helper | undefined {
  const ext = extension(src)
  if (!IMAGE_EXTS.includes(ext)) return undefined
  if (ext === 'svg') return svgHelper(env.tools)

  // Where nothing else reads it, a newer macOS may.
  const later = env.platform === 'darwin' && MACOS_READS_LATER.has(ext) ? 'sips' : undefined

  return shipped(env.platform, ext) ?? installed(env.tools, ext) ?? later
}

/**
 * What makes this session's temp folder. Off Windows it is made for its owner
 * alone: small copies of the person's pictures go there, and the temp folder
 * can be one that every user of the machine reads.
 */
const makeDirArgv = (env: Env): string[] =>
  env.platform === 'win32'
    ? windowsHelper(env.root, '-MakeDir', env.tempDir)
    : ['sh', '-c', 'umask 077 && mkdir -p "$1"', 'sh', env.tempDir]

/**
 * What removes one of the mod's old session folders. On Windows the helper
 * checks the folder is one of the mod's own before it deletes anything.
 */
export function removeArgv(env: Pick<Env, 'platform' | 'root'>, folder: string): string[] {
  return env.platform === 'win32' ? windowsHelper(env.root, '-RemoveDir', folder) : ['rm', '-rf', '--', folder]
}

async function run($: RunProcess, argv: readonly string[], stdin?: string): Promise<string | undefined> {
  const ran = await $(argv, stdin === undefined ? { timeoutMs: TIMEOUT_MS } : { timeoutMs: TIMEOUT_MS, stdin })

  return ran.exitCode === 0 ? ran.stdout : undefined
}

/** What a helper is handed: the image, where its files go, and the box they fit. */
type Making = {
  $: RunProcess
  env: Env
  req: ThumbRequest
  /** Each helper fits the picture to the box, in square pixels, and then writes `across` pixels for each one across. */
  box: Box
  bmpPath: string
  pngPath: string
}

/** The files a helper wrote, for an image of this size. */
function filesOf({ req, bmpPath, pngPath }: Making, width: number, height: number): ThumbFiles {
  return req.png ? { width, height, bmpPath, pngPath } : { width, height, bmpPath }
}

/** Writes the PNG thumbnail with `argv`, where one is wanted; false when that failed. */
async function hasPreview({ $, req }: Making, argv: readonly string[]): Promise<boolean> {
  return !req.png || (await run($, argv)) !== undefined
}

async function byPowershell(making: Making): Promise<ThumbFiles | undefined> {
  const { $, env, req, box } = making
  const room = ['-Width', String(box.width), '-Height', String(box.height), '-Across', String(box.across)]
  const full = req.six ? ['-SixId', req.six.id, '-SixW', String(req.six.width), '-SixH', String(req.six.height)] : []
  const png = ['-Png', req.png ? '1' : '0']
  const out = await run(
    $,
    windowsHelper(env.root, '-Src', req.src, '-OutDir', env.tempDir, '-Id', req.id, ...room, ...full, ...png),
  )
  if (out === undefined) return undefined
  const size = JSON.parse(out) as { w: number; h: number; sw?: number; sh?: number }
  const made = filesOf(making, size.w, size.h)

  return size.sw !== undefined && size.sh !== undefined ? { ...made, six: { width: size.sw, height: size.sh } } : made
}

async function bySips(making: Making): Promise<ThumbFiles | undefined> {
  const { $, env, req, box, bmpPath, pngPath } = making
  const info = await run($, ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', req.src])
  const width = Number(/pixelWidth:\s*(\d+)/.exec(info ?? '')?.[1])
  const height = Number(/pixelHeight:\s*(\d+)/.exec(info ?? '')?.[1])
  if (!(width > 0 && height > 0)) return undefined

  const fit = fitBox(width, height, box)
  await run($, makeDirArgv(env))
  const small = ['sips', '-s', 'format', 'bmp', '-z', String(fit.pxH), String(fit.pxW), req.src, '--out', bmpPath]
  if ((await run($, small)) === undefined) return undefined
  const preview = ['sips', '-s', 'format', 'png', '-Z', '480', req.src, '--out', pngPath]

  return (await hasPreview(making, preview)) ? filesOf(making, width, height) : undefined
}

async function byMagick(making: Making): Promise<ThumbFiles | undefined> {
  const { $, env, req, box, bmpPath, pngPath } = making
  // The reader is named, and `[0]` takes the first frame of an animation.
  const first = `${MAGICK_READERS[extension(req.src)]}:${req.src}[0]`
  await run($, makeDirArgv(env))
  const out = await run($, [
    'magick',
    first,
    '-auto-orient',
    '-format',
    '%w %h',
    '-write',
    'info:',
    '-background',
    'gray50',
    '-alpha',
    'remove',
    '-thumbnail',
    `${box.width}x${box.height}>`,
    ...(box.across === 2 ? ['-resize', '200x100%'] : []),
    '-type',
    'TrueColor',
    `BMP3:${bmpPath}`,
  ])
  if (out === undefined) return undefined
  const preview = ['magick', first, '-auto-orient', '-thumbnail', '480x480>', `PNG:${pngPath}`]
  if (!(await hasPreview(making, preview))) return undefined
  const [width, height] = out.trim().split(/\s+/).map(Number)

  return filesOf(making, width || 0, height || 0)
}

async function byFfmpeg(making: Making): Promise<ThumbFiles | undefined> {
  const { $, env, req, box, bmpPath, pngPath } = making
  // The input format is named: ffmpeg would otherwise follow a playlist
  // that is only named like an image. AVIF is a container, the rest are
  // single pictures.
  const format = extension(req.src) === 'avif' ? 'mov' : 'image2'
  const base = ['ffmpeg', '-v', 'error', '-y', '-f', format, '-i', req.src, '-frames:v', '1', '-update', '1']
  const widen = box.across === 2 ? ',scale=iw*2:ih' : ''
  const fit = `scale='min(${box.width},iw)':'min(${box.height},ih)':force_original_aspect_ratio=decrease${widen}`
  await run($, makeDirArgv(env))
  if ((await run($, [...base, '-vf', fit, '-pix_fmt', 'bgr24', bmpPath])) === undefined) return undefined
  const preview = [...base, '-vf', "scale='min(480,iw)':-2", pngPath]

  // ffmpeg does not say how large the image was.
  return (await hasPreview(making, preview)) ? filesOf(making, 0, 0) : undefined
}

/** An SVG is drawn to a PNG first, and the thumbnail made of that. */
async function byRsvg({ $, env, req }: Making): Promise<ThumbFiles | undefined> {
  const drawn = join(env, env.tempDir, `${req.id}.svg.png`)
  await run($, makeDirArgv(env))
  if ((await run($, ['rsvg-convert', '-w', '480', '-o', drawn, req.src])) === undefined) return undefined

  return make($, env, { ...req, src: drawn })
}

const MAKERS: Record<Helper, (making: Making) => Promise<ThumbFiles | undefined>> = {
  powershell: byPowershell,
  sips: bySips,
  magick: byMagick,
  ffmpeg: byFfmpeg,
  rsvg: byRsvg,
}

async function make($: RunProcess, env: Env, req: ThumbRequest): Promise<ThumbFiles | undefined> {
  const helper = helperFor(env, req.src)
  if (helper === undefined) return undefined

  return MAKERS[helper]({
    $,
    env,
    req,
    box: boxFor(req.blocks ?? 'quarter', req.columns, req.rows),
    bmpPath: join(env, env.tempDir, `${req.id}.bmp`),
    pngPath: join(env, env.tempDir, `${req.id}.png`),
  })
}

/**
 * Writes the thumbnail files of one image and answers where; undefined when
 * no program here reads it, the file is not an image, or the helper ran out
 * of time. Never throws.
 */
export async function makeThumb($: RunProcess, env: Env, req: ThumbRequest): Promise<ThumbFiles | undefined> {
  try {
    return await make($, env, req)
  } catch {
    return undefined
  }
}

/** Writes base64 bytes to a file, which `$.fs.write` cannot. Never throws. */
export async function saveBase64($: RunProcess, env: Env, base64: string, destPath: string): Promise<boolean> {
  try {
    const argv =
      env.platform === 'win32'
        ? windowsHelper(env.root, '-FromStdin', destPath)
        : // `-D` is the flag every macOS takes; an older one has no `-d`.
          ['sh', '-c', `umask 077 && mkdir -p "$(dirname "$1")" && base64 ${env.platform === 'darwin' ? '-D' : '-d'} > "$1"`, 'sh', destPath]

    return (await run($, argv, base64)) !== undefined
  } catch {
    return false
  }
}

async function answers($: RunProcess, argv: readonly string[]): Promise<string | undefined> {
  try {
    return await run($, argv)
  } catch {
    return undefined
  }
}

/** The system this is: Windows by the look of the mod's own path, the others by `uname`. */
async function platformOf($: RunProcess, isWindows: boolean): Promise<Platform> {
  if (isWindows) return 'win32'

  return (await answers($, ['uname', '-s']))?.trim() === 'Darwin' ? 'darwin' : 'linux'
}

/** The environment variables that name the temp folder, as the engine read them. */
export type TempVars = { TEMP?: string; TMP?: string; TMPDIR?: string }

/**
 * What this machine is and has, asked once a session. Never throws.
 *
 * The temp folder is taken from the environment first: a path printed by a
 * Windows console program loses the letters its code page lacks (`ğ` comes
 * back as `g`), and the folder would be the wrong one.
 */
export async function detectEnv(
  $: RunProcess,
  root: string,
  sessionFolder: string,
  vars: TempVars = {},
): Promise<Env> {
  const isWindows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\')
  const platform = await platformOf($, isWindows)

  const named = isWindows ? (vars.TEMP ?? vars.TMP) : vars.TMPDIR
  const asked =
    named ??
    (isWindows
      ? await answers($, [...POWERSHELL, '-Command', '[System.IO.Path]::GetTempPath()'])
      : // With no TMPDIR (most of Linux) the folder is the person's own cache
        // folder, not /tmp: any user of the machine can write there, and could
        // put a link in the place of the mod's folder.
        await answers($, ['sh', '-c', 'printf %s "${TMPDIR:-${XDG_CACHE_HOME:-$HOME/.cache}}"']))
  // Where nothing answered, nothing can be made either: the folder is nowhere,
  // and not a temp folder that every user of the machine shares.
  const tempRoot = trimEnd(asked?.trim() || (isWindows ? 'NUL' : '/dev/null'), String.raw`\/`)

  const has = async (tool: string) =>
    (await answers($, isWindows ? ['where.exe', tool] : ['sh', '-c', 'command -v "$1"', 'sh', tool])) !== undefined

  return {
    platform,
    root,
    tempDir: join({ platform }, tempRoot, 'cc-img', sessionFolder),
    tools: { ffmpeg: await has('ffmpeg'), magick: await has('magick'), rsvg: await has('rsvg-convert') },
  }
}
