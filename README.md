# Git Graph

A standalone desktop take on the VS Code Git Graph extension, built with Tauri 2, Rust and Vue 3, with a terminal beside each graph. The look follows [Terax](https://github.com/crynta/terax-ai).

- Tabs in the titlebar, one per repository, restored on the next launch
- A terminal pane next to each graph, with its own tabs, starting in the repository (`portable-pty` + xterm.js)
- Commit graph across all branches, remotes and tags, with the working tree shown as an "Uncommitted Changes" row
- Commit details with changed files and a line-numbered diff view
- Cmd/Ctrl-click a second commit to compare the two
- Right-click commits, branches, remote branches and tags for checkout, branch, tag, merge, rebase, cherry-pick, revert, reset, push, stash and delete
- Branch filter, remote-branch toggle, find (⌘F) and fetch
- Refreshes when the window regains focus, so changes made in a terminal show up
- Open a repo from the toolbar, by dropping its folder onto the window, or from the command line

## Shortcuts

| Keys          | Action                                              |
| ------------- | --------------------------------------------------- |
| ⌘T / ⌘W       | New tab / close tab (or the terminal, when focused) |
| ⌘1–9, ⌘⇧[ ⌘⇧] | Switch tabs                                         |
| ⌘J            | Show or hide the terminal                           |
| ⌃⇧`           | New terminal tab                                    |
| ⌘K            | Clear the terminal                                  |
| ⌘F / ⌘R / ⌘O  | Search commits / refresh / open a repository        |

## Develop

Requires Node (see `.node-version`), Rust (`rustup`) and git.

```bash
vp i
vp config     # installs the pre-commit hook; .npmrc sets ignore-scripts, so it isn't automatic
npm run dev   # tauri dev, which starts `vp dev` on port 1420
npm run check # vp check (fmt, lint, types) + vue-tsc for templates
npm run build # release .app / .dmg under src-tauri/target/release/bundle
```

Backend tests run against a throwaway repo: `cd src-tauri && cargo test`.

Open a specific repo on launch by passing its path to the binary:

```bash
"src-tauri/target/release/bundle/macos/Git Graph.app/Contents/MacOS/git-graph" ~/code/my-repo
```
