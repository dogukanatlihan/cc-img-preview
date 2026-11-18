// One image candidate in, one thumbnail out. What it needs of the engine is
// handed in as plain functions, so it runs the same under a test.
import type { Thumb } from '../types'

import type { Candidate } from './collect'
import { baseName, isImagePath } from './paths'
import { boxFor, cellsOf, MAX_COLUMNS, MAX_ROWS, parseBmp } from './pixels'
import type { Blocks } from './pixels'
import { makeThumb, saveBase64 } from './thumb'
import type { Env, RunProcess } from './thumb'

export type Deps = {
  /** `$.process.run`. */
  run: RunProcess
  /** `$.fs.stat`; undefined where there is nothing. */
  stat: (path: string) => Promise<{ kind: string; mtimeMs: number; realPath?: string } | undefined>
  /** `$.fs.read(path, { as: 'bytes' })`; undefined where there is nothing. */
  readBase64: (path: string) => Promise<string | undefined>
}

export type ThumbOptions = {
  /** Names the files written for this image. */
  id: string
  /** The tool the image came from, which names a picture that has no file. */
  tool: string
  /** Whether a PNG thumbnail is wanted too (pixel mode). */
  png: boolean
  /** The most cells the thumbnail may take, across and down; the box's own limits when left out. */
  columns?: number
  rows?: number
  /** The blocks the picture is drawn in; quarter blocks when left out. */
  blocks?: Blocks
  /** Asks for a full-size picture for the Sixel painter too, kept under this name. */
  six?: string
}

/** The Sixel painter takes every cell for this many pixels, as Windows Terminal does. */
export const SIXEL_CELL = { width: 10, height: 20 }

/** A PNG an `Image` element takes: 2 MiB decoded, so this much base64. */
const MAX_PNG_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3)

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/tiff': 'tif',
}

const separator = (env: Env) => (env.platform === 'win32' ? '\\' : '/')

/** `mcp__claude-in-chrome__computer` reads as `computer`. */
const label = (tool: string) => tool.split('__').pop() || 'image'

async function build(deps: Deps, env: Env, candidate: Candidate, options: ThumbOptions): Promise<Thumb | undefined> {
  let openPath: string
  let name: string

  if (candidate.kind === 'file') {
    const stat = await deps.stat(candidate.path)
    if (stat?.kind !== 'file') return undefined
    // A link named like an image may lead to a program, which a click would start.
    if (stat.realPath !== undefined && !isImagePath(stat.realPath)) return undefined
    if (candidate.newerThan !== undefined && stat.mtimeMs < candidate.newerThan) return undefined
    openPath = candidate.path
    name = baseName(candidate.path)
  } else {
    const ext = EXTENSIONS[candidate.mediaType]
    if (ext === undefined) return undefined
    openPath = `${env.tempDir}${separator(env)}${options.id}.${ext}`
    if (!(await saveBase64(deps.run, env, candidate.base64, openPath))) return undefined
    name = `${label(options.tool)}.${ext}`
  }

  const captionOnly = (width = 0, height = 0): Thumb => ({ openPath, name, width, height, columns: 0, rows: 0 })

  const blocks = options.blocks ?? 'quarter'
  const files = await makeThumb(deps.run, env, {
    src: openPath,
    id: options.id,
    png: options.png,
    blocks,
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
    ...(options.six === undefined
      ? {}
      : {
          six: {
            id: options.six,
            width: (options.columns ?? MAX_COLUMNS) * SIXEL_CELL.width,
            height: (options.rows ?? MAX_ROWS) * SIXEL_CELL.height,
          },
        }),
  })
  if (!files) return captionOnly()

  const stored = await deps.readBase64(files.bmpPath)
  const image = stored === undefined ? undefined : parseBmp(Uint8Array.fromBase64(stored))
  if (!image) return captionOnly(files.width, files.height)

  const { down } = boxFor(blocks)
  const made = cellsOf(image.rgb, image.width, image.height, down)
  const thumb: Thumb = {
    openPath,
    name,
    width: files.width,
    height: files.height,
    columns: made.columns,
    rows: made.rows,
    down,
    cells: made.cells.toBase64(),
  }
  if (options.six !== undefined && files.six !== undefined) {
    thumb.six = {
      id: options.six,
      columns: Math.ceil(files.six.width / SIXEL_CELL.width),
      rows: Math.ceil(files.six.height / SIXEL_CELL.height),
    }
  }
  if (files.pngPath !== undefined) {
    const png = await deps.readBase64(files.pngPath)
    if (png !== undefined && png.length <= MAX_PNG_BASE64) thumb.png = png
  }

  return thumb
}

/**
 * The thumbnail of one candidate: undefined when there is no such image (no
 * file, not changed by the call, bytes that would not save); a thumbnail with
 * no picture when the image is there but nothing here can read it. Never throws.
 */
export async function thumbFor(
  deps: Deps,
  env: Env,
  candidate: Candidate,
  options: ThumbOptions,
): Promise<Thumb | undefined> {
  try {
    return await build(deps, env, candidate, options)
  } catch {
    return undefined
  }
}

/** What `$.prompt.media` answers, as far as this reads it. */
type MediaSlice = {
  type?: string
  mediaType?: string
  base64?: string
  next?: number
  unreadable?: string
  deny?: string
}

/** A pasted image is read 4 MiB a call; this many calls is far past any image. */
const MAX_SLICES = 16

/**
 * The whole of one pasted image, its slices joined; undefined when it is not
 * an image or cannot be read. `read` is `$.prompt.media`. Never throws.
 */
export async function readMedia(
  read: (args: { id: string; offset?: number }) => Promise<MediaSlice>,
  id: string,
): Promise<{ base64: string; mediaType: string } | undefined> {
  try {
    let base64 = ''
    let mediaType = ''
    let offset: number | undefined

    for (let calls = 0; calls < MAX_SLICES; calls++) {
      const slice = await read(offset === undefined ? { id } : { id, offset })
      if (slice.type !== 'image' || slice.base64 === undefined || slice.mediaType === undefined) return undefined
      base64 += slice.base64
      mediaType = slice.mediaType
      if (slice.next === undefined) return { base64, mediaType }
      offset = slice.next
    }

    return undefined
  } catch {
    return undefined
  }
}
