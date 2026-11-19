# Contributing to cc-img

Help is welcome, from a one-line report to a new terminal. These help the most now:

1. **A report from a terminal that is not in the [Tested on](README.md#tested-on) table.** Linux, kitty, Ghostty, WezTerm, Alacritty, foot, Konsole and VS Code are not yet seen on a real screen. Open a ["Tested on" issue](https://github.com/dogukanatlihan/cc-img-preview/issues/new?template=tested-on.yml), whether the mod worked or not.
2. **A run of the Windows Sixel painter after 0.2.4.** Its C# was split into smaller parts in 0.2.4. CI compiles it on Windows, but no person has seen it paint since.
3. **Fixes and new terminals or formats.** Issues labelled [`good first issue`](https://github.com/dogukanatlihan/cc-img-preview/labels/good%20first%20issue) and [`help wanted`](https://github.com/dogukanatlihan/cc-img-preview/labels/help%20wanted) are a good start.

## Run the mod from your clone

1. Fork the repository and clone your fork.
2. If you installed the mod from the marketplace, turn that copy off, so that two copies do not draw: `claude plugin disable cc-img@cc-img-preview`.
3. Start Claude Code with the clone loaded: `claude --plugin-dir <your clone>`.

The [Development](README.md#development) section of the README says which file does what.

## Checks

The fast loop, with [bun](https://bun.sh), for every test file that needs no Claude Code engine:

```
bun test --preload ./tools/sonar/testing-shim.ts hooks/*.test.ts
```

Before a pull request, from the clone's folder:

```
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc -p .
```

`claude plugin test .` also runs the tests of `hooks/register.tsx`, which run only inside Claude Code. The type check needs the types that Claude Code writes into `.claude-plugin/types/`: start one session with `--plugin-dir` first.

CI runs the bun tests on Linux, macOS and Windows. On Windows it also compiles the painter with Windows PowerShell 5.1, as the mod does, and makes one thumbnail with `helpers/thumb.ps1`.

## Rules for a change

- One change for each pull request. New logic comes with a test.
- Keep the promises in [What the mod does on your machine](README.md#what-the-mod-does-on-your-machine):
  - no network;
  - no change to Claude's tools, tool results or prompts;
  - a click opens only image files the mod recorded itself;
  - a path is always given to a program as one argument, never through a shell.
- Anything you can see on screen: add a screenshot to the pull request, and say which terminal and system.
- Add a line to `CHANGELOG.md` under `## Unreleased`.
- The Windows painter compiles as C# 5 for .NET Framework, because Windows PowerShell 5.1 compiles it at run time. Newer C# does not compile there.

## Releases

The maintainer sets the version in `.claude-plugin/plugin.json`, moves the `Unreleased` lines under that version, and tags the commit `cc-img--v<version>`.

## Security

Report a security problem privately, as described in [SECURITY.md](SECURITY.md), not in a public issue.

## License

What you contribute is under the [MIT license](LICENSE) of this repository.
