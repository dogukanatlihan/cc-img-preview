import { expect, test } from 'claude-code/testing'

import { collect } from './collect'

const at = { cwd: 'C:\\proj', startedAt: 10_000 }
const b64 = 'iVBORw0KGgo='

test('a read of an image is that file, with no time check and no second copy from its result', async () => {
  const result = { type: 'image', file: { base64: b64, type: 'image/png' } }

  expect(collect({ ...at, tool: 'Read', input: { file_path: 'C:\\proj\\a.png' } }, { result })).toEqual([
    { kind: 'file', path: 'C:\\proj\\a.png' },
  ])
})

test('a read of anything else is nothing', async () => {
  expect(collect({ ...at, tool: 'Read', input: { file_path: 'C:\\proj\\a.cs' } }, { text: 'see b.png' })).toEqual([])
})

test('a written or edited image is that file', async () => {
  expect(collect({ ...at, tool: 'Write', input: { file_path: 'C:\\proj\\d.svg', content: '<svg/>' } }, {})).toEqual([
    { kind: 'file', path: 'C:\\proj\\d.svg' },
  ])
  expect(
    collect({ ...at, tool: 'Edit', input: { file_path: 'd.svg', old_string: 'a.png', new_string: 'b.png' } }, {}),
  ).toEqual([{ kind: 'file', path: 'C:\\proj\\d.svg' }])
})

test('any other tool: paths in its input and its result text, each once, to be newer than the call', async () => {
  expect(
    collect({ ...at, tool: 'Bash', input: { command: 'python plot.py -o out/p.png' } }, { text: 'saved out/p.png' }),
  ).toEqual([{ kind: 'file', path: 'C:\\proj\\out\\p.png', newerThan: 8_000 }])
})

test('a path with backslashes in an input string is read as written', async () => {
  expect(
    collect({ ...at, tool: 'PowerShell', input: { command: 'Copy-Item x "C:\\out dir\\my shot (1).png"' } }, {}),
  ).toEqual([{ kind: 'file', path: 'C:\\out dir\\my shot (1).png', newerThan: 8_000 }])
})

test('an image block in a result is its bytes, in each shape a tool answers with', async () => {
  expect(
    collect(
      { ...at, tool: 'mcp__x__shot', input: {} },
      { result: { content: [{ type: 'image', data: b64, mimeType: 'image/png' }], isError: false } },
    ),
  ).toEqual([{ kind: 'bytes', base64: b64, mediaType: 'image/png' }])
  expect(
    collect(
      { ...at, tool: 'mcp__x__shot', input: {} },
      { result: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }] },
    ),
  ).toEqual([{ kind: 'bytes', base64: b64, mediaType: 'image/jpeg' }])
  expect(
    collect({ ...at, tool: 'Other', input: {} }, { result: { type: 'image', file: { base64: b64, type: 'image/gif' } } }),
  ).toEqual([{ kind: 'bytes', base64: b64, mediaType: 'image/gif' }])
})

test('a web address is never a candidate', async () => {
  const found = collect({ ...at, tool: 'Bash', input: { command: 'ls' } }, { text: 'https://x.dev/f.png a.png' })

  expect(found.map(one => (one.kind === 'file' ? one.path : ''))).toEqual(['C:\\proj\\a.png'])
})

test('a command that names many images offers them all, so the one it wrote is not cut off', async () => {
  const found = collect(
    { ...at, tool: 'Bash', input: { command: 'magick a.png b.png c.png d.png out.png' } },
    { result: { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] } },
  )

  expect(found.map(one => (one.kind === 'file' ? one.path : one.kind))).toEqual([
    'C:\\proj\\a.png',
    'C:\\proj\\b.png',
    'C:\\proj\\c.png',
    'C:\\proj\\d.png',
    'C:\\proj\\out.png',
    'bytes',
  ])
})

test('the candidates of one call are bounded', async () => {
  const names = Array.from({ length: 40 }, (_, n) => `f${n}.png`).join(' ')

  expect(collect({ ...at, tool: 'Bash', input: { command: 'ls' } }, { text: names })).toHaveLength(16)
})

test('a network path found in text is never looked at', async () => {
  const text = 'src="//cdn.x.com/logo.png" and \\\\host\\share\\a.png and "\\\\host\\share\\b c.png"'

  expect(collect({ ...at, tool: 'Bash', input: { command: 'curl x' } }, { text })).toEqual([])
})

test('a network path Claude itself read is that file', async () => {
  expect(collect({ ...at, tool: 'Read', input: { file_path: '\\\\host\\share\\a.png' } }, {})).toEqual([
    { kind: 'file', path: '\\\\host\\share\\a.png' },
  ])
})

test('an input or a result of no known shape is nothing, and nothing is thrown', async () => {
  expect(collect({ ...at, tool: 'Bash', input: null }, { result: undefined })).toEqual([])
  expect(collect({ ...at, tool: 'Read', input: 7 }, { result: 'text' })).toEqual([])

  const loop: Record<string, unknown> = { type: 'image' }
  loop.self = loop
  expect(collect({ ...at, tool: 'Bash', input: {} }, { result: loop })).toEqual([])
})
