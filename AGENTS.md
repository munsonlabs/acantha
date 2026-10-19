# Git Graph — Agent Guide

## Layout

| Path                           | What lives there                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src-tauri/src/pty.rs`         | Terminal sessions: spawns the login shell in a PTY and streams output over a Tauri `Channel`                                               |
| `src-tauri/src/git.rs`         | Every Tauri command. Shells out to the `git` CLI, the same way the VS Code extension does                                                  |
| `src/lib/git.ts`               | Typed `invoke` wrappers and the shared types. Keep in sync with the Rust structs                                                           |
| `src/lib/graph.ts`             | Lane layout: assigns each commit a column and produces row-to-row edges                                                                    |
| `src/composables/workspace.ts` | A workspace is one top-level tab. `createWorkspace` builds its state from the `create*` factories; components get it with `useWorkspace()` |
| `src/composables/`             | Per-workspace factories (`repo`, `details`, `search`, `terminals`, …) and app-wide singletons (`useDialog`, `useToast`, `prefs`)           |
| `src/composables/menus.ts`     | Every right-click action, built on `ask()` dialogs and `run()`                                                                             |
| `src/components/`              | Presentational SFCs                                                                                                                        |

## Conventions

- Terminals stay mounted (`v-show`) while hidden or in a background tab: unmounting a `TerminalView` kills its shell.
- Theme tokens in `src/styles/main.css` mirror Terax's default theme, including the ANSI palette the terminal reads.

- Mutating git commands go through `run_action`, which only allows the subcommands in `ACTIONS`. Add the subcommand there when a new action needs one.
- `*` (`UNCOMMITTED`) is the pseudo-hash for the working tree, on both sides of the bridge.
- `git()` sets `GIT_TERMINAL_PROMPT=0` and `GIT_EDITOR=true` so nothing can block waiting for input. Pass `--no-edit` where git would open an editor.
- Formatting follows the Munson Labs style (single quotes, no semicolons, 150 columns), enforced by `vp check` and the pre-commit hook.

## Checks

```bash
npm run check                 # vp check + vue-tsc
cd src-tauri && cargo test    # builds a temp repo and exercises the commands
cd src-tauri && cargo clippy
```
