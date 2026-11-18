export type Thumb = {
  /** The file a click opens. */
  openPath: string
  name: string
  /** The original image's size in pixels; 0 when unknown. */
  width: number
  height: number
  /** The thumbnail's size in terminal cells; 0 and 0 when there is no picture. */
  columns: number
  rows: number
  /**
   * Block mode: base64 of columns * rows cells, 7 bytes each (which of the
   * cell's pixels are in its first colour, then its two colours), and how
   * many pixel rows a cell holds: 2 for quarter blocks, 4 for octant blocks.
   */
  cells?: string
  down?: number
  /**
   * Block mode as earlier versions kept it: base64 of pxW * pxH * 3 bytes of
   * RGB, drawn two pixel rows to a cell. With no `pxW` it is `columns` wide.
   */
  rgb?: string
  pxW?: number
  pxH?: number
  /** Pixel mode: a base64 PNG. */
  png?: string
  /**
   * Windows Terminal: the full-size picture the Sixel painter draws, kept as
   * the file `<id>.six.bmp`, and how many cells it takes.
   */
  six?: { id: string; columns: number; rows: number }
}

export type RowThumbs = { images: Thumb[] }

/** Newest last. */
export type Recent = { rowId: string; openPath: string }[]

/**
 * Pasted images waiting for the message row that shows `text`. `notFor`: the
 * rows already on screen when the prompt was sent, which are other messages.
 */
export type Pending = { text: string; images: Thumb[]; notFor: string[] }

export type Mode = 'block' | 'pixel'

declare module 'claude-code' {
  interface PluginState {
    'cc-img': {
      rows: StateFamily<Shaped<RowThumbs>>
      recent: Shaped<Recent>
      mode: Shaped<Mode>
      pending: Shaped<Pending[]>
    }
  }
}
