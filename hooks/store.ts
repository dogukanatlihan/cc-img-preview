// What the mod remembers of the images it has seen, as plain values: the
// thumbnails under each row, and the order they came in. Pure.
import type { Pending, Recent, RowThumbs } from '../types'

/** How many of the newest images keep their picture. */
export const KEEP_PICTURES = 40
/** How many of the newest images `/img` can still open. */
export const KEEP_RECENT = 200

type Entry = Recent[number]

const same = (a: Entry, b: Entry) => a.rowId === b.rowId && a.openPath === b.openPath

/** The row with `thumb` in it: in place of the same image, else at the end. */
export function addToRow(row: RowThumbs, thumb: RowThumbs['images'][number]): RowThumbs {
  const isKnown = row.images.some(one => one.openPath === thumb.openPath)

  return {
    images: isKnown
      ? row.images.map(one => (one.openPath === thumb.openPath ? thumb : one))
      : [...row.images, thumb],
  }
}

/**
 * The list with `entry` newest, and the entries that fell out of the newest
 * forty by it: theirs are the pictures to drop.
 */
export function addToRecent(recent: Recent, entry: Entry): { recent: Recent; dropped: Recent } {
  const before = recent.slice(-KEEP_PICTURES)
  const next = [...recent.filter(one => !same(one, entry)), entry].slice(-KEEP_RECENT)
  const kept = next.slice(-KEEP_PICTURES)

  return { recent: next, dropped: before.filter(one => !kept.some(other => same(one, other))) }
}

/** The row with one image's picture let go: its name and click stay. */
export function withoutPicture(row: RowThumbs, openPath: string): RowThumbs {
  return {
    images: row.images.map(one =>
      one.openPath === openPath
        ? { openPath: one.openPath, name: one.name, width: one.width, height: one.height, columns: 0, rows: 0 }
        : one,
    ),
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Which of the names in the mod's temp folder are its own session folders,
 * `s<start time>`, begun more than seven days ago: those are cleared.
 */
export function staleFolders(names: readonly string[], now: number): string[] {
  return names.filter(name => /^s\d+$/.test(name) && Number(name.slice(1)) < now - SEVEN_DAYS_MS)
}

/** How many pasted prompts wait for their message row at once. */
export const KEEP_PENDING = 20

/** The list with one more pasted prompt waiting, the oldest let go past twenty. */
export function addPending(pending: readonly Pending[], entry: Pending): Pending[] {
  return [...pending, entry].slice(-KEEP_PENDING)
}

/**
 * The pasted images waiting for the message row `requestId` that shows
 * `text`: the oldest prompt of that text, unless the row was already on
 * screen before that prompt was sent (an earlier message of the same words).
 */
export function waitingFor(pending: readonly Pending[], text: string, requestId: string): Pending | undefined {
  return pending.find(one => one.text === text && !one.notFor.includes(requestId))
}
