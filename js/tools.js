let editor = null;
let getActiveTab = null;
let setStatus = null;
let isSplitOpen = true;
let previewMode = 'auto';
let pyodideInstance = null;

export function initTools(cmInstance, activeTabGetter, statusSetter) {
  editor = cmInstance;
  getActiveTab = activeTabGetter;
  setStatus = statusSetter;
  setupResizer();
}

export function isPreviewOpen() {
  return isSplitOpen;
}

export function setPreviewMode(mode) {
  previewMode = mode;
}

export function renderPreview() {
  const mdDiv = document.getElementById('md-preview');
  const htmlFrame = document.getElementById('html-preview');
  const pyConsole = document.getElementById('py-console');
  const clearBtn = document.getElementById('clearConsoleBtn');
  const badge = document.getElementById('previewTypeBadge');

  if (previewMode === 'python') {
    mdDiv.style.display = 'none';
    htmlFrame.style.display = 'none';
    pyConsole.style.display = 'block';
    clearBtn.style.display = 'inline-block';
    badge.textContent = 'Python Console';
    return;
  }

  pyConsole.style.display = 'none';
  clearBtn.style.display = 'none';
  const mode = editor.getOption('mode');
  const content = editor.getValue();

  if (mode === 'htmlmixed') {
    mdDiv.style.display = 'none';
    htmlFrame.style.display = 'block';
    badge.textContent = 'HTML Output';
    htmlFrame.srcdoc = content;
  } else if (mode === 'markdown') {
    htmlFrame.style.display = 'none';
    mdDiv.style.display = 'block';
    badge.textContent = 'Markdown';
    mdDiv.innerHTML = marked.parse(content);
  } else {
    htmlFrame.style.display = 'none';
    mdDiv.style.display = 'block';
    badge.textContent = 'Code View';
    const esc = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    mdDiv.innerHTML = `<pre><code>${esc}</code></pre>`;
  }
}

export function toggleSplitView(forceState = null) {
  isSplitOpen = forceState !== null ? forceState : !isSplitOpen;
  const isMobile = window.innerWidth <= 768;
  const workspace = document.getElementById('workspace');

  if (isMobile) {
    workspace.classList.toggle('mobile-show-preview', isSplitOpen);
  } else {
    document.getElementById('preview-pane').style.display = isSplitOpen ? 'flex' : 'none';
    document.getElementById('resizer').style.display = isSplitOpen ? 'block' : 'none';
  }

  document.getElementById('splitBtn').classList.toggle('btn-active', isSplitOpen);
  if (isSplitOpen) renderPreview();
  editor.refresh();
}

function setupResizer() {
  const resizer = document.getElementById('resizer');
  const editorPane = document.getElementById('editor-pane');
  const workspace = document.getElementById('workspace');
  let dragging = false;

  resizer.addEventListener('mousedown', () => {
    dragging = true;
    document.getElementById('html-preview').style.pointerEvents = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const pct = Math.max(15, Math.min(85, ((e.clientX - rect.left) / rect.width) * 100));
    editorPane.style.flex = `0 0 ${pct}%`;
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.getElementById('html-preview').style.pointerEvents = 'auto';
      editor.refresh();
    }
  });
}

export async function runPythonCode() {
  previewMode = 'python';
  toggleSplitView(true);
  const pyConsole = document.getElementById('py-console');

  if (!pyodideInstance) {
    pyConsole.innerHTML = '<span class="py-info">Loading Python runtime...</span>\n';
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    pyodideInstance = await loadPyodide();
  }

  const code = editor.getValue();
  pyConsole.innerHTML += `<span class="py-info">>>> Running ${getActiveTab()?.title || 'script.py'}...</span>\n`;
  try {
    pyodideInstance.runPython(`import sys, io\nsys.stdout = io.StringIO()\nsys.stderr = io.StringIO()`);
    await pyodideInstance.runPythonAsync(code);
    const out = pyodideInstance.runPython("sys.stdout.getvalue()");
    const err = pyodideInstance.runPython("sys.stderr.getvalue()");
    if (out) pyConsole.innerHTML += out;
    if (err) pyConsole.innerHTML += `<span class="py-err">${err}</span>`;
    pyConsole.innerHTML += `\n`;
  } catch (err) {
    pyConsole.innerHTML += `<span class="py-err">${err.message}</span>\n\n`;
  }
  pyConsole.scrollTop = pyConsole.scrollHeight;
}

export function clearPyConsole() {
  document.getElementById('py-console').innerHTML = '';
}

export function formatJSON() {
  try {
    const parsed = JSON.parse(editor.getValue());
    editor.setValue(JSON.stringify(parsed, null, 2));
    setStatus('JSON formatted ✓');
  } catch (e) {
    alert('JSON Syntax Error: ' + e.message);
  }
}

export function runTextTool(action) {
  if (!action) return;
  const hasSel = editor.somethingSelected();
  const text = hasSel ? editor.getSelection() : editor.getValue();
  let result = text;

  if (action === 'upper') result = text.toUpperCase();
  if (action === 'lower') result = text.toLowerCase();
  if (action === 'sort') result = text.split('\n').sort().join('\n');
  if (action === 'dedupe') result = [...new Set(text.split('\n'))].join('\n');
  if (action === 'trim') result = text.split('\n').map(l => l.trim()).join('\n');

  if (hasSel) editor.replaceSelection(result);
  else editor.setValue(result);
  setStatus(`Applied text tool: ${action}`);
}
