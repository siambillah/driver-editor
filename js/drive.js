const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install';

let tokenClient = null;
let accessToken = null;
let folderStack = [{ id: 'root', name: 'My Drive' }];
let pendingDriveBrowser = false;
let pendingInitialState = null;
let handledCreateAction = false;
let callbacks = {};

async function driveFetch(url, options = {}) {
  if (!accessToken) throw new Error('Not connected to Google Drive');
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` };
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    accessToken = null;
    const authBtn = document.getElementById('authBtn');
    if (authBtn) authBtn.textContent = 'Reconnect Drive';
    callbacks.setStatus?.('Drive session expired — please reconnect.');
    alert('Google Drive সেশন এক্সপায়ার হয়েছে। অনুগ্রহ করে আবার "Reconnect Drive" বাটনে ক্লিক করুন।');
    throw new Error('Drive token expired (401)');
  }
  return res;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const n = Number(bytes);
  if (Number.isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function initDrive(cb, initialState = null) {
  callbacks = cb;
  if (initialState && !pendingInitialState) pendingInitialState = initialState;

  // Handle Google Drive "+ New" create action once even before auth
  if (!handledCreateAction && initialState?.action === 'create' && initialState.folderId) {
    handledCreateAction = true;
    callbacks.createTab({
      title: 'untitled.txt',
      content: '',
      folderId: initialState.folderId,
      isDirty: true
    });
    callbacks.setStatus('New Drive file ready — connect Drive & press Ctrl+S to save in folder.');
  }

  if (tokenClient || typeof google === 'undefined') return;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (res) => {
      if (res && res.access_token) {
        accessToken = res.access_token;
        document.getElementById('authBtn').textContent = 'Drive ✓';
        callbacks.setStatus('Google Drive Connected ✓');

        if (pendingInitialState?.ids?.length) {
          const ids = [...pendingInitialState.ids];
          pendingInitialState = null;
          for (const id of ids) {
            await openDriveFileInTab(id);
          }
        }
        if (pendingDriveBrowser) {
          pendingDriveBrowser = false;
          openDriveBrowser();
        }
      }
    }
  });
}

export function isDriveConnected() {
  return Boolean(accessToken);
}

export function handleAuth() {
  if (CLIENT_ID.startsWith('YOUR_GOOGLE')) {
    alert('আগে js/drive.js ফাইলের CLIENT_ID ভেরিয়েবলে আপনার Google Client ID বসান!');
    return;
  }
  if (!tokenClient && typeof google !== 'undefined') {
    initDrive(callbacks, pendingInitialState);
  }
  if (!tokenClient) {
    alert('Google Identity Services লোড হয়নি। ইন্টারনেট সংযোগ চেক করে পেজ রিফ্রেশ করুন।');
    return;
  }
  tokenClient.requestAccessToken({ prompt: '' });
}

export async function openDriveFileInTab(fileId) {
  const existing = callbacks.getTabs().find(t => t.fileId === fileId);
  if (existing) {
    callbacks.switchTab(existing.id);
    return;
  }

  callbacks.setStatus('Loading from Google Drive...');
  try {
    const metaRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,parents`);
    const meta = await metaRes.json();

    const contentRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const text = await contentRes.text();

    callbacks.createTab({
      title: meta.name || 'Untitled.txt',
      content: text,
      fileId: fileId,
      folderId: meta.parents?.[0] || null,
      mimeType: meta.mimeType || 'text/plain',
      isDirty: false
    });
    callbacks.setStatus(`Loaded "${meta.name}" ✓`);
  } catch (err) {
    callbacks.setStatus('Error loading Drive file');
  }
}

export async function reloadDriveTab(tab) {
  if (!tab?.fileId) return;
  if (!accessToken) {
    handleAuth();
    return;
  }
  if (tab.isDirty && !confirm(`"${tab.title}"-এ আনসেভড পরিবর্তন আছে। Drive থেকে রিলোড করলে তা মুছে যাবে। এগিয়ে যাবেন?`)) {
    return;
  }
  callbacks.setStatus(`Reloading "${tab.title}" from Drive...`);
  try {
    const contentRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${tab.fileId}?alt=media`);
    const text = await contentRes.text();
    tab.doc.setValue(text);
    tab.isDirty = false;
    callbacks.onTabSaved();
    callbacks.setStatus(`Reloaded "${tab.title}" from Drive ✓`);
  } catch {
    callbacks.setStatus('Failed to reload from Drive');
  }
}

export async function saveTabToDrive(tab, isAuto = false) {
  if (!accessToken) return false;
  const content = tab.doc.getValue();

  try {
    if (tab.fileId) {
      callbacks.setStatus(isAuto ? 'Auto-saving...' : 'Saving to Drive...');
      const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${tab.fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': tab.mimeType },
        body: content
      });
      if (res.ok) {
        tab.isDirty = false;
        callbacks.onTabSaved();
        callbacks.setStatus(isAuto ? 'Auto-saved ✓' : `Saved "${tab.title}" ✓`);
        return true;
      }
      return false;
    }

    // Create new file on Drive
    callbacks.setStatus(`Uploading "${tab.title}"...`);
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";
    const metadata = { name: tab.title, mimeType: tab.mimeType };
    if (tab.folderId && tab.folderId !== 'root') metadata.parents = [tab.folderId];

    const body =
      delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
      delimiter + 'Content-Type: ' + tab.mimeType + '\r\n\r\n' + content + close_delim;

    const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body: body
    });
    const data = await res.json();
    if (data.id) {
      tab.fileId = data.id;
      tab.isDirty = false;
      callbacks.onTabSaved();
      callbacks.setStatus(`Created & Saved "${tab.title}" ✓`);
      return true;
    }
  } catch {
    callbacks.setStatus('Drive save failed');
  }
  return false;
}

export function renameDriveFile(fileId, newTitle) {
  if (!accessToken || !fileId) return;
  driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newTitle })
  })
    .then(() => callbacks.setStatus(`Renamed to "${newTitle}" ✓`))
    .catch(() => callbacks.setStatus('Drive rename failed'));
}

export function openDriveBrowser() {
  if (!accessToken) {
    pendingDriveBrowser = true;
    handleAuth();
    return;
  }
  document.getElementById('driveModal').style.display = 'flex';
  folderStack = [{ id: 'root', name: 'My Drive' }];
  loadDriveFolder('root');
}

export function closeDriveBrowser() {
  document.getElementById('driveModal').style.display = 'none';
}

export async function createDriveFolder() {
  if (!accessToken) return;
  const name = prompt('নতুন ফোল্ডারের নাম দিন:');
  if (!name || !name.trim()) return;
  const currentFolder = folderStack[folderStack.length - 1];
  const metadata = {
    name: name.trim(),
    mimeType: 'application/vnd.google-apps.folder',
    ...(currentFolder.id !== 'root' ? { parents: [currentFolder.id] } : {})
  };
  try {
    await driveFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    callbacks.setStatus(`Created folder "${name.trim()}" ✓`);
    loadDriveFolder(currentFolder.id);
  } catch {
    callbacks.setStatus('Failed to create folder');
  }
}

export async function deleteDriveFile(fileId, name, e) {
  if (e) e.stopPropagation();
  if (!confirm(`"${name}" ট্র্যাশে পাঠাতে চান?`)) return;
  try {
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
    callbacks.setStatus(`Moved "${name}" to Trash`);
    loadDriveFolder(folderStack[folderStack.length - 1].id);
  } catch {
    callbacks.setStatus('Failed to delete file');
  }
}

export async function listDriveFolderItems(folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=folder,name&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files || [];
}

export function getCurrentDriveFolder() {
  return folderStack[folderStack.length - 1] || { id: 'root', name: 'My Drive' };
}

export async function loadDriveFolder(folderId, searchQuery = null) {
  const listEl = document.getElementById('driveFileList');
  listEl.innerHTML = 'Loading...';
  const bc = document.getElementById('driveBreadcrumb');
  bc.innerHTML = folderStack.map((f, i) => `<span data-idx="${i}">${f.name}</span>`).join(' / ');
  bc.querySelectorAll('span').forEach(el => {
    el.onclick = () => {
      const idx = Number(el.dataset.idx);
      folderStack = folderStack.slice(0, idx + 1);
      loadDriveFolder(folderStack[idx].id);
    };
  });

  const q = searchQuery
    ? `name contains '${searchQuery.replace(/'/g, "\\'")}' and trashed = false`
    : `'${folderId}' in parents and trashed = false`;

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=folder,name&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=80`;
  try {
    const res = await driveFetch(url);
    const data = await res.json();

    listEl.innerHTML = '';
    if (!data.files?.length) {
      listEl.innerHTML = '<div style="padding:16px; color:var(--text-muted); text-align:center;">No files found in this folder.</div>';
      return;
    }

    data.files.forEach(f => {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      const row = document.createElement('div');
      row.className = 'file-row';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${isFolder ? '📁' : '📄'} ${f.name}`;
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.style.whiteSpace = 'nowrap';

      const meta = document.createElement('div');
      meta.className = 'file-meta';
      const sizeStr = isFolder ? '' : formatSize(f.size);
      const dateStr = formatDate(f.modifiedTime);
      meta.innerHTML = `<span>${sizeStr}</span><span>${dateStr}</span>`;

      if (isFolder) {
        const openFolderBtn = document.createElement('button');
        openFolderBtn.textContent = 'Open';
        openFolderBtn.title = 'Open entire folder in Explorer sidebar';
        openFolderBtn.style.padding = '2px 7px';
        openFolderBtn.onclick = (e) => {
          e.stopPropagation();
          closeDriveBrowser();
          callbacks.onOpenDriveFolder?.(f.id, f.name);
        };
        meta.appendChild(openFolderBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑️';
      delBtn.title = 'Move to Trash';
      delBtn.style.padding = '2px 5px';
      delBtn.onclick = (e) => deleteDriveFile(f.id, f.name, e);
      meta.appendChild(delBtn);

      row.appendChild(nameSpan);
      row.appendChild(meta);

      row.onclick = () => {
        if (isFolder) {
          folderStack.push({ id: f.id, name: f.name });
          loadDriveFolder(f.id);
        } else {
          closeDriveBrowser();
          openDriveFileInTab(f.id);
        }
      };
      listEl.appendChild(row);
    });
  } catch {
    listEl.innerHTML = '<div style="padding:16px; color:#e53e3e;">Error loading Drive files.</div>';
  }
}

export function searchDriveFiles() {
  const q = document.getElementById('driveSearchInput').value.trim();
  loadDriveFolder('root', q || null);
}

export function openDriveByIdFallback() {
  const id = prompt('Google Drive File ID দিন:');
  if (id && id.trim()) {
    closeDriveBrowser();
    openDriveFileInTab(id.trim());
  }
}

export function saveNewFileToCurrentDriveFolder() {
  const tab = callbacks.getActiveTab();
  if (!tab) return;
  tab.folderId = folderStack[folderStack.length - 1].id;
  tab.fileId = null;
  closeDriveBrowser();
  saveTabToDrive(tab);
}
