import { expect, test } from 'claude-code/testing'

import { canOpen, openerArgv } from './open'

test('macOS and Linux open a file with their own command, the path one whole argument', async () => {
  expect(openerArgv('darwin', '/tmp/a b.png', '/m')).toEqual(['open', '/tmp/a b.png'])
  expect(openerArgv('linux', '/tmp/a.png', '/m')).toEqual(['xdg-open', '/tmp/a.png'])
})

test('Windows opens through the helper, which takes the path literally: a comma or an ampersand splits nothing', async () => {
  expect(openerArgv('win32', 'C:/a b/tool.exe,icon&x.png', 'C:\\m')).toEqual([
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\m\\helpers\\thumb.ps1',
    '-Open',
    'C:\\a b\\tool.exe,icon&x.png',
  ])
})

test('no system is handed a shell or explorer.exe', async () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const argv = openerArgv(platform, 'C:\\p\\a.png', 'C:\\m')

    expect(argv).not.toContain('explorer.exe')
    expect(argv).not.toContain('cmd.exe')
  }
})

test('only an image the mod recorded may be opened', async () => {
  const recorded = new Set(['C:\\p\\a.png', 'C:\\p\\run.bat'])

  expect(canOpen('C:\\p\\a.png', recorded)).toBe(true)
  expect(canOpen('C:\\p\\other.png', recorded)).toBe(false)
  expect(canOpen('C:\\p\\run.bat', recorded)).toBe(false)
})
