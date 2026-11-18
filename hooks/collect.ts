// What images one finished tool call touched: files to look at, and pictures
// that came back in its result. Pure: whether a file exists and when it
// changed is the caller's to check.
import { isImagePath, resolvePath, scanImagePaths } from './paths'

export type Candidate =
  /** An absolute path. `newerThan` set: keep it only if it changed since, in ms. */
  | { kind: 'file'; path: string; newerThan?: number }
  | { kind: 'bytes'; base64: string; mediaType: string }

/** How many images are shown for one call. */
export const MAX_PER_CALL = 4
/**
 * How many are offered for one call. More than are shown: most paths a
 * command names are files it only read, and the one it wrote may come last.
 */
export const MAX_CANDIDATES = 16
const MAX_DEPTH = 6
/** `\\host\share\a.png`, or `//cdn.example.com/a.png` out of a web page. */
const NETWORK_PATH = /^(\\\\|\/\/)/
/** A file's modified time may trail the clock a little. */
const SLACK_MS = 2000
/** Tools whose own target is the only file they touch. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit'])

/** `home`: the person's home folder, which `~/` in a path stands for. */
type Call = { tool: string; input: unknown; cwd: string; startedAt: number; home?: string }
type Ran = { result?: unknown; text?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Every string held in `value`, to a fixed depth. */
function strings(value: unknown, out: string[] = [], depth = 0, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') out.push(value)
  else if (isRecord(value) && depth < MAX_DEPTH && !seen.has(value)) {
    seen.add(value)
    for (const one of Object.values(value)) strings(one, out, depth + 1, seen)
  }

  return out
}

/** The picture an image block carries, in any of the shapes a tool answers with. */
function imageOf(block: Record<string, unknown>): Candidate | undefined {
  if (block.type !== 'image') return undefined

  // An MCP block.
  if (typeof block.data === 'string' && typeof block.mimeType === 'string')
    return { kind: 'bytes', base64: block.data, mediaType: block.mimeType }
  // A block as the model reads it.
  const source = block.source
  if (isRecord(source) && typeof source.data === 'string' && typeof source.media_type === 'string')
    return { kind: 'bytes', base64: source.data, mediaType: source.media_type }
  // A file tool's record.
  const file = block.file
  if (isRecord(file) && typeof file.base64 === 'string' && typeof file.type === 'string')
    return { kind: 'bytes', base64: file.base64, mediaType: file.type }

  return undefined
}

function images(value: unknown, out: Candidate[] = [], depth = 0, seen = new Set<unknown>()): Candidate[] {
  if (!isRecord(value) || depth > MAX_DEPTH || seen.has(value)) return out
  seen.add(value)

  const image = imageOf(value)
  if (image) out.push(image)
  else for (const one of Object.values(value)) images(one, out, depth + 1, seen)

  return out
}

/** The images a finished call may have touched: files to check, then pictures in its result. */
export function collect(call: Call, ran: Ran): Candidate[] {
  if (FILE_TOOLS.has(call.tool)) {
    const target = isRecord(call.input) ? call.input.file_path : undefined

    return typeof target === 'string' && isImagePath(target)
      ? [{ kind: 'file', path: resolvePath(target, call.cwd, call.home) }]
      : []
  }

  const found: Candidate[] = []
  const paths = new Set<string>()
  const newerThan = call.startedAt - SLACK_MS

  for (const text of [...strings(call.input), ran.text ?? '']) {
    // A Unix folder starts with `/`: there a command is read as a Unix shell reads it.
    for (const name of scanImagePaths(text, call.cwd.startsWith('/'))) {
      // Text is not to be trusted with where the machine looks: a network
      // path found in it would send this machine's sign-in to that host.
      if (NETWORK_PATH.test(name)) continue
      const path = resolvePath(name, call.cwd, call.home)
      if (paths.has(path)) continue
      paths.add(path)
      found.push({ kind: 'file', path, newerThan })
    }
  }
  found.push(...images(ran.result))

  return found.slice(0, MAX_CANDIDATES)
}
