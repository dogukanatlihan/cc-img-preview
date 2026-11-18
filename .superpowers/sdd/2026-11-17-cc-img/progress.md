# SDD ledger — plan: C:\Users\me\cc-img\docs\superpowers\plans\2026-11-17-cc-img.md

Setup: Ruling: no git repository and no worktree; ledger kept by hand, the skill's git scripts are not used — the person has not asked for git and the plan forbids commits — if wrong, there is no commit history to review, only the files.
Pre-flight: T3 fitBox/parseBmp/toRows -> T5 (thumb.ps1 must use the same fit rule), T7, T8: consistent.
Pre-flight: T4 Platform -> T5 Env, T8 openImage: consistent.
Pre-flight: T7 Thumb has pxH; T8 toRows needs width=columns, height=pxH: consistent.
Pre-flight: T5 ThumbRequest has no size fields (box fixed at 40x32 in helper): consistent with T7.
Task 1: Ruling: probe files are written to the session scratchpad (probe/), not the mod root — writing into the mod folder could trigger reloads — if wrong, nothing lost, files are throwaway.
Task 1: in progress — spike mod written at dev-mods/<session>/cc-img-spike, validate passed; waiting for the person's click test. Steps 4 and 5 (record answers, delete spike) still owed.
Task 2: Ruling: added two tests beyond the plan (`--out=a/b.png`, Git Bash `/c/...` path on a Windows cwd) — both are common in real commands on this PC — cost if wrong: none, extra coverage.
Task 2: complete (no commits; tests: claude plugin test MOD -> 9 pass 0 fail; claude plugin validate MOD -> passed with warnings: no author/README/LICENSE/icon, all deferred to Task 11)
Task 1: Spike B answered: tool.call result of Read on an image is { type: 'image', file: { base64, type: 'image/png', originalSize, dimensions: { originalWidth, originalHeight, displayWidth, displayHeight } } }. Image bytes ARE in tool.call results; session.append hook not needed for Read. MCP shape still unseen (typed as McpToolResult.content blocks).
Task 1: Spike C partly answered: ui.render ToolGroup hooks fire (requestId 'collapsed-<uuid>'), each call carries tool_use_id, tool, input, output. In this fullscreen session almost every Bash call is in a group, so the group path is the main one. Whether the added row is visible: waiting on the person.
Task 3: Ruling: parseBmp also accepts 32-bit BI_BITFIELDS (compression 3) — System.Drawing may write it — cost if wrong: a non-standard mask order would give wrong colours on such a file.
Task 3: complete (no commits; tests: claude plugin test MOD -> 21 pass 0 fail, incl. 9 pixel tests; RED seen: "cannot import ./pixels")
Task 4: complete (no commits; tests: claude plugin test MOD -> 21 pass 0 fail, incl. 3 opener tests; RED seen: "cannot import ./open")
Task order: Ruling: Task 6 (pure) done before Task 5 — Task 5 needs nothing from it and the spike answer is still pending — cost if wrong: none.
Task 6: Ruling: Read/Write/Edit yield only their own file_path and their inputs are not scanned — an Edit's old/new strings naming images are not images the call touched — cost if wrong: an image named only inside a written file's content is not shown.
Task 6: Ruling: a third image-block shape { type:'image', file:{ base64, type } } is accepted (seen in the spike's Read result).
Task 6: complete (no commits; tests: claude plugin test MOD -> 29 pass 0 fail; RED seen: collect.test.ts did not load)
Task 5: thumb.ps1 verified on real files: png and jpg -> exit 0, {"w":320,"h":180}, BMP 40x22 24-bit uncompressed, 0.41 s; fake.png -> exit 1; missing -> exit 1; -FromStdin copy byte-identical.
Task 5: Ruling: transparency is drawn over mid grey (128,128,128); EXIF orientation is applied — neither is in the spec — cost if wrong: cosmetic.
Task 5: Ruling: thumb.ts functions take a RunProcess function ((argv, init) => Promise<{exitCode, stdout}>) instead of `$`, and detectEnv takes the mod root as an argument — a test's `$` has no `process` noun (TypeError seen), so `$` cannot be faked there — cost if wrong: none; register.tsx passes (argv, init) => $.process.run(argv, init).
Task 5: complete (no commits; tests: claude plugin test MOD -> 47 pass 0 fail; RED seen: thumb.test.ts did not load, then 6 process tests failed on `$.process` undefined). Real runs: thumb.ps1 on png/jpg/fake/missing/stdin (see above). sips, magick and rsvg command lines are covered by argv tests only: none of those tools is on this PC.
Task 7: Ruling: the drain's logic lives in two extra pure modules, hooks/work.ts (thumbFor, engine calls injected as Deps) and hooks/store.ts (addToRow, addToRecent, withoutPicture) — a test's `$` lacks process/fs nouns, so logic inside register.tsx could not be unit-tested — cost if wrong: two more files than the plan lists.
Task 7: Ruling: recent keeps the newest 200 entries for /img; pictures are kept for the newest 40 (spec) — spec gives no cap for /img — cost if wrong: /img N beyond 200 says "No such image."
Task 7 (part): work.ts + store.ts done, tests: claude plugin test MOD -> 63 pass 0 fail (RED seen: both test files did not load). Wiring in register.tsx still owed.
Task 7: Ruling: engine rules found at load: `$` may only be passed to functions declared at the top of the file or imported; atoms need literal plugin/key, family members come from memberOf(rows, { requestId }) — code shaped accordingly — cost if wrong: none (engine refuses otherwise).
Task 7: Ruling: session temp folder is named s<start ms>; cleanup removes s<ms> folders older than 7 days via cmd rmdir / rm -rf, only names matching ^s\d+$ under <temp>/cc-img.
Task 7: complete (no commits; tests: claude plugin test MOD -> 77 pass 0 fail; validate passes; tsc -p MOD exit 0). RED seen for every engine-level test before register.tsx existed (7 failed on missing feature).
Task 8: Ruling: built the plan's primary variant (rows of plain Buttons) without waiting for spike answer A — the person picked it and cc-img itself now shows whether clicks land — cost if wrong: switch block drawing to Raster + [ open ] button.
Task 8: code and tests done with Task 7 (draw.tsx, ToolUse + ToolGroup hooks, openImage, /img): 77 pass. Step 6 (live try in the terminal) still owed: needs the mod reloaded and a new image read.
Task 1: Ruling: the spike's coloured blocks were removed once cc-img drew real thumbnails; the spike now only probes prompt.submit / UserMessage (question D). Spike folder still to delete after D is answered.
Deferred: relative paths resolve against the session's start folder, not a later `cd`.
Task 8: live evidence: with cc-img loaded, a Read of 'test shot (1).png' made %TEMP%/cc-img/s<ms>/t1.bmp (2694 bytes) — the queue, helper and store ran in the real session. Whether it draws and takes clicks: waiting on the person.
Task 1: Spike D answered: prompt.submit e = { text, wait, attachments:[{ type:'image', mediaType, filename, id:'media_<hex>' }], origin:{kind:'composer'} }; UserMessage row props = { text, origin, isExpanded } with requestId first 'placeholder', then a uuid. No shared id; the text is the same string. Decision rule D: plan said band above prompt when no id is shared.
Task 9: Ruling: pasted thumbnails are drawn under the UserMessage row matched by its text, claimed by the first row not seen before the submit, instead of the plan's AbovePrompt band — the person asked for thumbnails under the row, and text + "not seen before" identifies it — cost if wrong: two prompts with identical text sent before the first is claimed could swap pictures.
Task 1: complete — spike answers: A (clicks) to be confirmed on cc-img itself; B yes (bytes in tool.call results); C hooks fire, drawing confirmed live by the person seeing a thumbnail under a folded read; D no shared id, same text. Spike folder deleted.
Task 8: live: the person saw the thumbnail of the test image under the folded Read line ("its a different image" than their paste — it was the test image). Click not yet confirmed.
Task 9: Ruling: $.prompt.media is not a hookable event, so slice reading is the pure readMedia(read, id) in work.ts and the matching rule is waitingFor in store.ts; the engine-level tests seed the `pending` state and check drawing and the claim. The prompt.submit read itself is only checkable live.
Task 9: Ruling: pasted images are read before next(e) in prompt.submit (the only moment $.prompt.media answers) — this delays a prompt that carries images by the time of the read — cost if wrong: a slower send on prompts with large pasted images.
Task 9: code complete (no commits; tests: claude plugin test MOD -> 89 pass 0 fail; validate passes; tsc exit 0; RED seen for 2 engine-level and 7 pure tests). Live check with a real paste still owed.
Task 9: live: after reload, the person's pasted image was saved as %TEMP%/cc-img/s<ms>/t1.jpg (269979 bytes) and thumbnailed to t1.bmp (40x26); enlarged, it shows their three-panel picture. Drawing under the message and the click: waiting on the person.
Task 10: Ruling: the pixel test picture sits at the end of the first thumbnail's caption line (not on a line of its own), so a terminal that shows only its alt (one space) gains no blank line.
Task 10: complete (no commits; tests: claude plugin test MOD -> 94 pass 0 fail; validate passes; tsc exit 0; RED seen: 3 probe tests failed before workProbe existed; the 2 pixel-drawing tests passed at once because draw.tsx's pixel branch was written in Task 8 — a finding about order, not about the tests: they fail if the branch is removed). Pixel mode has never been seen in a real terminal.
Task 11: README written; mod copied to C:\Users\me\cc-img (without .claude-plugin/types).
Final review: fresh reviewer (most capable model) over C:\Users\me\cc-img, no git package (no repository). Findings re-graded below.
Final: fixed (Critical) thumb.ps1 held a lock on Claude's file via Image.FromFile — now ReadAllBytes + FromStream; real run on png/fake still 0/1, BMP 40x22. No automated test (PowerShell script); verified by real run.
Final: fixed (Critical) explorer.exe splits its argument on commas — Windows opens through thumb.ps1 -Open (Invoke-Item -LiteralPath) — open.test "a comma or an ampersand splits nothing" RED→GREEN, suite 107/107. The -Open mode itself was not run (it would open an app on the person's screen).
Final: fixed (Critical) cmd.exe /c rmdir and mkdir took a path as a shell string — replaced by thumb.ps1 -MakeDir / -RemoveDir (refuses any folder not <x>\cc-img\s<digits>) — thumb.test "never through a shell" RED→GREEN; real run: non-session folder refused (exit 1), session folder removed.
Final: fixed (Critical) a link named like an image leading to a program — stat with resolve, realPath must be an image, at thumbnail time and again at click time — work.test "a link named like an image..." and register.test "an image swapped for a link..." RED→GREEN.
Final: fixed (Important) /img answered { text }, which stays in Claude's requests — now answers {} and toasts — register.test "/img opens the newest..." RED→GREEN.
Final: fixed (Important) network paths in tool text were stat'ed — scanned paths starting \ or // are dropped; also a leading quote left after `name=` — collect.test "a network path found in text is never looked at" RED→GREEN.
Final: fixed (Important) the cap of 4 cut candidates before the changed-file filter — collect offers up to 16, workJob shows 4 — collect.test + register.test "a command that names many images shows the one it wrote" RED→GREEN.
Final: fixed (Important) temp path read through a console code page lost letters such as ğ — TEMP/TMP/TMPDIR read with $.env.get first — thumb.test "the temp folder is taken from the environment" RED→GREEN.
Final: fixed (Important) magick/ffmpeg guessed the format from content — reader named (png:, jpeg:, ...; -f image2 / mov) — thumb.test RED→GREEN; real run: webp reads with -f image2, a playlist named .webp is refused (exit 1).
Final: Ruling: notFor is now snapshotted before next(e) (reviewer finding 8) with NO test — $.prompt.media cannot be faked in the test kit, so the prompt.submit path only runs live — cost if wrong: a pasted image's thumbnail does not appear under its message.
Final: Ruling: reviewer thinks building the block-button variant before the click was confirmed was wrong — it stands, but the click is STILL unconfirmed by the person; if clicks do not land, block mode must switch to Raster + [ open ] button (spec fallback), or rely on the caption link and /img.
Final: Ruling: reviewer thinks the text-claim risk is understated because image-only prompts all read "[Image #1]" — agreed, the README says so; the rule stands (oldest waiting prompt of that text, rows seen before excluded) — cost if wrong: two image-only prompts sent within about a second can swap pictures.
Final: Ruling: declined-to-judge items (live drawing, click delivery, pixel mode, herdr, whether state survives resume or /clear, host limits on state holding 40 PNGs, whether /img's echo row reaches the model with no text) stay unverified and are reported to the person as such.
Final: minor (deferred): bare names starting with ( or [, or unquoted with spaces, are not found by the path scan.
Final: minor (deferred): the pixel probe is per module while the mode is in state: a /clear, or a session resumed in another terminal, can leave the wrong mode.
Final: minor (deferred): images beyond the newest 200 cannot be opened by click or /img (toast says so); the spec says older rows keep their open control.
Final: minor (deferred): the work queue is unbounded and one call's images can hold it for many seconds.
Final: minor (deferred): the test "a tool call gets its own answer back" would pass with the mod removed; no test for prompt.submit with attachments, the drain surviving a failing job, or the cleanup's list of folders.
Final: minor (deferred): relative paths resolve against the session's start folder, not a later cd.
Final review: one fix pass done; suite 107/107 in MOD and in cc-img; validate passes; tsc exit 0.

## After the final review: user asked for higher resolution (2026-11-17)
- Change: block mode draws quarter blocks (2x2 pixels a cell) and the box is 80x24 cells, was half blocks in 40x16. Helper takes -Columns/-Rows; BMP is the picture at twice its width.
- Ruling: quarter blocks only, no sextants or octants — quarter blocks are in every font and Windows Terminal draws them itself; sextants need font support nobody checked — costs half the vertical detail sextants would give.
- Ruling: box 80x24, capped to the terminal's width less 4 cells (viewport of the last row drawn), never under 8 — a herdr pane can be narrower than 80 — if the indent is more than 4 cells a full-width picture wraps.
- Ruling: old thumbnails in state (no pxW) still draw as half blocks, no shape change — the new field is optional — none known.
- Ruling: an odd pixel height repeats its last row instead of leaving the half cell empty — one code path — picture is half a row taller.
- Not measured: a photo is now about 1750 Text elements a thumbnail (was about 520); transcript drawing cost in the live TUI is unknown.
- Pixel mode's PNG is still 480 px wide, now drawn up to 80 columns wide: softer than it could be. Untested as before.
- Tests: 117/117 in both copies, tsc clean. Real runs: thumb.ps1 at 80 and 30 columns on the pasted image (146x48 and 60x19 BMPs), ffmpeg filter on a webp (160x45).

## Second pass on resolution: user said the 2x2 thumbnail is still pixelated (2026-11-17)
- Found: session runs in herdr inside Windows Terminal 1.25; its bundled Cascadia Mono 2407.024 has all 230 octants (checked with GlyphTypeface); the system copy (2102.025) has none.
- Change: octant blocks (2x4 pixels a cell) behind `/img fine`, kept in $.store; box is 80x40 cells, capped to the terminal's width less 4 and height less 6. New thumbnails are kept as cells (7 bytes each), not pixels; earlier ones still draw.
- Ruling: octants are opt-in, quarter blocks the default — a mod cannot ask the font, and a font without octants shows boxes — costs this user one command.
- Ruling: a cell's pixels are split at the middle of its widest colour channel, not by trying every split — 127 splits a cell is too slow for 8 pixels — slightly worse colour on some cells.
- Ruling: the 8 octant patterns Unicode gives to rarer characters (U+1CEA0.., U+1FB82, U+1FBE6..) are drawn as their opposite with colours swapped — those ranges are less likely to be in a font — none known.
- Octant table checked against UnicodeData 16.0 (230/230 by rule); five spot checks are in the tests.
- Not seen live: octants on the user's screen through herdr; drawing cost of about 2550 Text elements for a 64x40 thumbnail.
- Tests: 130/130, tsc clean. Real run: thumb.ps1 -Width 160 -Height 160 -Across 1 on the pasted 1080x1350 image gave a 128x160 BMP, drawn through cellsOf/rowsOf with 0 unknown blocks.
- Added `/img size <columns>` (8 to 160, kept in $.store, rows at most half) after the user asked for a smaller picture at the same density. Ruling: no finer block than octants exists, so the same pixels 2-3x smaller is not possible from a mod — only a smaller terminal font does it. Tests 133/133, tsc clean.

## Real pixels in Windows Terminal: Sixel painter (2026-11-17, user chose "Sixel bypass")
- Research: Codex CLI draws Sixel in Windows Terminal with its own encoder; Claude Code's Image element has no Sixel; herdr 0.9.5 passes none. User saw Codex in plain Windows Terminal.
- Spike (user's screenshot): a helper attached to Claude Code's console paints Sixel that Windows Terminal shows; text written later wins; the picture does not scroll with the text.
- Built: helpers/sixel.cs + sixel.ps1 (background painter per session: reads the screen, finds marker rows, paints, erases leftovers, repaints every 1.5 s); thumb.ps1 -SixId writes <id>.six.bmp; mod draws marker rows as buttons when WT_SESSION is set and HERDR_ENV/TMUX are not; `/img pixels on|off` kept in $.store.
- Ruling: painter is a detached PowerShell process, not a compiled exe — no binary to ship or build — costs about 90 MB a session and 1 s to start.
- Ruling: Windows Terminal is taken to be 1.22 or later whenever WT_SESSION is set — the version is not checked — on an older one the rows show faint markers and no picture; `/img pixels off` is the way out.
- Ruling: ESC 7 / ESC 8 around each paint — one write, cursor and colours restored — if Claude Code ever keeps its own saved cursor across writes, a paint could move it.
- Not seen live yet: the painter started by the mod itself (through $.process.run), scroll following, flicker, leftovers. The test painter started from a shell attached and logged no error; the user had not yet reported what it drew.
- Tests: 142/142, tsc clean. Real runs: thumb.ps1 -SixId (320x400 BMP), sixel.cs compiles, encoder output decoded back to the picture.
- Live in plain Windows Terminal (user's screenshots): the mod's own painter drew real pictures. Two defects seen and changed: (1) hover wiped rows, because a Button inverts under the pointer and is redrawn — picture rows are now plain Text and the image opens from the `open` button by its name; (2) after scrolling, pieces stayed in blank cells — leftovers are now wiped by writing spaces (DECERA left pieces), and the painter re-reads the screen just before it paints and paints nothing if the rows moved.
- Ruling: click on the picture is given up in Sixel mode — the alternative is a picture that flickers under the pointer — costs the "whole thumbnail" click the user first chose, in this one mode.
- Not seen live yet: the two fixes. Tests 142/142, tsc clean, sixel.cs compiles.
- 2026-11-18, user: "its still glitching but much better". Painter log from their scrolling: 50 moves, each repainted in 6-51 ms, 4 skipped because the screen changed again, up to 87 blank runs wiped a move. Idle cost measured: 505 s CPU over 26575 s (1.9% of a core) at 25 looks a second.
- Found earlier the same day: a painter started as a child of a command Claude Code ran was ended with it; now started through Win32_Process.Create (parent WmiPrvSE). Start and painter failures go to sixel.log.
- Change: picture rows are filled with blank braille (U+2800) to the picture's width and the row number is one braille cell at the left, so Claude Code clears the old place itself and only one cell a row differs on a scroll. Painter no longer wipes on a move (wiping wrote default-colour spaces, which could dent a coloured row); it wipes only after a paint that the screen moved under.
- Change: screen read is one ReadConsoleOutputW call (was one call a row), picture files are looked at once a second, the screen 60 times a second.
- Change: sixel.ps1 -Start is version-aware (hash of sixel.cs): same version running -> nothing; another version -> asked to end through stop-<pid>, replaced.
- Ruling: blank braille as filler — it draws nothing and is not a space — costs: copied text across a picture carries those characters; a terminal font without braille would show boxes for a frame.
- Verified by run: new painter starts, reads the screen whole, is replaced when the version differs, and its pattern matches the mod's row (bun + reflection). Not seen live: the scroll itself with the new rows.
- Tests 142/142 in both copies, tsc clean.
- 2026-11-18, user: "nearly perfect, just the edges of the image gets delayed when scrolling". Cause: rows newly scrolled into view held blank braille until the painter caught up (16 ms sleep on Windows' 15.6 ms timer, so 16-31 ms, plus the paint).
- Change: each picture row now holds that row of the block thumbnail (sixelRow), the marker hidden in its first cells in the colour of the cell beneath. Claude Code draws it in the scroll's own frame; the painter sharpens it. Marker is 5 cells: row as one braille character, U+2595, name as three braille characters (24-bit name from pictureId, FNV-1a of load stamp and counter). Names from before stay readable (written out, ended by U+258F).
- Change: painter asks for a 1 ms timer and looks every 3 ms for 1.5 s after a move, every 12 ms while pictures stand still, every 40 ms with none on screen; among files of one name it takes the newest.
- Ruling: block thumbnail under the picture instead of identical blank rows — an edge is never dark and the picture moves with the text — costs: every cell of a picture is rewritten on each scroll step, so the whole picture is coarse for a frame or two at each step, where before its middle stayed sharp but lagged. The user has not seen this trade yet.
- Verified by run: painter compiles, reads both marker forms from rows the mod's own code made (bun + reflection), replaced the running painter (version e2138b640bd4). Not seen live: the look while scrolling; whether the screen read returns octant cells one unit a cell.
- Tests 147/147 in both copies, tsc clean.
- 2026-11-18, user: scrolling "perfect now" in plain Windows Terminal. Asked: is it in git (no; offer of a private UDO repo was declined for now) and can it work in herdr.
- herdr: probe showed the herdr window process (herdr.exe under powershell under WindowsTerminal) has a console whose buffer is herdr's whole composed screen (188x49), readable with ReadConsoleOutputW; the herdr server has no console.
- Change: mod picks a screen: `claude` (WT_SESSION, no HERDR_ENV/TMUX) or `herdr` (HERDR_ENV, no TMUX); passes `-Screen` to sixel.ps1 -Start. For herdr the start script finds every herdr.exe under WindowsTerminal.exe and ensures one painter of this version per such window; none found -> exit 1 -> mod stays on blocks. Painter code unchanged apart from process lookup: markers are found at any column, so pane offsets need nothing.
- Ruling: one painter per herdr window, painting every pane's pictures — the window is shared — costs: a picture from a session whose files are gone shows nothing, and another session's mod version may write markers this painter reads (formats are compatible both ways today).
- Ruling: `-Host` renamed `-Screen`, as $Host is reserved in PowerShell.
- Verified by run: -Start -Screen herdr found window 23012, painter attached and read its 188x49 screen; -Start -Screen claude replaced the session painter (version change). Not seen live: a picture painted inside herdr; whether herdr rewrites rows under a picture often (sidebar spinners on the same row) and so makes it flicker.
- Tests 150/150, tsc clean.
- 2026-11-18, user in herdr: "it works but its pixelated" — the block thumbnail, not the painter. Log: `start failed: The term 'Get-FileHash' is not recognized`. Cause (reproduced): herdr panes run PowerShell 7; Claude Code inherits its PSModulePath and starts powershell.exe directly, so Windows PowerShell 5.1 looks in PowerShell 7's module folders and cannot load Get-FileHash. (Through pwsh itself it works: pwsh cleans the path for its children.)
- Fix: sixel.ps1 and thumb.ps1 put the machine PSModulePath back first; the version hash is computed in C# (VersionOf). Verified: with PowerShell 7's PSModulePath, -Start for herdr and for claude now exit 0 (before: exit 1, same error).
- Change: a painter start that fails toasts once a session, naming sixel.log. Test RED->GREEN.
- Tests 150/150, tsc clean.
- 2026-11-18, user: "now it works" inside herdr after the PSModulePath fix. Real pictures confirmed in plain Windows Terminal and in herdr. Debug move logging switched off (temp-folder `debug` file removed; running painters keep logging until replaced).
