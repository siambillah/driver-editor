import { CODE_SNIPPETS, getCustomSnippets, saveCustomSnippetEntry, deleteCustomSnippetEntry } from './suggestions.js';

let ctx = null;
let paletteItems = [];
let paletteSelectedIdx = 0;

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function initModals(context) {
  ctx = context;

  // Close any open modal on Escape or clicking backdrop
  ['driveModal', 'paletteModal', 'diffModal', 'searchAllModal', 'snippetsModal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      if (e.target === el) el.style.display = 'none';
    });
  });

  const paletteInput = document.getElementById('paletteInput');
  if (paletteInput) {
    paletteInput.addEventListener('input', () => renderPaletteList(paletteInput.value));
    paletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteSelectedIdx = Math.min(paletteItems.length - 1, paletteSelectedIdx + 1);
        highlightPaletteRow();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteSelectedIdx = Math.max(0, paletteSelectedIdx - 1);
        highlightPaletteRow();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (paletteItems[paletteSelectedIdx]) {
          const item = paletteItems[paletteSelectedIdx];
          closeCommandPalette();
          item.run();
        }
      } else if (e.key === 'Escape') {
        closeCommandPalette();
      }
    });
  }
}

/* ==================== 1. COMMAND PALETTE ==================== */
export function openCommandPalette() {
  const modal = document.getElementById('paletteModal');
  const input = document.getElementById('paletteInput');
  modal.style.display = 'flex';
  input.value = '';
  paletteSelectedIdx = 0;
  renderPaletteList('');
  setTimeout(() => input.focus(), 20);
}

export function closeCommandPalette() {
  document.getElementById('paletteModal').style.display = 'none';
  ctx.editor.focus();
}

function renderPaletteList(query) {
  const q = query.trim().toLowerCase();
  const listEl = document.getElementById('paletteList');

  const commands = ctx.getCommands();
  const tabCommands = ctx.getTabs().map(t => ({
    category: 'Tab',
    label: `Switch to: ${t.title}`,
    shortcut: t.fileId ? 'Drive' : t.fileHandle ? 'Disk' : 'Local',
    run: () => ctx.switchTab(t.id)
  }));

  const all = [...commands, ...tabCommands];
  paletteItems = q
    ? all.filter(c => `${c.category} ${c.label}`.toLowerCase().includes(q))
    : all;

  paletteSelectedIdx = 0;
  listEl.innerHTML = '';

  if (!paletteItems.length) {
    listEl.innerHTML = '<div style="padding:14px; color:var(--text-muted); text-align:center;">No matching commands</div>';
    return;
  }

  paletteItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'palette-item' + (idx === 0 ? ' selected' : '');
    row.innerHTML = `
      <div><span class="palette-cat">${escapeHtml(item.category)}</span>${escapeHtml(item.label)}</div>
      <span class="palette-shortcut">${escapeHtml(item.shortcut || '')}</span>
    `;
    row.onclick = () => {
      closeCommandPalette();
      item.run();
    };
    listEl.appendChild(row);
  });
}

function highlightPaletteRow() {
  const rows = document.querySelectorAll('#paletteList .palette-item');
  rows.forEach((r, i) => {
    r.classList.toggle('selected', i === paletteSelectedIdx);
    if (i === paletteSelectedIdx) r.scrollIntoView({ block: 'nearest' });
  });
}

/* ==================== 2. DIFF / COMPARE TABS ==================== */
function computeLineDiff(aLines, bLines) {
  // Fast fallback for very large files (> 1500 lines) to avoid O(n*m) slowdown
  if (aLines.length * bLines.length > 1200000) {
    const out = [];
    const maxLen = Math.max(aLines.length, bLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (aLines[i] === bLines[i]) {
        out.push({ type: 'eq', text: aLines[i], lnA: i + 1, lnB: i + 1 });
      } else {
        if (i < aLines.length) out.push({ type: 'del', text: aLines[i], lnA: i + 1, lnB: '' });
        if (i < bLines.length) out.push({ type: 'add', text: bLines[i], lnA: '', lnB: i + 1 });
      }
    }
    return out;
  }

  const n = aLines.length, m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const res = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      res.push({ type: 'eq', text: aLines[i], lnA: i + 1, lnB: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      res.push({ type: 'del', text: aLines[i], lnA: i + 1, lnB: '' });
      i++;
    } else {
      res.push({ type: 'add', text: bLines[j], lnA: '', lnB: j + 1 });
      j++;
    }
  }
  while (i < n) { res.push({ type: 'del', text: aLines[i], lnA: i + 1, lnB: '' }); i++; }
  while (j < m) { res.push({ type: 'add', text: bLines[j], lnA: '', lnB: j + 1 }); j++; }
  return res;
}

export function openDiffModal(leftId = null, rightId = null) {
  const tabs = ctx.getTabs();
  if (tabs.length < 2) {
    alert('তুলনা করার জন্য কমপক্ষে ২টি ট্যাব খোলা থাকতে হবে!');
    return;
  }
  const leftSel = document.getElementById('diffLeftSelect');
  const rightSel = document.getElementById('diffRightSelect');
  const active = ctx.getActiveTab();

  const opts = tabs.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  leftSel.innerHTML = opts;
  rightSel.innerHTML = opts;

  leftSel.value = leftId || active?.id || tabs[0].id;
  const other = tabs.find(t => t.id !== leftSel.value) || tabs[1];
  rightSel.value = rightId || other.id;

  document.getElementById('diffModal').style.display = 'flex';
  renderDiff();
}

export function closeDiffModal() {
  document.getElementById('diffModal').style.display = 'none';
}

export function renderDiff() {
  const tabs = ctx.getTabs();
  const leftTab = tabs.find(t => t.id === document.getElementById('diffLeftSelect').value);
  const rightTab = tabs.find(t => t.id === document.getElementById('diffRightSelect').value);
  const outEl = document.getElementById('diffOutput');
  const statsEl = document.getElementById('diffStats');
  if (!leftTab || !rightTab) return;

  const diff = computeLineDiff(leftTab.doc.getValue().split('\n'), rightTab.doc.getValue().split('\n'));
  let added = 0, removed = 0;

  const html = diff.map(d => {
    if (d.type === 'add') added++;
    if (d.type === 'del') removed++;
    const cls = d.type === 'add' ? 'diff-add' : d.type === 'del' ? 'diff-del' : '';
    const sign = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';
    return `<div class="diff-line ${cls}"><span class="diff-ln">${d.lnA}</span><span class="diff-ln">${d.lnB}</span><span class="diff-sign">${sign}</span><span>${escapeHtml(d.text)}</span></div>`;
  }).join('');

  statsEl.innerHTML = `<span style="color:#16a34a">+${added}</span> / <span style="color:#dc2626">-${removed}</span>`;
  outEl.innerHTML = (added === 0 && removed === 0)
    ? '<div style="padding:20px; text-align:center; color:var(--text-muted);">✓ Both tabs are identical!</div>'
    : html;
}

/* ==================== 3. FIND & REPLACE ACROSS ALL TABS ==================== */
export function openSearchAllModal() {
  document.getElementById('searchAllModal').style.display = 'flex';
  const input = document.getElementById('searchAllQuery');
  const sel = ctx.editor.getSelection();
  if (sel && !sel.includes('\n')) input.value = sel;
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

export function closeSearchAllModal() {
  document.getElementById('searchAllModal').style.display = 'none';
}

function buildSearchRegex(query, matchCase, useRegex) {
  const flags = matchCase ? 'g' : 'gi';
  const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(source, flags);
}

export function runSearchAll() {
  const query = document.getElementById('searchAllQuery').value;
  const matchCase = document.getElementById('searchAllCase').checked;
  const useRegex = document.getElementById('searchAllRegex').checked;
  const resultsEl = document.getElementById('searchAllResults');
  const statusEl = document.getElementById('searchAllStatus');

  if (!query) {
    statusEl.textContent = 'Enter a search query.';
    resultsEl.innerHTML = '';
    return;
  }

  let regex;
  try {
    regex = buildSearchRegex(query, matchCase, useRegex);
  } catch (e) {
    statusEl.textContent = 'Invalid regex: ' + e.message;
    return;
  }

  const tabs = ctx.getTabs();
  let totalMatches = 0;
  let matchedTabs = 0;
  resultsEl.innerHTML = '';

  tabs.forEach(tab => {
    const lines = tab.doc.getValue().split('\n');
    const tabMatches = [];
    lines.forEach((lineText, idx) => {
      regex.lastIndex = 0;
      const m = regex.exec(lineText);
      if (m) tabMatches.push({ line: idx, ch: m.index, text: lineText });
    });

    if (tabMatches.length) {
      matchedTabs++;
      totalMatches += tabMatches.length;
      tabMatches.forEach(hit => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `
          <span><strong>${escapeHtml(tab.title)}</strong> : Ln ${hit.line + 1}</span>
          <span class="search-match-preview">${escapeHtml(hit.text.trim())}</span>
        `;
        row.onclick = () => {
          closeSearchAllModal();
          ctx.openTabAtLine(tab.id, hit.line, hit.ch);
        };
        resultsEl.appendChild(row);
      });
    }
  });

  statusEl.textContent = `Found ${totalMatches} matching line(s) across ${matchedTabs} tab(s).`;
}

export function runReplaceAll() {
  const query = document.getElementById('searchAllQuery').value;
  const replacement = document.getElementById('searchAllReplace').value;
  const matchCase = document.getElementById('searchAllCase').checked;
  const useRegex = document.getElementById('searchAllRegex').checked;
  if (!query) return;

  let regex;
  try {
    regex = buildSearchRegex(query, matchCase, useRegex);
  } catch (e) {
    alert('Invalid regex: ' + e.message);
    return;
  }

  const tabs = ctx.getTabs();
  let replacedCount = 0;
  let touchedTabs = 0;

  tabs.forEach(tab => {
    const content = tab.doc.getValue();
    const matches = content.match(regex);
    if (matches?.length) {
      replacedCount += matches.length;
      touchedTabs++;
      tab.doc.setValue(content.replace(regex, replacement));
    }
  });

  document.getElementById('searchAllStatus').textContent =
    `Replaced ${replacedCount} occurrence(s) across ${touchedTabs} tab(s) ✓`;
  ctx.setStatus(`Replaced ${replacedCount} matches across ${touchedTabs} tabs ✓`);
  runSearchAll();
}

/* ==================== 4. CUSTOM SNIPPETS MANAGER ==================== */
export function openSnippetsModal() {
  document.getElementById('snippetsModal').style.display = 'flex';
  renderSnippetsList();
}

export function closeSnippetsModal() {
  document.getElementById('snippetsModal').style.display = 'none';
}

function renderSnippetsList() {
  const listEl = document.getElementById('snippetsList');
  const custom = getCustomSnippets();
  listEl.innerHTML = '';

  const customKeys = Object.keys(custom);
  if (customKeys.length) {
    customKeys.forEach(key => {
      const s = custom[key];
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div><strong>⚡ ${escapeHtml(key)}</strong> <span class="palette-cat">${escapeHtml(s.lang || 'all')}</span></div>
        <span class="snippet-code-preview">${escapeHtml(s.code.replace(/\n/g, ' ↵ '))}</span>
      `;
      const actions = document.createElement('div');
      actions.className = 'file-meta';

      const insertBtn = document.createElement('button');
      insertBtn.textContent = 'Insert';
      insertBtn.onclick = (e) => {
        e.stopPropagation();
        closeSnippetsModal();
        ctx.editor.replaceSelection(s.code);
        ctx.editor.focus();
      };

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'btn-danger';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteCustomSnippetEntry(key);
        renderSnippetsList();
        ctx.setStatus(`Deleted snippet "${key}"`);
      };

      actions.appendChild(insertBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  // Also display built-in snippets for quick insert
  Object.entries(CODE_SNIPPETS).forEach(([key, s]) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `
      <div><strong>⚡ ${escapeHtml(key)}</strong> <span class="palette-cat">Built-in • ${escapeHtml(s.lang)}</span></div>
      <span class="snippet-code-preview">${escapeHtml(s.code.replace(/\n/g, ' ↵ '))}</span>
    `;
    const insertBtn = document.createElement('button');
    insertBtn.textContent = 'Insert';
    insertBtn.onclick = (e) => {
      e.stopPropagation();
      closeSnippetsModal();
      ctx.editor.replaceSelection(s.code);
      ctx.editor.focus();
    };
    row.appendChild(insertBtn);
    listEl.appendChild(row);
  });
}

export function saveCustomSnippet() {
  const key = document.getElementById('snippetKeyInput').value.trim();
  const lang = document.getElementById('snippetLangInput').value;
  const body = document.getElementById('snippetBodyInput').value;
  if (!key || !body) {
    alert('ট্রিগার নাম এবং কোড উভয়ই দিন!');
    return;
  }
  saveCustomSnippetEntry(key, lang, body);
  document.getElementById('snippetKeyInput').value = '';
  document.getElementById('snippetBodyInput').value = '';
  renderSnippetsList();
  ctx.setStatus(`Saved custom snippet "${key}" ✓`);
}

/* ==================== 5. SHAREABLE SNIPPET URL ==================== */
export function shareCurrentTab() {
  const tab = ctx.getActiveTab();
  if (!tab) return;
  const content = tab.doc.getValue();
  if (content.length > 24000) {
    alert('ফাইলটি শেয়ার লিংকের জন্য বেশ বড় (>24KB)। অনুগ্রহ করে Google Drive বা Export ব্যবহার করুন।');
    return;
  }
  try {
    const payload = JSON.stringify({ t: tab.title, c: content });
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        ctx.setStatus(`Shareable link copied to clipboard (${url.length} chars) ✓`);
      });
    } else {
      prompt('শেয়ার লিংক কপি করুন:', url);
    }
  } catch (err) {
    alert('Could not create share link: ' + err.message);
  }
}

export function tryLoadSharedSnippet(createTab) {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#share=')) return false;
  try {
    const encoded = hash.slice('#share='.length);
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json);
    if (data && typeof data.c === 'string') {
      createTab({ title: data.t || 'shared.txt', content: data.c, isDirty: false });
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    }
  } catch {
    // invalid hash
  }
  return false;
}
