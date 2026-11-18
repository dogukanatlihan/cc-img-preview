// From an image's size to a thumbnail's box, from a BMP file to pixels, and
// from pixels to rows of coloured block characters. Pure.
//
// A terminal cell is about twice as tall as wide and takes one character in
// two colours. A block character paints some parts of the cell in the first
// colour and leaves the rest to the second, so a cell can stand for several
// pixels as long as they are of two colours:
//   quarter blocks: 2 pixels across, 2 down. In every font.
//   octant blocks:  2 pixels across, 4 down. Unicode 16; few fonts have them.

export const MAX_COLUMNS = 80
export const MAX_ROWS = 40
/** No thumbnail is made smaller than this, however small the terminal. */
export const MIN_COLUMNS = 8
export const MIN_ROWS = 6

export type Blocks = 'quarter' | 'octant'

/** The room a thumbnail is made to fit, for the program that resizes the image. */
export type Box = {
  /** The room in square pixels. */
  width: number
  height: number
  /**
   * How many pixels are written for each one across that fits: 2 for quarter
   * blocks, whose pixels are half as wide as tall.
   */
  across: number
  /** How many pixel rows a row of cells holds. */
  down: number
}

/** The box of so many cells, for these blocks. */
export function boxFor(blocks: Blocks, columns = MAX_COLUMNS, rows = MAX_ROWS): Box {
  return blocks === 'octant'
    ? { width: columns * 2, height: rows * 4, across: 1, down: 4 }
    : { width: columns, height: rows * 2, across: 2, down: 2 }
}

/** The size in pixels of the largest thumbnail that fits the box, aspect kept, never enlarged. */
export function fitBox(width: number, height: number, box: Box): { pxW: number; pxH: number } {
  const scale = width > 0 && height > 0 ? Math.min(box.width / width, box.height / height, 1) : 0

  return {
    pxW: Math.max(1, Math.floor(width * scale)) * box.across,
    pxH: Math.max(1, Math.floor(height * scale)),
  }
}

/**
 * The pixels of an uncompressed 24-bit or 32-bit BMP, top row first, as
 * R, G, B bytes; undefined for any other file.
 */
export function parseBmp(bytes: Uint8Array): { width: number; height: number; rgb: Uint8Array } | undefined {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const signedHeight = view.getInt32(22, true)
  const bitsPerPixel = view.getUint16(28, true)
  const compression = view.getUint32(30, true)
  const height = Math.abs(signedHeight)
  const bytesPerPixel = bitsPerPixel / 8

  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) return undefined
  // 3 is BI_BITFIELDS, which a 32-bit file written by Windows may carry.
  if (compression !== 0 && !(compression === 3 && bitsPerPixel === 32)) return undefined
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return undefined

  const rowSize = Math.ceil((width * bitsPerPixel) / 32) * 4
  if (offset + rowSize * (height - 1) + width * bytesPerPixel > bytes.length) return undefined

  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const fileRow = signedHeight > 0 ? height - 1 - y : y
    const from = offset + fileRow * rowSize
    for (let x = 0; x < width; x++) {
      const source = from + x * bytesPerPixel
      const target = (y * width + x) * 3
      rgb[target] = bytes[source + 2]!
      rgb[target + 1] = bytes[source + 1]!
      rgb[target + 2] = bytes[source]!
    }
  }

  return { width, height, rgb }
}

/**
 * The picture at the shape that shows true in a cell `cellRatio` times as
 * tall as wide. The helpers make it for a cell twice as tall as wide: for a
 * taller cell it is made shorter, for a squatter one narrower, never larger.
 * Each new pixel is the average of the old ones it covers.
 */
export function forCell(
  image: { width: number; height: number; rgb: Uint8Array },
  cellRatio: number,
): { width: number; height: number; rgb: Uint8Array } {
  const squash = 2 / cellRatio
  const width = squash > 1 ? Math.max(1, Math.round(image.width / squash)) : image.width
  const height = squash < 1 ? Math.max(1, Math.round(image.height * squash)) : image.height
  if (width === image.width && height === image.height) return image

  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * image.height) / height)
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * image.height) / height))
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * image.width) / width)
      const right = Math.max(left + 1, Math.floor(((x + 1) * image.width) / width))
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let sy = top; sy < bottom; sy++) for (let sx = left; sx < right; sx++) sum += image.rgb[(sy * image.width + sx) * 3 + c]!
        rgb[(y * width + x) * 3 + c] = Math.round(sum / ((bottom - top) * (right - left)))
      }
    }
  }

  return { width, height, rgb }
}

/** One stretch of cells that share a foreground and a background colour. */
export type Run = { text: string; fg: string; bg: string }

/**
 * The block that paints each set of a cell's quarters in the foreground: bit
 * 0 is the top left quarter, bit 1 the top right, bit 2 the bottom left. The
 * bottom right is always background, which loses nothing: the other way
 * round is the same picture with the two colours swapped.
 */
const BLOCKS = ['', '▘', '▝', '▀', '▖', '▌', '▞', '▛']
/** Tried in this order, so a cell of one colour is the plain half block. */
const SPLITS = [3, 5, 6, 1, 2, 4, 7]

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('')

/**
 * Rows of quarter blocks for `width * height` R, G, B pixels drawn `columns`
 * cells across, two pixel rows to a row of cells. A cell has two colours, so
 * its four quarters are split into the two groups that lose least, each
 * painted its average.
 *
 * A picture stored one pixel a column (`width === columns`) comes out as
 * upper half blocks. `maxColumns` cuts a picture wider than the room it has.
 *
 * This draws the thumbnails an earlier version kept as pixels. One made now
 * is kept as cells: `cellsOf`, `rowsOf`.
 */
export function toRows(
  rgb: Uint8Array,
  width: number,
  height: number,
  columns = Math.ceil(width / 2),
  maxColumns = columns,
): Run[][] {
  const rows: Run[][] = []
  const shown = Math.max(1, Math.min(columns, Math.floor(maxColumns)))
  // The four quarters' offsets into `rgb`, in the order of BLOCKS' bits.
  const at = [0, 0, 0, 0]

  for (let y = 0; y < height; y += 2) {
    const runs: Run[] = []
    const lower = Math.min(y + 1, height - 1)

    for (let cell = 0; cell < shown; cell++) {
      const left = Math.floor((cell * 2 * width) / (columns * 2))
      const right = Math.floor(((cell * 2 + 1) * width) / (columns * 2))
      at[0] = (y * width + left) * 3
      at[1] = (y * width + right) * 3
      at[2] = (lower * width + left) * 3
      at[3] = (lower * width + right) * 3

      let best = { block: '', fg: '', bg: '', loss: Infinity }
      for (const split of SPLITS) {
        // Sums of R, G, B and a count, for the foreground then the background.
        const sums = [0, 0, 0, 0, 0, 0, 0, 0]
        for (let quarter = 0; quarter < 4; quarter++) {
          const group = (split >> quarter) & 1 ? 0 : 4
          for (let channel = 0; channel < 3; channel++) sums[group + channel]! += rgb[at[quarter]! + channel]!
          sums[group + 3]!++
        }
        const mean = sums.map((sum, index) => sum / sums[index < 4 ? 3 : 7]!)

        let loss = 0
        for (let quarter = 0; quarter < 4; quarter++) {
          const group = (split >> quarter) & 1 ? 0 : 4
          for (let channel = 0; channel < 3; channel++) loss += (rgb[at[quarter]! + channel]! - mean[group + channel]!) ** 2
        }
        if (loss < best.loss) {
          best = { block: BLOCKS[split]!, fg: hex(mean[0]!, mean[1]!, mean[2]!), bg: hex(mean[4]!, mean[5]!, mean[6]!), loss }
        }
      }

      const last = runs[runs.length - 1]
      if (last && last.fg === best.fg && last.bg === best.bg) last.text += best.block
      else runs.push({ text: best.block, fg: best.fg, bg: best.bg })
    }
    rows.push(runs)
  }

  return rows
}

/**
 * The quarter block for each pattern of a cell's four pixels: bit 0 is the
 * top left, bit 1 the top right, bit 2 the bottom left, bit 3 the bottom right.
 */
const QUARTERS = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']

/** The octant patterns of each quarter of a cell: bit `2 * row + column`, four rows of two. */
const QUARTER_OF_OCTANTS = [0b00000101, 0b00001010, 0b01010000, 0b10100000]

/**
 * The block for each pattern of a cell's eight pixels, bit `2 * row + column`.
 *
 * Unicode's octants (U+1CD00 to U+1CDE5) are the patterns in ascending order,
 * less the 26 that older characters already draw. Of those, the 18 in the
 * Block Elements range are used; the 8 from rarer ranges are left out, and
 * drawn as their opposite with the two colours swapped.
 */
const OCTANTS: (string | undefined)[] = (() => {
  const blocks: (string | undefined)[] = new Array(256).fill(undefined)
  const elsewhere = new Set([0b11, 0b111111, 0b1, 0b10, 0b1000000, 0b10000000, 0b10100, 0b101000])

  QUARTERS.forEach((block, quarters) => {
    const pattern = QUARTER_OF_OCTANTS.reduce((bits, mask, quarter) => ((quarters >> quarter) & 1 ? bits | mask : bits), 0)
    blocks[pattern] = block
  })
  blocks[0b11000000] = '▂'
  blocks[0b11111100] = '▆'

  let next = 0x1cd00
  for (let pattern = 0; pattern < 256; pattern++) {
    if (blocks[pattern] === undefined && !elsewhere.has(pattern)) blocks[pattern] = String.fromCodePoint(next++)
  }

  return blocks
})()

/** The octant block that paints this pattern; undefined for the few patterns that have none. */
export function octant(pattern: number): string | undefined {
  return OCTANTS[pattern]
}

/** How many bytes a cell is kept in: its pattern, then its two colours. */
const CELL_BYTES = 7

/**
 * A picture as cells, each two pixels across and `down` pixel rows tall.
 *
 * A cell has two colours, so its pixels are split in two groups at the middle
 * of the colour channel that varies most among them, and each group is painted
 * its average. Kept as 7 bytes a cell, row by row: the pattern of the pixels
 * in the first colour (bit `2 * row + column`), the first colour's R, G, B,
 * then the second's. The pattern is always one `rowsOf` has a block for.
 */
export function cellsOf(
  rgb: Uint8Array,
  width: number,
  height: number,
  down: number,
): { columns: number; rows: number; cells: Uint8Array } {
  const columns = Math.ceil(width / 2)
  const rows = Math.ceil(height / down)
  const cells = new Uint8Array(columns * rows * CELL_BYTES)
  const count = down * 2
  const full = (1 << count) - 1
  const at = new Array<number>(count).fill(0)

  for (let row = 0; row < rows; row++) {
    for (let cell = 0; cell < columns; cell++) {
      // A picture that ends part way through a cell repeats its last row or column.
      for (let pixel = 0; pixel < count; pixel++) {
        const x = Math.min(cell * 2 + (pixel & 1), width - 1)
        const y = Math.min(row * down + (pixel >> 1), height - 1)
        at[pixel] = (y * width + x) * 3
      }

      let channel = 0
      let middle = 0
      let widest = -1
      for (let c = 0; c < 3; c++) {
        let low = 255
        let high = 0
        for (const offset of at) {
          low = Math.min(low, rgb[offset + c]!)
          high = Math.max(high, rgb[offset + c]!)
        }
        if (high - low > widest) {
          widest = high - low
          channel = c
          middle = (high + low) / 2
        }
      }

      let pattern = 0
      // R, G, B and a count, of the first colour's pixels then the second's.
      const sums = [0, 0, 0, 0, 0, 0, 0, 0]
      at.forEach((offset, pixel) => {
        const isFirst = rgb[offset + channel]! > middle
        const group = isFirst ? 0 : 4
        if (isFirst) pattern |= 1 << pixel
        for (let c = 0; c < 3; c++) sums[group + c]! += rgb[offset + c]!
        sums[group + 3]!++
      })

      let first = [0, 1, 2].map(c => Math.round(sums[c]! / Math.max(1, sums[3]!)))
      let second = [4, 5, 6].map(c => Math.round(sums[c]! / Math.max(1, sums[7]!)))
      if (pattern === 0) {
        // One colour: a full block of it.
        pattern = full
        first = second
      } else if (down === 4 && OCTANTS[pattern] === undefined) {
        pattern = full - pattern
        ;[first, second] = [second, first]
      }

      cells.set([pattern, ...first, ...second], (row * columns + cell) * CELL_BYTES)
    }
  }

  return { columns, rows, cells }
}

/**
 * The rows of blocks that draw `cells` (as `cellsOf` made them), neighbours of
 * the same two colours merged into one run. `maxColumns` cuts a picture wider
 * than the room it has.
 */
export function rowsOf(cells: Uint8Array, columns: number, rows: number, down: number, maxColumns = columns): Run[][] {
  const drawn: Run[][] = []
  const shown = Math.max(1, Math.min(columns, Math.floor(maxColumns)))
  const blocks = down === 4 ? OCTANTS : QUARTERS
  const colour = (from: number) => hex(cells[from]!, cells[from + 1]!, cells[from + 2]!)

  for (let row = 0; row < rows; row++) {
    const runs: Run[] = []
    for (let cell = 0; cell < shown; cell++) {
      const from = (row * columns + cell) * CELL_BYTES
      if (from + CELL_BYTES > cells.length) break
      const block = blocks[cells[from]!] ?? '█'
      const fg = colour(from + 1)
      const bg = colour(from + 4)
      const last = runs[runs.length - 1]
      if (last && last.fg === fg && last.bg === bg) last.text += block
      else runs.push({ text: block, fg, bg })
    }
    drawn.push(runs)
  }

  return drawn
}
