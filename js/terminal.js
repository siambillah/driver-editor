import { getPyodideInstance } from './tools.js';
import { getWorkspaceSource } from './explorer.js';

let ctx = null;
let isTerminalOpen = false;
let mode = 'shell'; // 'shell' | 'python' | 'javascript' | 'ws'
let history = [];
let historyIdx = -1;
let pyReplNs = null;
let wsConn = null;

const COMMANDS = [
  'help', 'clear', 'cls', 'ls', 'dir', 'pwd', 'cat', 'head', 'tail',
  'grep', 'wc', 'touch', 'open', 'save', 'rm', 'mv', 'cp', 'echo',
  'python', 'py', 'pip', 'node', 'js', 'date', 'whoami', 'history',
  'connect', 'disconnect', 'exit'
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function writeLine(text, cls = '') {
  const out = document.getElementById('terminalOutput');
  if (!out) return;
  const line = document.createElement('div');
  line.className = 'term-line' + (cls ? ' ' + cls : '');
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function writeHtmlLine(html, cls = '') {
  const out = document.getElementById('terminalOutput');
  if (!out) return;
  const line = document.createElement('div');
  line.className = 'term-line' + (cls ? ' ' + cls : '');
  line.innerHTML = html;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function getPromptLabel() {
  const ws = getWorkspaceSource();
  const folder = ws ? ws.name : 'workspace';
  if (mode === 'python') return 'py>>>';
  if (mode === 'javascript') return 'js>';
  if (mode === 'ws') return 'ws$';
  return `sb:~/${folder}$`;
}

function updatePromptUI() {
  const promptEl = document.getElementById('terminalPrompt');
  const badgeEl = document.getElementById('terminalModeBadge');
  if (promptEl) promptEl.textContent = getPromptLabel();
  if (badgeEl) {
    badgeEl.textContent = mode === 'python'
      ? 'Python REPL'
      : mode === 'javascript'
        ? 'JS REPL'
        : mode === 'ws'
          ? 'WS Bridge'
          : 'Shell';
  }
}

export function initTerminal(context) {
  ctx = context;
  setupTerminalResizer();

  const input = document.getElementById('terminalInput');
  if (!input) return;

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = input.value;
      input.value = '';
      if (raw.trim()) {
        history.push(raw);
        historyIdx = history.length;
      }
      await handleInput(raw);
    } else if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      historyIdx = Math.max(0, historyIdx - 1);
      input.value = history[historyIdx] || '';
    } else if (e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      historyIdx = Math.min(history.length, historyIdx + 1);
      input.value = history[historyIdx] || '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      autocompleteInput(input);
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      clearTerminal();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      writeLine(`${getPromptLabel()} ${input.value}^C`, 'term-dim');
      input.value = '';
      if (mode !== 'shell') {
        switchMode('shell');
      }
    }
  });

  // Focus input when clicking anywhere inside terminal output
  const out = document.getElementById('terminalOutput');
  out?.addEventListener('click', () => {
    if (!window.getSelection()?.toString()) input.focus();
  });

  writeHtmlLine('<span class="term-info">SB Editor Terminal ready.</span> Type <span class="term-ok">help</span> for commands, <span class="term-ok">python</span> for Python REPL, or <span class="term-ok">js</span> for JS REPL.');
  updatePromptUI();
}

export function toggleTerminal(forceState = null) {
  isTerminalOpen = forceState !== null ? forceState : !isTerminalOpen;
  const pane = document.getElementById('terminal-pane');
  const resizer = document.getElementById('terminal-resizer');
  const btn = document.getElementById('terminalBtn');

  if (pane) pane.style.display = isTerminalOpen ? 'flex' : 'none';
  if (resizer) resizer.style.display = isTerminalOpen ? 'block' : 'none';
  if (btn) btn.classList.toggle('btn-active', isTerminalOpen);

  ctx?.editor?.refresh();
  if (isTerminalOpen) {
    setTimeout(() => document.getElementById('terminalInput')?.focus(), 20);
  }
}

export function clearTerminal() {
  const out = document.getElementById('terminalOutput');
  if (out) out.innerHTML = '';
}

export function switchMode(newMode) {
  if (mode === 'ws' && newMode !== 'ws' && wsConn) {
    wsConn.close();
    wsConn = null;
  }
  mode = newMode;
  updatePromptUI();
  if (mode === 'python') {
    writeLine('Entered Python Interactive REPL (type "exit()" or press Ctrl+C to return to shell).', 'term-info');
  } else if (mode === 'javascript') {
    writeLine('Entered JavaScript Interactive REPL (type "exit" or press Ctrl+C to return to shell).', 'term-info');
  } else if (mode === 'shell') {
    writeLine('Switched to Shell mode.', 'term-dim');
  }
  document.getElementById('terminalInput')?.focus();
}

function setupTerminalResizer() {
  const resizer = document.getElementById('terminal-resizer');
  const pane = document.getElementById('terminal-pane');
  if (!resizer || !pane) return;

  let dragging = false;
  resizer.addEventListener('mousedown', () => {
    dragging = true;
    resizer.classList.add('dragging');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const footerH = document.querySelector('.statusbar')?.offsetHeight || 24;
    const h = Math.max(110, Math.min(window.innerHeight * 0.65, window.innerHeight - e.clientY - footerH));
    pane.style.height = h + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      resizer.classList.remove('dragging');
      ctx?.editor?.refresh();
    }
  });
}

function autocompleteInput(input) {
  const val = input.value;
  const parts = val.split(/\s+/);
  const last = parts[parts.length - 1] || '';

  let candidates = [];
  if (parts.length <= 1 && mode === 'shell') {
    candidates = COMMANDS.filter(c => c.startsWith(last));
  } else {
    const tabNames = ctx.getTabs().map(t => t.title);
    const ws = getWorkspaceSource();
    const folderNames = (ws?.rootNode?.children || []).map(n => n.name);
    const unique = [...new Set([...tabNames, ...folderNames])];
    candidates = unique.filter(n => n.toLowerCase().startsWith(last.toLowerCase()));
  }

  if (candidates.length === 1) {
    parts[parts.length - 1] = candidates[0];
    input.value = parts.join(' ') + (parts.length === 1 ? ' ' : '');
  } else if (candidates.length > 1) {
    writeLine(candidates.join('   '), 'term-dim');
  }
}

function tokenizeArgs(str) {
  const args = [];
  let cur = '', quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { args.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) args.push(cur);
  return args;
}

function findTabByName(name) {
  if (!name) return ctx.getActiveTab();
  const clean = name.replace(/^\.\//, '');
  return ctx.getTabs().find(t => t.title === clean || t.title.toLowerCase() === clean.toLowerCase()) || null;
}

async function readFileOrTabText(name) {
  const tab = findTabByName(name);
  if (tab) return tab.doc.getValue();

  const ws = getWorkspaceSource();
  const node = ws?.rootNode?.children?.find(n => n.kind === 'file' && n.name.toLowerCase() === name.toLowerCase());
  if (node?.handle) {
    const file = await node.handle.getFile();
    return await file.text();
  }
  if (node?.fileObj) {
    return await node.fileObj.text();
  }
  return null;
}

async function handleInput(raw) {
  const promptText = getPromptLabel();
  writeHtmlLine(`<span class="term-prompt">${escapeHtml(promptText)}</span> ${escapeHtml(raw)}`);

  const trimmed = raw.trim();
  if (!trimmed) return;

  if (mode === 'ws') {
    if (trimmed === 'disconnect' || trimmed === 'exit') {
      switchMode('shell');
      return;
    }
    if (wsConn && wsConn.readyState === WebSocket.OPEN) {
      wsConn.send(raw + '\n');
    } else {
      writeLine('WebSocket disconnected.', 'term-err');
      switchMode('shell');
    }
    return;
  }

  if (mode === 'python') {
    if (trimmed === 'exit' || trimmed === 'exit()' || trimmed === 'quit' || trimmed === 'quit()') {
      switchMode('shell');
      return;
    }
    await evalPythonInTerminal(raw, true);
    return;
  }

  if (mode === 'javascript') {
    if (trimmed === 'exit' || trimmed === '.exit') {
      switchMode('shell');
      return;
    }
    evalJsInTerminal(raw);
    return;
  }

  await runShellCommand(raw);
}

async function runShellCommand(raw) {
  // Handle simple output redirection: echo "hello" > file.txt
  const redirMatch = raw.match(/^(.*?)\s*(>>?)\s*(\S+)\s*$/);
  if (redirMatch && /^echo\b/i.test(redirMatch[1].trim())) {
    const text = tokenizeArgs(redirMatch[1].trim()).slice(1).join(' ');
    const op = redirMatch[2];
    const targetName = redirMatch[3];
    const existing = findTabByName(targetName);
    if (existing) {
      const prev = existing.doc.getValue();
      existing.doc.setValue(op === '>>' && prev ? `${prev}\n${text}` : text);
      writeLine(`Wrote to tab "${existing.title}"`, 'term-ok');
    } else {
      ctx.createTab({ title: targetName, content: text, isDirty: true });
      writeLine(`Created tab "${targetName}"`, 'term-ok');
    }
    return;
  }

  const args = tokenizeArgs(raw.trim());
  const cmd = (args[0] || '').toLowerCase();
  const rest = args.slice(1);

  switch (cmd) {
    case 'help':
      writeLine([
        'Available Terminal Commands:',
        '  ls / dir              List open tabs & workspace folder files',
        '  cat <file>            Print contents of a tab or local folder file',
        '  head / tail <file>    Print first or last 10 lines',
        '  grep <pat> [file]     Search pattern across open tabs or a file',
        '  wc <file>             Count lines, words, and characters',
        '  touch <name>          Create a new tab (or open existing)',
        '  open <name>           Switch to / open tab or folder file',
        '  save                  Save active tab (Drive / Disk / Download)',
        '  rm / mv / cp          Close tab, rename tab, or duplicate tab',
        '  echo <txt> [> file]   Print text or write to a tab',
        '  python [file.py]      Run Python script or enter interactive Py REPL',
        '  pip install <pkg>     Install Python package via micropip',
        '  node / js [file.js]   Run JS file or enter interactive JS REPL',
        '  connect ws://...      Connect to a local WebSocket shell bridge',
        '  clear / cls / Ctrl+L  Clear terminal output'
      ].join('\n'), 'term-info');
      break;

    case 'clear':
    case 'cls':
      clearTerminal();
      break;

    case 'pwd': {
      const ws = getWorkspaceSource();
      writeLine(ws ? `/${ws.type === 'drive' ? 'drive' : 'local'}/${ws.name}` : '/open-tabs');
      break;
    }

    case 'ls':
    case 'dir': {
      const tabs = ctx.getTabs();
      const activeId = ctx.getActiveTab()?.id;
      writeLine(`Open Tabs (${tabs.length}):`, 'term-info');
      tabs.forEach(t => {
        const mark = t.id === activeId ? '* ' : '  ';
        const src = t.fileId ? '[Drive]' : t.fileHandle ? '[Disk]' : '[Local]';
        writeLine(`${mark}${t.title.padEnd(24)} ${src}${t.isDirty ? ' (modified)' : ''}`);
      });
      const ws = getWorkspaceSource();
      if (ws?.rootNode?.children?.length) {
        writeLine(`\nFolder "${ws.name}" (${ws.rootNode.children.length} entries):`, 'term-info');
        const listStr = ws.rootNode.children
          .map(n => (n.kind === 'directory' ? `${n.name}/` : n.name))
          .join('   ');
        writeLine('  ' + listStr);
      }
      break;
    }

    case 'cat': {
      if (!rest[0]) { writeLine('Usage: cat <filename>', 'term-warn'); break; }
      const text = await readFileOrTabText(rest[0]);
      if (text === null) writeLine(`cat: ${rest[0]}: No such tab or file`, 'term-err');
      else writeLine(text);
      break;
    }

    case 'head':
    case 'tail': {
      if (!rest[0]) { writeLine(`Usage: ${cmd} <filename> [lines]`, 'term-warn'); break; }
      const text = await readFileOrTabText(rest[0]);
      if (text === null) { writeLine(`${cmd}: ${rest[0]}: Not found`, 'term-err'); break; }
      const n = Math.max(1, Number(rest[1]) || 10);
      const lines = text.split('\n');
      writeLine((cmd === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n'));
      break;
    }

    case 'wc': {
      const target = rest[0] ? await readFileOrTabText(rest[0]) : ctx.getActiveTab()?.doc.getValue();
      if (target === null || target === undefined) { writeLine(`wc: ${rest[0]}: Not found`, 'term-err'); break; }
      const lines = target.split('\n').length;
      const words = target.trim() ? target.trim().split(/\s+/).length : 0;
      writeLine(`  ${lines} lines   ${words} words   ${target.length} chars`);
      break;
    }

    case 'grep': {
      if (!rest[0]) { writeLine('Usage: grep <pattern> [filename]', 'term-warn'); break; }
      let re;
      try { re = new RegExp(rest[0], 'i'); }
      catch (e) { writeLine('Invalid regex: ' + e.message, 'term-err'); break; }
      const targets = rest[1] ? [findTabByName(rest[1])].filter(Boolean) : ctx.getTabs();
      let hits = 0;
      targets.forEach(t => {
        t.doc.getValue().split('\n').forEach((line, idx) => {
          if (re.test(line)) {
            hits++;
            writeHtmlLine(`<span class="term-ok">${escapeHtml(t.title)}:${idx + 1}</span>: ${escapeHtml(line)}`);
          }
        });
      });
      if (!hits) writeLine('No matches found.', 'term-dim');
      break;
    }

    case 'touch': {
      if (!rest[0]) { writeLine('Usage: touch <filename>', 'term-warn'); break; }
      const existing = findTabByName(rest[0]);
      if (existing) {
        ctx.switchTab(existing.id);
        writeLine(`Switched to existing tab "${existing.title}"`, 'term-info');
      } else {
        ctx.createTab({ title: rest[0], content: '', isDirty: true });
        writeLine(`Created tab "${rest[0]}"`, 'term-ok');
      }
      break;
    }

    case 'open': {
      if (!rest[0]) { writeLine('Usage: open <filename>', 'term-warn'); break; }
      const existing = findTabByName(rest[0]);
      if (existing) {
        ctx.switchTab(existing.id);
        writeLine(`Focused "${existing.title}"`, 'term-ok');
        break;
      }
      const txt = await readFileOrTabText(rest[0]);
      if (txt !== null) {
        ctx.createTab({ title: rest[0], content: txt, isDirty: false });
        writeLine(`Opened "${rest[0]}"`, 'term-ok');
      } else {
        writeLine(`open: ${rest[0]}: Not found in tabs or root folder`, 'term-err');
      }
      break;
    }

    case 'save':
      await ctx.saveCurrentTab();
      writeLine('Save triggered for active tab.', 'term-ok');
      break;

    case 'rm': {
      if (!rest[0]) { writeLine('Usage: rm <tabname>', 'term-warn'); break; }
      const tab = findTabByName(rest[0]);
      if (!tab) { writeLine(`rm: ${rest[0]}: Tab not found`, 'term-err'); break; }
      ctx.closeTab(tab.id);
      writeLine(`Closed "${tab.title}"`, 'term-ok');
      break;
    }

    case 'mv': {
      if (rest.length < 2) { writeLine('Usage: mv <oldname> <newname>', 'term-warn'); break; }
      const tab = findTabByName(rest[0]);
      if (!tab) { writeLine(`mv: ${rest[0]}: Tab not found`, 'term-err'); break; }
      ctx.renameTabDirect(tab.id, rest[1]);
      writeLine(`Renamed to "${rest[1]}"`, 'term-ok');
      break;
    }

    case 'cp': {
      if (rest.length < 2) { writeLine('Usage: cp <src> <dest>', 'term-warn'); break; }
      const text = await readFileOrTabText(rest[0]);
      if (text === null) { writeLine(`cp: ${rest[0]}: Not found`, 'term-err'); break; }
      ctx.createTab({ title: rest[1], content: text, isDirty: true });
      writeLine(`Copied "${rest[0]}" -> "${rest[1]}"`, 'term-ok');
      break;
    }

    case 'echo':
      writeLine(rest.join(' '));
      break;

    case 'date':
      writeLine(new Date().toString());
      break;

    case 'whoami':
      writeLine('sb-editor-user (browser-sandbox)');
      break;

    case 'history':
      history.forEach((h, i) => writeLine(`  ${String(i + 1).padStart(3)}  ${h}`));
      break;

    case 'python':
    case 'python3':
    case 'py': {
      if (!rest.length) {
        switchMode('python');
        break;
      }
      if (rest[0] === '-c' && rest[1]) {
        await evalPythonInTerminal(rest.slice(1).join(' '), false);
        break;
      }
      const code = await readFileOrTabText(rest[0]);
      if (code === null) {
        // Evaluate as inline Python if not a file
        await evalPythonInTerminal(rest.join(' '), true);
      } else {
        await evalPythonInTerminal(code, false);
      }
      break;
    }

    case 'pip': {
      if (rest[0] === 'install' && rest[1]) {
        const pkgs = rest.slice(1);
        try {
          const py = await getPyodideInstance((msg) => writeLine(msg, 'term-info'));
          writeLine(`Installing ${pkgs.join(', ')} via micropip...`, 'term-info');
          await py.loadPackage('micropip');
          const micropip = py.pyimport('micropip');
          await micropip.install(pkgs);
          writeLine(`Successfully installed: ${pkgs.join(', ')} ✓`, 'term-ok');
        } catch (err) {
          writeLine(`pip error: ${err.message}`, 'term-err');
        }
      } else {
        writeLine('Usage: pip install <package>', 'term-warn');
      }
      break;
    }

    case 'node':
    case 'js': {
      if (!rest.length) {
        switchMode('javascript');
        break;
      }
      if (rest[0] === '-e' && rest[1]) {
        evalJsInTerminal(rest.slice(1).join(' '));
        break;
      }
      const code = await readFileOrTabText(rest[0]);
      if (code === null) evalJsInTerminal(rest.join(' '));
      else evalJsInTerminal(code);
      break;
    }

    case 'connect': {
      const url = rest[0] || 'ws://localhost:8765';
      connectWebSocketBridge(url);
      break;
    }

    case 'exit':
      toggleTerminal(false);
      break;

    default:
      writeLine(`Command not found: "${cmd}". Type "help" for available commands.`, 'term-err');
  }
}

async function evalPythonInTerminal(code, isRepl) {
  try {
    const py = await getPyodideInstance((msg) => writeLine(msg, 'term-info'));
    if (!pyReplNs) pyReplNs = py.toPy({ __name__: '__main__' });
    const ns = isRepl ? pyReplNs : py.toPy({ __name__: '__main__' });
    try {
      await py.loadPackagesFromImports(code);
      py.runPython(`import sys, io\nsys.stdout = io.StringIO()\nsys.stderr = io.StringIO()`);
      const result = await py.runPythonAsync(code, { globals: ns });
      const out = py.runPython('sys.stdout.getvalue()');
      const err = py.runPython('sys.stderr.getvalue()');
      if (out) writeLine(out.replace(/\n$/, ''));
      if (err) writeLine(err.replace(/\n$/, ''), 'term-err');
      if (isRepl && result !== undefined && result !== null && !out) {
        writeLine(String(result), 'term-ok');
      }
    } finally {
      if (!isRepl && ns) ns.destroy();
    }
  } catch (err) {
    writeLine(err.message, 'term-err');
  }
}

function evalJsInTerminal(code) {
  const logs = [];
  const fakeConsole = {
    log: (...a) => logs.push(a.map(formatJsVal).join(' ')),
    info: (...a) => logs.push(a.map(formatJsVal).join(' ')),
    warn: (...a) => logs.push('[warn] ' + a.map(formatJsVal).join(' ')),
    error: (...a) => logs.push('[error] ' + a.map(formatJsVal).join(' '))
  };
  try {
    const fn = new Function('console', `return (function(){\n${code}\n})()`);
    let res;
    try {
      // Try expression return first for one-liners like 2 + 2
      res = new Function('console', `return (${code})`)(fakeConsole);
    } catch {
      res = fn(fakeConsole);
    }
    logs.forEach(l => writeLine(l));
    if (res !== undefined && !logs.length) {
      writeLine(formatJsVal(res), 'term-ok');
    }
  } catch (err) {
    writeLine(err.message, 'term-err');
  }
}

function formatJsVal(v) {
  if (typeof v === 'object' && v !== null) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
  return String(v);
}

function connectWebSocketBridge(url) {
  if (wsConn) wsConn.close();
  writeLine(`Connecting to ${url}...`, 'term-info');
  try {
    wsConn = new WebSocket(url);
    wsConn.onopen = () => {
      mode = 'ws';
      updatePromptUI();
      writeLine(`Connected to ${url} ✓ (type "disconnect" to return to local shell)`, 'term-ok');
    };
    wsConn.onmessage = (e) => writeLine(String(e.data).replace(/\n$/, ''));
    wsConn.onerror = () => writeLine(`Could not connect to ${url}. Make sure a local WebSocket shell server is running.`, 'term-err');
    wsConn.onclose = () => {
      if (mode === 'ws') switchMode('shell');
    };
  } catch (err) {
    writeLine('WebSocket error: ' + err.message, 'term-err');
  }
}
