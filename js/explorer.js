import * as drive from './drive.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', 'dist', 'build', '.cache']);
const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf', 'zip', 'tar', 'gz', '7z', 'rar', 'mp3', 'mp4', 'wav', 'mov', 'avi', 'woff', 'woff2', 'ttf', 'eot', 'exe', 'dll', 'so', 'pyc', 'class', 'wasm']);

let ctx = null;
let isSidebarOpen = false;
let workspaceSource = null; // { type: 'local-handle' | 'local-files' | 'drive', name, rootNode, dirHandle?, folderId? }

function isBinaryFilename(name) {
  const ext = name.split('.').pop().toLowerCase();
  return name.includes('.') && BINARY_EXTS.has(ext);
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['html', 'htm'].includes(ext)) return '🌐';
  if (ext === 'css' || ext === 'scss') return '🎨';
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx'].includes(ext)) return '📜';
  if (ext === 'py') return '🐍';
  if (ext === 'md' || ext === 'markdown') return '📝';
  if (ext === 'json' || ext === 'yaml' || ext === 'yml') return '⚙️';
  if (ext === 'sql') return '🗄️';
  if (ext === 'sh' || ext === 'bash') return '💻';
  return '📄';
}

export function initExplorer(context) {
  ctx = context;
  setupSidebarResizer();
}

export function isExplorerOpen() {
  return isSidebarOpen;
}

export function toggleSidebar(forceState = null) {
  isSidebarOpen = forceState !== null ? forceState : !isSidebarOpen;
  const sidebar = document.getElementById('sidebar-pane');
  const resizer = document.getElementById('sidebar-resizer');
  const btn = document.getElementById('explorerBtn');

  if (sidebar) sidebar.classList.toggle('open', isSidebarOpen);
  if (resizer) resizer.style.display = (isSidebarOpen && window.innerWidth > 768) ? 'block' : 'none';
  if (btn) btn.classList.toggle('btn-active', isSidebarOpen);
  ctx?.editor?.refresh();
}

function setupSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar-pane');
  const workspace = document.getElementById('workspace');
  if (!resizer || !sidebar || !workspace) return;

  let dragging = false;
  resizer.addEventListener('mousedown', () => {
    dragging = true;
    resizer.classList.add('dragging');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const w = Math.max(170, Math.min(480, e.clientX - rect.left));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      resizer.classList.remove('dragging');
      ctx?.editor?.refresh();
    }
  });
}

/* ==================== 1. OPEN LOCAL FOLDER ==================== */
export async function openLocalFolder() {
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      let dirHandle;
      try {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        if (e.name === 'AbortError') return;
        dirHandle = await window.showDirectoryPicker();
      }
      await loadLocalDirectoryHandle(dirHandle);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  // Fallback for Firefox/Safari/Mobile
  const input = document.getElementById('localFolderInput');
  if (input) input.click();
}

export async function loadLocalDirectoryHandle(dirHandle) {
  const rootNode = {
    kind: 'directory',
    name: dirHandle.name,
    path: dirHandle.name,
    handle: dirHandle,
    expanded: true,
    loaded: false,
    children: []
  };
  workspaceSource = { type: 'local-handle', name: dirHandle.name, dirHandle, rootNode };
  toggleSidebar(true);
  await loadHandleChildren(rootNode);
  renderSidebarTree();
  ctx.setStatus(`Opened local folder "${dirHandle.name}" ✓`);
}

async function loadHandleChildren(node) {
  const dirs = [];
  const files = [];
  for await (const [name, handle] of node.handle.entries()) {
    if (handle.kind === 'directory') {
      dirs.push({
        kind: 'directory',
        name,
        path: `${node.path}/${name}`,
        handle,
        expanded: false,
        loaded: false,
        children: []
      });
    } else {
      files.push({
        kind: 'file',
        name,
        path: `${node.path}/${name}`,
        handle
      });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  node.children = [...dirs, ...files];
  node.loaded = true;
}

export function loadLocalFolderFromInput(event) {
  const fileList = Array.from(event.target.files || []);
  event.target.value = '';
  if (!fileList.length) return;

  const rootName = (fileList[0].webkitRelativePath || '').split('/')[0] || 'Local Folder';
  const rootNode = { kind: 'directory', name: rootName, path: rootName, expanded: true, loaded: true, children: [] };

  const dirMap = new Map([['', rootNode]]);
  for (const file of fileList) {
    const rel = file.webkitRelativePath || file.name;
    const parts = rel.split('/');
    if (parts.some(p => SKIP_DIRS.has(p))) continue;

    let parentKey = '';
    for (let i = 1; i < parts.length - 1; i++) {
      const seg = parts[i];
      const curKey = parentKey ? `${parentKey}/${seg}` : seg;
      if (!dirMap.has(curKey)) {
        const dirNode = { kind: 'directory', name: seg, path: `${rootName}/${curKey}`, expanded: false, loaded: true, children: [] };
        dirMap.get(parentKey).children.push(dirNode);
        dirMap.set(curKey, dirNode);
      }
      parentKey = curKey;
    }
    dirMap.get(parentKey).children.push({
      kind: 'file',
      name: parts[parts.length - 1],
      path: rel,
      fileObj: file
    });
  }

  sortTreeRecursive(rootNode);
  workspaceSource = { type: 'local-files', name: rootName, rootNode };
  toggleSidebar(true);
  renderSidebarTree();
  ctx.setStatus(`Loaded local folder "${rootName}" (${fileList.length} files) ✓`);
}

function sortTreeRecursive(node) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(c => {
    if (c.kind === 'directory') sortTreeRecursive(c);
  });
}

/* ==================== 2. OPEN GOOGLE DRIVE FOLDER ==================== */
export async function openDriveFolderInSidebar(folderId, folderName = 'Drive Folder') {
  if (!drive.isDriveConnected()) {
    drive.handleAuth();
    return;
  }
  const rootNode = {
    kind: 'directory',
    name: folderName,
    path: folderName,
    driveId: folderId,
    expanded: true,
    loaded: false,
    children: []
  };
  workspaceSource = { type: 'drive', name: folderName, folderId, rootNode };
  toggleSidebar(true);
  document.getElementById('sidebarSubHeader').textContent = `☁️ Drive: ${folderName}`;
  document.getElementById('sidebarTree').innerHTML = '<div class="sidebar-loading">Loading Drive folder...</div>';
  await loadDriveNodeChildren(rootNode);
  renderSidebarTree();
  ctx.setStatus(`Opened Drive folder "${folderName}" ✓`);
}

async function loadDriveNodeChildren(node) {
  const items = await drive.listDriveFolderItems(node.driveId);
  const dirs = [];
  const files = [];
  items.forEach(f => {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      dirs.push({
        kind: 'directory',
        name: f.name,
        path: `${node.path}/${f.name}`,
        driveId: f.id,
        expanded: false,
        loaded: false,
        children: []
      });
    } else {
      files.push({
        kind: 'file',
        name: f.name,
        path: `${node.path}/${f.name}`,
        driveId: f.id,
        mimeType: f.mimeType,
        size: Number(f.size || 0)
      });
    }
  });
  node.children = [...dirs, ...files];
  node.loaded = true;
}

/* ==================== 3. TREE RENDERING & FILE OPENING ==================== */
function renderSidebarTree() {
  const sub = document.getElementById('sidebarSubHeader');
  const treeEl = document.getElementById('sidebarTree');
  if (!workspaceSource) return;

  const badge = workspaceSource.type === 'drive' ? '☁️ Drive' : '📂 Local';
  sub.textContent = `${badge}: ${workspaceSource.name}`;
  treeEl.innerHTML = '';

  const rootChildren = workspaceSource.rootNode.children || [];
  if (!rootChildren.length) {
    treeEl.innerHTML = '<div class="sidebar-loading">Empty folder</div>';
    return;
  }
  renderNodes(rootChildren, treeEl, 0);
}

function renderNodes(nodes, container, depth) {
  nodes.forEach(node => {
    const row = document.createElement('div');
    row.className = 'tree-row' + (node.kind === 'directory' && SKIP_DIRS.has(node.name) ? ' tree-dim' : '');
    row.style.paddingLeft = `${10 + depth * 14}px`;
    row.title = node.path;

    if (node.kind === 'directory') {
      row.innerHTML = `<span class="tree-arrow">${node.expanded ? '▾' : '▸'}</span><span class="tree-icon">📁</span><span class="tree-name">${escapeHtml(node.name)}</span>`;
      row.onclick = async () => {
        node.expanded = !node.expanded;
        if (node.expanded && !node.loaded) {
          row.classList.add('tree-loading');
          try {
            if (workspaceSource.type === 'local-handle') await loadHandleChildren(node);
            else if (workspaceSource.type === 'drive') await loadDriveNodeChildren(node);
          } catch (e) {
            ctx.setStatus('Failed to read subfolder: ' + e.message);
          }
        }
        renderSidebarTree();
      };
      container.appendChild(row);
      if (node.expanded && node.children?.length) {
        renderNodes(node.children, container, depth + 1);
      }
    } else {
      row.innerHTML = `<span class="tree-arrow"></span><span class="tree-icon">${getFileIcon(node.name)}</span><span class="tree-name">${escapeHtml(node.name)}</span>`;
      row.onclick = () => openTreeFile(node);
      container.appendChild(row);
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function openTreeFile(node) {
  if (isBinaryFilename(node.name) && !confirm(`"${node.name}" একটি বাইনারি ফাইল হতে পারে। তারপরও টেক্সট হিসেবে খুলতে চান?`)) {
    return;
  }

  if (workspaceSource.type === 'drive') {
    await drive.openDriveFileInTab(node.driveId);
  } else if (workspaceSource.type === 'local-handle') {
    const existing = ctx.getTabs().find(t => t.fileHandle && t.workspacePath === node.path);
    if (existing) {
      ctx.switchTab(existing.id);
    } else {
      const file = await node.handle.getFile();
      if (file.size > 2 * 1024 * 1024 && !confirm(`"${node.name}" ফাইলটি ${(file.size / (1024 * 1024)).toFixed(1)} MB বড়। খুলতে চান?`)) {
        return;
      }
      const content = await file.text();
      ctx.createTab({
        title: node.name,
        content,
        fileHandle: node.handle,
        workspacePath: node.path,
        isDirty: false
      });
      ctx.setStatus(`Opened "${node.path}" ✓`);
    }
  } else if (workspaceSource.type === 'local-files') {
    const existing = ctx.getTabs().find(t => t.workspacePath === node.path);
    if (existing) {
      ctx.switchTab(existing.id);
    } else {
      const content = await node.fileObj.text();
      ctx.createTab({
        title: node.name,
        content,
        workspacePath: node.path,
        isDirty: false
      });
      ctx.setStatus(`Opened "${node.path}" ✓`);
    }
  }

  if (window.innerWidth <= 768) {
    toggleSidebar(false);
  }
}

/* ==================== 4. FOLDER ACTIONS (REFRESH / NEW FILE / OPEN ALL) ==================== */
export async function refreshWorkspaceFolder() {
  if (!workspaceSource) return;
  if (workspaceSource.type === 'local-handle') {
    await loadHandleChildren(workspaceSource.rootNode);
    renderSidebarTree();
    ctx.setStatus(`Refreshed "${workspaceSource.name}" ✓`);
  } else if (workspaceSource.type === 'drive') {
    await loadDriveNodeChildren(workspaceSource.rootNode);
    renderSidebarTree();
    ctx.setStatus(`Refreshed Drive folder "${workspaceSource.name}" ✓`);
  }
}

export async function newFileInWorkspace() {
  if (!workspaceSource) {
    ctx.promptNewTab();
    return;
  }
  const name = prompt(`"${workspaceSource.name}" ফোল্ডারে নতুন ফাইলের নাম দিন:`, 'script.py');
  if (!name || !name.trim()) return;
  const cleanName = name.trim();

  if (workspaceSource.type === 'local-handle') {
    try {
      const handle = await workspaceSource.dirHandle.getFileHandle(cleanName, { create: true });
      ctx.createTab({ title: cleanName, content: '', fileHandle: handle, workspacePath: `${workspaceSource.name}/${cleanName}`, isDirty: false });
      await loadHandleChildren(workspaceSource.rootNode);
      renderSidebarTree();
      ctx.setStatus(`Created "${cleanName}" in folder ✓`);
    } catch (e) {
      alert('ফাইল তৈরি করা যায়নি: ' + e.message);
    }
  } else if (workspaceSource.type === 'drive') {
    ctx.createTab({ title: cleanName, content: '', folderId: workspaceSource.folderId, isDirty: true });
    ctx.setStatus(`New file "${cleanName}" ready — press Ctrl+S to save in "${workspaceSource.name}".`);
  } else {
    ctx.createTab({ title: cleanName, content: '', isDirty: true });
  }
}

export async function openAllInFolder() {
  if (!workspaceSource?.rootNode?.children) {
    alert('আগে একটি Local বা Google Drive ফোল্ডার ওপেন করুন!');
    return;
  }
  const textFiles = workspaceSource.rootNode.children.filter(
    n => n.kind === 'file' && !isBinaryFilename(n.name) && (!n.size || n.size < 1024 * 1024)
  );
  if (!textFiles.length) {
    alert('এই ফোল্ডারে সরাসরি খোলার মতো কোনো টেক্সট/কোড ফাইল পাওয়া যায়নি।');
    return;
  }
  const limit = 25;
  const toOpen = textFiles.slice(0, limit);
  if (textFiles.length > 8 && !confirm(`${toOpen.length}টি ফাইল একসাথে ট্যাবে ওপেন করতে চান?${textFiles.length > limit ? ` (মোট ${textFiles.length}টির প্রথম ${limit}টি)` : ''}`)) {
    return;
  }
  for (const node of toOpen) {
    await openTreeFile(node);
  }
  ctx.setStatus(`Opened ${toOpen.length} file(s) from "${workspaceSource.name}" ✓`);
}

export async function handleDroppedEntry(dataTransferItem) {
  if (typeof dataTransferItem.getAsFileSystemHandle === 'function') {
    try {
      const handle = await dataTransferItem.getAsFileSystemHandle();
      if (handle?.kind === 'directory') {
        await loadLocalDirectoryHandle(handle);
        return true;
      }
    } catch {
      // fallback below
    }
  }
  if (typeof dataTransferItem.webkitGetAsEntry === 'function') {
    const entry = dataTransferItem.webkitGetAsEntry();
    if (entry?.isDirectory) {
      const rootNode = await readWebkitDirectoryEntry(entry, entry.name);
      workspaceSource = { type: 'local-files', name: entry.name, rootNode };
      toggleSidebar(true);
      renderSidebarTree();
      ctx.setStatus(`Opened dropped folder "${entry.name}" ✓`);
      return true;
    }
  }
  return false;
}

async function readWebkitDirectoryEntry(dirEntry, path) {
  const node = { kind: 'directory', name: dirEntry.name, path, expanded: path === dirEntry.name, loaded: true, children: [] };
  if (SKIP_DIRS.has(dirEntry.name)) return node;

  const reader = dirEntry.createReader();
  const entries = await new Promise((resolve) => {
    const all = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) resolve(all);
        else { all.push(...batch); readBatch(); }
      }, () => resolve(all));
    };
    readBatch();
  });

  for (const ent of entries) {
    if (ent.isDirectory) {
      node.children.push(await readWebkitDirectoryEntry(ent, `${path}/${ent.name}`));
    } else if (ent.isFile) {
      const fileObj = await new Promise((res) => ent.file(res, () => res(null)));
      if (fileObj) {
        node.children.push({ kind: 'file', name: ent.name, path: `${path}/${ent.name}`, fileObj });
      }
    }
  }
  sortTreeRecursive(node);
  return node;
}
