import { expect, test } from 'claude-code/testing'

import type { Recent, Thumb } from '../types'
import { addPending, addToRecent, addToRow, KEEP_PENDING, KEEP_PICTURES, staleFolders, waitingFor, withoutPicture } from './store'

const thumb = (openPath: string, rgb = 'AAAA'): Thumb => ({
  openPath,
  name: openPath,
  width: 4,
  height: 4,
  columns: 2,
  rows: 1,
  pxH: 2,
  rgb,
})

test('a row lists its images in the order they came', async () => {
  const row = addToRow(addToRow({ images: [] }, thumb('a.png')), thumb('b.png'))

  expect(row.images.map(one => one.openPath)).toEqual(['a.png', 'b.png'])
})

test('an image seen twice under one row is shown once, as last seen', async () => {
  const row = addToRow(addToRow({ images: [thumb('a.png', 'OLD_')] }, thumb('b.png')), thumb('a.png', 'NEW_'))

  expect(row.images.map(one => [one.openPath, one.rgb])).toEqual([
    ['a.png', 'NEW_'],
    ['b.png', 'AAAA'],
  ])
})

test('the newest image is last in the recent list', async () => {
  const first = addToRecent([], { rowId: 'r1', openPath: 'a.png' })
  const second = addToRecent(first.recent, { rowId: 'r2', openPath: 'b.png' })

  expect(second.recent).toEqual([
    { rowId: 'r1', openPath: 'a.png' },
    { rowId: 'r2', openPath: 'b.png' },
  ])
  expect(second.dropped).toEqual([])
})

test('the same image under the same row moves to the end, not in twice', async () => {
  const start: Recent = [
    { rowId: 'r1', openPath: 'a.png' },
    { rowId: 'r2', openPath: 'b.png' },
  ]

  expect(addToRecent(start, { rowId: 'r1', openPath: 'a.png' }).recent).toEqual([
    { rowId: 'r2', openPath: 'b.png' },
    { rowId: 'r1', openPath: 'a.png' },
  ])
})

test('the forty-first image drops the first one out of the pictures kept', async () => {
  let recent: Recent = []
  for (let n = 0; n < KEEP_PICTURES; n++) recent = addToRecent(recent, { rowId: `r${n}`, openPath: `${n}.png` }).recent

  const added = addToRecent(recent, { rowId: 'new', openPath: 'new.png' })

  expect(KEEP_PICTURES).toBe(40)
  expect(added.dropped).toEqual([{ rowId: 'r0', openPath: '0.png' }])
  expect(added.recent).toHaveLength(41)
})

test('a row that lost its picture keeps the name and the click', async () => {
  const row = withoutPicture({ images: [{ ...thumb('a.png'), png: 'iVBO' }, thumb('b.png')] }, 'a.png')

  expect(row.images[0]).toEqual({ openPath: 'a.png', name: 'a.png', width: 4, height: 4, columns: 0, rows: 0 })
  expect(row.images[1]?.rgb).toBe('AAAA')
})

test('only the mod\u0027s own session folders older than seven days are stale', async () => {
  const day = 24 * 60 * 60 * 1000
  const now = 1_700_000_000_000
  const names = ['s1000', `s${now - 8 * day}`, `s${now - 6 * day}`, `s${now}`, 'other', 's12x', 's', '..']

  expect(staleFolders(names, now)).toEqual(['s1000', `s${now - 8 * day}`])
})

const waiting = (text: string, notFor: string[] = []) => ({ text, images: [thumb('p.png')], notFor })

test('a pasted image waits for the message row that carries its text', async () => {
  const pending = [waiting('look [Image #1]'), waiting('other [Image #2]')]

  expect(waitingFor(pending, 'other [Image #2]', 'u9')?.text).toBe('other [Image #2]')
  expect(waitingFor(pending, 'no such text', 'u9')).toBeUndefined()
})

test('a row that was on screen before the prompt was sent does not take its image', async () => {
  const pending = [waiting('look [Image #1]', ['u0'])]

  expect(waitingFor(pending, 'look [Image #1]', 'u0')).toBeUndefined()
  expect(waitingFor(pending, 'look [Image #1]', 'u1')).toBeDefined()
})

test('of two prompts with the same text the older waits first', async () => {
  const first = { ...waiting('same'), images: [thumb('first.png')] }
  const second = { ...waiting('same'), images: [thumb('second.png')] }

  expect(waitingFor([first, second], 'same', 'u1')?.images[0]?.openPath).toBe('first.png')
})

test('only the newest twenty pasted prompts keep waiting', async () => {
  let pending = [waiting('0')]
  for (let n = 1; n <= KEEP_PENDING; n++) pending = addPending(pending, waiting(String(n)))

  expect(KEEP_PENDING).toBe(20)
  expect(pending).toHaveLength(20)
  expect(pending[0]?.text).toBe('1')
})
