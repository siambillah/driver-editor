# Notepad++ Web & Google Drive Studio

A lightweight, modular, zero-build web code and text editor built with **CodeMirror 5**, **Google Drive API v3**, and **Pyodide**. Designed as a fast Notepad++-inspired workspace that integrates directly into Google Drive's **"Open with"** and **"+ New"** context menus—working seamlessly across both desktop and mobile browsers.

**Live App:** [https://siambillah.github.io/driver-editor/](https://siambillah.github.io/driver-editor/)

---

## Features

### Google Drive Integration
* **Native Drive UI Integration:** Open `.py`, `.md`, `.html`, `.json`, `.js`, `.css`, `.sql`, `.sh`, and `.txt` files directly from Google Drive via **Right-Click > Open with**.
* **In-App Drive Explorer:** Browse folders, search files, and save new files directly into specific Google Drive folders without leaving the editor.
* **Auto-Save & Sync:** Save changes with `Ctrl+S` or toggle **Auto-Save** to sync edits automatically 4 seconds after typing.

### Editor & Coding Tools
* **Multi-Tab Workspace & Crash Recovery:** Work across multiple files simultaneously with per-tab undo/redo history, unsaved indicators (`*`), double-click tab renaming, and automatic `localStorage` session recovery.
* **Syntax Highlighting & Code Folding:** Supports Python, HTML, CSS, JavaScript, JSON, Markdown, SQL, and Bash/Shell with Light (Notepad++) and Dark (Dracula) themes.
* **Smart Autocomplete & Auto-Close Tags:** Automatically closes HTML tags (`<html>` → `</html>`) and brackets, paired with context-aware keyword suggestions and built-in code snippets (`html5`, `pyreq`, `pymain`).
* **Notepad++ Text & Data Utilities:** Duplicate lines or selections (`Ctrl+D`), format/validate JSON, convert case (`UPPERCASE` / `lowercase`), sort lines (`A–Z`), remove duplicate lines, and trim whitespace.

### Live Split Preview & Browser Python Runner
* **Draggable Split Screen:** Edit code on the left and view live rendered output on the right.
* **Markdown & HTML Live Rendering:** Real-time Markdown preview with formatting toolbar and clean **Print / Export to PDF** support, plus sandboxed live HTML rendering.
* **Client-Side Python Execution (`▶ Run Py`):** Execute Python scripts directly inside the browser via **Pyodide** with an integrated console output pane—no backend server required.

### Mobile-Friendly Design
* **Responsive Toggle View:** Automatically adapts on mobile screens to switch cleanly between full-screen Editor and full-screen Output/Console.
* **Floating Extra-Keys Bar:** Provides quick touch access to `Tab`, `{ }`, `[ ]`, `( )`, `< >`, quotes, operators, autocomplete hints, and `Undo/Redo`.

---

## Project Structure

```text
driver-editor/
├── index.html          # Main UI layout, CodeMirror loader, and mobile extra-keys bar
├── css/
│   └── style.css       # Light/Dark themes, split-screen layout, and mobile responsive rules
└── js/
    ├── main.js         # Core editor initialization, multi-tab manager, and shortcuts
    ├── suggestions.js  # Language-specific autocomplete dictionaries and custom snippets
    ├── drive.js        # Google OAuth 2.0, Drive folder browser, and file read/write sync
    └── tools.js        # Live split preview, Pyodide Python runner, JSON & text utilities
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
   [https://siambillah.github.io](https://siambillah.github.io)
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
   [https://siambillah.github.io/driver-editor/index.html](https://siambillah.github.io/driver-editor/index.html)
   ```
3. Add default MIME types (`text/plain`, `text/x-python`, `text/markdown`, `text/html`, `application/json`) and file extensions (`txt`, `py`, `md`, `html`, `js`, `css`, `json`, `sql`, `sh`), then click **Submit**.

---

## Running Locally

Because the project uses native ES6 modules (`type="module"`), serve it over HTTP rather than opening `index.html` directly via `file://`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + S` / `Cmd + S` | Save active file to Google Drive (or download locally if disconnected) |
| `Ctrl + D` / `Cmd + D` | Duplicate current line or selected text |
| `Ctrl + Space` | Trigger smart autocomplete & snippet suggestions |
| `Ctrl + /` | Toggle line/block comment |
| `Ctrl + F` | Find text |
| `Ctrl + H` | Find and replace |
| `Ctrl + G` | Jump to line number |
| `Double-Click` (Tab) | Rename active file (syncs rename to Google Drive) |

---

## Extending the Editor

* **Add Custom Snippets or Keywords:** Edit `LANGUAGE_DICTIONARIES` or `CODE_SNIPPETS` inside `js/suggestions.js`.
* **Add New Language Modes:** Include the corresponding CodeMirror mode script in `index.html` and map its file extension in `detectMeta()` inside `js/main.js`.
