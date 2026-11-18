# Changelog

Versions follow [Semantic Versioning](https://semver.org). The version is the one in `.claude-plugin/plugin.json`, and each release has a git tag: `cc-img--v<version>` from 0.2.1 on (the form `claude plugin tag` makes), `v<version>` before that.

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
