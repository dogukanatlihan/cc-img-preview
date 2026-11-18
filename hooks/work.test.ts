import { expect, test } from 'claude-code/testing'

import type { Env } from './thumb'
import { readMedia, thumbFor } from './work'
import type { Deps } from './work'

const env: Env = {
  platform: 'win32',
  root: 'C:\\m',
  tempDir: 'C:\\t',
  tools: { ffmpeg: false, magick: false, rsvg: false },
}

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
  files?: Record<string, { kind: 'file' | 'dir'; mtimeMs: number; realPath?: string }>
  contents?: Record<string, string>
  helper?: { exitCode: number; stdout: string }
}

/** Stands for the engine: a few files, and a helper that answers as told. */
function world({ files = {}, contents = {}, helper = { exitCode: 0, stdout: '{"w":320,"h":180}' } }: World = {}) {
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const deps: Deps = {
    run: async (argv, init) => {
      runs.push({ argv, stdin: init?.stdin })

      return helper
    },
    stat: async path => files[path],
    readBase64: async path => contents[path],
  }

  return { deps, runs }
}

const picture = { files: { 'C:\\p\\a.png': { kind: 'file' as const, mtimeMs: 9_000 } }, contents: { 'C:\\t\\t1.bmp': bmp2x2() } }
const options = { id: 't1', tool: 'Read', png: false }

test('a file that is an image becomes a thumbnail of its pixels', async () => {
  const { deps } = world(picture)

  const thumb = await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options)

  expect(thumb).toEqual({
    openPath: 'C:\\p\\a.png',
    name: 'a.png',
    width: 320,
    height: 180,
    columns: 1,
    rows: 1,
    down: 2,
    // One cell: red and white in the foreground, green and blue behind.
    cells: Uint8Array.from([9, 255, 128, 128, 0, 128, 128]).toBase64(),
  })
})

test('a thumbnail asked for a smaller room is made that small', async () => {
  const { deps, runs } = world(picture)

  await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, { ...options, columns: 30, rows: 12 })
  const argv = runs.find(one => one.argv.includes('-Src'))?.argv ?? []

  expect([argv[argv.indexOf('-Width') + 1], argv[argv.indexOf('-Height') + 1]]).toEqual(['30', '24'])
})

test('a thumbnail asked for in octant blocks holds four pixels down a cell', async () => {
  const { deps, runs } = world(picture)

  const thumb = await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, { ...options, blocks: 'octant' })
  const argv = runs.find(one => one.argv.includes('-Src'))?.argv ?? []

  expect(argv[argv.indexOf('-Across') + 1]).toBe('1')
  expect([thumb?.columns, thumb?.rows, thumb?.down]).toEqual([1, 1, 4])
})

test('a thumbnail made for the Sixel painter says how many cells its full-size picture takes', async () => {
  const { deps, runs } = world({ ...picture, helper: { exitCode: 0, stdout: '{"w":1080,"h":1350,"sw":320,"sh":395}' } })

  const thumb = await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, { ...options, columns: 40, rows: 20, six: 'k3x91' })
  const argv = runs.find(one => one.argv.includes('-Src'))?.argv ?? []

  // A cell is 10 by 20 pixels to the painter: 40 by 20 cells are 400 by 400.
  expect([argv[argv.indexOf('-SixW') + 1], argv[argv.indexOf('-SixH') + 1]]).toEqual(['400', '400'])
  expect(thumb?.six).toEqual({ id: 'k3x91', columns: 32, rows: 20 })
  expect(thumb?.cells).toBeDefined()
})

test('a thumbnail not made for the painter, or whose full-size picture was not written, has none', async () => {
  const { deps } = world(picture)

  expect((await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options))?.six).toBeUndefined()
  expect((await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, { ...options, six: 'k3x91' }))?.six).toBeUndefined()
})

test('a path that names no file is nothing, and no helper runs', async () => {
  const { deps, runs } = world()

  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\prose.png' }, options)).toBeUndefined()
  expect(runs).toHaveLength(0)
})

test('a folder named like an image is nothing', async () => {
  const { deps } = world({ files: { 'C:\\p\\a.png': { kind: 'dir', mtimeMs: 9_000 } } })

  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options)).toBeUndefined()
})

test('a file the call did not change is nothing; one it changed is kept', async () => {
  const { deps } = world(picture)

  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png', newerThan: 9_001 }, options)).toBeUndefined()
  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png', newerThan: 9_000 }, options)).toBeDefined()
})

test('a link named like an image that leads to something else is nothing', async () => {
  const link = (realPath: string) => ({ 'C:\\p\\a.png': { kind: 'file' as const, mtimeMs: 9_000, realPath } })

  expect(
    await thumbFor(world({ ...picture, files: link('C:\\p\\setup.cmd') }).deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options),
  ).toBeUndefined()
  expect(
    await thumbFor(world({ ...picture, files: link('D:\\art\\real.PNG') }).deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options),
  ).toBeDefined()
})

test('a file the helper cannot read keeps its name and its click, with no picture', async () => {
  const { deps } = world({ ...picture, helper: { exitCode: 1, stdout: '' } })

  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options)).toEqual({
    openPath: 'C:\\p\\a.png',
    name: 'a.png',
    width: 0,
    height: 0,
    columns: 0,
    rows: 0,
  })
})

test('a thumbnail file that is missing or garbled leaves the size and no picture', async () => {
  const { deps } = world({ files: picture.files, contents: { 'C:\\t\\t1.bmp': 'bm90IGEgYm1w' } })

  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options)).toEqual({
    openPath: 'C:\\p\\a.png',
    name: 'a.png',
    width: 320,
    height: 180,
    columns: 0,
    rows: 0,
  })
})

test('a picture from a tool result is saved to the temp folder and opened from there', async () => {
  const { deps, runs } = world({ contents: picture.contents })

  const thumb = await thumbFor(
    deps,
    env,
    { kind: 'bytes', base64: 'aGk=', mediaType: 'image/jpeg' },
    { id: 't1', tool: 'mcp__claude-in-chrome__computer', png: false },
  )

  expect(runs[0]?.argv.slice(-2)).toEqual(['-FromStdin', 'C:\\t\\t1.jpg'])
  expect(runs[0]?.stdin).toBe('aGk=')
  expect(thumb?.openPath).toBe('C:\\t\\t1.jpg')
  expect(thumb?.name).toBe('computer.jpg')
  expect(thumb?.columns).toBe(1)
})

test('a picture that cannot be saved is nothing', async () => {
  const { deps } = world({ helper: { exitCode: 1, stdout: '' } })

  expect(
    await thumbFor(deps, env, { kind: 'bytes', base64: 'aGk=', mediaType: 'image/png' }, options),
  ).toBeUndefined()
})

test('in pixel mode the PNG thumbnail is carried too', async () => {
  const { deps } = world({ ...picture, contents: { ...picture.contents, 'C:\\t\\t1.png': 'iVBORw0KGgo=' } })

  const thumb = await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, { ...options, png: true })

  expect(thumb?.png).toBe('iVBORw0KGgo=')
  expect(thumb?.cells).toBeDefined()
})

test('an engine call that throws is nothing, and nothing is thrown', async () => {
  const deps: Deps = {
    run: async () => ({ exitCode: 0, stdout: '' }),
    stat: async () => {
      throw new Error('denied')
    },
    readBase64: async () => undefined,
  }

  expect(await thumbFor(deps, env, { kind: 'file', path: 'C:\\p\\a.png' }, options)).toBeUndefined()
})

test('a pasted image read in slices is the slices joined', async () => {
  const asked: (number | undefined)[] = []
  const media = await readMedia(async ({ offset }) => {
    asked.push(offset)

    return offset === undefined
      ? { type: 'image', mediaType: 'image/png', base64: 'AAAA', size: 6, next: 3 }
      : { type: 'image', mediaType: 'image/png', base64: 'BBBB', size: 6 }
  }, 'media_1')

  expect(media).toEqual({ base64: 'AAAABBBB', mediaType: 'image/png' })
  expect(asked).toEqual([undefined, 3])
})

test('a pasted item that cannot be read, is refused or is no image is nothing', async () => {
  expect(await readMedia(async () => ({ unreadable: 'gone' }), 'm')).toBeUndefined()
  expect(await readMedia(async () => ({ deny: 'settled' }), 'm')).toBeUndefined()
  expect(await readMedia(async () => ({ type: 'document', mediaType: 'application/pdf', base64: 'AAAA', size: 3 }), 'm')).toBeUndefined()
  expect(
    await readMedia(async () => {
      throw new Error('no')
    }, 'm'),
  ).toBeUndefined()
})

test('a pasted image whose slices never end is given up', async () => {
  let calls = 0
  const media = await readMedia(async () => {
    calls++

    return { type: 'image', mediaType: 'image/png', base64: 'AAAA', size: 3, next: calls * 3 }
  }, 'm')

  expect(media).toBeUndefined()
  expect(calls).toBeLessThanOrEqual(16)
})
