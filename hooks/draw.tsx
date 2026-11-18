// What one image looks like under a row: its picture, then its name and size.
import type { Elements, RenderElement } from 'claude-code'

import type { Mode, Thumb } from '../types'

import { fileUrl } from './paths'
import { rowsOf, toRows } from './pixels'

type Table = Elements['terminal']

/** `a.png  1280x720`, the name a link to the file for the terminal's own click. */
function Caption(
  els: Table,
  thumb: Thumb,
  index: number,
  onOpen: () => void,
  hasButton: boolean,
  extra?: RenderElement,
): RenderElement {
  const { Box, Text, Link, Button } = els
  const size = thumb.width > 0 && thumb.height > 0 ? `  ${thumb.width}x${thumb.height}` : ''

  return (
    <Box flexDirection="row">
      <Text dimColor>
        <Link href={fileUrl(thumb.openPath)} label={thumb.name} />
        {size}
      </Text>
      {hasButton && <Text> </Text>}
      {hasButton && <Button key={`img${index}-open`} label="open" onPress={onOpen} />}
      {extra}
    </Box>
  )
}

/** How a picture is drawn: the session's mode, or by the Sixel painter. */
export type Draw = Mode | 'sixel'

/** Dark enough to pass unseen in the moment before the painter covers it. */
const MARKER_COLOR = '#2a2a2a'

/**
 * The blank braille pattern: it draws nothing, and is no space. The 256
 * braille patterns from it on stand for the numbers 0 to 255.
 */
const BRAILLE = 0x2800

/**
 * The name the painter knows a picture by, and its file (`<name>.six.bmp`):
 * six hex digits made of `seed`, which three braille characters spell.
 */
export function pictureId(seed: string): string {
  // FNV-1a, folded to 24 bits.
  let hash = 0x811c9dc5
  for (let at = 0; at < seed.length; at++) hash = Math.imul(hash ^ seed.charCodeAt(at), 0x01000193)

  return (((hash >>> 24) ^ hash) & 0xffffff).toString(16).padStart(6, '0')
}

/**
 * What tells the Sixel painter (helpers/sixel.cs) that row `row` of picture
 * `id` belongs on this row of the screen, from this column: the row's number
 * as one braille character, a thin bar, and the picture's name as three more.
 * The painter reads the screen for it; prose holds no such run of characters.
 *
 * A name an earlier version gave is no six hex digits: it is written out,
 * with a second bar to end it.
 */
export function markerOf(id: string, row: number): string {
  const start = String.fromCharCode(BRAILLE + Math.min(row, 255), 0x2595)
  if (!/^[0-9a-f]{6}$/.test(id)) return start + id + String.fromCharCode(0x258f)

  return start + String.fromCharCode(...[0, 2, 4].map(at => BRAILLE + parseInt(id.slice(at, at + 2), 16)))
}

/** A stretch of cells in one pair of colours; no `bg` is the terminal's own. */
type Stretch = { text: string; fg: string; bg?: string }

const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

/** The colour half way between two. */
const between = (a: string, b: string) => {
  const [first, second] = [channels(a), channels(b)]

  return '#' + first.map((value, at) => Math.round((value + second[at]!) / 2).toString(16).padStart(2, '0')).join('')
}

/**
 * One row of a picture the painter draws, `columns` cells wide: what Claude
 * Code itself puts there, for the painter to cover with real pixels.
 *
 * `under` is that row of the block thumbnail. It shows wherever the real
 * picture is not there yet or not there any more: on the rows a scroll has
 * just brought into view, in the frame before the painter has caught up, and
 * for good where no painter runs. The picture so moves with the text, coarse
 * for a moment, and is sharp again a moment later.
 *
 * The row's first cells hold the marker, each in the one colour of the cell
 * it stands on, so that it is read by the painter and seen by nobody. Cells
 * past the thumbnail hold blank braille. Every cell so holds a character, and
 * no two rows hold the same: when a row moves, Claude Code writes each of its
 * cells anew, which clears the picture from where it was.
 */
export function sixelRow(id: string, row: number, columns: number, under: readonly Stretch[] = []): Stretch[] {
  const marker = [...markerOf(id, row)]
  const beneath: Stretch[] = []
  for (const run of under) for (const text of run.text) beneath.push({ ...run, text })

  const runs: Stretch[] = []
  for (let cell = 0; cell < columns; cell++) {
    const below = beneath[cell]
    const mark = marker[cell]
    let next: Stretch
    if (mark !== undefined && below?.bg !== undefined) {
      const hidden = between(below.fg, below.bg)
      next = { text: mark, fg: hidden, bg: hidden }
    } else if (mark !== undefined) next = { text: mark, fg: MARKER_COLOR }
    else next = below ?? { text: String.fromCharCode(BRAILLE), fg: MARKER_COLOR }

    const last = runs[runs.length - 1]
    if (last && last.fg === next.fg && last.bg === next.bg) last.text += next.text
    else runs.push({ ...next })
  }

  return runs
}

/**
 * One image under a row.
 *
 * Block mode draws the picture as block characters, each row of them a plain
 * Button, so a click anywhere on the picture opens the image. Pixel mode
 * draws real pixels, which take no click, so an open button sits by the name;
 * so it does where there is no picture to draw. Where the Sixel painter runs,
 * the rows only mark the place and the painter draws real pixels over them.
 *
 * `index` tells this image's keys from those of the others in the same tree.
 * `extra` is drawn at the end of the name's line. `room` is how many cells
 * across there are to draw in: a wider block picture is cut at it, a wider
 * real one drawn smaller.
 */
export function Thumbnail(
  els: Table,
  thumb: Thumb,
  index: number,
  mode: Draw,
  onOpen: () => void,
  extra?: RenderElement,
  room = Infinity,
): RenderElement {
  const { Box, Text, Button, Image } = els

  if (mode === 'pixel' && thumb.png !== undefined && thumb.columns > 0) {
    const columns = Math.max(1, Math.min(thumb.columns, Math.floor(room)))

    return (
      <Box flexDirection="column">
        <Image
          key={`img${index}`}
          source={{ png: thumb.png }}
          columns={columns}
          rows={Math.max(1, Math.round((thumb.rows * columns) / thumb.columns))}
          alt={thumb.name}
        />
        {Caption(els, thumb, index, onOpen, true, extra)}
      </Box>
    )
  }

  // The painter draws the picture itself, over rows that say which rows of it
  // they are and show the block thumbnail meanwhile. They are plain text, not
  // buttons: a button is drawn again whenever the pointer comes over it, and
  // what is drawn again wipes the picture on that row. So the image opens
  // from a button by its name.
  if (mode === 'sixel' && thumb.six !== undefined && thumb.six.columns <= room) {
    const { id, columns } = thumb.six
    const blocks =
      thumb.cells !== undefined && thumb.columns > 0
        ? rowsOf(Uint8Array.fromBase64(thumb.cells), thumb.columns, thumb.rows, thumb.down ?? 2, columns)
        : []

    return (
      <Box flexDirection="column">
        {Array.from({ length: thumb.six.rows }, (_, row) => (
          <Box key={`img${index}-s${row}`} flexDirection="row">
            {sixelRow(id, row, columns, blocks[row]).map(run =>
              run.bg === undefined ? (
                <Text color={run.fg}>{run.text}</Text>
              ) : (
                <Text color={run.fg} backgroundColor={run.bg}>
                  {run.text}
                </Text>
              ),
            )}
          </Box>
        ))}
        {Caption(els, thumb, index, onOpen, true, extra)}
      </Box>
    )
  }

  // Kept as cells; or as pixels, by an earlier version.
  const rows =
    thumb.columns === 0
      ? undefined
      : thumb.cells !== undefined
        ? rowsOf(Uint8Array.fromBase64(thumb.cells), thumb.columns, thumb.rows, thumb.down ?? 2, room)
        : thumb.rgb !== undefined && thumb.pxH !== undefined
          ? toRows(Uint8Array.fromBase64(thumb.rgb), thumb.pxW ?? thumb.columns, thumb.pxH, thumb.columns, room)
          : undefined
  if (rows === undefined) return Caption(els, thumb, index, onOpen, true, extra)

  return (
    <Box flexDirection="column">
      {rows.map((runs, row) => (
        <Button key={`img${index}-r${row}`} label={`open ${thumb.name}`} plain onPress={onOpen}>
          {runs.map(run => (
            <Text color={run.fg} backgroundColor={run.bg}>
              {run.text}
            </Text>
          ))}
        </Button>
      ))}
      {Caption(els, thumb, index, onOpen, false, extra)}
    </Box>
  )
}
