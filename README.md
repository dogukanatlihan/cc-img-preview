# cc-img

A Claude Code mod that shows a small thumbnail in the terminal transcript for every image Claude touches, and opens the image in your system's default app when you click it.

It was inspired by [hood/claude-kitty-image](https://github.com/hood/claude-kitty-image), which gives Claude a tool to show pictures on purpose. `cc-img` gives Claude no tool and changes nothing Claude reads: it watches what Claude does and draws the pictures for you.

## What gets a thumbnail

- Image files Claude reads.
- Image files Claude writes, edits, or produces by running a command. A file counts when its path appears in the command or its output and the file changed during the call.
- Pictures that come back from a tool, such as browser or editor screenshots.
- Pictures you paste or attach to a prompt.

At most 4 images are shown per tool call. Tool calls made by subagents are not covered.

## How it is drawn

| Terminal | Picture |
| --- | --- |
| Any terminal with 24-bit colour (Windows Terminal, VS Code, most others) | Coloured block characters. A thumbnail is at most 80 columns by 40 rows, and smaller where the terminal is. A cell has only two colours, so fine detail blurs. |
| kitty, Ghostty | Real pixels. |
| iTerm2 3.5+ | Real pixels, once you allow them in iTerm2's own dialog (see below). |
| Windows Terminal 1.22+, directly or inside herdr (not tmux) | Real pixels, by a painter of the mod's own (experimental; see below). |

The mod finds out which kind of terminal it is in by itself, once per session.

### Real pictures in iTerm2

iTerm2 draws real pixels, but it asks the person first. For each picture a program sends, iTerm2 opens the dialog "Allow Terminal-Initiated Display?", and Claude Code stands still until the dialog is answered. The first image brings about three such dialogs, the first of them for the mod's one-pixel test picture ("Unnamed file", 70 bytes). The mod says so once, the first time it starts in iTerm2.

You have two ways to stop the dialogs:

- Tick "Remember my choice" in the dialog and press Yes. Know what that tick does before you set it: iTerm2 keeps one answer for pictures and for file downloads that a program in the terminal starts, so after the tick it asks for neither. To take it back: iTerm2 Settings, Advanced, "Suppress confirmation of terminal-initiated downloads".
- Type `/img pixels off`. The mod then draws block characters and sends no picture. The choice is kept between sessions.

If you answer No and tick "Remember my choice", the picture area stays empty, and the mod cannot see that. Go to blocks with `/img pixels off`.

The mod knows iTerm2 by the `TERM_PROGRAM` and `LC_TERMINAL` variables. It uses them only to say the above once. Where neither reaches Claude Code (over ssh with no `LC_*` variables sent on, or in a tmux server started from another terminal), the dialogs come with no word from the mod.

### Real pictures in Windows Terminal (experimental)

Windows Terminal draws pictures only as Sixel, and Claude Code gives a mod no way to send Sixel. So here the mod goes around Claude Code:

- Under the tool call it draws the block-character thumbnail, and hides a marker in the first five cells of each row.
- It starts one background process for the session (`helpers/sixel.ps1`, about 90 MB), which reads Claude Code's screen, finds the markers, and paints the picture over those rows itself. It ends when Claude Code does.
- The picture itself takes no click: a button redraws under the pointer, which wipes the picture there. Open the image with the `open` button beside its name, or `/img`.

What to expect: the block thumbnail is what Claude Code itself draws, so it moves with the text; the painter then covers it with the real picture, a frame or two later. While you scroll, the picture is therefore coarse for a moment at each step and sharp again when it rests. The painter looks at the screen every 3 ms while pictures move, every 12 ms while they stand still. Where the painter does not run, the block thumbnail stays.

The marker cells hold braille characters in the colour of the picture beneath them. Copying text across a picture copies the block and braille characters too.

`/img pixels off` goes back to block characters, in every terminal; `/img pixels on` returns. Inside tmux the mod always uses blocks: tmux passes no Sixel on.

Inside herdr the painter works past herdr, which passes no Sixel on either. It paints on the screen of the herdr window itself, which is Windows Terminal's: it finds the picture rows wherever herdr has put the pane and paints there. One painter runs per herdr window and paints the pictures of every pane in it. If the herdr window does not run in Windows Terminal, or there is none on this machine, the mod uses blocks.

Block characters come in two kinds, and the mod cannot tell which your font has, so you choose:

| Command | Blocks | "Pixels" a cell | Largest thumbnail | Needs |
| --- | --- | --- | --- | --- |
| `/img coarse` (the default) | Quarter blocks | 2 across, 2 down | 160 by 80 | Nothing: every font has them. |
| `/img fine` | Octant blocks | 2 across, 4 down | 160 by 160 | A font with Unicode 16's octants, such as the Cascadia Mono that Windows Terminal 1.22 and later ships. |

`/img size 40` sets how wide a thumbnail may be, in columns, from 8 to 160 (80 to start with); it is at most half as many rows tall. A "pixel" can be no smaller than a block: half a cell wide, and a half or a quarter of a cell tall. So a smaller thumbnail holds fewer pixels, and the only way to get the same picture smaller is a smaller terminal font.

`/img cell 7x17` tells the mod the size of one terminal cell, width by height. The mod cannot ask the terminal, and takes a cell for twice as tall as wide (`1x2`). With a taller line spacing a thumbnail then looks stretched from top to bottom, and a real picture has empty rows under it. Only the shape counts, so any unit does. Most terminals, iTerm2 among them, print the size for this line in bash or zsh:

```
printf '\033[16t'; IFS=';' read -rs -d t _ h w; echo "${w}x${h}"
```

These choices are kept between sessions and apply to thumbnails made after them. If `/img fine` shows boxes or question marks where the picture should be, the font lacks octants: go back with `/img coarse`.

Under each picture is the file name and the image's size, for example `shot.png  1280x720`.

## Opening an image

- **Click the thumbnail.** In block mode the whole picture is clickable. In pixel mode, and for images that could not be drawn, there is an `open` button next to the name. Clicks need Claude Code's fullscreen mode (`"tui": "fullscreen"` in settings).
- **Ctrl+click the file name** (Cmd+click in iTerm2), which is a link the terminal opens itself.
- **`/img`** opens the most recent image. `/img 2` opens the one before it, and so on.

Only image files the mod recorded itself can be opened this way, so a click never starts a program or a script. A file name that turns out to be a link to something that is not an image is not shown and not opened.

Image paths found in a command's text are only looked at on this machine: a network path (`\\host\share\a.png`) in tool output is ignored, unless Claude itself read that file.

## Formats

| System | Works with nothing installed | Needs `ffmpeg` or ImageMagick |
| --- | --- | --- |
| Windows | png, jpg, gif, bmp, tif, ico | webp, avif |
| macOS | png, jpg, gif, bmp, tif; on a newer macOS also webp (from macOS 11), avif (from macOS 13) and ico | webp, avif and ico on an older macOS |
| Linux | none | all of them |

SVG needs ImageMagick or `rsvg-convert`. An image that nothing on the machine can read still gets its name and an `open` button, with no picture.

## Things to know

- Pictures that have no file of their own (tool screenshots and pasted images) are saved to `<temp folder>/cc-img/`, so there is something to open. Folders there are deleted after 7 days.
- A pasted image opens as the resized copy Claude Code made of it, not your original file.
- The mod keeps pictures for the 40 most recent images. Older rows keep their name and can still be opened.
- A pasted image is matched to your message by the message's text. Two messages with exactly the same text, sent before the first one's thumbnail has appeared, can swap pictures.
- A relative path in a command is resolved against the folder the session started in. On macOS and Linux a path that starts with `~/` is resolved against your home folder, and a space written as `\ ` is read as part of the path.
- A path with spaces is found only where it is quoted or its spaces are escaped. A bare `my shot.png` in a command's output is read as two words.
- On macOS the clear parts of a picture are drawn black; with ImageMagick they are drawn grey.
- A thumbnail keeps the width it was made at. Narrow the terminal afterwards and it is cut off at the right edge; widen it and it stays small.
- The box is two constants, `MAX_COLUMNS` and `MAX_ROWS`, in `hooks/pixels.ts`.

## Status

Built and run on Windows 11 in Windows Terminal 1.25: block thumbnails and the Sixel painter have been seen working there, both directly and inside herdr 0.9.5, and the Windows helper and the `ffmpeg` path have been run on real files.

Run on macOS 27 in iTerm2 3.7.7 with Claude Code 2.1.327. Seen working on screen there: block thumbnails for files Claude read and files a command wrote (png, jpg, webp, names with escaped spaces), a click on a thumbnail, `/img`, `/img cell 7x17`, and real pixels after a Yes in iTerm2's dialogs. The `sips` commands have been run by hand on png, jpg, gif, bmp, tif, webp, avif and ico files.

Not yet run on a real machine or terminal: Linux, kitty and Ghostty, pasted images and tool screenshots on macOS, the file name link, and octant blocks in iTerm2.

## Development

Load the mod into a session from this folder:

```
claude --plugin-dir <this folder>
```

Then, from this folder:

```
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc -p .
```

The type check needs the types Claude Code writes into `.claude-plugin/types/` when it loads the mod from this folder: start one session with `--plugin-dir` first.

The design is in `docs/superpowers/specs/`, the build plan in `docs/superpowers/plans/`, and every decision made since, with its reason, in `.superpowers/sdd/2026-11-17-cc-img/progress.md`.

The Windows painter logs to `%TEMP%\cc-img\sixel.log`. A file named `debug` in `%TEMP%\cc-img` makes a newly started painter log every move too.
