import { expect, test } from 'claude-code/testing'

import { baseName, fileUrl, isAbsolute, isImagePath, resolvePath, scanImagePaths } from './paths'

test('an image is told by its extension, in any case', async () => {
  expect(isImagePath('a/B.PNG')).toBe(true)
  expect(isImagePath('shot.jpeg')).toBe(true)
  expect(isImagePath('notes.png.txt')).toBe(false)
  expect(isImagePath('png')).toBe(false)
})

test('image paths are found in text once each, in order', async () => {
  expect(scanImagePaths('saved to out/plot.png and out/plot.png.')).toEqual(['out/plot.png'])
  expect(scanImagePaths('see (./b.webp), c.gif;')).toEqual(['./b.webp', 'c.gif'])
  expect(scanImagePaths('no images here.')).toEqual([])
  expect(scanImagePaths('plot --out=a/b.png')).toEqual(['a/b.png'])
})

test('a Git Bash drive path on Windows becomes a Windows path', async () => {
  expect(resolvePath('/c/Users/me/a.png', 'C:\\proj')).toBe('C:\\Users\\me\\a.png')
  expect(resolvePath('/c/Users/me/a.png', '/proj')).toBe('/c/Users/me/a.png')
})

test('a quoted path keeps its spaces, brackets and letters', async () => {
  expect(scanImagePaths('wrote "C:\\Users\\me\\my shot (1).png" ok')).toEqual(['C:\\Users\\me\\my shot (1).png'])
  expect(scanImagePaths("open '/tmp/çizim 2.jpg'")).toEqual(['/tmp/çizim 2.jpg'])
})

test('a web address is not a file path', async () => {
  expect(scanImagePaths('see https://x.dev/a.png and b.png')).toEqual(['b.png'])
  expect(scanImagePaths('"https://x.dev/a b.png"')).toEqual([])
})

test('a relative path is resolved against the working folder', async () => {
  expect(resolvePath('out/a.png', 'C:\\proj')).toBe('C:\\proj\\out\\a.png')
  expect(resolvePath('./out/a.png', '/proj')).toBe('/proj/out/a.png')
  expect(resolvePath('../a.png', '/proj/sub')).toBe('/proj/a.png')
})

test('an absolute path is left where it points', async () => {
  expect(isAbsolute('C:\\a.png')).toBe(true)
  expect(isAbsolute('C:/a.png')).toBe(true)
  expect(isAbsolute('/a.png')).toBe(true)
  expect(isAbsolute('\\\\server\\share\\a.png')).toBe(true)
  expect(isAbsolute('a.png')).toBe(false)
  expect(resolvePath('/abs/a.png', '/proj')).toBe('/abs/a.png')
  expect(resolvePath('D:/abs/a.png', 'C:\\proj')).toBe('D:\\abs\\a.png')
})

test('the file name is the last part of either kind of path', async () => {
  expect(baseName('C:\\x\\y z.png')).toBe('y z.png')
  expect(baseName('/x/y.png')).toBe('y.png')
  expect(baseName('y.png')).toBe('y.png')
})

test('a file address escapes what a link cannot hold', async () => {
  expect(fileUrl('C:\\a b\\x.png')).toBe('file:///C:/a%20b/x.png')
  expect(fileUrl('/tmp/a#1.png')).toBe('file:///tmp/a%231.png')
})

test('a space a Unix shell escapes is part of the path, and the escapes are taken off', async () => {
  expect(scanImagePaths('open my\\ shot\\ \\(1\\).png now', true)).toEqual(['my shot (1).png'])
  // A quoted path is taken as it is written, and so is a Windows path.
  expect(scanImagePaths('open "a\\b.png" C:\\x\\c.png', true)).toEqual(['a\\b.png', 'C:\\x\\c.png'])
  // A network path is still seen as one, with or without escapes.
  expect(scanImagePaths('see \\/\\/host/x.png', true)).toEqual(['//host/x.png'])
  // On Windows a backslash parts folders, and a space ends a word.
  expect(scanImagePaths('robocopy C:\\src\\ C:\\dst\\ shot.png')).toEqual(['shot.png'])
  expect(resolvePath('sub\\a.png', 'C:\\proj')).toBe('C:\\proj\\sub\\a.png')
})

test('a path that starts at ~ starts at the home folder, where that is known', async () => {
  expect(resolvePath('~/Desktop/a.png', '/proj', '/Users/me')).toBe('/Users/me/Desktop/a.png')
  expect(resolvePath('~/a.png', 'C:\\proj', 'C:\\Users\\me')).toBe('C:\\Users\\me\\a.png')
  expect(resolvePath('~/a.png', '/proj')).toBe('/proj/~/a.png')
})
