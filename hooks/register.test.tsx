import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

type TestEngine = Parameters<TestBody>[0]

const IMAGE = 'C:\\p\\a.png'
const NOW = 1_000_000_000

/** A 2x2 24-bit BMP: top row red, green; bottom row blue, white. */
function bmp2x2(): string {
  const bytes = new Uint8Array(54 + 16)
  const view = new DataView(bytes.buffer)
  bytes.set([0x42, 0x4d])
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, 2, true)
  view.setInt32(22, 2, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  bytes.set([255, 0, 0, 255, 255, 255], 54)
  bytes.set([0, 0, 255, 0, 255, 0], 62)

  return bytes.toBase64()
}

type World = {
  /** Whether the helper can read the image. */
  canRead?: boolean
  /** When the file on disk last changed. */
  mtimeMs?: number
  /** Whether the file is still there at the click. */
  exists?: boolean
  result?: unknown
  text?: string
  /** When one file last changed, where files differ. */
  mtimeOf?: (path: string) => number
  /** Where a path lands when it is a link; `asked` counts the looks at the file system. */
  realPathOf?: (path: string, asked: number) => string | undefined
  /** What the mod kept in an earlier session. */
  kept?: Record<string, unknown>
  /** The environment variables that are set. */
  env?: Record<string, string>
  /** What the Windows helper prints for an image it read. */
  helperOut?: string
  /** Whether the Sixel painter starts. */
  painterStarts?: boolean
}

/** Stands for the engine and the machine beneath the mod, whatever system the test runs on. */
function world(
  on: On,
  {
    canRead = true,
    mtimeMs = NOW,
    exists = true,
    result = {},
    text,
    mtimeOf,
    realPathOf,
    kept = {},
    env = {},
    helperOut = '{"w":320,"h":180}',
    painterStarts = true,
  }: World = {},
) {
  on('env.get', (_, e) => ({ value: env[e.name] }))
  const clock = mock.clock(on, { now: NOW })
  const runs: (readonly string[])[] = []
  const toasts: string[] = []
  const ids: string[] = []
  const store: Record<string, unknown> = { ...kept }

  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })

  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    ids.push(e.tool_use_id)

    return text === undefined ? { result } : { result, text }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  let asked = 0
  on('fs.stat', (_, e) => {
    const realPath = realPathOf?.(e.path, ++asked)

    return { value: { kind: 'file', size: 10, mtimeMs: mtimeOf?.(e.path) ?? mtimeMs, isLink: realPath !== undefined, realPath } } as never
  })
  on('fs.exists', () => ({ value: exists }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: { base64: bmp2x2() } }))
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    runs.push(e.argv)
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '' } }) as never

    if (line.includes('GetTempPath')) return answer(0, 'C:\\t\\')
    if (line.includes('TMPDIR')) return answer(0, '/t')
    if (e.argv[0] === 'uname') return answer(0, 'Linux')
    if (e.argv[0] === 'where.exe' || line.includes('command -v')) return answer(line.includes('magick') ? 0 : 1)
    if (line.includes('sixel.ps1')) return painterStarts ? answer(0, '{"ok":true,"pid":1,"console":2}') : answer(1)
    if (!canRead) return answer(1)
    if (line.includes('thumb.ps1') && line.includes('-Src')) return answer(0, helperOut)
    if (e.argv[0] === 'magick') return answer(0, '320 180')

    return answer(0)
  })

  const helperRuns = () => runs.filter(argv => argv.includes('-Src') || argv[0] === 'magick').length
  const opened = () => runs.filter(argv => argv.includes('-Open') || ['open', 'xdg-open'].includes(argv[0] ?? ''))
  /** The box the first thumbnail was asked for, as `<width>x<height>`, whichever helper made it. */
  const boxAsked = () => {
    const argv = runs.find(one => one.includes('-Src') || one[0] === 'magick') ?? []
    const named = argv.find(one => /^\d+x\d+>$/.test(one))?.slice(0, -1)

    return named ?? `${argv[argv.indexOf('-Width') + 1]}x${argv[argv.indexOf('-Height') + 1]}`
  }

  /** Whether the mod took this machine for Windows: only there is there a Sixel painter. */
  const onWindows = () => !runs.some(argv => argv[0] === 'uname')
  const painterStarted = () => runs.filter(argv => argv.includes('-Start')).length
  /** Whose screen the painter was asked to paint on: Claude Code's own, or the herdr window's. */
  const painterHost = () => {
    const argv = runs.find(one => one.includes('-Start')) ?? []

    return argv[argv.indexOf('-Screen') + 1]
  }

  return { clock, runs, toasts, ids, store, helperRuns, opened, boxAsked, onWindows, painterStarted, painterHost }
}

const start = { cwd: 'C:\\p', surface: 'terminal', isInteractive: true } as const

const toolUse = (id: string, surface: 'terminal' | 'desktop' = 'terminal') =>
  ({
    plugin: 'cc-img',
    component: 'ToolUse',
    requestId: id,
    surface,
    props: {
      tool_use_id: id,
      tool: 'Read',
      input: { file_path: IMAGE },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  }) as const

const CALL = { tool: 'Read', isRunning: false, isErrored: false, isInterrupted: false } as const

const toolGroup = (id: string, isExpanded: boolean) =>
  ({
    plugin: 'cc-img',
    component: 'ToolGroup',
    requestId: 'collapsed-1',
    surface: 'terminal',
    props: {
      calls: [
        { ...CALL, tool_use_id: 'other', input: { file_path: 'C:\\p\\a.cs' } },
        { ...CALL, tool_use_id: id, input: { file_path: IMAGE } },
      ],
      isActive: false,
      isExpanded,
    },
  }) as const

test('a tool call gets its own answer back, before any thumbnail work has run', async ($, on) => {
  const { helperRuns } = world(on, { result: { type: 'text', file: { content: 'x' } } })
  await $.session.start(start)

  const ran = await $.tool.call({ tool: 'Read', file_path: IMAGE })

  expect(ran.result).toEqual({ type: 'text', file: { content: 'x' } })
  expect(helperRuns()).toBe(0)
})

test('an image Claude read is drawn under its row: block rows, then its name and size', async ($, on) => {
  const { clock, ids, helperRuns } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolUse(ids[0]!))
  const row = await ui.find({ type: 'Button', key: 'img0-r0' })

  expect(helperRuns()).toBe(1)
  // The helper's 2 by 2 pixels are one cell: two pixels across, two down.
  expect(row?.text).toHaveLength(1)
  expect(row?.children).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /320x180/ })).toBeDefined()
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('file:///C:/p/a.png')
  await ui.unmount()
})

test('a click on the thumbnail opens the image in the default app', async ($, on) => {
  const { clock, ids, opened } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolUse(ids[0]!))
  await ui.press({ key: 'img0-r0' })

  expect(opened()).toHaveLength(1)
  expect(opened()[0]?.slice(-1)).toEqual([IMAGE])
  await ui.unmount()
})

test('a click on an image that has since been deleted opens nothing and says so', async ($, on) => {
  const { clock, ids, opened, toasts } = world(on, { exists: false })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolUse(ids[0]!))
  await ui.press({ key: 'img0-r0' })

  expect(opened()).toHaveLength(0)
  expect(toasts).toEqual(['a.png is no longer there.'])
  await ui.unmount()
})

test('an image the helper cannot read keeps its name and an open button, with no picture', async ($, on) => {
  const { clock, ids } = world(on, { canRead: false })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolUse(ids[0]!))

  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'img0-open' })).toBeDefined()
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  await ui.unmount()
})

test('a file a command only names, without changing it, gets no thumbnail', async ($, on) => {
  const { clock, ids, helperRuns } = world(on, { mtimeMs: NOW - 60_000, text: 'found a.png' })
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...toolUse(ids[0]!), props: { ...toolUse(ids[0]!).props, tool: 'Bash' } })

  expect(helperRuns()).toBe(0)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a file a command wrote gets a thumbnail', async ($, on) => {
  const { clock, ids } = world(on, { mtimeMs: NOW + 5, text: 'saved a.png' })
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'python plot.py' })
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...toolUse(ids[0]!), props: { ...toolUse(ids[0]!).props, tool: 'Bash' } })

  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeDefined()
  await ui.unmount()
})

test('a call folded into a group has its thumbnail under the count line', async ($, on) => {
  const { clock, ids } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolGroup(ids[0]!, false))

  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeDefined()
  await ui.unmount()
})

test('a group shown unfolded leaves the thumbnail to the call row', async ($, on) => {
  const { clock, ids } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolGroup(ids[0]!, true))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('on a surface that is not a terminal nothing is added', async ($, on) => {
  const { clock, ids } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolUse(ids[0]!, 'desktop'))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a subagent call is left alone', async ($, on) => {
  const { clock, helperRuns } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE, agentId: 'a1' })
  await clock.advance(1000)

  expect(helperRuns()).toBe(0)
})

test('/img opens the newest image, /img 2 the one before, and says when there is none', async ($, on) => {
  const { clock, opened, toasts } = world(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: 'C:\\p\\first.png' })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\p\\second.png' })
  await clock.advance(1000)

  // The kit takes a command by its name and args alone; its type asks for the engine's whole input.
  const newest = await $.command.run({ command: 'img' } as never)
  const before = await $.command.run({ command: 'img', args: '2' } as never)
  const none = await $.command.run({ command: 'img', args: '99' } as never)

  expect(opened().map(argv => argv.slice(-1)[0])).toEqual(['C:\\p\\second.png', 'C:\\p\\first.png'])
  expect(toasts).toEqual(['Opened second.png.', 'Opened first.png.', 'No such image.'])
  // A command's text is kept in what Claude reads: the answer carries none.
  expect([newest?.text, before?.text, none?.text]).toEqual([undefined, undefined, undefined])
})

test('a command that names many images shows the one it wrote', async ($, on) => {
  const { clock, ids } = world(on, {
    text: 'magick a.png b.png c.png d.png out.png',
    mtimeOf: path => (path.endsWith('out.png') ? NOW + 5 : NOW - 60_000),
  })
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...toolUse(ids[0]!), props: { ...toolUse(ids[0]!).props, tool: 'Bash' } })
  const names = (await ui.findAll({ type: 'Link' })).map(link => link.props.label)

  expect(names).toEqual(['out.png'])
  await ui.unmount()
})

test('at most four images are shown for one call', async ($, on) => {
  const { clock, ids } = world(on, { text: 'a.png b.png c.png d.png e.png f.png', mtimeMs: NOW + 5 })
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await clock.advance(5000)

  const ui = await $.ui.mount({ ...toolUse(ids[0]!), props: { ...toolUse(ids[0]!).props, tool: 'Bash' } })

  expect((await ui.findAll({ type: 'Link' })).map(link => link.props.label)).toEqual(['a.png', 'b.png', 'c.png', 'd.png'])
  await ui.unmount()
})

test('an image swapped for a link to a program after it was drawn is not opened', async ($, on) => {
  // The first look, when the thumbnail is made, finds an image; every later one finds a link to a script.
  const { clock, ids, opened, toasts } = world(on, {
    realPathOf: (_, asked) => (asked === 1 ? undefined : 'C:\\p\\setup.cmd'),
  })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  const ui = await $.ui.mount(toolUse(ids[0]!))
  await ui.press({ key: 'img0-r0' })

  expect(opened()).toHaveLength(0)
  expect(toasts).toEqual(['a.png is no longer an image.'])
  await ui.unmount()
})

test('what an earlier version stored is declined, and the row draws as the engine drew it', async ($, on) => {
  world(on)
  on('state.get', () => ({ value: { value: { images: [{ file: 'old' }] }, version: 1 } }))

  const ui = await $.ui.mount(toolUse('t1'))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

const PASTED = {
  openPath: 'C:\t\t9.png',
  name: 'Screenshot.png',
  width: 320,
  height: 180,
  columns: 2,
  rows: 1,
  pxH: 2,
  rgb: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]).toBase64(),
}

const userMessage = (id: string, text = 'look [Image #1]') =>
  ({
    plugin: 'cc-img',
    component: 'UserMessage',
    requestId: id,
    surface: 'terminal',
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
  }) as const

/** Pasted images already made into thumbnails, waiting for their message row. */
function waitingPaste(on: On, notFor: string[] = []) {
  on('state.get', { plugin: 'cc-img', key: 'pending' }, () => ({
    value: { value: { shape: 'pending-1', value: [{ text: 'look [Image #1]', images: [PASTED], notFor }] }, version: 1 },
  }) as never)
}

test('a pasted image is drawn under the message that carries it', async ($, on) => {
  world(on)
  waitingPaste(on)

  const ui = await $.ui.mount(userMessage('u1'))

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toBe('▀▀')
  expect(await ui.find({ type: 'Text', text: /Screenshot\.png/ })).toBeDefined()
  await ui.unmount()
})

test('a message of other words gets no pasted image', async ($, on) => {
  world(on)
  waitingPaste(on)

  const ui = await $.ui.mount(userMessage('u1', 'something else'))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('an earlier message of the same words does not take the pasted image', async ($, on) => {
  world(on)
  waitingPaste(on, ['u0'])

  const ui = await $.ui.mount(userMessage('u0'))

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('the row that drew a pasted image keeps it as its own', async ($, on) => {
  const { clock } = world(on)
  waitingPaste(on)
  const kept: unknown[] = []
  on('state.set', { plugin: 'cc-img', key: 'rows' }, (_, e, next) => {
    kept.push(e)

    return next(e)
  })
  await $.session.start(start)

  const ui = await $.ui.mount(userMessage('u1'))
  await clock.advance(1000)

  expect(kept).toHaveLength(1)
  expect(kept[0]).toMatchObject({ id: 'u1', value: { shape: 'rows-1', value: { images: [{ name: 'Screenshot.png' }] } } })
  await ui.unmount()
})

test('a prompt goes on as it was sent', async ($, on) => {
  world(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const sent = await $.prompt.submit({ text: 'hello' } as never)

  expect(sent).toMatchObject({ text: 'hello' })
})

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** What the session already holds: the drawing mode, and the images under row `t1`. */
function holding(on: On, mode: 'pixel' | undefined, image: object) {
  // Left alone, the mode is the kit's to keep: a session starts in blocks.
  if (mode !== undefined) on('state.get', { plugin: 'cc-img', key: 'mode' }, () => ({ value: { value: { shape: 'mode-1', value: mode }, version: 1 } }) as never)
  on('state.get', { plugin: 'cc-img', key: 'rows' }, () => ({
    value: { value: { shape: 'rows-1', value: { images: [image] } }, version: 1 },
  }) as never)
}

test('where the terminal draws pixels, an image is a real picture with an open button', async ($, on) => {
  world(on)
  holding(on, 'pixel', { ...PASTED, png: TINY_PNG })
  await $.session.start(start)

  const ui = await $.ui.mount(toolUse('t1'))
  const picture = await ui.find({ type: 'Image', key: 'img0' })

  expect(picture?.props).toMatchObject({ source: { png: TINY_PNG }, columns: 2, rows: 1, alt: 'Screenshot.png' })
  expect(await ui.find({ type: 'Button', key: 'img0-open' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeUndefined()
  await ui.unmount()
})

test('an image made before pixels were known to draw stays in blocks', async ($, on) => {
  world(on)
  holding(on, 'pixel', PASTED)

  const ui = await $.ui.mount(toolUse('t1'))

  expect(await ui.find({ type: 'Image', key: 'img0' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeDefined()
  await ui.unmount()
})

/** Twelve cells across, two pixels a cell, all black. */
const WIDE = { ...PASTED, columns: 12, rows: 1, pxW: 24, pxH: 2, rgb: new Uint8Array(24 * 2 * 3).toBase64() }
/** A terminal ten cells across, of which the row's own indent takes four. */
const NARROW = { columns: 10, rows: 40 }

test('a picture wider than the terminal is cut to the room there is', async ($, on) => {
  world(on)
  holding(on, undefined, WIDE)

  const ui = await $.ui.mount({ ...toolUse('t1'), viewport: NARROW })

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toHaveLength(6)
  await ui.unmount()
})

test('a real picture wider than the terminal is drawn smaller', async ($, on) => {
  world(on)
  holding(on, 'pixel', { ...WIDE, rows: 4, png: TINY_PNG })
  await $.session.start(start)

  const ui = await $.ui.mount({ ...toolUse('t1'), viewport: NARROW })

  expect((await ui.find({ type: 'Image', key: 'img0' }))?.props).toMatchObject({ columns: 6, rows: 2 })
  await ui.unmount()
})

test('a thumbnail is made no wider or taller than the terminal last seen', async ($, on) => {
  const { clock, boxAsked } = world(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ ...toolUse('none'), viewport: { columns: 30, rows: 20 } })
  await ui.unmount()

  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  // 26 cells across and 14 down, in quarter blocks: one pixel a cell across, two down.
  expect(boxAsked()).toBe('26x28')
})

test('/img fine draws the thumbnails that follow in octant blocks, and is kept for later sessions', async ($, on) => {
  const { clock, store, toasts, boxAsked } = world(on)
  await $.session.start(start)

  await $.command.run({ command: 'img', args: 'fine' } as never)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  expect(store).toEqual({ blocks: 'octant' })
  expect(toasts).toHaveLength(1)
  expect(boxAsked()).toBe('160x160')
})

test('/img coarse goes back to quarter blocks', async ($, on) => {
  const { clock, store, boxAsked } = world(on, { kept: { blocks: 'octant' } })
  await $.session.start(start)

  await $.command.run({ command: 'img', args: 'coarse' } as never)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  expect(store).toEqual({ blocks: 'quarter' })
  expect(boxAsked()).toBe('80x80')
})

test('a session starts with the blocks an earlier one chose', async ($, on) => {
  const { clock, boxAsked } = world(on, { kept: { blocks: 'octant' } })
  await $.session.start(start)

  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  expect(boxAsked()).toBe('160x160')
})

test('/img size 40 makes the thumbnails that follow at most 40 cells across and half that down, and is kept', async ($, on) => {
  const { clock, store, boxAsked } = world(on)
  await $.session.start(start)

  await $.command.run({ command: 'img', args: 'size 40' } as never)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  expect(store).toEqual({ columns: 40 })
  // Quarter blocks: one pixel a cell across, two down.
  expect(boxAsked()).toBe('40x40')
})

test('a session starts with the size an earlier one chose', async ($, on) => {
  const { clock, boxAsked } = world(on, { kept: { columns: 40, blocks: 'octant' } })
  await $.session.start(start)

  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(1000)

  expect(boxAsked()).toBe('80x80')
})

test('/img size with no sensible width changes nothing and says what it takes', async ($, on) => {
  const { store, toasts } = world(on)
  await $.session.start(start)

  await $.command.run({ command: 'img', args: 'size 3' } as never)
  await $.command.run({ command: 'img', args: 'size wide' } as never)

  expect(store).toEqual({})
  expect(toasts).toEqual(['Give a width in columns, from 8 to 160: /img size 40', 'Give a width in columns, from 8 to 160: /img size 40'])
})

/** Windows Terminal, with a helper that writes a full-size picture of 320 by 400 pixels: 32 by 20 cells. */
const WINDOWS_TERMINAL = { env: { WT_SESSION: 'abc' }, helperOut: '{"w":1080,"h":1350,"sw":320,"sh":400}' }
/** A row's number as one braille character, a thin bar, then the picture's name as three more. */
const MARKER = /^[\u2800-\u28FF]\u2595[\u2800-\u28FF]{3}/

test('in Windows Terminal an image is rows of markers for the Sixel painter, which is started once', async ($, on) => {
  const { clock, ids, onWindows, painterStarted, opened } = world(on, WINDOWS_TERMINAL)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\p\\b.png' })
  await clock.advance(2000)
  if (!onWindows()) return

  const ui = await $.ui.mount(toolUse(ids[0]!))

  // Twenty rows of cells, each a marker row.
  const rows: string[] = []
  for (let row = 0; row < 20; row++) rows.push((await ui.find({ type: 'Box', key: `img0-s${row}` }))?.text ?? '')
  expect(await ui.find({ type: 'Box', key: 'img0-s20' })).toBeUndefined()
  // Each row says which row of the picture it is, in its first cell.
  expect(rows.every(row => MARKER.test(row))).toBe(true)
  expect(rows.map(row => row.charCodeAt(0) - 0x2800)).toEqual(Array.from({ length: 20 }, (_, row) => row))
  // And each fills the picture's 32 cells with characters that are not blanks:
  // when the row moves away, Claude Code writes every one of them anew, which
  // clears the picture from where it was.
  expect(rows.every(row => [...row].length === 32 && !/\s/.test(row))).toBe(true)
  expect(painterStarted()).toBe(1)
  // No row of the picture is a button: one under the pointer is drawn again,
  // which wipes the picture on that row. The image opens from beside its name.
  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeUndefined()
  await ui.press({ key: 'img0-open' })
  expect(opened()).toHaveLength(1)
  await ui.unmount()
})

test('inside herdr the painter is asked to paint on the herdr window, past herdr, and an image is rows for it', async ($, on) => {
  // herdr passes no Sixel on, and sets no WT_SESSION for the panes inside it.
  const { clock, ids, painterStarted, painterHost, onWindows } = world(on, { ...WINDOWS_TERMINAL, env: { HERDR_ENV: '1' } })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(2000)
  if (!onWindows()) return

  const ui = await $.ui.mount(toolUse(ids[0]!))

  expect(painterStarted()).toBe(1)
  expect(painterHost()).toBe('herdr')
  expect(await ui.find({ type: 'Box', key: 'img0-s0' })).toBeDefined()
  await ui.unmount()
})

test("in plain Windows Terminal the painter is asked to paint on Claude Code's own screen", async ($, on) => {
  const { clock, painterHost, onWindows } = world(on, WINDOWS_TERMINAL)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(2000)
  if (!onWindows()) return

  expect(painterHost()).toBe('claude')
})

test('inside tmux, which passes no Sixel on, an image stays in blocks and no painter is started', async ($, on) => {
  const { clock, ids, painterStarted } = world(on, { ...WINDOWS_TERMINAL, env: { WT_SESSION: 'abc', TMUX: '/tmp/tmux-1/default' } })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(2000)

  const ui = await $.ui.mount(toolUse(ids[0]!))

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toHaveLength(1)
  expect(painterStarted()).toBe(0)
  await ui.unmount()
})

test('inside herdr, a painter that finds no herdr window in Windows Terminal leaves images in blocks', async ($, on) => {
  const { clock, ids } = world(on, { ...WINDOWS_TERMINAL, env: { HERDR_ENV: '1' }, painterStarts: false })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(2000)

  const ui = await $.ui.mount(toolUse(ids[0]!))

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toHaveLength(1)
  await ui.unmount()
})

test('a painter that will not start leaves images in blocks, and says so once, with where to look', async ($, on) => {
  const { clock, ids, toasts, onWindows } = world(on, { ...WINDOWS_TERMINAL, painterStarts: false })
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\p\\b.png' })
  await clock.advance(3000)

  const ui = await $.ui.mount(toolUse(ids[0]!))

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toHaveLength(1)
  if (onWindows()) {
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/block characters.*sixel\.log/s)
  }
  await ui.unmount()
})

test('/img pixels off keeps images in blocks, here and in later sessions; /img pixels on brings the painter back', async ($, on) => {
  const { clock, ids, store, toasts, painterStarted, onWindows } = world(on, WINDOWS_TERMINAL)
  await $.session.start(start)

  await $.command.run({ command: 'img', args: 'pixels off' } as never)
  await $.tool.call({ tool: 'Read', file_path: IMAGE })
  await clock.advance(2000)
  const ui = await $.ui.mount(toolUse(ids[0]!))
  const offText = (await ui.find({ type: 'Button', key: 'img0-r0' }))?.text
  await ui.unmount()
  const startedWhileOff = painterStarted()

  await $.command.run({ command: 'img', args: 'pixels on' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:\\p\\b.png' })
  await clock.advance(2000)

  expect(offText).toHaveLength(1)
  expect(startedWhileOff).toBe(0)
  expect(store).toEqual({ pixels: 'on' })
  expect(toasts).toHaveLength(2)
  if (onWindows()) expect(painterStarted()).toBe(1)
})

test('a full-size picture wider than the terminal is drawn in blocks instead, cut to fit', async ($, on) => {
  world(on, WINDOWS_TERMINAL)
  holding(on, undefined, { ...WIDE, six: { id: 'lflsn1', columns: 12, rows: 6 } })
  await $.session.start(start)

  const ui = await $.ui.mount({ ...toolUse('t1'), viewport: NARROW })

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toHaveLength(6)
  await ui.unmount()
})

/** One cell of octant blocks: BLOCK OCTANT-3 in white on black. */
const OCTANT = { ...PASTED, columns: 1, rows: 1, down: 4, cells: Uint8Array.from([4, 255, 255, 255, 0, 0, 0]).toBase64(), rgb: undefined, pxH: undefined }

test('a thumbnail kept as cells draws the block each cell names', async ($, on) => {
  world(on)
  holding(on, undefined, OCTANT)

  const ui = await $.ui.mount(toolUse('t1'))

  expect((await ui.find({ type: 'Button', key: 'img0-r0' }))?.text).toBe('\u{1CD00}')
  await ui.unmount()
})

/** Draws the first thumbnail of a session, with the terminal answering the pixel test as told. */
async function probed($: TestEngine, on: On, deny: string | undefined) {
  const { clock } = world(on)
  holding(on, undefined, PASTED)
  const modes: unknown[] = []
  let tries = 0
  on('state.set', { plugin: 'cc-img', key: 'mode' }, (_, e, next) => {
    modes.push(e.value)

    return next(e)
  })
  on('ui.blit', () => {
    tries++

    return { value: deny === undefined ? {} : { deny } } as never
  })
  await $.session.start(start)

  const ui = await $.ui.mount(toolUse('t1'))
  const hadProbe = (await ui.find({ type: 'Image', key: 'probe' })) !== undefined
  await clock.advance(5000)
  await ui.unmount()

  const again = await $.ui.mount(toolUse('t1'))
  const hasProbeAfter = (await again.find({ type: 'Image', key: 'probe' })) !== undefined
  await again.unmount()

  return { modes, tries: () => tries, hadProbe, hasProbeAfter }
}

test('a terminal that takes the test picture is drawn in pixels from then on', async ($, on) => {
  const { modes, hadProbe, hasProbeAfter } = await probed($, on, undefined)

  expect(hadProbe).toBe(true)
  expect(modes).toEqual([{ shape: 'mode-1', value: 'pixel' }])
  expect(hasProbeAfter).toBe(false)
})

test('a terminal that refuses the test picture stays in blocks, and is asked once', async ($, on) => {
  const { modes, tries, hasProbeAfter } = await probed($, on, 'this terminal draws the alt text')

  expect(modes).toEqual([])
  expect(tries()).toBe(1)
  expect(hasProbeAfter).toBe(false)
})

test('a test picture that never gets drawn is given up after fifteen tries', async ($, on) => {
  const { modes, tries } = await probed($, on, 'not mounted')

  expect(modes).toEqual([])
  expect(tries()).toBe(15)
})

test('in iTerm2, which asks the person before it shows each picture, the person is told so once', async ($, on) => {
  const { store, toasts } = world(on, { env: { TERM_PROGRAM: 'iTerm.app' } })
  holding(on, undefined, PASTED)
  await $.session.start(start)
  await $.session.start(start)

  const ui = await $.ui.mount(toolUse('t1'))

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Remember my choice')
  expect(toasts[0]).toContain('/img pixels off')
  expect(store).toEqual({ itermTold: true })
  expect(await ui.find({ type: 'Image', key: 'probe' })).toBeDefined()
  await ui.unmount()
})

test('in iTerm2 with pixels off no picture is sent and nothing is said', async ($, on) => {
  const { clock, toasts } = world(on, { env: { LC_TERMINAL: 'iTerm2' }, kept: { pixels: 'off' } })
  holding(on, undefined, PASTED)
  let sends = 0
  on('ui.blit', () => {
    sends++

    return { value: {} } as never
  })
  await $.session.start(start)

  const ui = await $.ui.mount(toolUse('t1'))
  const hadProbe = (await ui.find({ type: 'Image', key: 'probe' })) !== undefined
  await clock.advance(2000)
  await ui.unmount()

  expect(hadProbe).toBe(false)
  expect(sends).toBe(0)
  expect(toasts).toEqual([])
})

test('/img cell 7x17 makes the thumbnails that follow for that cell, and is kept; a shape no cell has is refused', async ($, on) => {
  const { store, toasts } = world(on)
  await $.session.start(start)

  await $.command.run({ command: 'img', args: 'cell 7x17' } as never)
  await $.command.run({ command: 'img', args: 'cell 17x7' } as never)
  await $.command.run({ command: 'img', args: 'cell tall' } as never)

  expect(store).toEqual({ cell: '7x17' })
  expect(toasts).toHaveLength(3)
  expect(toasts[1]).toBe(toasts[2])
})

test('/img pixels off draws blocks where the terminal itself draws pixels too', async ($, on) => {
  world(on)
  holding(on, 'pixel', { ...PASTED, png: TINY_PNG })
  await $.session.start(start)
  await $.command.run({ command: 'img', args: 'pixels off' } as never)

  const ui = await $.ui.mount(toolUse('t1'))

  expect(await ui.find({ type: 'Image', key: 'img0' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeDefined()
  await ui.unmount()
})

test('a row drawn before the session has said which terminal this is sends no picture', async ($, on) => {
  world(on, { env: { TERM_PROGRAM: 'iTerm.app' } })
  holding(on, 'pixel', { ...PASTED, png: TINY_PNG })

  const ui = await $.ui.mount(toolUse('t1'))

  expect(await ui.find({ type: 'Image', key: 'probe' })).toBeUndefined()
  expect(await ui.find({ type: 'Image', key: 'img0' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'img0-r0' })).toBeDefined()
  await ui.unmount()
})
