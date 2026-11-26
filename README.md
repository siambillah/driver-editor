# SB Editor Text

A lightweight, modular, zero-build web code and text editor built with **CodeMirror 5**, **Google Drive API v3**, **Pyodide**, and **PWA offline support**. Designed as a fast Notepad++-inspired studio that integrates directly into Google Drive's **"Open with"** and **"+ New"** context menus—working seamlessly across both desktop and mobile browsers.

**Live App:** [https://siambillah.github.io/driver-editor/](https://siambillah.github.io/driver-editor/)

---

## Features

### Google Drive & Local File Integration
* **Native Drive UI Integration:** Open single or multiple files directly from Google Drive via **Right-Click > Open with**, and create new files directly in the target folder via **+ New** (`action: "create"`).
* **Upgraded In-App Drive Explorer & Full Folder Workspace:** Browse folders, search files, view file size and last modified timestamps, **create new folders**, **move files/folders to Trash**, **reload Drive tabs**, save new files into any Drive folder, or **open an entire Google Drive folder** in the left **Explorer Sidebar** (`Ctrl+B`).
* **Auto-Save & Session Expiry Handling:** Save with `Ctrl+S` or toggle **Auto-Save** (4-second debounce) with automatic `401` expired-token detection and reconnect prompts.
* **Local Folder Explorer & File System Access API:** Open an entire **Local Folder** (`Open Folder` or Drag & Drop folder) into the collapsible Explorer Sidebar—with lazy subfolder expansion, **Open All**, creating new files inside the folder, and direct in-place `Ctrl+S` saving back to disk in Chrome/Edge (with `webkitdirectory` fallback for other browsers).
* **Shareable Snippet Links:** Share code snippets directly via `#share=` URL hash with zero backend.

### Editor & Notepad++ Power Tools
* **Full Dark Mode & Persisted Settings:** True full-UI Dark Mode (`Dracula`, `Monokai`, `Material Dark`) alongside Light (`Eclipse`, `Classic`) themes, automatically saving theme, font size, word wrap, and auto-save preferences to `localStorage`.
* **Multi-Tab Workspace & Crash Recovery:** Work across multiple tabs with per-tab undo/redo history, unsaved indicators (`*`), `Drive`/`Disk`/`Local` badges, double-click rename, right-click / `⋮` tab action menu (Rename, Duplicate, Reload from Drive, Compare, Copy Content, Close Others), and automatic session recovery.
* **Command Palette (`Ctrl+Shift+P` / `F1`):** Instant keyboard-navigable access to all commands, tools, themes, and open tabs.
* **Diff / Compare Tabs:** Side-by-side line-by-line Diff viewer (`+` / `-` stats and color-coded changes) between any two open tabs.
* **Find & Replace Across All Open Tabs (`Ctrl+Shift+F`):** Search with Case-Sensitive (`Aa`) and Regex (`.*`) toggles across all tabs, jump directly to any match, or Replace All globally.
* **Expanded Language Modes & Editing Addons:** Supports HTML, CSS, JavaScript/TypeScript/JSON, Python, Markdown, SQL, Bash/Shell, C/C++/C#, Java, PHP, YAML, XML/SVG, Go, and Rust—with tag matching, selection match highlighting, code folding, line moving (`Alt+↑`/`Alt+↓`), and line bookmarks (`Ctrl+F2` / `F2`).
* **Smart Autocomplete & Custom Snippets Manager:** Context-aware hints plus a built-in UI to create, insert, and manage custom code snippets saved in `localStorage`.
* **Auto Code Formatter (`Shift+Alt+F`):** One-click formatting for HTML, CSS, JavaScript, and JSON.
* **Text & Developer Utilities:**
  * *Text:* `UPPERCASE`, `lowercase`, `Title Case`, `Sort A–Z / Z–A`, `Reverse Lines`, `Remove Duplicate Lines`, `Remove Empty Lines`, `Trim Spaces`, `Add Line Numbers`, `Join Lines`, and `Ctrl+D` line/selection duplicate.
  * *Dev / Encoding:* `Base64 Encode/Decode`, `URL Encode/Decode`, `JWT Decoder`, `Minify JSON`, `JSON ↔ CSV`, and `HTML Escape/Unescape`.

### Live Split Preview & Browser Code Runners
* **Multi-File HTML Live Bundling:** Automatically injects open `.css` and `.js` tabs referenced by `<link>` or `<script>` inside HTML live preview.
* **Upgraded Markdown Preview:** Real-time rendering with **Syntax Highlighting** (`highlight.js`) + per-block **Copy** buttons, on-demand **Mermaid** diagrams, **KaTeX** math (`$...$` / `$$...$$`), **Scroll Sync**, **Export Standalone HTML**, and **Print / Export to PDF**.
* **Client-Side Python (`Pyodide`) & JavaScript Console (`▶ Run`):**
  * Smart `▶ Run` button executes Python via Pyodide (with `input()` prompt support, auto package imports, HTML-escaped console output, timing, and `+ Pkg` `micropip` installer) or JavaScript in an isolated sandboxed console (`console.log/warn/error`).

### Installable PWA & Mobile Experience
* **Offline PWA Support:** Installable web app (`manifest.json` + `sw.js`) that caches the app shell and CDN assets for offline coding.
* **Mobile-Friendly Controls:** Responsive Editor/Output toggle, horizontal swipe gestures on mobile screens, `⋮` mobile-friendly tab actions menu, and floating Extra-Keys bar.

---

## Project Structure

```text
driver-editor/
├── index.html          # Main UI layout, CodeMirror/library loaders, modals & mobile bar
├── favicon.ico         # Multi-size browser favicon (16x16, 32x32, 48x48) for GitHub Pages
├── manifest.json       # PWA Web App Manifest (installable app metadata)
├── sw.js               # Service Worker for offline caching (skips Google Auth/Drive APIs)
├── assets/
│   ├── icon.svg        # Vector SB Editor Text favicon & app icon
│   ├── favicon-32x32.png
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   └── icon-512.png    # PWA & Google Drive UI Integration app icon
├── css/
│   └── style.css       # Full Light/Dark UI theme variables, split layout, modals & Diff styles
└── js/
    ├── main.js         # Core editor, tabs, settings persistence, bookmarks, File API, Drag&Drop & PWA
    ├── suggestions.js  # Language keyword dictionaries, built-in & localStorage custom snippets
    ├── drive.js        # Google OAuth 2.0, 401 refresh handling, folder/file CRUD & Drive sync
    ├── tools.js        # Multi-file HTML preview, Markdown (hljs/Mermaid/KaTeX), Python/JS runners & utilities
    ├── modals.js       # Command Palette, Diff Viewer, Search All Tabs, Snippets Manager & Share Links
    └── explorer.js     # Collapsible Folder Explorer sidebar for Local & Google Drive folders
```

---

## Setup & Google Cloud Configuration

### 1. Enable Google Drive API
1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Navigate to **APIs & Services > Library**, search for **Google Drive API**, and click **Enable**.

### 2. Configure OAuth Consent Screen & Credentials
1. Open **APIs & Services > OAuth consent screen**, select **External**, and add your email under **Test users**.
2. Add the following scopes:
   * `https://www.googleapis.com/auth/drive.file`
   * `https://www.googleapis.com/auth/drive.install`
3. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID** (**Web application**).
4. Under **Authorized JavaScript origins**, add:
   ```text
   https://siambillah.github.io
   http://localhost:8000
   ```
5. Copy the generated **Client ID** and paste it into `js/drive.js`:
   ```javascript
   const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
   ```

### 3. Configure Drive UI Integration
1. In Google Cloud Console, open **Google Drive API > Drive UI Integration**.
2. Set both **Open URL** and **Create URL** to:
   ```text
   https://siambillah.github.io/driver-editor/index.html
   ```
3. Add default MIME types (`text/plain`, `text/x-python`, `text/markdown`, `text/html`, `application/json`) and file extensions (`txt`, `py`, `md`, `html`, `js`, `css`, `json`, `sql`, `sh`), then click **Submit**.

---

## Running Locally

Because the project uses native ES6 modules (`type="module"`) and a Service Worker, serve it over HTTP rather than opening `index.html` directly via `file://`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + S` / `Cmd + S` | Save active file (Google Drive, Direct Disk handle, or Download) |
| `Ctrl + B` / `Cmd + B` | Toggle Folder Explorer Sidebar (Local / Drive folder tree) |
| `Ctrl + Enter` | Run active file (Python, JavaScript, or live HTML/Markdown preview) |
| `Ctrl + Shift + P` / `F1` | Open Command Palette |
| `Ctrl + Shift + F` | Find & Replace across all open tabs |
| `Shift + Alt + F` | Auto-format HTML, CSS, JavaScript, or JSON |
| `Ctrl + D` / `Cmd + D` | Duplicate current line or selected text |
| `Alt + ↑` / `Alt + ↓` | Move current line or selection up / down |
| `Ctrl + F2` | Toggle bookmark on current line |
| `F2` / `Shift + F2` | Jump to next / previous bookmark |
| `Ctrl + Space` | Trigger smart autocomplete & snippet suggestions |
| `Ctrl + /` | Toggle line/block comment |
| `Ctrl + F` / `Ctrl + H` | Find / Find and replace in current tab |
| `Ctrl + G` | Jump to line number |
| `Double-Click` / `Right-Click` (Tab) | Rename tab or open Tab Actions menu |

---

## Extending the Editor

* **Add Custom Snippets:** Click **Snippets** in the toolbar (saved in `localStorage`) or edit `LANGUAGE_DICTIONARIES` / `CODE_SNIPPETS` in `js/suggestions.js`.
* **Add New Language Modes:** Include the corresponding CodeMirror mode script in `index.html` and map its file extension in `detectMeta()` inside `js/main.js`.
