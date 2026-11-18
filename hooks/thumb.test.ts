import { expect, test } from 'claude-code/testing'

import { detectEnv, helperFor, makeThumb, removeArgv, saveBase64 } from './thumb'
import type { Env, RunProcess } from './thumb'

const none = { ffmpeg: false, magick: false, rsvg: false }
const win: Env = { platform: 'win32', root: 'C:\\m', tempDir: 'C:\\t', tools: none }
const mac: Env = { platform: 'darwin', root: '/m', tempDir: '/t', tools: none }
const linux: Env = { platform: 'linux', root: '/m', tempDir: '/t', tools: none }

type Ran = { argv: readonly string[]; init?: { stdin?: string; timeoutMs?: number } }
type Answer = { exitCode: number; stdout: string }

/** Stands for `$.process.run`: records each run and answers as told. */
function fake(answer: (argv: readonly string[]) => Answer) {
  const runs: Ran[] = []
  const run: RunProcess = async (argv, init) => {
    runs.push({ argv, init })

    return answer(argv)
  }

  return { run, runs }
}

const ok = (stdout = ''): Answer => ({ exitCode: 0, stdout })
const failed: Answer = { exitCode: 1, stdout: '' }

test('Windows and macOS read the common formats with what they ship', async () => {
  expect(helperFor(win, 'a.PNG')).toBe('powershell')
  expect(helperFor(win, 'C:\\x\\photo.jpeg')).toBe('powershell')
  expect(helperFor(mac, 'a.jpg')).toBe('sips')
})

test('a format the system cannot read needs a tool that is installed', async () => {
  expect(helperFor(win, 'a.webp')).toBeUndefined()
  expect(helperFor({ ...win, tools: { ...none, ffmpeg: true } }, 'a.webp')).toBe('ffmpeg')
  expect(helperFor({ ...mac, tools: { ...none, magick: true } }, 'a.avif')).toBe('magick')
})

test('HEIC is read by sips on macOS and by ImageMagick elsewhere, and never by ffmpeg', async () => {
  const both = { ffmpeg: true, magick: true, rsvg: false }

  expect(helperFor(mac, 'IMG_0001.HEIC')).toBe('sips')
  expect(helperFor({ ...mac, tools: both }, 'a.heif')).toBe('sips')
  expect(helperFor(win, 'a.heic')).toBeUndefined()
  expect(helperFor({ ...win, tools: both }, 'a.heic')).toBe('magick')
  // An ffmpeg before 7.0 answers with one tile of a phone's photo.
  expect(helperFor({ ...linux, tools: { ...none, ffmpeg: true } }, 'a.heic')).toBeUndefined()

  const { run, runs } = fake(() => ok('4032 3024'))
  await makeThumb(run, { ...linux, tools: both }, { src: '/p/a.heif', id: 't1', png: false })
  expect(runs.find(one => one.argv[0] === 'magick')?.argv[1]).toBe('heic:/p/a.heif[0]')
})

test('Linux has no reader of its own', async () => {
  expect(helperFor(linux, 'a.png')).toBeUndefined()
  expect(helperFor({ ...linux, tools: { ...none, magick: true } }, 'a.png')).toBe('magick')
  expect(helperFor({ ...linux, tools: { ...none, ffmpeg: true } }, 'a.png')).toBe('ffmpeg')
})

test('an svg is drawn by ImageMagick, else rsvg-convert, never ffmpeg', async () => {
  expect(helperFor({ ...win, tools: { ...none, ffmpeg: true } }, 'a.svg')).toBeUndefined()
  expect(helperFor({ ...win, tools: { ...none, rsvg: true } }, 'a.svg')).toBe('rsvg')
  expect(helperFor({ ...win, tools: { ffmpeg: true, magick: true, rsvg: true } }, 'a.svg')).toBe('magick')
})

test('the Windows helper runs as an argument vector, five seconds at most, the path one whole argument', async () => {
  const { run, runs } = fake(() => ok('{"w":1280,"h":720}'))

  const made = await makeThumb(run, win, { src: 'C:\\p\\my shot (1).png', id: 't1', png: false })

  expect(runs).toHaveLength(1)
  expect(runs[0]?.argv[0]).toBe('powershell.exe')
  expect(runs[0]?.argv).toContain('C:\\p\\my shot (1).png')
  expect(runs[0]?.argv).toContain('C:\\m\\helpers\\thumb.ps1')
  expect(runs[0]?.init?.timeoutMs).toBe(5000)
  expect(made).toEqual({ width: 1280, height: 720, bmpPath: 'C:\\t\\t1.bmp' })
})

const boxOf = (argv: readonly string[] = []) =>
  ['-Width', '-Height', '-Across'].map(name => argv[argv.indexOf(name) + 1])

test('the Windows helper is told the box in pixels: 80 by 40 cells of quarter blocks, or what is asked for', async () => {
  const { run, runs } = fake(() => ok('{"w":1280,"h":720}'))

  await makeThumb(run, win, { src: 'C:\\p\\a.png', id: 't1', png: false })
  await makeThumb(run, win, { src: 'C:\\p\\a.png', id: 't2', png: false, columns: 20, rows: 10 })
  await makeThumb(run, win, { src: 'C:\\p\\a.png', id: 't3', png: false, blocks: 'octant' })

  expect(boxOf(runs[0]?.argv)).toEqual(['80', '80', '2'])
  expect(boxOf(runs[1]?.argv)).toEqual(['20', '20', '2'])
  expect(boxOf(runs[2]?.argv)).toEqual(['160', '160', '1'])
})

test('a PNG is asked for only in pixel mode', async () => {
  const { run, runs } = fake(() => ok('{"w":8,"h":8}'))

  const made = await makeThumb(run, win, { src: 'C:\\p\\a.png', id: 't1', png: true })

  expect(made?.pngPath).toBe('C:\\t\\t1.png')
  expect(runs[0]?.argv.slice(-2)).toEqual(['-Png', '1'])
})

test('a helper still running at the timeout gives nothing, and nothing is thrown', async () => {
  const run: RunProcess = async () => {
    throw new Error('timed out')
  }

  expect(await makeThumb(run, win, { src: 'C:\\p\\huge.png', id: 't2', png: false })).toBeUndefined()
})

test('a file that is not really an image gives nothing', async () => {
  const { run } = fake(() => failed)

  expect(await makeThumb(run, win, { src: 'C:\\p\\text.png', id: 't3', png: false })).toBeUndefined()
})

test('a helper that answers what is not a size gives nothing', async () => {
  const { run } = fake(() => ok('Windows PowerShell banner'))

  expect(await makeThumb(run, win, { src: 'C:\\p\\a.png', id: 't3', png: false })).toBeUndefined()
})

test('a format with no reader runs nothing', async () => {
  const { run, runs } = fake(() => ok())

  expect(await makeThumb(run, win, { src: 'C:\\p\\a.webp', id: 't4', png: false })).toBeUndefined()
  expect(runs).toHaveLength(0)
})

test('macOS asks sips for the size, then for a BMP of the fitted size', async () => {
  const { run, runs } = fake(() => ok('  pixelWidth: 1280\n  pixelHeight: 720\n'))

  const made = await makeThumb(run, mac, { src: '/p/a b.jpg', id: 't5', png: false })
  const sips = runs.filter(one => one.argv[0] === 'sips')

  expect(sips).toHaveLength(2)
  expect(sips[1]?.argv).toEqual(['sips', '-s', 'format', 'bmp', '-z', '45', '160', '/p/a b.jpg', '--out', '/t/t5.bmp'])
  expect(made).toEqual({ width: 1280, height: 720, bmpPath: '/t/t5.bmp' })
})

test('ffmpeg fits the box without enlarging and cannot tell the size', async () => {
  const { run, runs } = fake(() => ok())
  const env = { ...win, tools: { ...none, ffmpeg: true } }

  const made = await makeThumb(run, env, { src: 'C:\\p\\a b.webp', id: 't6', png: false })
  const ffmpeg = runs.find(one => one.argv[0] === 'ffmpeg')

  expect(ffmpeg?.argv).toContain('C:\\p\\a b.webp')
  expect(ffmpeg?.argv).toContain(
    "scale='min(80,iw)':'min(80,ih)':force_original_aspect_ratio=decrease,scale=iw*2:ih",
  )
  expect(ffmpeg?.argv.slice(-1)).toEqual(['C:\\t\\t6.bmp'])
  expect(made).toEqual({ width: 0, height: 0, bmpPath: 'C:\\t\\t6.bmp' })
})

test('an svg drawn by rsvg-convert goes on through the system reader', async () => {
  const { run, runs } = fake(argv => (argv[0] === 'powershell.exe' ? ok('{"w":480,"h":480}') : ok()))
  const env = { ...win, tools: { ...none, rsvg: true } }

  const made = await makeThumb(run, env, { src: 'C:\\p\\d.svg', id: 't7', png: false })
  const drawn = runs.find(one => one.argv[0] === 'rsvg-convert')
  const read = runs.find(one => one.argv.includes('-Src'))

  expect(drawn?.argv.slice(-3)).toEqual(['-o', 'C:\\t\\t7.svg.png', 'C:\\p\\d.svg'])
  expect(read?.argv).toContain('C:\\t\\t7.svg.png')
  expect(made?.bmpPath).toBe('C:\\t\\t7.bmp')
})

test('ImageMagick is told the format by the file name, so it does not guess it from the content', async () => {
  const env = { ...linux, tools: { ...none, magick: true } }
  const sources = async (src: string) => {
    const { run, runs } = fake(() => ok('8 8'))
    await makeThumb(run, env, { src, id: 't8', png: true })

    return runs.filter(one => one.argv[0] === 'magick').map(one => one.argv[1])
  }

  expect(await sources('/p/a b.png')).toEqual(['png:/p/a b.png[0]', 'png:/p/a b.png[0]'])
  expect(await sources('/p/a.JPG')).toEqual(['jpeg:/p/a.JPG[0]', 'jpeg:/p/a.JPG[0]'])
  expect(await sources('/p/a.tif')).toEqual(['tiff:/p/a.tif[0]', 'tiff:/p/a.tif[0]'])
})

test('ImageMagick fits the box without enlarging, then doubles the width', async () => {
  const { run, runs } = fake(() => ok('1280 720'))

  await makeThumb(run, { ...linux, tools: { ...none, magick: true } }, { src: '/p/a.png', id: 't8', png: false, columns: 20 })
  const argv = runs.find(one => one.argv[0] === 'magick')?.argv ?? []

  expect(argv.slice(argv.indexOf('-thumbnail'), argv.indexOf('-thumbnail') + 4)).toEqual([
    '-thumbnail',
    '20x80>',
    '-resize',
    '200x100%',
  ])
})

test('for the Sixel painter the Windows helper also writes the picture at full size, and says how big it came out', async () => {
  const { run, runs } = fake(() => ok('{"w":1080,"h":1350,"sw":320,"sh":400}'))

  const made = await makeThumb(run, win, {
    src: 'C:\\p\\a.png',
    id: 't1',
    png: false,
    six: { id: 'k3x91', width: 400, height: 400 },
  })
  const argv = runs[0]?.argv ?? []

  expect(['-SixId', '-SixW', '-SixH'].map(name => argv[argv.indexOf(name) + 1])).toEqual(['k3x91', '400', '400'])
  expect(argv.slice(-2)).toEqual(['-Png', '0'])
  expect(made?.six).toEqual({ width: 320, height: 400 })
})

test('a helper that writes no full-size picture says nothing of one', async () => {
  const six = { id: 'k3x91', width: 400, height: 400 }
  const plain = fake(() => ok('{"w":1080,"h":1350}'))
  const ffmpeg = fake(() => ok())

  const fromWindows = await makeThumb(plain.run, win, { src: 'C:\\p\\a.png', id: 't1', png: false, six })
  const fromFfmpeg = await makeThumb(ffmpeg.run, { ...win, tools: { ...none, ffmpeg: true } }, { src: 'C:\\p\\a.webp', id: 't1', png: false, six })

  expect(fromWindows?.six).toBeUndefined()
  expect(fromFfmpeg?.six).toBeUndefined()
})

test('for octant blocks the pixels are square, so no helper widens the picture', async () => {
  const octant = { id: 't8', png: false, blocks: 'octant' as const }
  const magick = fake(() => ok('1280 720'))
  const ffmpeg = fake(() => ok())
  const sips = fake(() => ok('  pixelWidth: 1280\n  pixelHeight: 720\n'))

  await makeThumb(magick.run, { ...linux, tools: { ...none, magick: true } }, { ...octant, src: '/p/a.png' })
  await makeThumb(ffmpeg.run, { ...win, tools: { ...none, ffmpeg: true } }, { ...octant, src: 'C:\\p\\a.webp' })
  await makeThumb(sips.run, mac, { ...octant, src: '/p/a.jpg' })
  const drawn = magick.runs.find(one => one.argv[0] === 'magick')?.argv ?? []

  expect(drawn).toContain('160x160>')
  expect(drawn).not.toContain('-resize')
  expect(ffmpeg.runs.find(one => one.argv[0] === 'ffmpeg')?.argv).toContain(
    "scale='min(160,iw)':'min(160,ih)':force_original_aspect_ratio=decrease",
  )
  expect(sips.runs.filter(one => one.argv[0] === 'sips')[1]?.argv.slice(4, 7)).toEqual(['-z', '90', '160'])
})

test('ffmpeg is told to read an image, so a playlist named like one is not followed', async () => {
  const env = { ...win, tools: { ...none, ffmpeg: true } }
  const formatOf = async (src: string) => {
    const { run, runs } = fake(() => ok())
    await makeThumb(run, env, { src, id: 't9', png: false })
    const argv = runs.find(one => one.argv[0] === 'ffmpeg')?.argv ?? []

    return [argv[argv.indexOf('-f') + 1], argv.indexOf('-f') < argv.indexOf('-i')]
  }

  expect(await formatOf('C:\\p\\a.webp')).toEqual(['image2', true])
  expect(await formatOf('C:\\p\\a.avif')).toEqual(['mov', true])
})

test('on Windows a folder is made and removed by the helper, never through a shell', async () => {
  const { run, runs } = fake(() => ok())
  await makeThumb(run, { ...win, tools: { ...none, ffmpeg: true } }, { src: 'C:\\p\\a.webp', id: 't10', png: false })

  expect(runs.some(one => one.argv[0] === 'cmd.exe')).toBe(false)
  expect(runs[0]?.argv.slice(-2)).toEqual(['-MakeDir', 'C:\\t'])
  expect(removeArgv(win, 'C:\\R&D\\Temp\\cc-img\\s1').slice(-2)).toEqual(['-RemoveDir', 'C:\\R&D\\Temp\\cc-img\\s1'])
  expect(removeArgv(win, 'C:\\t\\cc-img\\s1')[0]).toBe('powershell.exe')
  expect(removeArgv(mac, '/t/cc-img/s1')).toEqual(['rm', '-rf', '--', '/t/cc-img/s1'])
})

test('the temp folder is taken from the environment, which keeps letters a console would lose', async () => {
  const { run, runs } = fake(() => failed)

  const env = await detectEnv(run, 'C:\\m', 's1', { TEMP: 'C:\\Users\\Doğukan\\AppData\\Local\\Temp\\' })
  const posix = await detectEnv(fake(argv => (argv[0] === 'uname' ? ok('Darwin') : failed)).run, '/m', 's1', {
    TMPDIR: '/var/folders/ğ/T/',
  })

  expect(env.tempDir).toBe('C:\\Users\\Doğukan\\AppData\\Local\\Temp\\cc-img\\s1')
  expect(runs.some(one => one.argv.join(' ').includes('GetTempPath'))).toBe(false)
  expect(posix.tempDir).toBe('/var/folders/ğ/T/cc-img/s1')
})

test('bytes are saved through the helper on Windows, as base64 on its stdin', async () => {
  const { run, runs } = fake(() => ok())

  expect(await saveBase64(run, win, 'aGk=', 'C:\\t\\shot.png')).toBe(true)
  expect(runs[0]?.argv.slice(-2)).toEqual(['-FromStdin', 'C:\\t\\shot.png'])
  expect(runs[0]?.init?.stdin).toBe('aGk=')
})

test('bytes that cannot be saved say so', async () => {
  expect(await saveBase64(fake(() => failed).run, mac, 'aGk=', '/t/shot.png')).toBe(false)
  expect(
    await saveBase64(
      async () => {
        throw new Error('cannot start')
      },
      mac,
      'aGk=',
      '/t/shot.png',
    ),
  ).toBe(false)
})

test('on Windows the temp folder and the tools are asked of the system', async () => {
  const { run } = fake(argv => {
    if (argv[0] === 'powershell.exe') return ok('C:\\Users\\me\\AppData\\Local\\Temp\\\r\n')

    return argv[0] === 'where.exe' && argv[1] === 'ffmpeg' ? ok('C:\\tools\\ffmpeg.exe') : failed
  })

  expect(await detectEnv(run, 'C:\\Users\\me\\.claude\\mods\\cc-img', 's1')).toEqual({
    platform: 'win32',
    root: 'C:\\Users\\me\\.claude\\mods\\cc-img',
    tempDir: 'C:\\Users\\me\\AppData\\Local\\Temp\\cc-img\\s1',
    tools: { ffmpeg: true, magick: false, rsvg: false },
  })
})

test('elsewhere the system is told apart by uname', async () => {
  const { run } = fake(argv => {
    if (argv[0] === 'uname') return ok('Darwin\n')
    if (argv.join(' ').includes('TMPDIR')) return ok('/var/folders/x/T/')

    return argv.includes('rsvg-convert') ? ok('/opt/homebrew/bin/rsvg-convert') : failed
  })

  expect(await detectEnv(run, '/Users/me/.claude/mods/cc-img', 's1')).toEqual({
    platform: 'darwin',
    root: '/Users/me/.claude/mods/cc-img',
    tempDir: '/var/folders/x/T/cc-img/s1',
    tools: { ffmpeg: false, magick: false, rsvg: true },
  })
})

test('a system that answers nothing is taken for Linux with /tmp and no tools', async () => {
  const run: RunProcess = async () => {
    throw new Error('cannot start')
  }

  expect(await detectEnv(run, '/home/me/mods/cc-img', 's1')).toEqual({
    platform: 'linux',
    root: '/home/me/mods/cc-img',
    tempDir: '/tmp/cc-img/s1',
    tools: { ffmpeg: false, magick: false, rsvg: false },
  })
})

test('macOS with no tool installed asks sips for the formats only a newer macOS reads', async () => {
  expect(helperFor(mac, 'a.webp')).toBe('sips')
  expect(helperFor(mac, 'a.avif')).toBe('sips')
  expect(helperFor(mac, 'a.ico')).toBe('sips')
  expect(helperFor({ ...mac, tools: { ...none, ffmpeg: true } }, 'a.webp')).toBe('ffmpeg')
  expect(helperFor(linux, 'a.webp')).toBeUndefined()
})

test('on macOS bytes are decoded with the flag every macOS takes', async () => {
  const { run, runs } = fake(() => ok())

  expect(await saveBase64(run, mac, 'aGk=', '/t/shot.png')).toBe(true)
  expect(runs[0]?.argv[2]).toContain('base64 -D')
  expect(await saveBase64(run, linux, 'aGk=', '/t/shot.png')).toBe(true)
  expect(runs[1]?.argv[2]).toContain('base64 -d')
})
