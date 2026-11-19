# Changelog

Versions follow [Semantic Versioning](https://semver.org). The version is the one in `.claude-plugin/plugin.json`, and each release has a git tag: `cc-img--v<version>` from 0.2.1 on (the form `claude plugin tag` makes), `v<version>` before that.

## Unreleased

- The repository is open for contributions: `CONTRIBUTING.md`, `SECURITY.md`, issue forms (one to report how the mod looks on a terminal) and a pull request template.
- README: Ghostty 1.3.1 on macOS seen drawing real pixels with no setting.
- New: CI on GitHub Actions. It runs the tests on Linux, macOS and Windows, compiles the Windows painter with Windows PowerShell 5.1, and makes one thumbnail with the Windows helper.

## 0.2.4 - 2026-11-18

Two faults a SonarQube scan found, and the code put in order after it.

- Fixed: a long run of dots or closing brackets in a command's output made the mod slow, with a quadratic expression: 80,000 dots took 3.6 seconds. It is a loop now, and takes 3 milliseconds.
- Fixed: on Linux with no `TMPDIR` the mod kept its thumbnails in `/tmp/cc-img`, where every user of the machine can read and write. They are now in `~/.cache/cc-img`, and on macOS and Linux each session folder is made for its owner alone. Where no temp folder can be found at all, the mod no longer falls back to `/tmp` or `C:\Windows\Temp`: it writes nothing.
- The code is in smaller parts, with no change to what it does: one function for each helper program, for each `/img` setting, and for each step of making a thumbnail. The scan now finds nothing in the TypeScript or in the C# painter.
- The Windows painter (`helpers/sixel.cs`) is in smaller parts too. Its Sixel encoder, its reading of markers and its erasing give the same output as before, byte for byte, on test input. It names its version by SHA-256 now, so a painter left running by an earlier version is replaced at the next start. Not yet run on Windows since this change.
- New: `tools/sonar/scan.sh` scans the TypeScript and the C# in one run.

## 0.2.3 - 2026-11-18

HEIC.

- `.heic` and `.heif` files get a thumbnail. macOS reads them with nothing installed (`sips`); Windows and Linux need ImageMagick built with HEIC support.
- HEIC is never given to `ffmpeg`: a phone's photo is a grid of tiles, and an `ffmpeg` before 7.0 answers with one tile of it.

## 0.2.2 - 2026-11-18

Real pictures in Rex.

- README: how to get real pixels in Rex, and in any other terminal that draws kitty graphics but that Claude Code does not know by name, with Claude Code's `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` variable.
- README rewritten for the public: two pictures of the mod at work (`docs/blocks.png`, `docs/pixels.png`), a table of commands, what the mod does on your machine, and what to do if something looks wrong.
- Fixed: the first picture of a session stayed in block characters in a terminal that draws real pixels, because it was made before the terminal had answered the mod's test picture. Pictures made before the answer are now kept as a PNG too, and turn to real pixels when the answer comes.

## 0.2.1 - 2026-11-18

Install from a marketplace.

- The repository is now a Claude Code marketplace (`.claude-plugin/marketplace.json`). One line installs the mod: `/plugin install cc-img --marketplace dogukanatlihan/cc-img-preview`.
- `plugin.json` names the author, the repository, the license and keywords.
- No change to what the mod does.

## 0.2.0 - 2026-11-18

macOS and iTerm2.

- iTerm2 asks the person before it shows each picture, and Claude Code stands still until the dialog is answered. The mod now says so once, the first time it starts in iTerm2, with the two ways to stop it.
- `/img pixels off` now gives block characters in every terminal, and sends no picture. Before, it changed nothing in kitty, Ghostty and iTerm2.
- New: `/img cell 7x17` gives the size of a terminal cell. Thumbnails keep their shape where a cell is not twice as tall as wide, and a real picture has no empty rows under it.
- No picture is sent before the session's start has run.
- Paths that start with `~/` and paths with escaped spaces (`my\ shot.png`) in a command are found on macOS and Linux.
- On a macOS with no ImageMagick and no ffmpeg, webp, avif and ico files are read by `sips`.
- On macOS, pictures with no file are decoded with `base64 -D`, which every macOS version takes.
- Run on macOS 27 in iTerm2 3.7.7: see Status in the README.

## 0.1.0 - 2026-11-18

First public version.

- Block-character thumbnails for images Claude reads, writes, or gets back from a tool, and for pasted images.
- Real pictures in Windows Terminal 1.22+ by the Sixel painter, directly and inside herdr.
- Click to open, `/img`, `/img fine`, `/img coarse`, `/img size`, `/img pixels`.
- Run on Windows 11 only. The macOS and Linux paths are covered by tests only.
