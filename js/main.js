import { registerCustomHints, setupAutoComplete } from './suggestions.js';
import * as drive from './drive.js';
import * as tools from './tools.js';

const STORAGE_KEY = 'npp_modular_tabs_v1';
let tabs = [];
let activeTabId = null;
let currentFontSize = 15;
let autoSaveEnabled = false;
let autoSaveTimer = null;
let previewTimer = null;

// Register smart autocomplete
registerCustomHints(CodeMirror);

// Initialize CodeMirror with Auto-Close Tags & Ctrl+D Duplicate
const editor = CodeMirror(document.getElementById('editor-pane'), {
  theme: 'eclipse',
  lineNumbers: true,
  lineWrapping: true,
  styleActiveLine: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  autoCloseTags: true, // <html> লিখলেই </html> অটোমেটিক বসে যাবে
  foldGutter: true,
  gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
  indentUnit: 4,
  tabSize: 4,
  extraKeys: {
    "Ctrl-S": () => saveCurrentTab(),
    "Cmd-S": () => saveCurrentTab(),
    "Ctrl-D": () => duplicateLineOrSelection(),
    "Cmd-D": () => duplicateLineOrSelection(),
    "Ctrl-Space": (cm) => cm.showHint({ hint: CodeMirror.hint.smartHint }),
    "Ctrl-/": (cm) => cm.toggleComment(),
    "Ctrl-G": (cm) => cm.execCommand("jumpToLine"),
    "Tab": (cm) => {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.replaceSelection("    ", "end");
    }
  }
});

setupAutoComplete(editor);

// Notepad++ Style Ctrl+D (Duplicate Selection or Current Line)
function duplicateLineOrSelection() {
  if (editor.somethingSelected()) {
    const sel = editor.getSelection();
    editor.replaceSelection(sel + sel, "around");
  } else {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    editor.replaceRange("\n" + lineText, { line: cursor.line, ch: lineText.length });
    editor.setCursor({ line: cursor.line + 1, ch: cursor.ch });
  }
}

function detectMeta(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const modes = {
    html: 'htmlmixed', htm: 'htmlmixed', py: 'python',
    md: 'markdown', js: 'javascript', json: 'javascript',
    css: 'css', sql: 'sql', sh: 'shell', txt: 'text/plain'
  };
  const mimes = {
    html: 'text/html', py: 'text/x-python', md: 'text/markdown',
    js: 'application/javascript', json: 'application/json',
    css: 'text/css', sql: 'application/sql', txt: 'text/plain'
  };
  return { mode: modes[ext] || 'text/plain', mimeType: mimes[ext] || 'text/plain' };
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function setStatus(msg) {
  document.getElementById('statusMsg').textContent = msg;
}

function createTab({ title = 'index.html', content = '', fileId = null, folderId = null, isDirty = false, mode = null, mimeType = null } = {}) {
  const meta = detectMeta(title);
  const finalMode = mode || meta.mode;
  const id = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const doc = CodeMirror.Doc(content, finalMode);

  const tab = { id, title, doc, mode: finalMode, mimeType: mimeType || meta.mimeType, fileId, folderId, isDirty };

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
      if (autoSaveEnabled && tab.fileId && drive.isDriveConnected()) {
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
  document.getElementById('langSelect').value = tab.mode;
  document.getElementById('md-toolbar').style.display = tab.mode === 'markdown' ? 'flex' : 'none';
  tools.setPreviewMode('auto');
  renderTabBar();
  updateStatusBar();
  if (tools.isPreviewOpen()) tools.renderPreview();
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

function renameTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const newName = prompt('নতুন ফাইলের নাম দিন:', tab.title);
  if (!newName || !newName.trim() || newName.trim() === tab.title) return;

  tab.title = newName.trim();
  const meta = detectMeta(tab.title);
  tab.mode = meta.mode;
  tab.mimeType = meta.mimeType;
  tab.doc.setOption('mode', tab.mode);

  if (tab.id === activeTabId) {
    document.getElementById('langSelect').value = tab.mode;
    document.getElementById('md-toolbar').style.display = tab.mode === 'markdown' ? 'flex' : 'none';
    if (tools.isPreviewOpen()) tools.renderPreview();
  }
  renderTabBar();
  saveSession();
  if (tab.fileId) drive.renameDriveFile(tab.fileId, tab.title);
}

function renderTabBar() {
  const bar = document.getElementById('tabBar');
  bar.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = () => switchTab(tab.id);
    el.ondblclick = () => renameTab(tab.id);

    const badge = tab.fileId ? '<span class="tab-dot drive">Drive</span>' : '<span class="tab-dot">Local</span>';
    el.innerHTML = `<span class="tab-title">${tab.isDirty ? '*' : ''}${tab.title}</span>${badge}`;

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
    const name = prompt('ফাইলের নাম (যেমন: page.html, bot.py, note.md):', 'index.html');
    if (name && name.trim()) createTab({ title: name.trim(), content: '' });
  };
  bar.appendChild(add);
}

function updateStatusBar() {
  const cur = editor.getCursor();
  const txt = editor.getValue();
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  document.getElementById('cursorPos').textContent = `Ln: ${cur.line + 1}, Col: ${cur.ch + 1}`;
  document.getElementById('wordStats').textContent = `Lines: ${editor.lineCount()} | Words: ${words}`;
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

async function saveCurrentTab() {
  const tab = getActiveTab();
  if (!tab) return;
  if (drive.isDriveConnected()) {
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

// Initialize Modules
tools.initTools(editor, getActiveTab, setStatus);

window.onload = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      parsed.tabs.forEach(t => createTab(t));
      if (parsed.active >= 0 && tabs[parsed.active]) switchTab(tabs[parsed.active].id);
    } catch (e) {}
  }

  if (tabs.length === 0) {
    createTab({
      title: 'index.html',
      content: `<!DOCTYPE html>\n<html>\n<head>\n  <title>Auto-Close Tag Demo</title>\n</head>\n<body>\n  <h2>যেকোনো ট্যাগ লিখলেই অটো ক্লোজ হবে!</h2>\n  <p>Ctrl+D চাপলে লাইন ডুপ্লিকেট হবে।</p>\n</body>\n</html>`
    });
    createTab({
      title: 'app.py',
      content: `def greet(name: str):\n    return f"Hello, {name}!"\n\nprint(greet("Siam"))`
    });
    switchTab(tabs[0].id);
  }

  // Mobile defaults to Editor-only view; Desktop opens Split View
  tools.toggleSplitView(window.innerWidth > 768);

  const params = new URLSearchParams(window.location.search);
  let openId = null;
  if (params.get('state')) {
    try {
      const st = JSON.parse(params.get('state'));
      if (st.ids?.length) openId = st.ids[0];
    } catch (e) {}
  }

  drive.initDrive({
    getTabs: () => tabs,
    getActiveTab,
    createTab,
    switchTab,
    setStatus,
    onTabSaved: () => { renderTabBar(); saveSession(); }
  }, openId);
};

// Expose clean API to HTML buttons
window.app = {
  editor,
  handleAuth: drive.handleAuth,
  openDriveBrowser: drive.openDriveBrowser,
  closeDriveBrowser: drive.closeDriveBrowser,
  searchDriveFiles: drive.searchDriveFiles,
  openDriveByIdFallback: drive.openDriveByIdFallback,
  saveNewFileToCurrentDriveFolder: drive.saveNewFileToCurrentDriveFolder,
  saveCurrentTab,
  downloadCurrentTab,
  duplicateLineOrSelection,
  toggleSplitView: tools.toggleSplitView,
  runPythonCode: tools.runPythonCode,
  clearPyConsole: tools.clearPyConsole,
  formatJSON: tools.formatJSON,
  runTextTool: tools.runTextTool,
  promptNewTab: () => {
    const name = prompt('নতুন ফাইলের নাম দিন:', 'untitled.py');
    if (name && name.trim()) createTab({ title: name.trim(), content: '' });
  },
  toggleAutoSave: () => {
    autoSaveEnabled = !autoSaveEnabled;
    const btn = document.getElementById('autoSaveBtn');
    btn.textContent = `Auto: ${autoSaveEnabled ? 'ON' : 'OFF'}`;
    btn.classList.toggle('btn-active', autoSaveEnabled);
  },
  loadLocalFiles: (e) => {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = (ev) => createTab({ title: f.name, content: ev.target.result });
      r.readAsText(f);
    });
  },
  manualLanguageChange: (mode) => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.mode = mode;
    editor.setOption('mode', mode);
    document.getElementById('md-toolbar').style.display = mode === 'markdown' ? 'flex' : 'none';
    tools.setPreviewMode('auto');
    if (tools.isPreviewOpen()) tools.renderPreview();
  },
  changeTheme: (theme) => {
    editor.setOption('theme', theme);
    document.getElementById('preview-pane').classList.toggle('dark-preview', theme === 'dracula');
  },
  changeFontSize: (delta) => {
    currentFontSize = Math.max(11, Math.min(28, currentFontSize + delta));
    document.querySelector('.CodeMirror').style.fontSize = currentFontSize + 'px';
    editor.refresh();
  },
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
