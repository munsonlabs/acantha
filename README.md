<div align="center">

<img src="docs/brand/acantha.svg" width="176" height="176" alt="Acantha">

# Acantha

A Git client and simple editor for macOS: a commit graph, a Git panel, terminals and your files, side by side.

**AI-generated and sense-checked · inspired by [Terax](https://github.com/crynta/terax-ai) · for personal use only**

[**Download**](https://github.com/munsonlabs/acantha/releases/latest) ·
[![CI](https://github.com/munsonlabs/acantha/actions/workflows/ci.yml/badge.svg)](https://github.com/munsonlabs/acantha/actions/workflows/ci.yml)
[![Release](https://github.com/munsonlabs/acantha/actions/workflows/release.yml/badge.svg)](https://github.com/munsonlabs/acantha/actions/workflows/release.yml)
[![PolyForm Strict](https://img.shields.io/badge/license-PolyForm%20Strict-blue)](LICENSE)

</div>

> [!IMPORTANT]
> **This project is entirely AI-generated**, written with Claude and sense-checked by a person rather than written by hand. It's **inspired by [Terax](https://github.com/crynta/terax-ai)**, whose look and layout it follows, and by the VS Code Git Graph extension. It was built **for personal use only**: it is not a supported product, and comes with no guarantees. The licence, [PolyForm Strict 1.0.0](LICENSE), allows personal and other non-commercial use only, and no redistribution or modified versions.

![Acantha showing its own history: the commit graph with a commit's details open, the Git panel, and a terminal](docs/screenshot.png)

## Features

Built with Tauri 2, Rust and Vue 3.

- Tabs in the titlebar, one per repository, restored on the next launch with only the last one open and the rest asleep until clicked. Double-click a tab (or a terminal tab) to rename it; right-click to put it to sleep, freeing its memory while keeping its open files and unsaved edits; ▾ lists them all when there are too many to see
- A Git panel: write a commit message, stage, unstage and discard files, view staged or unstaged diffs, amend, push and pull. In a diff, stage, unstage or discard a hunk at a time, or pick single lines by their line numbers
- A terminal pane next to each graph, with its own tabs, starting in the repository (`portable-pty` + xterm.js). ⌘D splits a tab in two, ⌘F finds in the scrollback, and a repository's terminal tabs come back when it's opened again. ⌘-click a file path in the output (`src/x.ts:42:7`) to open it in the editor at that line
- A file browser for the working tree or any commit, with highlighted code, rendered Markdown, images, blame and file history. The eye button also shows what .gitignore leaves out (node_modules, build output), dimmed, each folder read only when opened
- Search in files (⇧⌘F): file names, contents or both, through `git grep`, with match case, regular expressions and a filter for file types or folders (`ts, src/, !*.lock`)
- A tabbed panel under the terminal for Slack messages and canvases (see [Slack](#slack)) and to-do lists: paste a bulleted list anywhere to turn it into to-dos. Tabs are kept per repository. Also in the panel: notes, scripts, two branches compared (commits and changed files), GitHub (the branch's pull request and checks, Actions runs and open pull requests, through the `gh` CLI), a live Markdown preview of a repository file, and any npm package's README
- A small editor (CodeMirror, optional Vim keys) for working-tree files: ⌘S to save, Save & Stage, a warning before losing unsaved changes or overwriting edits made elsewhere, and Open in VS Code, Cursor, Zed or another app
- Branch filter: show any set of branches, or all of them; stashes in the graph, which can be hidden
- A merge conflict resolver (accept current, incoming or both per conflict, or edit it by hand) with Continue/Abort for merges, rebases and cherry-picks
- Interactive rebase: reorder by dragging, then pick, reword, edit, squash, fixup or drop
- Worktrees: listed in the Git panel, each opening in a tab of its own. Create one for a branch or from any commit, remove or prune them, and see which branches are checked out in another worktree (a dashed label in the graph)
- Undo for git actions: commits, amends, merges, rebases, resets, checkouts, branches, tags, stashes and discards
- Instant updates: a file watcher picks up changes from the terminal or your editor straight away
- Auto-fetch in the background, with badges when a branch is behind its remote
- "Open in…" for repositories and files: your editor, Finder, Terminal, or a new terminal tab
- Commit graph across all branches, remotes and tags, with the working tree shown as an "Uncommitted Changes" row
- Commit details with changed files and a line-numbered diff view
- Cmd/Ctrl-click a second commit to compare the two
- Right-click commits, branches, remote branches and tags for checkout, branch, tag, merge, rebase, cherry-pick, revert, reset, push, stash and delete
- Branch filter, remote-branch toggle, find (⌘F) and fetch
- Watches the working tree while the window is focused, so changes made in the terminal or an editor show up
- Open a repo from the toolbar, by dropping its folder onto the window, or from the command line

## Interface

- Relative dates ("3h ago"), author pictures from GitHub or Gravatar, and a lines-changed column
- Hover a commit for a card with its message, files and a link to the commit online; hovering also highlights its branch line
- Go to File (⌘P): fuzzy, the file name first, recent files when empty, `name:42` for a line; the command palette (⇧⌘P, or `>` in Go to File) for commands and recent repositories; Check Out Branch… for a list of just branches
- Settings (⌘,), a native menu bar, and a shortcuts sheet (⌘/)
- Tabs with a sliding highlight, reordered by dragging

## Shortcuts

| Keys          | Action                                              |
| ------------- | --------------------------------------------------- |
| ⌘T / ⌘W       | New tab / close tab (or the terminal, when focused) |
| ⌘1–9, ⌘⇧[ ⌘⇧] | Switch tabs                                         |
| ⌘P            | Go to file                                          |
| ⇧⌘P           | Command palette                                     |
| ⌘,            | Settings                                            |
| ⌘/            | Keyboard shortcuts                                  |
| ⌘B            | Show or hide the sidebar (Files and Git)            |
| ⌘+ / ⌘− / ⌘0  | Interface size: bigger, smaller, actual size        |
| ⌘↵            | Commit (in the message box)                         |
| ⌘J            | Show or hide the terminal                           |
| ⌃⇧`           | New terminal tab                                    |
| ⌘K            | Clear the terminal                                  |
| ⌘F / ⌘R / ⌘O  | Search commits / refresh / open a repository        |
| ⇧⌘F / ⌥⌘F     | Search in files / search file names                 |
| ⇧⌘L           | Open a Slack link (or paste one with ⌘V)            |

## Slack

Acantha can show a Slack message (with its thread) or a canvas in a panel under the terminal. It reads them with your
own Slack user token, which lives in the macOS Keychain; the app never stores it, and nothing is ever posted to Slack.

### Set up

1. Go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App → From a manifest**, pick your
   workspace and paste:

   ```yaml
   display_information:
     name: Acantha
   oauth_config:
     scopes:
       user:
         - channels:history # messages in public channels
         - files:read # canvases
         - users:read # names and avatars (optional)
   ```

   Add `groups:history`, `im:history` or `mpim:history` only if you want private channels, DMs or group DMs too.

2. Open **OAuth & Permissions** and click **Install to Workspace**. If it says **Request to Install**, your workspace
   needs an admin to approve it first; install it once they have.
3. Copy the **User OAuth Token** (`xoxp-…`). You don't need the app-level token, client secret or signing secret.
4. Save it to your Keychain from Terminal, pasting the token when asked (twice):

   ```sh
   security add-generic-password -a "$USER" -s com.munsonlabs.acantha.slack -w
   ```

### Use

- Copy a message's link in Slack (**⋯ → Copy link**) or a canvas's link, click anywhere in Acantha outside a text box
  and press ⌘V: it opens in a tab of the panel under the terminal. ⇧⌘L opens a box to paste one into, and the panel's
  **+** menu has the same.
- Copy a bulleted, numbered or checkbox list and press ⌘V the same way to make a to-do list tab. A Slack message with
  bullet points has a **To-dos** button that does the same for its bullets. Tick items off, click one to edit it, or
  paste more lines into the box at the bottom.
- The **Panel** button at the bottom right shows or hides the panel; drag the bar between it and the terminal to
  resize. **Expand** moves it over the graph, and Esc puts it back. Double-click or right-click a tab to rename it.
- Tabs, with their Slack links and to-dos, are remembered per repository.
- To limit Acantha to certain channels, put their IDs (the `C…` in a message link) under **Settings → Slack →
  Allowed channels**. Anything from another channel is then refused before it's fetched. Left empty, any channel
  you can read is allowed.

### Good to know

- A user token only sees what you can see in Slack. Nobody is notified when Acantha reads a message, and the app
  can't post: it has no write scopes. Workspace admins can see that the app is installed and what it may read.
- Custom workspace emoji show as `:name:`; pictures in canvases aren't loaded.
- To remove it, delete the app on [api.slack.com/apps](https://api.slack.com/apps) (or **Revoke Tokens** there),
  and the Keychain item with `security delete-generic-password -s com.munsonlabs.acantha.slack`.

## Install

Download the `.dmg` for your Mac from [Releases](https://github.com/munsonlabs/acantha/releases): **aarch64** for Apple Silicon, **x64** for Intel. The app isn't notarised yet, so the first time, right-click Acantha in Applications and choose **Open**.

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
"src-tauri/target/release/bundle/macos/Acantha.app/Contents/MacOS/acantha" ~/code/my-repo
```

## Releasing

Bump `version` in `src-tauri/tauri.conf.json` and `package.json`, commit, then tag and push:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The Release workflow builds the app for Apple Silicon and Intel on GitHub's macOS runners and publishes both `.dmg` files to the Releases page. CI runs the checks and tests on every push.

## Licence

[PolyForm Strict 1.0.0](LICENSE): free for personal and other non-commercial use. It doesn't allow commercial use, redistributing the app, or publishing modified versions.
