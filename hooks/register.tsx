// cc-img: a thumbnail in the transcript for every image Claude touches, and a
// click that opens it in the system's default app.
//
// This file is wiring only. A tool call is answered first and untouched; what
// images it touched is worked out afterwards, off a queue a timer drains, so
// no call waits on a thumbnail and none fails because of one.
import { atom, memberOf, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Mode, Pending, Recent, RowThumbs, Thumb } from '../types'

import { collect, MAX_PER_CALL } from './collect'
import type { Candidate } from './collect'
import { pictureId, Thumbnail } from './draw'
import { canOpen, openerArgv, POWERSHELL } from './open'
import { baseName, isImagePath } from './paths'
import { MAX_COLUMNS, MIN_COLUMNS, MIN_ROWS } from './pixels'
import type { Blocks } from './pixels'
import { addPending, addToRecent, addToRow, staleFolders, waitingFor, withoutPicture } from './store'
import { detectEnv, removeArgv, TIMEOUT_MS } from './thumb'
import type { Env } from './thumb'
import { readMedia, thumbFor } from './work'
import type { Deps } from './work'

const DRAIN_EVERY_MS = 150
/** A 1 by 1 PNG: the picture the pixel test draws. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PROBE_KEY = 'probe'
/** The row is not yet on screen for the first few sends: that many are retried. */
const MAX_PROBE_TRIES = 15
/** How many message rows are remembered as already on screen. */
const KEEP_SEEN = 200
/** The id a message row is drawn under before the engine has given it one. */
const UNNAMED_ROW = 'placeholder'
/** The cells of a row's width that its own indent may take. */
const ROW_INDENT = 4
/** The rows of the terminal left for the prompt and the lines around a picture. */
const ROWS_KEPT = 6
/** The keys the chosen blocks and size are kept under, between sessions. */
const BLOCKS_KEY = 'blocks'
const COLUMNS_KEY = 'columns'
const PIXELS_KEY = 'pixels'
const CELL_KEY = 'cell'
const ITERM_TOLD_KEY = 'itermTold'
/** The widest a person may ask thumbnails to be, in cells. */
const WIDEST = 160
const SIZE_HELP = `Give a width in columns, from ${MIN_COLUMNS} to ${WIDEST}: /img size 40`
const CELL_HELP = 'Give the size of one terminal cell, width x height: /img cell 7x17. To start with it is 1x2.'

// Change a tag when the value's fields change: it declines what an earlier
// version of the mod stored, which outlives a reload.
const NO_IMAGES: RowThumbs = { images: [] }
const NO_RECENT: Recent = []
const NO_PENDING: Pending[] = []
const rows = atom({ plugin: 'cc-img', key: 'rows' } as const, NO_IMAGES, { shape: 'rows-1' })
const recentList = atom({ plugin: 'cc-img', key: 'recent' } as const, NO_RECENT, { shape: 'recent-1' })
const drawMode = atom({ plugin: 'cc-img', key: 'mode' } as const, 'block' as Mode, { shape: 'mode-1' })
const pendingList = atom({ plugin: 'cc-img', key: 'pending' } as const, NO_PENDING, { shape: 'pending-1' })

/** A finished tool call whose images are still to be made into thumbnails. */
type Job = { rowId: string; tool: string; candidates: Candidate[] }
/** A sent prompt whose pasted images are still to be made into thumbnails. */
type Paste = { text: string; media: { base64: string; mediaType: string; name: string }[]; notFor: string[] }
/** A message row that drew a waiting paste, and so is the row it belongs to. */
type Claim = { requestId: string; text: string }

// The module's own: they start over at a reload, as the session's start runs again.
let cwd = ''
let env: Promise<Env> | undefined
let isDraining = false
let made = 0
// Whether this terminal draws pixels is not something a mod can ask. It draws
// one tiny picture beside the session's first thumbnail and sends it again:
// a terminal that showed only the picture's alt text refuses the second send.
let probe: { requestId: string; tries: number } | 'done' | undefined
// How many cells across and down a picture has to draw in, as the last row
// drawn saw it; unknown until a row is drawn on a terminal that has been measured.
let room = Infinity
let roomDown = Infinity
// Octant blocks hold twice the pixels of quarter blocks, in a font that has
// them. A mod cannot ask the font, so the person says: `/img fine`.
let blocks: Blocks = 'quarter'
// The most cells across a thumbnail is made, as the person chose: `/img size 40`.
// It is at most half as many cells down, which on screen is about a square.
let widest = MAX_COLUMNS
// Windows Terminal draws real pictures as Sixel, which Claude Code gives a
// mod no way to send. There the mod only marks the rows a picture takes, and
// a painter it starts once (helpers/sixel.cs) draws the picture over them.
// Whose screen it paints on: Claude Code's own, in Windows Terminal itself;
// the herdr window's, inside herdr, which passes no Sixel on but whose own
// screen is Windows Terminal's (the painter checks that). Undefined where
// nothing can: tmux, or no Windows Terminal at all.
let sixelHost: 'claude' | 'herdr' | undefined
// Whether the person wants real pictures, the painter's or the terminal's own:
// `/img pixels off` says no. Not until the session's start has said which
// terminal this is: a row drawn before that sends no picture.
let wantsPixels = false
// iTerm2 asks the person before it shows each picture, in a dialog that holds
// the session until it is answered. The person is told so once, and how to
// stop it.
let isITerm = false
// How many times as tall as wide a cell of this terminal is. A mod cannot ask
// the terminal, so the person says: `/img cell 7x17`.
let cellRatio = 2
// The person's home folder, which `~/` in a command stands for.
let home: string | undefined
// The painter, asked for once a session; and whether it started.
let painter: Promise<boolean> | undefined
let isPainting = false
// Tells this session's full-size pictures from those of every other session.
let stamp = ''
const queue: Job[] = []
const pastes: Paste[] = []
const claims: Claim[] = []
const seenRows: string[] = []

const depsOf = ($: EngineInterface): Deps => ({
  run: (argv, init) => $.process.run(argv, init),
  stat: path =>
    // `resolve` says where a link lands, so one that leads to a program is told apart.
    $.fs.stat(path, { resolve: true }).then(
      stat => stat,
      () => undefined,
    ),
  readBase64: path =>
    $.fs.read(path, { as: 'bytes' }).then(
      bytes => bytes.base64,
      () => undefined,
    ),
})

/** Notes the room a row is drawn in, and answers it. */
function roomOf(e: { viewport?: { columns: number; rows: number } }): number {
  if (e.viewport !== undefined) {
    room = e.viewport.columns - ROW_INDENT
    roomDown = e.viewport.rows - ROWS_KEPT
  }

  return room
}

/** The cell shape `7x17` names, as height over width; undefined for what names none a terminal has. */
function ratioOf(value: unknown): number | undefined {
  const sizes = typeof value === 'string' ? /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(value) : null
  const ratio = sizes ? Number(sizes[2]) / Number(sizes[1]) : NaN

  return ratio >= 1 && ratio <= 4 ? ratio : undefined
}

/** Whether this is a width a person may ask for. */
const isWidth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= MIN_COLUMNS && value <= WIDEST

/** How a thumbnail is made now: the size chosen, or the terminal where that is smaller, in the blocks chosen. */
const sizeToMake = () => ({
  columns: Math.max(MIN_COLUMNS, Math.min(widest, room)),
  rows: Math.max(Math.min(MIN_ROWS, Math.round(widest / 2)), Math.min(Math.round(widest / 2), roomDown)),
  blocks,
  cellRatio,
})

/** Starts the Sixel painter for this session, on `host`'s screen; whether it started. */
async function startPainter($: EngineInterface, machine: Env, host: 'claude' | 'herdr'): Promise<boolean> {
  // It reads every session's pictures from the folder that holds their folders.
  const home = machine.tempDir.slice(0, machine.tempDir.lastIndexOf('\\'))
  const argv = [...POWERSHELL, '-File', `${machine.root}\\helpers\\sixel.ps1`, '-Start', '-Dir', home, '-Screen', host]
  const ran = await $.process.run(argv, { timeoutMs: TIMEOUT_MS }).catch(() => undefined)
  isPainting = ran?.exitCode === 0
  // Rows already drawn in blocks are drawn again as the painter's.
  if (isPainting) $.ui.invalidate('ui.render')
  // Said once a session: the start is asked for once, and its answer kept.
  else {
    $.ui.toast(
      `cc-img: real pictures could not start here, so images are drawn in block characters. Why: ${home}\\sixel.log`,
    )
  }

  return isPainting
}

/** Whether pictures are the painter's to draw now; it is started the first time they are. */
async function painting($: EngineInterface, machine: Env): Promise<boolean> {
  if (!wantsPixels || sixelHost === undefined || machine.platform !== 'win32') return false
  painter ??= startPainter($, machine, sixelHost)

  return painter
}

/** What this machine is and has, asked once; and the old temp folders cleared. */
async function setUp($: EngineInterface): Promise<Env> {
  const { run } = depsOf($)
  const now = await $.clock.now()
  const found = await detectEnv(run, $.plugin.root, `s${now}`, {
    TEMP: await $.env.get('TEMP').catch(() => undefined),
    TMP: await $.env.get('TMP').catch(() => undefined),
    TMPDIR: await $.env.get('TMPDIR').catch(() => undefined),
  })

  // Only folders this mod made, named `s<start time>`, under its own temp folder.
  try {
    const separator = found.platform === 'win32' ? '\\' : '/'
    const home = found.tempDir.slice(0, found.tempDir.lastIndexOf(separator))
    const names = (await $.fs.list(home)).map(entry => entry.name)
    for (const name of staleFolders(names, now)) {
      await run(removeArgv(found, `${home}${separator}${name}`), { timeoutMs: TIMEOUT_MS })
    }
  } catch {
    // nothing to clear, or it would not clear: both are fine
  }

  return found
}

/** Notes an image as the newest, and lets go of the pictures past the newest forty. */
async function remember($: EngineInterface, rowId: string, openPath: string): Promise<void> {
  let dropped: Recent = []

  await update($, recentList, recent => {
    const next = addToRecent(recent, { rowId, openPath })
    dropped = next.dropped

    return next.recent
  })
  for (const one of dropped) {
    await update($, memberOf(rows, { requestId: one.rowId }), row => withoutPicture(row, one.openPath))
  }
}

/** A finished call's images become thumbnails under its row. */
async function workJob($: EngineInterface, machine: Env, job: Job, png: boolean): Promise<void> {
  let shown = 0

  for (const candidate of job.candidates) {
    const id = `t${++made}`
    const six = (await painting($, machine)) ? { six: pictureId(`${stamp}:${made}`) } : {}
    const options = { id, tool: job.tool, png, ...sizeToMake(), ...six }
    const thumb = await thumbFor(depsOf($), machine, candidate, options)
    if (!thumb) continue
    await update($, memberOf(rows, { requestId: job.rowId }), row => addToRow(row, thumb))
    await remember($, job.rowId, thumb.openPath)
    // Counted here, after the files a command only named have fallen away.
    if (++shown >= MAX_PER_CALL) break
  }
}

/** A prompt's pasted images become thumbnails that wait for its message row. */
async function workPaste($: EngineInterface, machine: Env, paste: Paste, png: boolean): Promise<void> {
  const images: Thumb[] = []

  for (const media of paste.media) {
    const candidate: Candidate = { kind: 'bytes', base64: media.base64, mediaType: media.mediaType }
    const id = `t${++made}`
    const six = (await painting($, machine)) ? { six: pictureId(`${stamp}:${made}`) } : {}
    const options = { id, tool: media.name, png, ...sizeToMake(), ...six }
    const thumb = await thumbFor(depsOf($), machine, candidate, options)
    if (thumb) images.push(thumb)
  }
  if (images.length === 0) return

  await update($, pendingList, list => addPending(list, { text: paste.text, images, notFor: paste.notFor }))
  for (const thumb of images) await remember($, UNNAMED_ROW, thumb.openPath)
}

/** The waiting images of a prompt become those of the row that drew them. */
async function workClaim($: EngineInterface, claim: Claim): Promise<void> {
  const entry = waitingFor(await read($, pendingList), claim.text, claim.requestId)
  if (!entry) return

  const paths = entry.images.map(one => one.openPath)
  await update($, memberOf(rows, { requestId: claim.requestId }), () => ({ images: entry.images }))
  await update($, pendingList, list =>
    list.filter(one => !(one.text === entry.text && one.images[0]?.openPath === paths[0])),
  )
  await update($, recentList, recent =>
    recent.map(one => (paths.includes(one.openPath) ? { ...one, rowId: claim.requestId } : one)),
  )
}

/** One send of the pixel test; a terminal that takes it is drawn in pixels from then on. */
async function workProbe($: EngineInterface, target: { requestId: string; tries: number }): Promise<void> {
  target.tries++
  const sent = await $.ui.blit({
    requestId: target.requestId,
    key: PROBE_KEY,
    source: { png: PROBE_PNG },
    columns: 1,
    rows: 1,
  })

  if (sent.deny === undefined) {
    probe = 'done'
    await update($, drawMode, () => 'pixel' as Mode)
  } else if (!/mount/i.test(sent.deny) || target.tries >= MAX_PROBE_TRIES) {
    probe = 'done'
  }
}

/** One piece of queued work a tick, and one send of the pixel test while it runs. */
async function drain($: EngineInterface): Promise<void> {
  if (isDraining || env === undefined) return
  const isProbing = wantsPixels && probe !== undefined && probe !== 'done'
  if (!isProbing && queue.length + pastes.length + claims.length === 0) return

  isDraining = true
  try {
    if (wantsPixels && probe !== undefined && probe !== 'done') await workProbe($, probe).catch(() => (probe = 'done'))

    const claim = claims.shift()
    if (claim) {
      await workClaim($, claim)

      return
    }

    const machine = await env
    const png = wantsPixels && (await read($, drawMode)) === 'pixel'
    const paste = pastes.shift()
    if (paste) {
      await workPaste($, machine, paste, png)

      return
    }

    const job = queue.shift()
    if (job) await workJob($, machine, job, png)
  } catch {
    // work that fails is dropped: the row draws as the engine drew it
  } finally {
    isDraining = false
  }
}

/** Opens one image in the default app; says why when it cannot. */
async function openImage($: EngineInterface, path: string): Promise<boolean> {
  const recorded = new Set((await read($, recentList)).map(one => one.openPath))
  if (!canOpen(path, recorded) || env === undefined) {
    $.ui.toast(`${baseName(path)} cannot be opened from here any more.`)

    return false
  }
  if (!(await $.fs.exists(path).catch(() => false))) {
    $.ui.toast(`${baseName(path)} is no longer there.`)

    return false
  }
  // The file may have been swapped since its thumbnail was made: a link that
  // now leads to a program is not opened.
  const landed = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (landed?.kind !== 'file' || (landed.realPath !== undefined && !isImagePath(landed.realPath))) {
    $.ui.toast(`${baseName(path)} is no longer an image.`)

    return false
  }

  const machine = await env
  await $.process
    .run(openerArgv(machine.platform, path, machine.root), { timeoutMs: TIMEOUT_MS })
    .catch(() => undefined)

  return true
}

/** The images kept under these rows, in order. */
async function imagesOf($: EngineInterface, rowIds: readonly string[]): Promise<Thumb[]> {
  const images: Thumb[] = []
  for (const id of rowIds) images.push(...(await read($, memberOf(rows, { requestId: id }))).images)

  return images
}

/** The engine's row with these images under it. */
async function drawUnder(
  $: EngineInterface,
  e: { surface: string; requestId: string; viewport?: { columns: number; rows: number } },
  row: RenderElement,
  images: readonly Thumb[],
): Promise<RenderElement> {
  // Noted for every row, pictures or none: the next thumbnail is made to fit it.
  const across = roomOf(e)
  if (images.length === 0) return row

  const mode = wantsPixels ? await read($, drawMode) : 'block'
  const els = $.ui.resolve(e as never) as Elements['terminal']
  const { Box, Image } = els

  // Pictures an earlier load of the mod made for the painter: it is started
  // for them too, and the rows are drawn again once it runs.
  if (painter === undefined && env !== undefined && images.some(one => one.six !== undefined)) {
    void env.then(machine => painting($, machine)).catch(() => false)
  }
  const draw = isPainting && wantsPixels ? 'sixel' : mode

  // The pixel test rides on the first thumbnail a session draws, on its name's line.
  if (mode === 'pixel') probe = 'done'
  else if (probe === undefined && wantsPixels) probe = { requestId: e.requestId, tries: 0 }
  const test =
    wantsPixels && probe !== undefined && probe !== 'done' && probe.requestId === e.requestId ? (
      <Image key={PROBE_KEY} source={{ png: PROBE_PNG }} columns={1} rows={1} alt=" " />
    ) : undefined

  return (
    <Box flexDirection="column">
      {row}
      {images.map((thumb, index) =>
        Thumbnail(els, thumb, index, draw, () => void openImage($, thumb.openPath), index === 0 ? test : undefined, across),
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    cwd = e.cwd
    env = setUp($)
    blocks = (await $.store.get(BLOCKS_KEY).catch(() => undefined)) === 'octant' ? 'octant' : 'quarter'
    const kept = await $.store.get(COLUMNS_KEY).catch(() => undefined)
    widest = isWidth(kept) ? kept : MAX_COLUMNS
    const pixels = await $.store.get(PIXELS_KEY).catch(() => undefined)
    // tmux inside iTerm2 names itself in TERM_PROGRAM; LC_TERMINAL still says iTerm2.
    isITerm =
      (await $.env.get('TERM_PROGRAM').catch(() => undefined)) === 'iTerm.app' ||
      (await $.env.get('LC_TERMINAL').catch(() => undefined)) === 'iTerm2'
    wantsPixels = pixels !== 'off'
    cellRatio = ratioOf(await $.store.get(CELL_KEY).catch(() => undefined)) ?? 2
    if (isITerm && wantsPixels && (await $.store.get(ITERM_TOLD_KEY).catch(() => undefined)) !== true) {
      await $.store.set(ITERM_TOLD_KEY, true).catch(() => undefined)
      $.ui.toast('iTerm2 asks before it shows each picture: tick "Remember my choice", then Yes. Or: /img pixels off')
    }
    home = (await $.env.get('HOME').catch(() => undefined)) || undefined
    // Rows drawn before this was known were drawn in blocks.
    if (wantsPixels) $.ui.invalidate('ui.render')
    // herdr and tmux sit between Claude Code and the terminal, and pass no Sixel on.
    const windowsTerminal = await $.env.get('WT_SESSION').catch(() => undefined)
    const herdr = await $.env.get('HERDR_ENV').catch(() => undefined)
    const tmux = await $.env.get('TMUX').catch(() => undefined)
    sixelHost = tmux ? undefined : herdr ? 'herdr' : windowsTerminal ? 'claude' : undefined
    stamp = Math.floor((await $.clock.now().catch(() => 0)) / 1000).toString(36)
    await $.command.register({
      name: 'img',
      description:
        'Open the latest image (/img 2: the one before; /img fine or coarse: sharper or plainer thumbnails; /img size 40: their width; /img pixels on or off: real pictures; /img cell 7x17: the size of a terminal cell)',
    })
    $.clock.every(DRAIN_EVERY_MS, () => void drain($))

    return started
  })

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now().catch(() => 0)
    const ran = await next(e)

    try {
      // A subagent's calls draw no row here.
      if (ran.deny === undefined && ran.isError !== true && e.agentId === undefined) {
        const { tool, tool_use_id: rowId, ...input } = e
        const call = { tool, input, cwd, startedAt, ...(home === undefined ? {} : { home }) }
        const candidates = collect(call, { result: ran.result, text: ran.text })
        if (candidates.length > 0) queue.push({ rowId, tool, candidates })
      }
    } catch {
      // the call's own answer goes back whatever happened here
    }

    return ran
  })

  // A pasted image can only be read while its prompt is being sent.
  on('prompt.submit', async ($, e, next) => {
    const media: Paste['media'] = []

    try {
      for (const item of e.attachments ?? []) {
        if (item.type !== 'image' || item.id === undefined) continue
        const image = await readMedia(args => $.prompt.media(args), item.id)
        if (image) media.push({ ...image, name: (item.filename ?? 'pasted').replace(/\.[A-Za-z0-9]+$/, '') })
      }
    } catch {
      // the prompt goes on whatever happened here
    }

    // Taken before the prompt goes on: once it has, its own row may already
    // be on screen, and would be counted among the rows that came before it.
    const notFor = [...seenRows]
    const sent = await next(e)
    if (media.length > 0 && sent.text !== undefined) pastes.push({ text: sent.text, media, notFor })

    return sent
  })

  on('command.run', { command: 'img' }, async ($, e) => {
    const recent = await read($, recentList)
    // A bare `/img` may come with no args at all.
    const asked = (e.args ?? '').trim()
    if (asked === 'fine' || asked === 'coarse') {
      blocks = asked === 'fine' ? 'octant' : 'quarter'
      await $.store.set(BLOCKS_KEY, blocks).catch(() => undefined)
      $.ui.toast(
        asked === 'fine'
          ? 'Thumbnails from now on use octant blocks. If they show as boxes or question marks, your font lacks them: /img coarse.'
          : 'Thumbnails from now on use quarter blocks.',
      )

      return {}
    }
    if (asked === 'pixels on' || asked === 'pixels off') {
      wantsPixels = asked === 'pixels on'
      // A test picture not yet answered is sent again from the next thumbnail drawn.
      if (probe !== 'done') probe = undefined
      await $.store.set(PIXELS_KEY, wantsPixels ? 'on' : 'off').catch(() => undefined)
      $.ui.invalidate('ui.render')
      $.ui.toast(
        wantsPixels
          ? isITerm
            ? 'Real pictures are on. iTerm2 asks before each one: tick "Remember my choice", then Yes.'
            : 'Images are drawn as real pictures again, where the terminal can.'
          : 'Images are drawn in block characters, in every terminal.',
      )

      return {}
    }
    if (asked.split(/\s+/)[0] === 'size') {
      const width = Number(asked.split(/\s+/)[1])
      if (!isWidth(width)) $.ui.toast(SIZE_HELP)
      else {
        widest = width
        await $.store.set(COLUMNS_KEY, width).catch(() => undefined)
        $.ui.toast(`Thumbnails from now on are at most ${width} columns wide and ${Math.round(width / 2)} rows tall.`)
      }

      return {}
    }
    if (asked.split(/\s+/)[0] === 'cell') {
      const shape = asked.split(/\s+/)[1]
      const ratio = ratioOf(shape)
      if (ratio === undefined) $.ui.toast(CELL_HELP)
      else {
        cellRatio = ratio
        await $.store.set(CELL_KEY, shape).catch(() => undefined)
        $.ui.toast(`Thumbnails from now on are made for a cell of ${shape}.`)
      }

      return {}
    }
    const back = asked === '' ? 1 : Number(asked)
    const entry = Number.isInteger(back) && back >= 1 ? recent[recent.length - back] : undefined
    // The answer carries no text: a command's text is kept in what Claude
    // reads, and nothing of this mod is to reach Claude. The person is told
    // by a toast instead.
    if (!entry) $.ui.toast('No such image.')
    else if (await openImage($, entry.openPath)) $.ui.toast(`Opened ${baseName(entry.openPath)}.`)

    return {}
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') return row

    return drawUnder($, e, row, await imagesOf($, [e.props.tool_use_id]))
  })

  // A call folded into a count line ("Read 3 files") has no row of its own.
  // Shown unfolded, each call is a ToolUse row and draws there instead.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isExpanded) return row
    const ids = e.props.calls.flatMap(call => (call.tool_use_id === undefined ? [] : [call.tool_use_id]))

    return drawUnder($, e, row, await imagesOf($, ids))
  })

  // A message row and the prompt it shows share no id, only their text. So a
  // prompt's images wait under that text, and the first row to show it that
  // was not on screen before the prompt was sent is the row they belong to.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') return row
    roomOf(e)

    const own = await imagesOf($, [e.requestId])
    if (own.length > 0) return drawUnder($, e, row, own)

    const waiting = waitingFor(await read($, pendingList), e.props.text, e.requestId)
    if (e.requestId !== UNNAMED_ROW) {
      if (!waiting) {
        if (!seenRows.includes(e.requestId)) seenRows.push(e.requestId)
        if (seenRows.length > KEEP_SEEN) seenRows.shift()
      } else if (!claims.some(one => one.requestId === e.requestId)) {
        // State cannot be written while a row is drawn: the timer does it.
        claims.push({ requestId: e.requestId, text: e.props.text })
      }
    }

    return waiting ? drawUnder($, e, row, waiting.images) : row
  })
}
