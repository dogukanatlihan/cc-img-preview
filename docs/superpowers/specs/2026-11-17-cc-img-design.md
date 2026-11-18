# cc-img: image thumbnails in the Claude Code terminal

Date: 2026-11-17
Status: reviewed by a builder check, awaiting the person's approval

## Intent

When Claude Code works with an image, the person at the terminal sees only a
file name. They have to leave the terminal to find out what the picture is.
`cc-img` is a Claude Code mod that draws a small thumbnail in the transcript
for every image Claude touches, and opens the full image in the operating
system's default app when the thumbnail is clicked.

It is inspired by `hood/claude-kitty-image`, which adds a `show_image` tool
that Claude calls on purpose. `cc-img` is different: it gives Claude no new
tool and shows images automatically.

## Goals

1. Show a thumbnail for each of these, with no action from Claude or the person:
   - image files Claude reads;
   - image files Claude writes, edits or produces by running a command;
   - pictures that come back inside a tool result (browser, Unity, Blender,
     Figma screenshots and the like);
   - pictures the person pastes or attaches to a prompt.
2. Work in the person's current setup: Windows 11, Windows Terminal, inside
   the `herdr` multiplexer. This terminal cannot draw real pixel images.
3. Look sharp where the terminal can draw real pixel images (kitty, Ghostty,
   iTerm2).
4. A click opens the image in the OS default app, on Windows, macOS and Linux.
5. Need nothing installed on Windows and macOS for png, jpg, gif and bmp.

## Non-goals

- No tool for Claude to call and no change to the system prompt.
- No gallery pane or side panel. Thumbnails sit under the tool call only.
- No in-terminal zoom or full-size viewer. The OS app does that.
- No video, PDF or other document previews.
- Terminal surface only. On desktop, VS Code and mobile the mod draws nothing
  and passes the row through unchanged.
- Tool calls made by subagents are not covered.

## Anti-goals

These would make the mod a failure even if thumbnails appear:

- A tool call that fails, changes its result or runs noticeably slower
  because of the mod.
- Anything added to Claude's context. Claude must not be able to tell the mod
  is installed.
- A click that opens or runs anything other than an image file the mod
  itself recorded.

## Constraints found during design

- A mod has no Node and no DOM. Everything outside the module goes through
  the engine interface `$` (`$.process.run`, `$.fs`, `$.ui`, `$.state`).
- The terminal `Image` element draws real pixels only in kitty, Ghostty and
  iTerm2 3.5+ (and through tmux with passthrough on). Elsewhere it draws its
  `alt` text. It takes PNG bytes of at most 2 MiB, or raw RGBA.
- `Image` and `Raster` are leaves: neither takes a click. Only `Button` (and
  links in `Markdown`) can be pressed.
- A terminal reports mouse clicks to a mod only in fullscreen mode
  (`"tui": "fullscreen"`, which this PC has set). In a main-screen session
  the transcript is printed into scrollback and nothing there can be clicked.
  Whether `herdr` forwards clicks is unknown until the spike.
- Reads, searches and read-only shell commands are folded into one
  `ToolGroup` count line ("Read 3 files"). No `ToolUse` row is drawn for
  them unless a hook sets the group's `isExpanded`.
- A standalone tool row's result is drawn by a separate `ToolResult`
  component, so a tree added under `ToolUse` sits between the call line and
  its result.
- A `tool.call` result is not promised to carry image blocks: it is `unknown`
  for MCP tools and its `text` holds text blocks only. Image blocks are typed
  on `session.append` (door `tool-result`).
- `$.fs` has read, write, list, exists, stat and ancestors. It cannot delete.
- Work that outlives a hook's dispatch is not promised to keep its `$`. The
  documented pattern is a timer started at `session.start`.
- Setting a state value redraws every site that read it.
- A `Button` accepts strings and `Text` children. `Text` takes `color` and
  `backgroundColor`.
- A mod cannot decode image formats itself without hand-written decoders.
- `$.fs.write` writes text only. `$.process.run` returns stdout as decoded
  text, so binary data must not travel through stdout.
- `$.fs.read(path, { as: 'bytes' })` returns base64.
- `$.prompt.media({ id })` returns a pasted image's bytes, but only inside the
  `prompt.submit` hook that lists it.
- The `ToolUse` render props carry `tool_use_id`, `tool`, `input` and, once
  the call has resolved, `output`.

## Approaches

### How a thumbnail is drawn

| Option | Trade-off |
| --- | --- |
| Real pixels only (the reference's way) | Sharp, but shows only dim alt text on the person's Windows setup. |
| Coloured block characters only | Works in every terminal and looks the same everywhere. Coarse: a 40-column thumbnail is about 40x32 "pixels". |
| **Both (chosen)** | Real pixels where the terminal draws them, block characters elsewhere. Most work, but good on the person's PC today and sharp on a Mac. |

### How an image file becomes thumbnail pixels

| Option | Trade-off |
| --- | --- |
| **Tools the OS already has (chosen)** | Windows: built-in image library through Windows PowerShell. macOS: `sips`. Nothing to install on either for png, jpg, gif, bmp. Other formats need an optional tool. Linux needs ffmpeg or ImageMagick. |
| Decoders written inside the mod | No outside tool and identical everywhere, but a lot of decoding code, slow on large photos, and no webp or svg. |
| Require ffmpeg or ImageMagick everywhere | Least code and every format works, but nothing shows until the tool is installed. |

### What is clicked

| Option | Trade-off |
| --- | --- |
| **Whole thumbnail (chosen)** | Build the block thumbnail from one `Button` per row so a click anywhere opens the image. Unproven: needs a spike first. Not possible for a real pixel image, which gets an open button instead. |
| Open button under the thumbnail | Certain to work. This is the fallback if the spike fails. |
| Open button plus show-in-folder button | Not chosen. |

### Where thumbnails appear

Under the tool call that used the image (chosen), over a side gallery pane or
both. A pane needs a wide terminal and was not wanted.

## Design

### Parts

1. **Collector.** Hooks that notice images and record them:
   - `tool.call` on every tool. The hook calls `await next(e)` first and
     returns that result untouched. It only puts a small job on a queue. A
     timer started at `session.start` drains the queue, so the tool call
     never waits on thumbnail work and never fails because of it.
   - `prompt.submit`, for pasted and attached images.
   - `session.append` (door `tool-result`), only if the first build step
     shows that `tool.call` results do not carry a tool's image bytes. This
     hook reads the row and passes it on untouched.
2. **Thumbnailer.** Turns a recorded image into thumbnail data by running a
   helper process.
3. **Store.** Session state mapping a row (a `tool_use_id`, or a submitted
   prompt) to its thumbnails.
4. **Renderer.** `ui.render` hooks on `ToolUse`, `ToolGroup` and
   `UserMessage` that draw the stored thumbnails under the row.
   - A call with its own row: thumbnails go under that row.
   - A call folded into a group ("Read 3 files"): the group stays folded and
     the thumbnails of its image calls go under the count line, in call
     order (chosen by the person). When the group is shown unfolded, as in
     the ctrl+o view, each thumbnail goes under its own call's row instead,
     never in both places.
5. **Opener.** Runs the OS command that opens a file in its default app.

### What counts as an image, per source

- **Files Claude reads.** A `Read` call whose `file_path` has an image
  extension. The thumbnail is made from the file on disk, and the click opens
  that file.
- **Images Claude makes.**
  - `Write` and `Edit` calls whose target has an image extension (in practice
    svg).
  - Any other tool: scan the call's input and its result text for file paths
    ending in an image extension, resolve relative ones against the session's
    working directory, and keep those that exist and whose modified time is
    at or after the moment the call started. At most 4 per call.
- **Tool screenshots.** Any tool result that carries image blocks (base64
  data with a media type). These have no file, so the bytes are saved to the
  temp folder first; the click opens that saved file.
- **Pasted images.** Each image attachment of a `prompt.submit`, read with
  `$.prompt.media` and saved to the temp folder. These bytes are the
  engine's resized copy, so a click opens that copy, not the original.

An image seen twice under one row is shown once. Image extensions: png, jpg,
jpeg, gif, bmp, webp, svg, tif, tiff, avif, ico.

### Thumbnail size

A thumbnail fits a box of at most 40 columns by 16 rows and keeps the image's
aspect ratio. Terminal cells are about twice as tall as wide, and a block
cell holds two stacked pixels, so block pixels come out roughly square.

Under each thumbnail, one dim line: file name and pixel size, for example
`shot.png  1280x720`.

Several images under one row stack vertically.

### Drawing mode

The mod decides once per session whether the terminal draws real pixels, with
the probe the reference plugin uses: mount an `Image`, then re-send it with
`$.ui.blit` and read whether it was refused. The answer is cached in session
state.

- **Pixel mode.** An `Image` with a PNG thumbnail, plus an `[ open ]` button
  on the caption line.
- **Block mode.** Upper-half-block characters (`▀`), foreground the top
  pixel, background the bottom pixel. Each thumbnail row is one plain
  `Button` whose children are `Text` runs; neighbouring cells with the same
  two colours merge into one run. A click anywhere on any row opens the
  image.

**Spike first.** Before anything else is built, a throwaway mod draws one
hard-coded block thumbnail from button rows and the person clicks it. If
rows of buttons draw badly, are slow, or do not take clicks, block mode falls
back to a `Raster` thumbnail with an `[ open ]` button on the caption line,
the same as pixel mode.

### Making thumbnail data

The helper is chosen in this order, and the choice is cached per session:

1. **Windows:** `powershell.exe` (Windows PowerShell, always present) running
   a script shipped in the mod that uses `System.Drawing`.
2. **macOS:** `sips`.
3. **Any OS, for formats the built-in tool cannot read, and on Linux:**
   `ffmpeg`, then ImageMagick (`magick`), when found on `PATH`. SVG also
   tries `rsvg-convert`.

The helper receives the source path (or base64 on stdin for images that have
no file), the target size, and an output folder. It writes files and prints
only a small JSON line with the original width and height. The mod reads the
output files with `$.fs.read(..., { as: 'bytes' })`.

- Block mode output: an uncompressed pixel file (BMP or raw RGB) at exactly
  the thumbnail's pixel size, which the mod can parse without a decoder.
- Pixel mode output: a PNG thumbnail about 480 pixels wide, well under 2 MiB.

When no helper can read a format, the row still shows the caption line with
an `[ open ]` button, and no picture.

### Temp files

Images with no file of their own, and helper outputs, go under
`<OS temp folder>/cc-img/<session id>/`. At `session.start` the mod deletes
`cc-img` session folders older than 7 days, through `$.process.run`, since
`$.fs` cannot delete. The delete command is given only paths under that
`cc-img` folder.

### Store

Session state declared in the mod's type contract, as a state family keyed
by row, so a new image redraws only its own row. Each entry:
`{ images: [{ openPath, name, width, height, columns, rows, cells?, png? }] }`.
A small separate index lists images in order. The mod keeps the thumbnail
data of the 40 most recent images. Older rows keep their caption line and
open control but drop the picture.

### Opening

- Windows: `explorer.exe <path>`
- macOS: `open <path>`
- Linux: `xdg-open <path>`

Always run as an argument vector through `$.process.run`, never through a
shell string. The opener refuses any path that the mod did not record itself,
and any path whose extension is not in the image list, so a click can never
start a program or script. A file that no longer exists gives a short toast
instead.

Two more ways to open, for sessions where clicks do not reach the mod (a
main-screen session, or `herdr` not forwarding them):

- The file name on the caption line is a terminal hyperlink to the file, so
  the terminal's own ctrl+click opens it.
- A slash command, `/img`, opens the most recent image; `/img 2` the one
  before it, and so on. It goes through the same opener and the same checks.

### Main-screen (non-fullscreen) sessions

Best effort. The mod never delays a tool result to wait for a thumbnail. If
the row has already been printed into scrollback when the thumbnail is
ready, no picture appears and `/img` still opens the image.

### Failure behaviour

Every failure is quiet: a missing helper, an unreadable file, a helper that
times out (5 seconds). The row is drawn as the engine would draw it, with at
most the caption line. Nothing is reported to Claude.

## Calls made by the designer (not decided by the person)

- The name `cc-img`.
- The 40x16 thumbnail box, the 4-images-per-call cap, the 40-image memory cap,
  the 7-day temp cleanup and the 5-second helper timeout.
- The rule for "images Claude makes" (path scan plus modified-time check).
- `explorer.exe` as the Windows opener.
- The two extra ways to open (caption hyperlink and `/img`), added after the
  reviewer found that clicks reach a mod only in fullscreen mode.
- Main-screen sessions are best effort, with no delay of tool results.
- Reading image bytes from `session.append` only if `tool.call` lacks them.
- No settings in the first version. Sizes are constants.
- The mod is developed in this session's dev-mods folder, where Claude Code
  hot-reloads it, and then copied to `C:\Users\me\cc-img` as its
  home for a future repository.

## Left to the builder

- Exact helper scripts and command lines per OS.
- How a pasted image's thumbnails are matched to its `UserMessage` row (the
  row's props carry text and origin, but no obvious id). If no reliable match
  exists, pasted images are shown in a band above the prompt until the next
  prompt is sent.
- The cell-packing and run-merging code.
- Test layout. Expected: unit tests under `claude plugin test` for path
  scanning, pixel-file parsing, cell packing and the opener's refusals, plus
  `claude plugin validate` and a type check.

## How it is verified

1. The spike: the person clicks a block thumbnail in this terminal.
2. In this Windows Terminal + herdr session: read a png and a jpg, run a
   command that writes a png, take a tool screenshot, paste an image. Each
   shows a thumbnail, and a click opens the default image app.
3. Pixel mode is checked in kitty or Ghostty on the Mac when one is
   available. Until then it is covered by tests only, and that is said
   plainly in the hand-over.
