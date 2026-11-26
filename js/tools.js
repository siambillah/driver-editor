let editor = null;
let getActiveTab = null;
let getAllTabs = null;
let setStatus = null;
let isSplitOpen = true;
let previewMode = 'auto';
let scrollSyncEnabled = true;
let liveRunEnabled = true;
let liveRunTimer = null;
let pyodideInstance = null;
let pyodideLoadingPromise = null;
let isPyRunning = false;
let pendingLivePy = false;
let mermaidLoaded = false;
let katexLoaded = false;
let jsRunnerFrame = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCssOnce(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

export function initTools(cmInstance, activeTabGetter, allTabsGetter, statusSetter) {
  editor = cmInstance;
  getActiveTab = activeTabGetter;
  getAllTabs = allTabsGetter;
  setStatus = statusSetter;
  setupResizer();
  setupScrollSync();
  setupJsMessageListener();
}

export function isPreviewOpen() {
  return isSplitOpen;
}

export function setPreviewMode(mode) {
  previewMode = mode;
}

export function toggleScrollSync() {
  scrollSyncEnabled = !scrollSyncEnabled;
  const btn = document.getElementById('scrollSyncBtn');
  if (btn) {
    btn.textContent = `Sync: ${scrollSyncEnabled ? 'ON' : 'OFF'}`;
    btn.classList.toggle('btn-active', scrollSyncEnabled);
  }
  setStatus(`Preview scroll sync ${scrollSyncEnabled ? 'enabled' : 'disabled'}`);
}

function getCurrentMode() {
  return getActiveTab?.()?.mode || editor?.getDoc?.()?.modeOption || editor?.getOption('mode') || 'text/plain';
}

function setupScrollSync() {
  editor.on('scroll', () => {
    if (!scrollSyncEnabled || !isSplitOpen || previewMode !== 'auto') return;
    if (getCurrentMode() !== 'markdown') return;
    const info = editor.getScrollInfo();
    const maxEditorScroll = info.height - info.clientHeight;
    if (maxEditorScroll <= 0) return;
    const ratio = info.top / maxEditorScroll;
    const mdDiv = document.getElementById('md-preview');
    const maxPreviewScroll = mdDiv.scrollHeight - mdDiv.clientHeight;
    if (maxPreviewScroll > 0) {
      mdDiv.scrollTop = ratio * maxPreviewScroll;
    }
  });
}

// Multi-file HTML bundling: injects open CSS/JS tabs referenced via <link> or <script>
function bundleHtmlWithOpenTabs(html) {
  const tabs = getAllTabs ? getAllTabs() : [];
  if (tabs.length <= 1) return html;

  const byName = new Map();
  tabs.forEach(t => {
    const clean = t.title.toLowerCase();
    byName.set(clean, t);
    const base = clean.split('/').pop();
    if (!byName.has(base)) byName.set(base, t);
  });

  // Inline matching local CSS tabs (supports both rel-before-href and href-before-rel)
  let bundled = html.replace(
    /<link\b[^>]*>/gi,
    (tag) => {
      if (!/rel=["']stylesheet["']/i.test(tag)) return tag;
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) return tag;
      const key = hrefMatch[1].replace(/^\.\//, '').toLowerCase();
      const target = byName.get(key) || byName.get(key.split('/').pop());
      if (target) {
        return `<style data-bundled="${target.title}">\n${target.doc.getValue()}\n</style>`;
      }
      return tag;
    }
  );

  // Inline matching local JS tabs
  bundled = bundled.replace(
    /<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
    (match, src) => {
      const key = src.replace(/^\.\//, '').toLowerCase();
      const target = byName.get(key) || byName.get(key.split('/').pop());
      if (target) {
        return `<script data-bundled="${target.title}">\n${target.doc.getValue()}\n<\/script>`;
      }
      return match;
    }
  );

  return bundled;
}

async function enhanceMarkdownPreview(mdDiv) {
  // 1. Highlight code blocks & add Copy buttons
  mdDiv.querySelectorAll('pre code').forEach(block => {
    if (block.classList.contains('language-mermaid')) {
      const container = document.createElement('div');
      container.className = 'mermaid';
      container.textContent = block.textContent;
      block.parentElement.replaceWith(container);
      return;
    }
    if (typeof hljs !== 'undefined') {
      hljs.highlightElement(block);
    }
    const pre = block.parentElement;
    if (pre && !pre.querySelector('.copy-code-btn')) {
      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.textContent = 'Copy';
      btn.onclick = () => {
        navigator.clipboard?.writeText(block.textContent);
        btn.textContent = 'Copied ✓';
        setTimeout(() => (btn.textContent = 'Copy'), 1200);
      };
      pre.appendChild(btn);
    }
  });

  // 2. Render Mermaid diagrams on demand
  const mermaidBlocks = mdDiv.querySelectorAll('.mermaid');
  if (mermaidBlocks.length > 0) {
    try {
      if (!mermaidLoaded) {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js');
        if (typeof mermaid !== 'undefined') {
          mermaid.initialize({ startOnLoad: false, theme: 'default' });
          mermaidLoaded = true;
        }
      }
      if (typeof mermaid !== 'undefined') {
        await mermaid.run({ nodes: mermaidBlocks });
      }
    } catch {
      // ignore invalid mermaid syntax while typing
    }
  }

  // 3. Render KaTeX math on demand
  if (/\$[^$\n]+\$|\$\$[\s\S]+?\$\$/.test(mdDiv.textContent || '')) {
    try {
      if (!katexLoaded) {
        loadCssOnce('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css');
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js');
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js');
        katexLoaded = true;
      }
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(mdDiv, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      }
    } catch {
      // ignore math parse issues while typing
    }
  }
}

export function toggleLiveRun() {
  liveRunEnabled = !liveRunEnabled;
  const btn = document.getElementById('liveRunBtn');
  if (btn) {
    btn.textContent = `Live: ${liveRunEnabled ? 'ON' : 'OFF'}`;
    btn.classList.toggle('btn-active', liveRunEnabled);
  }
  setStatus(`Live code execution ${liveRunEnabled ? 'enabled' : 'disabled'}`);
  if (liveRunEnabled && isSplitOpen) renderPreview();
}

function scheduleLiveRun(kind) {
  clearTimeout(liveRunTimer);
  const delay = kind === 'python' ? 600 : 450;
  liveRunTimer = setTimeout(() => {
    if (!isSplitOpen || !liveRunEnabled) return;
    const mode = getCurrentMode();
    const tab = getActiveTab();
    const isJson = tab?.title?.toLowerCase().endsWith('.json');
    if (kind === 'python' && mode === 'python') {
      runPythonCode({ isLive: true });
    } else if (kind === 'javascript' && mode === 'javascript' && !isJson) {
      runJavaScriptCode({ isLive: true });
    }
  }, delay);
}

function showConsolePane(kind) {
  const mdDiv = document.getElementById('md-preview');
  const htmlFrame = document.getElementById('html-preview');
  const pyConsole = document.getElementById('py-console');
  const clearBtn = document.getElementById('clearConsoleBtn');
  const pkgBtn = document.getElementById('installPyPkgBtn');
  const liveBtn = document.getElementById('liveRunBtn');
  const badge = document.getElementById('previewTypeBadge');

  const isPy = kind === 'python';
  mdDiv.style.display = 'none';
  htmlFrame.style.display = 'none';
  pyConsole.style.display = 'block';
  clearBtn.style.display = 'inline-block';
  pkgBtn.style.display = isPy ? 'inline-block' : 'none';
  if (liveBtn) {
    liveBtn.style.display = 'inline-block';
    liveBtn.textContent = `Live: ${liveRunEnabled ? 'ON' : 'OFF'}`;
    liveBtn.classList.toggle('btn-active', liveRunEnabled);
  }
  badge.textContent = isPy
    ? (liveRunEnabled ? 'Python Live' : 'Python Console')
    : (liveRunEnabled ? 'JS Live' : 'JS Console');
}

export function renderPreview() {
  const mdDiv = document.getElementById('md-preview');
  const htmlFrame = document.getElementById('html-preview');
  const pyConsole = document.getElementById('py-console');
  const clearBtn = document.getElementById('clearConsoleBtn');
  const pkgBtn = document.getElementById('installPyPkgBtn');
  const liveBtn = document.getElementById('liveRunBtn');
  const badge = document.getElementById('previewTypeBadge');

  const mode = getCurrentMode();
  const tab = getActiveTab();
  const isJson = tab?.title?.toLowerCase().endsWith('.json');
  const content = editor.getValue();

  const showPythonConsole = previewMode === 'python' || (previewMode === 'auto' && mode === 'python');
  const showJsConsole = previewMode === 'javascript' || (previewMode === 'auto' && mode === 'javascript' && !isJson);

  if (showPythonConsole || showJsConsole) {
    showConsolePane(showPythonConsole ? 'python' : 'javascript');

    if (!content.trim()) {
      pyConsole.innerHTML = `<span class="py-info">Write ${showPythonConsole ? 'Python' : 'JavaScript'} code on the left to see live output...</span>\n`;
    } else if (!liveRunEnabled) {
      if (!pyConsole.innerHTML.trim()) {
        pyConsole.innerHTML = `<span class="py-info">Live run is OFF. Click ▶ Run (or press Ctrl+Enter) to execute.</span>\n`;
      }
    } else if (showPythonConsole && /\binput\s*\(/.test(content)) {
      clearTimeout(liveRunTimer);
      pyConsole.innerHTML = `<span class="py-info">This script uses input() — click ▶ Run Py (or Ctrl+Enter) to run interactively.</span>\n`;
    } else if (showJsConsole && /\b(alert|prompt|confirm)\s*\(/.test(content)) {
      clearTimeout(liveRunTimer);
      pyConsole.innerHTML = `<span class="py-info">This script uses browser dialog calls — click ▶ Run JS (or Ctrl+Enter) to run.</span>\n`;
    } else {
      scheduleLiveRun(showPythonConsole ? 'python' : 'javascript');
    }
    return;
  }

  clearTimeout(liveRunTimer);
  pyConsole.style.display = 'none';
  clearBtn.style.display = 'none';
  pkgBtn.style.display = 'none';
  if (liveBtn) liveBtn.style.display = 'none';

  if (mode === 'htmlmixed') {
    mdDiv.style.display = 'none';
    htmlFrame.style.display = 'block';
    badge.textContent = 'HTML Output';
    htmlFrame.srcdoc = bundleHtmlWithOpenTabs(content);
  } else if (mode === 'markdown') {
    htmlFrame.style.display = 'none';
    mdDiv.style.display = 'block';
    badge.textContent = 'Markdown';
    mdDiv.innerHTML = marked.parse(content);
    enhanceMarkdownPreview(mdDiv);
  } else {
    htmlFrame.style.display = 'none';
    mdDiv.style.display = 'block';
    badge.textContent = 'Code View';
    mdDiv.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
    if (typeof hljs !== 'undefined') {
      const codeEl = mdDiv.querySelector('code');
      if (codeEl) hljs.highlightElement(codeEl);
    }
  }
}

export function exportMarkdownHtml() {
  const tab = getActiveTab();
  const title = tab ? tab.title.replace(/\.md$/i, '') : 'document';
  const rendered = marked.parse(editor.getValue());
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { max-width: 820px; margin: 32px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; color: #24292f; }
    pre { background: #f6f8fa; padding: 14px; border-radius: 6px; overflow-x: auto; }
    code { font-family: Consolas, monospace; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
  </style>
</head>
<body>
${rendered}
</body>
</html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title}.html`;
  a.click();
  setStatus(`Exported "${title}.html" ✓`);
}

export function toggleSplitView(forceState = null, { skipRender = false } = {}) {
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
  if (isSplitOpen && !skipRender) renderPreview();
  editor.refresh();
}

function setupResizer() {
  const resizer = document.getElementById('resizer');
  const editorPane = document.getElementById('editor-pane');
  const workspace = document.getElementById('workspace');
  let dragging = false;

  resizer.addEventListener('mousedown', () => {
    dragging = true;
    resizer.classList.add('dragging');
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
      resizer.classList.remove('dragging');
      document.getElementById('html-preview').style.pointerEvents = 'auto';
      editor.refresh();
    }
  });
}

// Smart Run dispatcher based on active file/mode
export function runActiveCode() {
  const tab = getActiveTab();
  const mode = getCurrentMode();
  const isJson = tab?.title?.toLowerCase().endsWith('.json');

  if (mode === 'python') {
    runPythonCode();
  } else if (mode === 'javascript' && !isJson) {
    runJavaScriptCode();
  } else if (mode === 'htmlmixed' || mode === 'markdown') {
    previewMode = 'auto';
    toggleSplitView(true);
    renderPreview();
    setStatus(`Rendered live ${mode === 'htmlmixed' ? 'HTML' : 'Markdown'} preview`);
  } else {
    runPythonCode();
  }
}

async function ensurePyodide(pyConsole) {
  if (pyodideInstance) return pyodideInstance;
  if (!pyodideLoadingPromise) {
    pyConsole.innerHTML = '<span class="py-info">Loading Pyodide Python runtime (first time only)...</span>\n';
    pyodideLoadingPromise = (async () => {
      await loadScriptOnce('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
      const inst = await loadPyodide();
      inst.globals.set('_browser_input', (msg = '') => {
        const val = window.prompt(msg || 'Python input():');
        return val === null ? '' : val;
      });
      inst.runPython(`import builtins\nbuiltins.input = _browser_input`);
      pyodideInstance = inst;
      return inst;
    })().catch((err) => {
      pyodideLoadingPromise = null;
      throw err;
    });
  }
  return pyodideLoadingPromise;
}

export async function runPythonCode({ isLive = false } = {}) {
  clearTimeout(liveRunTimer);
  if (!isLive) {
    if (getCurrentMode() !== 'python') previewMode = 'python';
    toggleSplitView(true, { skipRender: true });
    showConsolePane('python');
  }
  const pyConsole = document.getElementById('py-console');

  if (isPyRunning) {
    if (isLive) pendingLivePy = true;
    return;
  }

  isPyRunning = true;
  try {
    try {
      await ensurePyodide(pyConsole);
    } catch (e) {
      pyConsole.innerHTML = `<span class="py-err">Failed to load Pyodide: ${escapeHtml(e.message)}</span>\n`;
      return;
    }

    const code = editor.getValue();
    const title = getActiveTab()?.title || 'script.py';
    const t0 = performance.now();

    if (isLive) {
      pyConsole.innerHTML = `<span class="py-info">&gt;&gt;&gt; Live Output (${escapeHtml(title)})</span>\n`;
    } else {
      pyConsole.innerHTML += `<span class="py-info">&gt;&gt;&gt; Running ${escapeHtml(title)}...</span>\n`;
    }

    let ns = null;
    try {
      await pyodideInstance.loadPackagesFromImports(code);
      pyodideInstance.runPython(`import sys, io\nsys.stdout = io.StringIO()\nsys.stderr = io.StringIO()`);
      ns = pyodideInstance.toPy({ __name__: '__main__' });
      await pyodideInstance.runPythonAsync(code, { globals: ns });
      const out = pyodideInstance.runPython('sys.stdout.getvalue()');
      const err = pyodideInstance.runPython('sys.stderr.getvalue()');
      if (out) pyConsole.innerHTML += escapeHtml(out);
      if (err) pyConsole.innerHTML += `<span class="py-err">${escapeHtml(err)}</span>`;
      if (!out && !err) pyConsole.innerHTML += `<span class="py-info">(No output)</span>\n`;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      pyConsole.innerHTML += `<span class="py-ok">[Finished in ${elapsed}s]</span>\n${isLive ? '' : '\n'}`;
    } catch (err) {
      pyConsole.innerHTML += `<span class="py-err">${escapeHtml(err.message)}</span>\n${isLive ? '' : '\n'}`;
    } finally {
      if (ns) ns.destroy();
    }
    pyConsole.scrollTop = pyConsole.scrollHeight;
  } finally {
    isPyRunning = false;
    if (pendingLivePy) {
      pendingLivePy = false;
      if (isSplitOpen && liveRunEnabled && getCurrentMode() === 'python') {
        runPythonCode({ isLive: true });
      }
    }
  }
}

export async function installPyPackage() {
  const pkg = prompt('Pyodide (micropip) দিয়ে যে Python প্যাকেজ ইন্সটল করতে চান তার নাম দিন (যেমন: numpy, sympy, requests):');
  if (!pkg || !pkg.trim()) return;
  previewMode = 'python';
  toggleSplitView(true);
  const pyConsole = document.getElementById('py-console');
  try {
    await ensurePyodide(pyConsole);
    pyConsole.innerHTML += `<span class="py-info">Installing "${escapeHtml(pkg.trim())}" via micropip...</span>\n`;
    await pyodideInstance.loadPackage('micropip');
    const micropip = pyodideInstance.pyimport('micropip');
    await micropip.install(pkg.trim());
    pyConsole.innerHTML += `<span class="py-ok">Installed "${escapeHtml(pkg.trim())}" ✓</span>\n\n`;
  } catch (err) {
    pyConsole.innerHTML += `<span class="py-err">Install failed: ${escapeHtml(err.message)}</span>\n\n`;
  }
  pyConsole.scrollTop = pyConsole.scrollHeight;
}

function setupJsMessageListener() {
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.__driverEditorJs !== true) return;
    const pyConsole = document.getElementById('py-console');
    if (!pyConsole) return;
    const { level, text } = e.data;
    const cls = level === 'error' ? 'py-err' : level === 'warn' ? 'py-warn' : level === 'ok' ? 'py-ok' : '';
    pyConsole.innerHTML += cls
      ? `<span class="${cls}">${escapeHtml(text)}</span>\n`
      : `${escapeHtml(text)}\n`;
    pyConsole.scrollTop = pyConsole.scrollHeight;
  });
}

export function runJavaScriptCode({ isLive = false } = {}) {
  clearTimeout(liveRunTimer);
  if (!isLive) {
    if (getCurrentMode() !== 'javascript') previewMode = 'javascript';
    toggleSplitView(true, { skipRender: true });
    showConsolePane('javascript');
  }
  const pyConsole = document.getElementById('py-console');
  const title = getActiveTab()?.title || 'script.js';
  if (isLive) {
    pyConsole.innerHTML = `<span class="py-info">&gt;&gt;&gt; Live Output (${escapeHtml(title)})</span>\n`;
  } else {
    pyConsole.innerHTML += `<span class="py-info">&gt;&gt;&gt; Running ${escapeHtml(title)}...</span>\n`;
  }

  if (jsRunnerFrame) jsRunnerFrame.remove();
  jsRunnerFrame = document.createElement('iframe');
  jsRunnerFrame.setAttribute('sandbox', 'allow-scripts allow-modals');
  jsRunnerFrame.style.display = 'none';

  const userCode = editor.getValue().replace(/<\/script>/gi, '<\\/script>');
  jsRunnerFrame.srcdoc = `<!DOCTYPE html><html><body><script>
    const send = (level, args) => {
      const text = args.map(a => {
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a, null, 2); } catch { return String(a); }
        }
        return String(a);
      }).join(' ');
      parent.postMessage({ __driverEditorJs: true, level, text }, '*');
    };
    console.log = (...a) => send('log', a);
    console.info = (...a) => send('log', a);
    console.warn = (...a) => send('warn', a);
    console.error = (...a) => send('error', a);
    window.onerror = (msg, _s, line) => send('error', [msg + ' (line ' + line + ')']);
    window.addEventListener('unhandledrejection', e => send('error', ['Unhandled Promise Rejection: ' + e.reason]));
    (async () => {
      const t0 = performance.now();
      try {
        ${userCode}
        send('ok', ['[Finished in ' + ((performance.now() - t0) / 1000).toFixed(2) + 's]']);
      } catch (err) {
        send('error', [err.stack || err.message || String(err)]);
      }
    })();
  <\/script></body></html>`;
  document.body.appendChild(jsRunnerFrame);
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

export function formatActiveCode() {
  const tab = getActiveTab();
  const mode = getCurrentMode();
  const title = (tab?.title || '').toLowerCase();
  const content = editor.getValue();

  if (title.endsWith('.json')) {
    formatJSON();
    return;
  }

  // Try JSON parse if it looks like JSON in JS/plain mode
  if (/^\s*[\[{]/.test(content) && mode !== 'htmlmixed' && mode !== 'css') {
    try {
      const parsed = JSON.parse(content);
      editor.setValue(JSON.stringify(parsed, null, 2));
      setStatus('JSON formatted ✓');
      return;
    } catch {
      // fall through to JS beautifier
    }
  }

  try {
    if (mode === 'htmlmixed' || mode === 'application/xml') {
      if (typeof html_beautify === 'function') {
        editor.setValue(html_beautify(content, { indent_size: 2, wrap_line_length: 120 }));
        setStatus('HTML formatted ✓');
        return;
      }
    } else if (mode === 'css') {
      if (typeof css_beautify === 'function') {
        editor.setValue(css_beautify(content, { indent_size: 2 }));
        setStatus('CSS formatted ✓');
        return;
      }
    } else if (mode === 'javascript') {
      if (typeof js_beautify === 'function') {
        editor.setValue(js_beautify(content, { indent_size: 2, space_in_empty_paren: false }));
        setStatus('JavaScript formatted ✓');
        return;
      }
    }
    setStatus('Auto-format is available for HTML, CSS, JS, and JSON files.');
  } catch (err) {
    alert('Format error: ' + err.message);
  }
}

function jsonToCsv(jsonStr) {
  const arr = JSON.parse(jsonStr);
  if (!Array.isArray(arr) || !arr.length) throw new Error('JSON must be a non-empty array of objects');
  const headers = [...new Set(arr.flatMap(obj => Object.keys(obj || {})))];
  const esc = v => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [headers.map(esc).join(',')];
  arr.forEach(obj => rows.push(headers.map(h => esc(obj?.[h])).join(',')));
  return rows.join('\n');
}

function csvToJson(csvStr) {
  const lines = csvStr.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');
  const splitRow = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = splitRow(lines[0]).map(h => h.trim());
  const data = lines.slice(1).map(l => {
    const cols = splitRow(l);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i] ?? ''));
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

function decodeJwt(token) {
  const parts = token.trim().split('.');
  if (parts.length < 2) throw new Error('Invalid JWT format (expected header.payload.signature)');
  const b64Decode = (str) => {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  };
  const decoded = {
    header: b64Decode(parts[0]),
    payload: b64Decode(parts[1])
  };
  if (decoded.payload.exp) {
    decoded._expReadable = new Date(decoded.payload.exp * 1000).toISOString();
  }
  return JSON.stringify(decoded, null, 2);
}

export function runTextTool(action) {
  if (!action) return;
  const hasSel = editor.somethingSelected();
  const text = hasSel ? editor.getSelection() : editor.getValue();
  let result = text;

  try {
    switch (action) {
      case 'upper': result = text.toUpperCase(); break;
      case 'lower': result = text.toLowerCase(); break;
      case 'title': result = text.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()); break;
      case 'sort': result = text.split('\n').sort((a, b) => a.localeCompare(b)).join('\n'); break;
      case 'sortDesc': result = text.split('\n').sort((a, b) => b.localeCompare(a)).join('\n'); break;
      case 'reverse': result = text.split('\n').reverse().join('\n'); break;
      case 'dedupe': result = [...new Set(text.split('\n'))].join('\n'); break;
      case 'removeEmpty': result = text.split('\n').filter(l => l.trim() !== '').join('\n'); break;
      case 'trim': result = text.split('\n').map(l => l.trim()).join('\n'); break;
      case 'lineNumbers': result = text.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n'); break;
      case 'joinLines': result = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(' '); break;
      case 'b64encode': result = btoa(unescape(encodeURIComponent(text))); break;
      case 'b64decode': result = decodeURIComponent(escape(atob(text.trim()))); break;
      case 'urlEncode': result = encodeURIComponent(text); break;
      case 'urlDecode': result = decodeURIComponent(text); break;
      case 'jwtDecode': result = decodeJwt(text); break;
      case 'minifyJson': result = JSON.stringify(JSON.parse(text)); break;
      case 'jsonToCsv': result = jsonToCsv(text); break;
      case 'csvToJson': result = csvToJson(text); break;
      case 'htmlEscape':
        result = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        break;
      case 'htmlUnescape': {
        const tmp = document.createElement('textarea');
        tmp.innerHTML = text;
        result = tmp.value;
        break;
      }
      default: return;
    }

    if (hasSel) editor.replaceSelection(result);
    else editor.setValue(result);
    setStatus(`Applied tool: ${action} ✓`);
  } catch (err) {
    alert(`Tool "${action}" error: ${err.message}`);
  }
}
