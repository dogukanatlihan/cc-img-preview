import { expect, test } from 'claude-code/testing'

import { boxFor, cellsOf, fitBox, forCell, octant, parseBmp, rowsOf, toRows } from './pixels'

/** An uncompressed BMP. `rows` are in file order, each the row's pixel bytes. */
function bmp(width: number, height: number, bitsPerPixel: number, rows: number[][], compression = 0): Uint8Array {
  const rowSize = Math.ceil((Math.abs(width) * bitsPerPixel) / 32) * 4
  const bytes = new Uint8Array(54 + rowSize * rows.length)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, bitsPerPixel, true)
  view.setUint32(30, compression, true)
  rows.forEach((row, index) => bytes.set(row, 54 + index * rowSize))

  return bytes
}

// Top row red, green; bottom row blue, white. Stored bottom-up, as B, G, R.
const bottomUp = bmp(2, 2, 24, [
  [255, 0, 0, 255, 255, 255],
  [0, 0, 255, 0, 255, 0],
])
const PIXELS = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]

test('a box of 80 by 40 cells is so many square pixels, and so many written for each across', async () => {
  expect(boxFor('quarter')).toEqual({ width: 80, height: 80, across: 2, down: 2 })
  expect(boxFor('octant')).toEqual({ width: 160, height: 160, across: 1, down: 4 })
  expect(boxFor('octant', 20, 10)).toEqual({ width: 40, height: 40, across: 1, down: 4 })
})

test('a wide image fills the box across', async () => {
  expect(fitBox(1280, 720, boxFor('quarter'))).toEqual({ pxW: 160, pxH: 45 })
  expect(fitBox(1280, 720, boxFor('octant'))).toEqual({ pxW: 160, pxH: 90 })
  expect(fitBox(4000, 10, boxFor('quarter'))).toEqual({ pxW: 160, pxH: 1 })
})

test('a tall image fills the box down', async () => {
  expect(fitBox(640, 1280, boxFor('octant'))).toEqual({ pxW: 80, pxH: 160 })
  expect(fitBox(10, 4000, boxFor('quarter'))).toEqual({ pxW: 2, pxH: 80 })
})

test('a small image is never enlarged, only written twice across for quarter blocks', async () => {
  expect(fitBox(16, 16, boxFor('octant'))).toEqual({ pxW: 16, pxH: 16 })
  expect(fitBox(16, 16, boxFor('quarter'))).toEqual({ pxW: 32, pxH: 16 })
  expect(fitBox(0, 0, boxFor('quarter'))).toEqual({ pxW: 2, pxH: 1 })
})

test('a bottom-up 24-bit BMP reads top row first, as R, G, B', async () => {
  const image = parseBmp(bottomUp)!

  expect([image.width, image.height]).toEqual([2, 2])
  expect(Array.from(image.rgb)).toEqual(PIXELS)
})

test('a top-down 32-bit BMP reads the same pixels', async () => {
  const image = parseBmp(
    bmp(2, -2, 32, [
      [0, 0, 255, 255, 0, 255, 0, 255],
      [255, 0, 0, 255, 255, 255, 255, 255],
    ]),
  )!

  expect([image.width, image.height]).toEqual([2, 2])
  expect(Array.from(image.rgb)).toEqual(PIXELS)
})

test('what is not a plain BMP is declined', async () => {
  expect(parseBmp(new Uint8Array(0))).toBeUndefined()
  expect(parseBmp(new TextEncoder().encode('this is text, not an image, however long it runs on for'))).toBeUndefined()
  expect(parseBmp(bottomUp.slice(0, 60))).toBeUndefined()
  expect(parseBmp(bmp(2, 2, 24, [[], []], 1))).toBeUndefined()
  expect(parseBmp(bmp(2, 2, 8, [[], []]))).toBeUndefined()
})

const W = [255, 255, 255]
const K = [0, 0, 0]
/** One cell's four pixels: top left, top right, bottom left, bottom right. */
const cell = (...pixels: number[][]) => Uint8Array.from(pixels.flat())

test('a picture stored one pixel a column draws as half blocks', async () => {
  expect(toRows(Uint8Array.from(PIXELS), 2, 2, 2)).toEqual([
    [
      { text: '▀', fg: '#ff0000', bg: '#0000ff' },
      { text: '▀', fg: '#00ff00', bg: '#ffffff' },
    ],
  ])
})

test('a cell of two pixels across draws the quarter block that splits its two colours', async () => {
  const glyph = (...pixels: number[][]) => toRows(cell(...pixels), 2, 2, 1)

  expect(glyph(W, K, W, K)).toEqual([[{ text: '▌', fg: '#ffffff', bg: '#000000' }]])
  expect(glyph(W, K, K, K)).toEqual([[{ text: '▘', fg: '#ffffff', bg: '#000000' }]])
  expect(glyph(K, W, W, K)).toEqual([[{ text: '▞', fg: '#ffffff', bg: '#000000' }]])
  expect(glyph(K, K, K, W)).toEqual([[{ text: '▛', fg: '#000000', bg: '#ffffff' }]])
})

test('each half of a cell is the average of its pixels', async () => {
  expect(toRows(cell([250, 0, 0], [254, 0, 0], [0, 0, 250], [0, 0, 254]), 2, 2, 1)).toEqual([
    [{ text: '▀', fg: '#fc0000', bg: '#0000fc' }],
  ])
})

test('neighbours of the same two colours merge into one run, whatever their blocks', async () => {
  expect(toRows(new Uint8Array(4 * 2 * 3), 4, 2, 4)).toEqual([[{ text: '▀▀▀▀', fg: '#000000', bg: '#000000' }]])
  expect(toRows(cell(W, K, W, K, W, K, K, K), 4, 2, 2)).toEqual([[{ text: '▌▘', fg: '#ffffff', bg: '#000000' }]])
})

test('an odd height repeats its last pixel row', async () => {
  const rows = toRows(new Uint8Array(2 * 3 * 3), 2, 3, 1)

  expect(rows).toHaveLength(2)
  expect(rows[1]).toEqual([{ text: '▀', fg: '#000000', bg: '#000000' }])
})

test('a picture wider than the room it has is cut at the room', async () => {
  expect(toRows(new Uint8Array(8 * 2 * 3), 8, 2, 4, 3)).toEqual([[{ text: '▀▀▀', fg: '#000000', bg: '#000000' }]])
})

/** The rows of a picture one cell big: two pixels across, `down` of them down. */
function oneCell(down: number, ...pixels: number[][]) {
  const made = cellsOf(cell(...pixels), 2, down, down)

  return rowsOf(made.cells, made.columns, made.rows, down)
}

test('a cell of quarter blocks is split where its widest colour channel divides', async () => {
  expect(oneCell(2, W, K, W, K)).toEqual([[{ text: '▌', fg: '#ffffff', bg: '#000000' }]])
  expect(oneCell(2, W, K, K, K)).toEqual([[{ text: '▘', fg: '#ffffff', bg: '#000000' }]])
  expect(oneCell(2, K, K, K, W)).toEqual([[{ text: '▗', fg: '#ffffff', bg: '#000000' }]])
  expect(oneCell(2, [250, 0, 0], [254, 0, 0], [0, 0, 250], [0, 0, 254])).toEqual([
    [{ text: '▀', fg: '#fc0000', bg: '#0000fc' }],
  ])
})

test('a cell of octant blocks holds two pixels across and four down', async () => {
  expect(oneCell(4, W, W, W, W, K, K, K, K)).toEqual([[{ text: '▀', fg: '#ffffff', bg: '#000000' }]])
  expect(oneCell(4, W, K, W, K, W, K, W, K)).toEqual([[{ text: '▌', fg: '#ffffff', bg: '#000000' }]])
  expect(oneCell(4, K, K, W, K, K, K, K, K)).toEqual([[{ text: '\u{1CD00}', fg: '#ffffff', bg: '#000000' }]])
})

test('a pattern with no octant of its own is drawn as its opposite, the colours swapped', async () => {
  expect(oneCell(4, W, K, K, K, K, K, K, K)).toEqual([[{ text: '\u{1CDE5}', fg: '#000000', bg: '#ffffff' }]])
})

test('a cell of one colour is a full block', async () => {
  expect(oneCell(2, K, K, K, K)).toEqual([[{ text: '█', fg: '#000000', bg: '#000000' }]])
  expect(oneCell(4, W, W, W, W, W, W, W, W)).toEqual([[{ text: '█', fg: '#ffffff', bg: '#ffffff' }]])
})

test('the octant characters are the patterns in order, less those other blocks already draw', async () => {
  // From Unicode 16's names: BLOCK OCTANT-3, -23, -15, -1234567, -2345678.
  expect([4, 6, 17, 127, 254].map(octant)).toEqual(['\u{1CD00}', '\u{1CD01}', '\u{1CD0A}', '\u{1CD70}', '\u{1CDE5}'])
  expect([15, 85, 192, 255].map(octant)).toEqual(['▀', '▌', '▂', '█'])
  for (let pattern = 1; pattern < 255; pattern++) {
    expect(octant(pattern) ?? octant(255 - pattern)).toBeDefined()
  }
})

test('cells of the same two colours merge into one run, and a picture is cut at the room it has', async () => {
  const made = cellsOf(cell(W, K, W, K, W, K, K, K), 4, 2, 2)
  const black = cellsOf(new Uint8Array(8 * 2 * 3), 8, 2, 2)

  expect(rowsOf(made.cells, made.columns, made.rows, 2)).toEqual([[{ text: '▌▘', fg: '#ffffff', bg: '#000000' }]])
  expect([black.columns, black.rows]).toEqual([4, 1])
  expect(rowsOf(black.cells, 4, 1, 2, 3)).toEqual([[{ text: '███', fg: '#000000', bg: '#000000' }]])
})

test('a height that is not whole cells repeats its last pixel row', async () => {
  const made = cellsOf(new Uint8Array(2 * 5 * 3), 2, 5, 4)

  expect([made.columns, made.rows]).toEqual([1, 2])
  expect(rowsOf(made.cells, 1, 2, 4)).toHaveLength(2)
})

test('for a cell taller than two to one a picture is made shorter, for a squatter one narrower, never larger', async () => {
  // 2 across, 4 down: the rows are 0, 100, 200, 100 in every channel.
  const rgb = new Uint8Array([0, 0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 200, 200, 200, 200, 200, 200, 100, 100, 100, 100, 100, 100])
  const image = { width: 2, height: 4, rgb }

  expect(forCell(image, 2)).toBe(image)
  // A cell four times as tall as wide: half the rows, each the average of two.
  expect(forCell(image, 4)).toEqual({ width: 2, height: 2, rgb: new Uint8Array([50, 50, 50, 50, 50, 50, 150, 150, 150, 150, 150, 150]) })
  // A square cell: half the columns, the rows as they were.
  expect(forCell(image, 1)).toEqual({ width: 1, height: 4, rgb: new Uint8Array([0, 0, 0, 100, 100, 100, 200, 200, 200, 100, 100, 100]) })
})
