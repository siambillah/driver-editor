import { registerCustomHints, setupAutoComplete } from './suggestions.js';
import * as drive from './drive.js';
import * as tools from './tools.js';
import * as modals from './modals.js';
import * as explorer from './explorer.js';
import * as terminal from './terminal.js';

const STORAGE_KEY = 'npp_modular_tabs_v1';
const SETTINGS_KEY = 'npp_modular_settings_v1';
const DARK_THEMES = new Set(['dracula', 'monokai', 'material-darker']);

let tabs = [];
let activeTabId = null;
let autoSaveTimer = null;
let previewTimer = null;

// Persisted Settings
const settings = {
  theme: 'eclipse',
  fontSize: 15,
  wordWrap: true,
  autoSave: false
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    Object.assign(settings, saved);
  } catch {}
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

loadSettings();

// Register smart autocomplete
registerCustomHints(CodeMirror);

// Initialize CodeMirror with Auto-Close Tags, Match Tags, Highlight Matches, Bookmarks & Shortcuts
const editor = CodeMirror(document.getElementById('editor-pane'), {
  theme: settings.theme,
  lineNumbers: true,
  lineWrapping: settings.wordWrap,
  styleActiveLine: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  autoCloseTags: true,
  matchTags: { bothTags: true },
  highlightSelectionMatches: { showToken: /\w/, annotateScrollbar: false },
  foldGutter: true,
  gutters: ['CodeMirror-bookmarks', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
  indentUnit: 4,
  tabSize: 4,
  extraKeys: {
    'Ctrl-S': () => saveCurrentTab(),
    'Cmd-S': () => saveCurrentTab(),
    'Ctrl-D': () => duplicateLineOrSelection(),
    'Cmd-D': () => duplicateLineOrSelection(),
    'Ctrl-Space': (cm) => cm.showHint({ hint: CodeMirror.hint.smartHint }),
    'Ctrl-/': (cm) => cm.toggleComment(),
    'Cmd-/': (cm) => cm.toggleComment(),
    'Ctrl-G': (cm) => cm.execCommand('jumpToLine'),
    'Alt-Up': () => moveLines(-1),
    'Alt-Down': () => moveLines(1),
    'Ctrl-F2': () => toggleBookmark(),
    'F2': () => nextBookmark(1),
    'Shift-F2': () => nextBookmark(-1),
    'Shift-Alt-F': () => tools.formatActiveCode(),
    'Ctrl-Shift-P': () => modals.openCommandPalette(),
    'Cmd-Shift-P': () => modals.openCommandPalette(),
    'F1': () => modals.openCommandPalette(),
    'Ctrl-Shift-F': () => modals.openSearchAllModal(),
    'Cmd-Shift-F': () => modals.openSearchAllModal(),
    'Ctrl-B': () => explorer.toggleSidebar(),
    'Cmd-B': () => explorer.toggleSidebar(),
    'Ctrl-`': () => terminal.toggleTerminal(),
    'Cmd-`': () => terminal.toggleTerminal(),
    'Ctrl-Enter': () => tools.runActiveCode(),
    'Cmd-Enter': () => tools.runActiveCode(),
    'Tab': (cm) => {
      if (cm.somethingSelected()) cm.indentSelection('add');
      else cm.replaceSelection('    ', 'end');
    }
  }
});

setupAutoComplete(editor);

// Global shortcuts even when editor is unfocused
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    modals.openCommandPalette();
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    modals.openSearchAllModal();
  } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    explorer.toggleSidebar();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.code === 'Backquote')) {
    e.preventDefault();
    terminal.toggleTerminal();
  } else if (e.key === 'Escape') {
    hideTabContextMenu();
    ['driveModal', 'paletteModal', 'diffModal', 'searchAllModal', 'snippetsModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display === 'flex') el.style.display = 'none';
    });
  }
});

// Click bookmark gutter to toggle bookmark
editor.on('gutterClick', (cm, line, gutter) => {
  if (gutter === 'CodeMirror-bookmarks') {
    toggleBookmark(line);
  }
});

/* ==================== BOOKMARKS & LINE MOVE ==================== */
function makeBookmarkMarker() {
  const m = document.createElement('div');
  m.className = 'bookmark-marker';
  m.textContent = '●';
  m.title = 'Bookmark (F2 to jump)';
  return m;
}

function toggleBookmark(lineNum = null) {
  const line = lineNum !== null ? lineNum : editor.getCursor().line;
  const info = editor.lineInfo(line);
  const hasBm = Boolean(info?.gutterMarkers?.['CodeMirror-bookmarks']);
  editor.setGutterMarker(line, 'CodeMirror-bookmarks', hasBm ? null : makeBookmarkMarker());
  updateBookmarkStat();
}

function getBookmarkedLines() {
  const lines = [];
  editor.eachLine((handle) => {
    if (handle.gutterMarkers?.['CodeMirror-bookmarks']) {
      lines.push(editor.getLineNumber(handle));
    }
  });
  return lines;
}

function nextBookmark(dir = 1) {
  const bms = getBookmarkedLines();
  if (!bms.length) {
    setStatus('No bookmarks in this file (press Ctrl+F2 or click left margin).');
    return;
  }
  const cur = editor.getCursor().line;
  let target;
  if (dir > 0) {
    target = bms.find(l => l > cur) ?? bms[0];
  } else {
    target = [...bms].reverse().find(l => l < cur) ?? bms[bms.length - 1];
  }
  editor.setCursor({ line: target, ch: 0 });
  editor.scrollIntoView({ line: target, ch: 0 }, 80);
  editor.focus();
}

function updateBookmarkStat() {
  const el = document.getElementById('bookmarkStat');
  if (!el) return;
  const count = getBookmarkedLines().length;
  el.textContent = count ? `🔖 ${count}` : '';
}

function moveLines(dir) {
  const doc = editor.getDoc();
  const from = doc.getCursor('from');
  const to = doc.getCursor('to');
  const startLine = from.line;
  const endLine = to.line;
  const lastLine = doc.lineCount() - 1;

  if (dir < 0 && startLine === 0) return;
  if (dir > 0 && endLine >= lastLine) return;

  editor.operation(() => {
    if (dir < 0) {
      const above = doc.getLine(startLine - 1);
      const block = [];
      for (let i = startLine; i <= endLine; i++) block.push(doc.getLine(i));
      doc.replaceRange(
        [...block, above].join('\n'),
        { line: startLine - 1, ch: 0 },
        { line: endLine, ch: doc.getLine(endLine).length }
      );
      doc.setSelection({ line: startLine - 1, ch: from.ch }, { line: endLine - 1, ch: to.ch });
    } else {
      const below = doc.getLine(endLine + 1);
      const block = [];
      for (let i = startLine; i <= endLine; i++) block.push(doc.getLine(i));
      doc.replaceRange(
        [below, ...block].join('\n'),
        { line: startLine, ch: 0 },
        { line: endLine + 1, ch: doc.getLine(endLine + 1).length }
      );
      doc.setSelection({ line: startLine + 1, ch: from.ch }, { line: endLine + 1, ch: to.ch });
    }
  });
}

// Notepad++ Style Ctrl+D (Duplicate Selection or Current Line)
function duplicateLineOrSelection() {
  if (editor.somethingSelected()) {
    const sel = editor.getSelection();
    editor.replaceSelection(sel + sel, 'around');
  } else {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    editor.replaceRange('\n' + lineText, { line: cursor.line, ch: lineText.length });
    editor.setCursor({ line: cursor.line + 1, ch: cursor.ch });
  }
}

/* ==================== LANGUAGE DETECTION ==================== */
function detectMeta(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const modes = {
    html: 'htmlmixed', htm: 'htmlmixed',
    py: 'python',
    md: 'markdown', markdown: 'markdown',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript', jsx: 'javascript', tsx: 'javascript', json: 'javascript',
    css: 'css', scss: 'css',
    sql: 'sql',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    c: 'text/x-c++src', h: 'text/x-c++src', cpp: 'text/x-c++src', cc: 'text/x-c++src', hpp: 'text/x-c++src', cs: 'text/x-c++src',
    java: 'text/x-java',
    php: 'application/x-httpd-php',
    yml: 'text/x-yaml', yaml: 'text/x-yaml',
    xml: 'application/xml', svg: 'application/xml',
    go: 'text/x-go',
    rs: 'text/x-rustsrc',
    txt: 'text/plain'
  };
  const mimes = {
    html: 'text/html', htm: 'text/html',
    py: 'text/x-python',
    md: 'text/markdown',
    js: 'application/javascript', ts: 'text/typescript', json: 'application/json',
    css: 'text/css',
    sql: 'application/sql',
    sh: 'text/x-sh',
    xml: 'application/xml', svg: 'image/svg+xml',
    yml: 'text/yaml', yaml: 'text/yaml',
    txt: 'text/plain'
  };
  return { mode: modes[ext] || 'text/plain', mimeType: mimes[ext] || 'text/plain' };
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function setStatus(msg) {
  document.getElementById('statusMsg').textContent = msg;
}

function updateRunButtonLabel(tab) {
  const btn = document.getElementById('runBtn');
  if (!btn || !tab) return;
  const isJson = tab.title.toLowerCase().endsWith('.json');
  if (tab.mode === 'python') btn.textContent = '▶ Run Py';
  else if (tab.mode === 'javascript' && !isJson) btn.textContent = '▶ Run JS';
  else if (tab.mode === 'htmlmixed' || tab.mode === 'markdown') btn.textContent = '▶ Preview';
  else btn.textContent = '▶ Run';
}

/* ==================== TAB MANAGEMENT ==================== */
function createTab({ title = 'index.html', content = '', fileId = null, folderId = null, fileHandle = null, workspacePath = null, isDirty = false, mode = null, mimeType = null } = {}) {
  const meta = detectMeta(title);
  const finalMode = mode || meta.mode;
  const id = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const doc = CodeMirror.Doc(content, finalMode);

  const tab = { id, title, doc, mode: finalMode, mimeType: mimeType || meta.mimeType, fileId, folderId, fileHandle, workspacePath, isDirty };

  doc.on('change', () => {
    if (!tab.isDirty) {
      tab.isDirty = true;
      renderTabBar();
    }
    saveSession();
    if (tab.id === activeTabId) {
      updateStatusBar();
      if (tools.isPreviewOpen()) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(tools.renderPreview, 120);
      }
      if (settings.autoSave && tab.fileId && drive.isDriveConnected()) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => drive.saveTabToDrive(tab, true), 4000);
      }
    }
  });

  tabs.push(tab);
  switchTab(id);
  saveSession();
  return tab;
}

function switchTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  activeTabId = id;
  editor.swapDoc(tab.doc);
  editor.setOption('mode', tab.mode);
  const langSelect = document.getElementById('langSelect');
  if (langSelect) langSelect.value = tab.mode;
  document.getElementById('md-toolbar').style.display = tab.mode === 'markdown' ? 'flex' : 'none';
  updateRunButtonLabel(tab);
  tools.setPreviewMode('auto');
  renderTabBar();
  updateStatusBar();
  updateBookmarkStat();
  if (tools.isPreviewOpen()) tools.renderPreview();
  editor.focus();
}

function openTabAtLine(tabId, line, ch = 0) {
  switchTab(tabId);
  editor.setCursor({ line, ch });
  editor.scrollIntoView({ line, ch }, 100);
  editor.focus();
}

function closeTab(id, e) {
  if (e) e.stopPropagation();
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (tabs[idx].isDirty && !confirm(`"${tabs[idx].title}" সেভ করা হয়নি। বন্ধ করবেন?`)) return;

  tabs.splice(idx, 1);
  if (tabs.length === 0) createTab({ title: 'untitled.txt', content: '' });
  else if (activeTabId === id) switchTab(tabs[Math.max(0, idx - 1)].id);
  else renderTabBar();
  saveSession();
}

function closeOtherTabs(keepId) {
  const keep = tabs.find(t => t.id === keepId);
  if (!keep) return;
  const dirtyOthers = tabs.filter(t => t.id !== keepId && t.isDirty);
  if (dirtyOthers.length && !confirm(`${dirtyOthers.length}টি আনসেভড ট্যাব বন্ধ করতে চান?`)) return;
  tabs = [keep];
  switchTab(keep.id);
  saveSession();
}

function duplicateTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const parts = tab.title.split('.');
  const newName = parts.length > 1
    ? `${parts.slice(0, -1).join('.')}_copy.${parts.pop()}`
    : `${tab.title}_copy`;
  createTab({ title: newName, content: tab.doc.getValue(), mode: tab.mode, isDirty: true });
}

function renameTab(id, directName = null) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const newName = directName !== null ? directName : prompt('নতুন ফাইলের নাম দিন:', tab.title);
  if (!newName || !newName.trim() || newName.trim() === tab.title) return;

  tab.title = newName.trim();
  const meta = detectMeta(tab.title);
  tab.mode = meta.mode;
  tab.mimeType = meta.mimeType;
  tab.doc.modeOption = tab.mode;

  if (tab.id === activeTabId) {
    editor.setOption('mode', tab.mode);
    document.getElementById('langSelect').value = tab.mode;
    document.getElementById('md-toolbar').style.display = tab.mode === 'markdown' ? 'flex' : 'none';
    updateRunButtonLabel(tab);
    tools.setPreviewMode('auto');
    if (tools.isPreviewOpen()) tools.renderPreview();
  }
  renderTabBar();
  saveSession();
  if (tab.fileId) drive.renameDriveFile(tab.fileId, tab.title);
}

/* ==================== TAB CONTEXT / MOBILE ACTION MENU ==================== */
function showTabContextMenu(tab, x, y) {
  const menu = document.getElementById('tabContextMenu');
  const items = [
    { label: '✏️ Rename Tab', run: () => renameTab(tab.id) },
    { label: '📑 Duplicate Tab', run: () => duplicateTab(tab.id) },
    { label: '📋 Copy All Content', run: () => { navigator.clipboard?.writeText(tab.doc.getValue()); setStatus(`Copied "${tab.title}" to clipboard ✓`); } },
    { label: '⚖️ Compare with Tab...', run: () => modals.openDiffModal(tab.id) }
  ];

  if (tab.fileId) {
    items.push({ sep: true });
    items.push({ label: '🔄 Reload from Drive', run: () => drive.reloadDriveTab(tab) });
  }

  items.push({ sep: true });
  items.push({ label: '🧹 Close Other Tabs', run: () => closeOtherTabs(tab.id) });
  items.push({ label: '✕ Close Tab', run: () => closeTab(tab.id) });

  menu.innerHTML = '';
  items.forEach(item => {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const row = document.createElement('div');
    row.className = 'context-menu-item';
    row.textContent = item.label;
    row.onclick = () => {
      hideTabContextMenu();
      item.run();
    };
    menu.appendChild(row);
  });

  menu.style.display = 'block';
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(6, left) + 'px';
  menu.style.top = Math.max(6, top) + 'px';
}

function hideTabContextMenu() {
  const menu = document.getElementById('tabContextMenu');
  if (menu) menu.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#tabContextMenu') && !e.target.closest('.tab-menu-btn')) {
    hideTabContextMenu();
  }
});

function renderTabBar() {
  const bar = document.getElementById('tabBar');
  bar.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = () => switchTab(tab.id);
    el.ondblclick = () => renameTab(tab.id);
    el.oncontextmenu = (e) => {
      e.preventDefault();
      showTabContextMenu(tab, e.clientX, e.clientY);
    };

    const badge = tab.fileId
      ? '<span class="tab-dot drive">Drive</span>'
      : tab.fileHandle
        ? '<span class="tab-dot disk">Disk</span>'
        : '<span class="tab-dot">Local</span>';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = `${tab.isDirty ? '*' : ''}${tab.title}`;
    el.appendChild(titleSpan);

    const badgeWrap = document.createElement('span');
    badgeWrap.innerHTML = badge;
    el.appendChild(badgeWrap.firstElementChild);

    // Mobile & desktop quick menu button (⋮)
    const menuBtn = document.createElement('span');
    menuBtn.className = 'tab-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.title = 'Tab actions';
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      showTabContextMenu(tab, r.left, r.bottom + 4);
    };
    el.appendChild(menuBtn);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => closeTab(tab.id, e);
    el.appendChild(closeBtn);
    bar.appendChild(el);
  });

  const add = document.createElement('button');
  add.className = 'tab-add';
  add.textContent = '+';
  add.onclick = () => {
    const name = prompt('ফাইলের নাম (যেমন: page.html, bot.py, style.css, note.md):', 'index.html');
    if (name && name.trim()) createTab({ title: name.trim(), content: '' });
  };
  bar.appendChild(add);
}

function updateStatusBar() {
  const cur = editor.getCursor();
  const txt = editor.getValue();
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  document.getElementById('cursorPos').textContent = `Ln: ${cur.line + 1}, Col: ${cur.ch + 1}`;
  document.getElementById('wordStats').textContent = `Lines: ${editor.lineCount()} | Words: ${words} | Chars: ${txt.length}`;
}

editor.on('cursorActivity', updateStatusBar);

function saveSession() {
  try {
    const data = tabs.map(t => ({
      title: t.title, content: t.doc.getValue(), mode: t.mode,
      mimeType: t.mimeType, fileId: t.fileId, folderId: t.folderId, isDirty: t.isDirty
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: tabs.findIndex(t => t.id === activeTabId), tabs: data }));
  } catch (e) {}
}

/* ==================== FILE SYSTEM ACCESS API & SAVING ==================== */
async function openLocalFile() {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      for (const handle of handles) {
        const file = await handle.getFile();
        const content = await file.text();
        createTab({ title: file.name, content, fileHandle: handle, isDirty: false });
      }
      setStatus(`Opened ${handles.length} local file(s) with direct save ✓`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  document.getElementById('localFileInput').click();
}

async function saveToDiskHandle(tab) {
  try {
    const writable = await tab.fileHandle.createWritable();
    await writable.write(tab.doc.getValue());
    await writable.close();
    tab.isDirty = false;
    renderTabBar();
    saveSession();
    setStatus(`Saved "${tab.title}" directly to disk ✓`);
    return true;
  } catch (err) {
    setStatus('Direct disk save failed — downloading copy...');
    return false;
  }
}

async function saveCurrentTab() {
  const tab = getActiveTab();
  if (!tab) return;

  if (tab.fileId && drive.isDriveConnected()) {
    await drive.saveTabToDrive(tab, false);
  } else if (tab.fileHandle) {
    const ok = await saveToDiskHandle(tab);
    if (!ok) downloadCurrentTab();
  } else if (drive.isDriveConnected()) {
    await drive.saveTabToDrive(tab, false);
  } else {
    downloadCurrentTab();
  }
}

function downloadCurrentTab() {
  const tab = getActiveTab();
  if (!tab) return;
  const blob = new Blob([tab.doc.getValue()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = tab.title;
  a.click();
  tab.isDirty = false;
  renderTabBar();
  setStatus(`Downloaded "${tab.title}"`);
}

/* ==================== DRAG & DROP FILES ==================== */
function setupDragAndDrop() {
  const overlay = document.getElementById('dropOverlay');
  let dragDepth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.remove('show');
  });
  window.addEventListener('drop', async (e) => {
    const items = Array.from(e.dataTransfer?.items || []);
    const files = Array.from(e.dataTransfer?.files || []);
    if (!items.length && !files.length) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('show');

    // Check if an entire folder was dropped
    for (const item of items) {
      if (await explorer.handleDroppedEntry(item)) {
        return;
      }
    }

    files.forEach(f => {
      const r = new FileReader();
      r.onload = (ev) => createTab({ title: f.name, content: ev.target.result, isDirty: false });
      r.readAsText(f);
    });
    setStatus(`Opened ${files.length} dropped file(s) ✓`);
  });
}

/* ==================== MOBILE SWIPE GESTURE ==================== */
function setupMobileSwipe() {
  const ws = document.getElementById('workspace');
  let startX = 0, startY = 0;

  ws.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768 || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  ws.addEventListener('touchend', (e) => {
    if (window.innerWidth > 768 || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 105 && Math.abs(dy) < 42 && !editor.somethingSelected()) {
      if (dx < 0 && !tools.isPreviewOpen()) tools.toggleSplitView(true);
      if (dx > 0 && tools.isPreviewOpen()) tools.toggleSplitView(false);
    }
  }, { passive: true });
}

/* ==================== THEME, FONT & WRAP SETTINGS ==================== */
function applyTheme(theme) {
  settings.theme = theme;
  const isDark = DARK_THEMES.has(theme);
  editor.setOption('theme', theme);
  document.body.classList.toggle('dark-ui', isDark);
  const hljsLink = document.getElementById('hljs-theme');
  if (hljsLink) {
    hljsLink.href = isDark
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
  }
  const themeSel = document.getElementById('themeSelect');
  if (themeSel) themeSel.value = theme;
  persistSettings();
}

function applyFontSize(size) {
  settings.fontSize = Math.max(11, Math.min(28, size));
  document.querySelector('.CodeMirror').style.fontSize = settings.fontSize + 'px';
  editor.refresh();
  persistSettings();
}

function applyWordWrap(wrap) {
  settings.wordWrap = wrap;
  editor.setOption('lineWrapping', wrap);
  const btn = document.getElementById('wrapBtn');
  if (btn) btn.classList.toggle('btn-active', wrap);
  persistSettings();
}

function applyAutoSave(enabled) {
  settings.autoSave = enabled;
  const btn = document.getElementById('autoSaveBtn');
  if (btn) {
    btn.textContent = `Auto: ${enabled ? 'ON' : 'OFF'}`;
    btn.classList.toggle('btn-active', enabled);
  }
  persistSettings();
}

/* ==================== COMMAND PALETTE REGISTRY ==================== */
function getCommands() {
  return [
    { category: 'File', label: 'New Tab', shortcut: '+ New', run: () => window.app.promptNewTab() },
    { category: 'File', label: 'Open Local File (Direct Save)', shortcut: 'Open', run: () => openLocalFile() },
    { category: 'File', label: 'Open Local Folder in Explorer', run: () => explorer.openLocalFolder() },
    { category: 'File', label: 'Toggle Folder Explorer Sidebar', shortcut: 'Ctrl+B', run: () => explorer.toggleSidebar() },
    { category: 'File', label: 'Open All Text Files in Opened Folder', run: () => explorer.openAllInFolder() },
    { category: 'File', label: 'Save Active Tab', shortcut: 'Ctrl+S', run: () => saveCurrentTab() },
    { category: 'File', label: 'Export / Download Active Tab', run: () => downloadCurrentTab() },
    { category: 'File', label: 'Share Snippet via Link', run: () => modals.shareCurrentTab() },
    { category: 'Drive', label: 'Connect / Reconnect Google Drive', run: () => drive.handleAuth() },
    { category: 'Drive', label: 'Open Google Drive Explorer', run: () => drive.openDriveBrowser() },
    { category: 'Drive', label: 'Reload Active Tab from Google Drive', run: () => drive.reloadDriveTab(getActiveTab()) },
    { category: 'Run', label: 'Run Active File (Smart)', shortcut: 'Ctrl+Enter', run: () => tools.runActiveCode() },
    { category: 'Run', label: 'Toggle Live Python / JS Execution', run: () => tools.toggleLiveRun() },
    { category: 'Run', label: 'Run Python (Pyodide)', run: () => tools.runPythonCode() },
    { category: 'Run', label: 'Toggle Integrated Terminal', shortcut: 'Ctrl+`', run: () => terminal.toggleTerminal() },
    { category: 'Run', label: 'Open Python Interactive REPL in Terminal', run: () => { terminal.toggleTerminal(true); terminal.switchMode('python'); } },
    { category: 'Run', label: 'Open JavaScript REPL in Terminal', run: () => { terminal.toggleTerminal(true); terminal.switchMode('javascript'); } },
    { category: 'Run', label: 'Install Python Package (micropip)', run: () => tools.installPyPackage() },
    { category: 'Run', label: 'Run JavaScript Console', run: () => tools.runJavaScriptCode() },
    { category: 'Edit', label: 'Format Code (HTML / CSS / JS / JSON)', shortcut: 'Shift+Alt+F', run: () => tools.formatActiveCode() },
    { category: 'Edit', label: 'Find in Current Tab', shortcut: 'Ctrl+F', run: () => editor.execCommand('find') },
    { category: 'Edit', label: 'Find & Replace in Current Tab', shortcut: 'Ctrl+H', run: () => editor.execCommand('replace') },
    { category: 'Edit', label: 'Find & Replace Across All Tabs', shortcut: 'Ctrl+Shift+F', run: () => modals.openSearchAllModal() },
    { category: 'Edit', label: 'Jump to Line', shortcut: 'Ctrl+G', run: () => editor.execCommand('jumpToLine') },
    { category: 'Edit', label: 'Duplicate Line or Selection', shortcut: 'Ctrl+D', run: () => duplicateLineOrSelection() },
    { category: 'Edit', label: 'Move Line(s) Up', shortcut: 'Alt+↑', run: () => moveLines(-1) },
    { category: 'Edit', label: 'Move Line(s) Down', shortcut: 'Alt+↓', run: () => moveLines(1) },
    { category: 'Edit', label: 'Toggle Bookmark on Current Line', shortcut: 'Ctrl+F2', run: () => toggleBookmark() },
    { category: 'Edit', label: 'Jump to Next Bookmark', shortcut: 'F2', run: () => nextBookmark(1) },
    { category: 'Tools', label: 'Compare Two Tabs (Diff View)', run: () => modals.openDiffModal() },
    { category: 'Tools', label: 'Manage Custom Snippets', run: () => modals.openSnippetsModal() },
    { category: 'Tools', label: 'Export Markdown as Standalone HTML', run: () => tools.exportMarkdownHtml() },
    { category: 'Tools', label: 'Base64 Encode', run: () => tools.runTextTool('b64encode') },
    { category: 'Tools', label: 'Base64 Decode', run: () => tools.runTextTool('b64decode') },
    { category: 'Tools', label: 'Decode JWT Token', run: () => tools.runTextTool('jwtDecode') },
    { category: 'Tools', label: 'Convert JSON → CSV', run: () => tools.runTextTool('jsonToCsv') },
    { category: 'Tools', label: 'Convert CSV → JSON', run: () => tools.runTextTool('csvToJson') },
    { category: 'Tools', label: 'Sort Lines (A-Z)', run: () => tools.runTextTool('sort') },
    { category: 'Tools', label: 'Remove Duplicate Lines', run: () => tools.runTextTool('dedupe') },
    { category: 'Tools', label: 'Remove Empty Lines', run: () => tools.runTextTool('removeEmpty') },
    { category: 'View', label: 'Toggle Split Preview / Output', run: () => tools.toggleSplitView() },
    { category: 'View', label: 'Toggle Word Wrap', run: () => applyWordWrap(!settings.wordWrap) },
    { category: 'View', label: 'Toggle Auto-Save to Drive', run: () => applyAutoSave(!settings.autoSave) },
    { category: 'Theme', label: 'Theme: Light (Eclipse)', run: () => applyTheme('eclipse') },
    { category: 'Theme', label: 'Theme: Classic Light', run: () => applyTheme('default') },
    { category: 'Theme', label: 'Theme: Dracula (Dark)', run: () => applyTheme('dracula') },
    { category: 'Theme', label: 'Theme: Monokai (Dark)', run: () => applyTheme('monokai') },
    { category: 'Theme', label: 'Theme: Material Darker', run: () => applyTheme('material-darker') }
  ];
}

// Initialize Modules
tools.initTools(editor, getActiveTab, () => tabs, setStatus);
modals.initModals({
  editor,
  getTabs: () => tabs,
  getActiveTab,
  switchTab,
  setStatus,
  getCommands,
  openTabAtLine
});
explorer.initExplorer({
  editor,
  getTabs: () => tabs,
  createTab,
  switchTab,
  setStatus,
  promptNewTab: () => window.app.promptNewTab()
});
terminal.initTerminal({
  editor,
  getTabs: () => tabs,
  getActiveTab,
  createTab,
  switchTab,
  closeTab,
  saveCurrentTab,
  renameTabDirect: (id, name) => renameTab(id, name)
});
setupDragAndDrop();
setupMobileSwipe();

// Apply saved settings immediately
applyTheme(settings.theme);
applyFontSize(settings.fontSize);
applyWordWrap(settings.wordWrap);
applyAutoSave(settings.autoSave);

/* ==================== APP STARTUP & PWA REGISTRATION ==================== */
function startApp() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      parsed.tabs.forEach(t => createTab(t));
      if (parsed.active >= 0 && tabs[parsed.active]) switchTab(tabs[parsed.active].id);
    } catch (e) {}
  }

  // Load shared snippet from URL hash if present
  modals.tryLoadSharedSnippet(createTab);

  if (tabs.length === 0) {
    createTab({
      title: 'index.html',
      content: `<!DOCTYPE html>\n<html>\n<head>\n  <title>SB Editor Text — Live Demo</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <h2>SB Editor Text</h2>\n  <p>Edit <code>style.css</code> or press <b>Ctrl+Shift+P</b> for Command Palette!</p>\n</body>\n</html>`
    });
    createTab({
      title: 'style.css',
      content: `body {\n  font-family: system-ui, sans-serif;\n  padding: 20px;\n  color: #1e293b;\n}\nh2 {\n  color: #0078d7;\n}`
    });
    createTab({
      title: 'app.py',
      content: `def greet(name: str):\n    return f"Hello, {name}!"\n\nprint(greet("Siam"))`
    });
    switchTab(tabs[0].id);
  }

  // Mobile defaults to Editor-only view; Desktop opens Split View
  tools.toggleSplitView(window.innerWidth > 768);

  // Parse Google Drive Open / Create URL state
  const params = new URLSearchParams(window.location.search);
  let driveState = null;
  if (params.get('state')) {
    try {
      driveState = JSON.parse(params.get('state'));
    } catch (e) {}
  }

  const initDriveSafely = () => {
    drive.initDrive({
      getTabs: () => tabs,
      getActiveTab,
      createTab,
      switchTab,
      setStatus,
      onTabSaved: () => { renderTabBar(); saveSession(); },
      onOpenDriveFolder: (id, name) => explorer.openDriveFolderInSidebar(id, name)
    }, driveState);
  };

  initDriveSafely();
  window.addEventListener('load', initDriveSafely, { once: true });

  // Register Service Worker for offline PWA support
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}

// Expose clean API to HTML buttons
window.app = {
  editor,
  handleAuth: drive.handleAuth,
  openDriveBrowser: drive.openDriveBrowser,
  closeDriveBrowser: drive.closeDriveBrowser,
  searchDriveFiles: drive.searchDriveFiles,
  createDriveFolder: drive.createDriveFolder,
  openDriveByIdFallback: drive.openDriveByIdFallback,
  saveNewFileToCurrentDriveFolder: drive.saveNewFileToCurrentDriveFolder,
  saveCurrentTab,
  openLocalFile,
  openLocalFolder: explorer.openLocalFolder,
  loadLocalFolderFromInput: explorer.loadLocalFolderFromInput,
  toggleSidebar: explorer.toggleSidebar,
  refreshWorkspaceFolder: explorer.refreshWorkspaceFolder,
  newFileInWorkspace: explorer.newFileInWorkspace,
  openAllInFolder: explorer.openAllInFolder,
  openCurrentDriveFolderInSidebar: () => {
    const folder = drive.getCurrentDriveFolder();
    drive.closeDriveBrowser();
    explorer.openDriveFolderInSidebar(folder.id, folder.name);
  },
  downloadCurrentTab,
  shareCurrentTab: modals.shareCurrentTab,
  duplicateLineOrSelection,
  nextBookmark: () => nextBookmark(1),
  toggleSplitView: tools.toggleSplitView,
  toggleTerminal: terminal.toggleTerminal,
  clearTerminal: terminal.clearTerminal,
  setTerminalMode: terminal.switchMode,
  toggleLiveRun: tools.toggleLiveRun,
  toggleScrollSync: tools.toggleScrollSync,
  exportMarkdownHtml: tools.exportMarkdownHtml,
  runActiveCode: tools.runActiveCode,
  runPythonCode: tools.runPythonCode,
  runJavaScriptCode: tools.runJavaScriptCode,
  installPyPackage: tools.installPyPackage,
  clearPyConsole: tools.clearPyConsole,
  formatActiveCode: tools.formatActiveCode,
  formatJSON: tools.formatJSON,
  runTextTool: tools.runTextTool,
  openCommandPalette: modals.openCommandPalette,
  closeCommandPalette: modals.closeCommandPalette,
  openDiffModal: () => modals.openDiffModal(),
  closeDiffModal: modals.closeDiffModal,
  renderDiff: modals.renderDiff,
  openSearchAllModal: modals.openSearchAllModal,
  closeSearchAllModal: modals.closeSearchAllModal,
  runSearchAll: modals.runSearchAll,
  runReplaceAll: modals.runReplaceAll,
  openSnippetsModal: modals.openSnippetsModal,
  closeSnippetsModal: modals.closeSnippetsModal,
  saveCustomSnippet: modals.saveCustomSnippet,
  promptNewTab: () => {
    const name = prompt('নতুন ফাইলের নাম দিন:', 'untitled.py');
    if (name && name.trim()) createTab({ title: name.trim(), content: '' });
  },
  toggleAutoSave: () => applyAutoSave(!settings.autoSave),
  toggleWordWrap: () => applyWordWrap(!settings.wordWrap),
  loadLocalFiles: (e) => {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = (ev) => createTab({ title: f.name, content: ev.target.result, isDirty: false });
      r.readAsText(f);
    });
    e.target.value = '';
  },
  manualLanguageChange: (mode) => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.mode = mode;
    editor.setOption('mode', mode);
    document.getElementById('md-toolbar').style.display = mode === 'markdown' ? 'flex' : 'none';
    updateRunButtonLabel(tab);
    tools.setPreviewMode('auto');
    if (tools.isPreviewOpen()) tools.renderPreview();
  },
  changeTheme: (theme) => applyTheme(theme),
  changeFontSize: (delta) => applyFontSize(settings.fontSize + delta),
  insertMd: (pre, suf) => {
    editor.replaceSelection(`${pre}${editor.getSelection()}${suf}`);
    editor.focus();
  },
  insertChar: (ch) => {
    editor.replaceSelection(ch);
    editor.focus();
  },
  triggerHint: () => {
    editor.showHint({ hint: CodeMirror.hint.smartHint });
  }
};
