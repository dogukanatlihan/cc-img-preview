import { expect, test } from 'claude-code/testing'

import { markerOf, pictureId, sixelRow } from './draw'

const BLANK = String.fromCharCode(0x2800)
const BAR = String.fromCharCode(0x2595)
const cells = (text: string) => [...text].length
const textOf = (runs: { text: string }[]) => runs.map(run => run.text).join('')

test('a marker is the row as one braille character, a bar, and the picture name as three more', async () => {
  const marker = markerOf('0a1bff', 7)

  expect([...marker].map(c => c.charCodeAt(0))).toEqual([0x2807, 0x2595, 0x280a, 0x281b, 0x28ff])
})

test('a picture named by an earlier version keeps the longer marker the painter also knows', async () => {
  expect(markerOf('tongiin5', 2)).toBe(String.fromCharCode(0x2802) + BAR + 'tongiin5' + String.fromCharCode(0x258f))
})

test('a picture name is six hex digits, the same for the same seed and another for another', async () => {
  expect(pictureId('k3x9:1')).toMatch(/^[0-9a-f]{6}$/)
  expect(pictureId('k3x9:1')).toBe(pictureId('k3x9:1'))
  expect(pictureId('k3x9:1')).not.toBe(pictureId('k3x9:2'))
})

test('a row of a picture shows the block thumbnail beneath it, cell for cell', async () => {
  const under = [{ text: '▀'.repeat(8), fg: '#ff0000', bg: '#0000ff' }]

  const runs = sixelRow('0a1bff', 0, 8, under)

  // The marker takes five cells, each in the one colour of the cell it covers:
  // what it says is for the painter to read, not for anyone to see.
  expect(runs[0]).toEqual({ text: markerOf('0a1bff', 0), fg: '#800080', bg: '#800080' })
  expect(runs[1]).toEqual({ text: '▀▀▀', fg: '#ff0000', bg: '#0000ff' })
  expect(runs).toHaveLength(2)
})

test('a row is as many cells as the picture is wide, whatever the thumbnail beneath', async () => {
  const octant = String.fromCodePoint(0x1cd00)
  const narrow = sixelRow('0a1bff', 3, 12, [{ text: octant.repeat(7), fg: '#101010', bg: '#303030' }])
  const wide = sixelRow('0a1bff', 3, 6, [{ text: octant.repeat(20), fg: '#101010', bg: '#303030' }])
  const none = sixelRow('0a1bff', 3, 12)

  expect([cells(textOf(narrow)), cells(textOf(wide)), cells(textOf(none))]).toEqual([12, 6, 12])
  // Where there is no thumbnail the cells hold blank braille: nothing to see, and no blanks.
  expect(textOf(narrow).endsWith(BLANK.repeat(5))).toBe(true)
  expect(textOf(none)).toBe(markerOf('0a1bff', 3) + BLANK.repeat(7))
  expect(/\s/.test(textOf(none) + textOf(narrow))).toBe(false)
})
