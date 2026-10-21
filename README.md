[![GitHub Tag](https://img.shields.io/github/v/tag/vielhuber/chatgpt-folders)](https://github.com/vielhuber/chatgpt-folders/tags)
[![Code Style](https://img.shields.io/badge/code_style-psr--12-ff69b4.svg)](https://www.php-fig.org/psr/psr-12/)
[![License](https://img.shields.io/github/license/vielhuber/chatgpt-folders)](https://github.com/vielhuber/chatgpt-folders/blob/main/LICENSE.md)
[![Last Commit](https://img.shields.io/github/last-commit/vielhuber/chatgpt-folders)](https://github.com/vielhuber/chatgpt-folders/commits)

# 📁 ChatGPT folders 📁

A browser extension that organizes your ChatGPT projects in a sortable, hierarchical folder structure.

## Features

- 📂 **Hierarchical folders** - Organize GPT projects in multiple levels using `-` separator
- 🔢 **Conversation counter** - See how many conversations each project contains
- ✅ **Completed projects** - Mark projects as done by including "done" in the name
- 💾 **Smart caching** - Fast loading with localStorage
- 🔄 **Auto-sync** - Real-time updates on URL and title changes
- 📍 **Scroll persistence** - Remembers your scroll position
- 🎨 **Background theme** - The extension offers a background theme for ChatGPT

## Installation

### Chrome

- [https://chromewebstore.google.com/detail/chatgpt-folders/eladlappidlicdlohjjbecghafblfflc](https://chromewebstore.google.com/detail/chatgpt-folders/eladlappidlicdlohjjbecghafblfflc)

### Firefox

- [https://addons.mozilla.org/de/firefox/addon/chatgptfolders](https://addons.mozilla.org/de/firefox/addon/chatgptfolders/)

## Usage

### Creating hierarchies

Use `-` (space-dash-space) in your GPT project names:

```
Project A - Subproject 1
Project A - Subproject 2
Project B - Feature X - Details
```

Results in:

```
📦 Project A
  📁 Subproject 1 (3)
  📁 Subproject 2 (5)
📦 Project B
  📦 Feature X
    📁 Details (2)
```

### Marking as done

Include "done" anywhere in the project name. Completed projects are sorted to the end and marked with ✅.


## Project title-based directories (maintained fork)

This fork adds an **项目目录** navigation section next to ChatGPT's native **项目** section.
The directory tree is reconstructed from original Project names, using ` - `
(space-dash-space) to separate path segments; there is **no separate folder database**.

- 📁 Folder nodes can expand/collapse.
- 📄 Leaf Projects use a document icon so they are distinguishable from folders.
- A Project that is both a parent and an actual Project is shown **once**;
  clicking its name expands it and navigates to the native Project.
  The chevron expands/collapses without navigating.
- Drag a folder **onto another folder** to move its subtree. Drop it on the
  **项目目录** header to move it to the top level.
- Dragging shows a confirmation with the number of native Projects to rename.
  It changes Project titles in ChatGPT, so those changes sync across devices.

Example:

```text
AI - SGLang
AI - SGLang - Scheduler
AI - SGLang - KV Cache
Infra - vLLM
```

Drag `AI / SGLang` onto `Infra` to rename:

```text
Infra - SGLang
Infra - SGLang - Scheduler
Infra - SGLang - KV Cache
Infra - vLLM
```

**Important:** Folder moves call ChatGPT's **undocumented internal Project APIs**.
The extension reads each Project's current settings before renaming,
checks its original title, performs confirmed writes sequentially, and
attempts rollback if any operation fails. API behavior may change.
If rollback reports unresolved Projects, inspect names in the native 项目 list.

No destructive Project rename is attempted if the project list could not be
freshly retrieved. Native standalone Projects are still available in 项目.
Project membership, conversations and files are not moved.

## Local test

```bash
node --test tests/folder-model.test.cjs
```

In Chrome, visit `chrome://extensions`, enable Developer mode, load this
directory unpacked, and disable any previously installed store version.
