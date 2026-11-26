const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install';

let tokenClient = null;
let accessToken = null;
let folderStack = [{ id: 'root', name: 'My Drive' }];
let pendingDriveBrowser = false;
let callbacks = {};

export function initDrive(cb, initialFileId = null) {
  callbacks = cb;
  if (typeof google === 'undefined') return;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (res) => {
      if (res && res.access_token) {
        accessToken = res.access_token;
        document.getElementById('authBtn').textContent = 'Drive ✓';
        callbacks.setStatus('Google Drive Connected ✓');
        if (initialFileId) openDriveFileInTab(initialFileId);
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
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const meta = await metaRes.json();

    const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const text = await contentRes.text();

    callbacks.createTab({
      title: meta.name || 'Untitled.txt',
      content: text,
      fileId: fileId,
      mimeType: meta.mimeType || 'text/plain',
      isDirty: false
    });
    callbacks.setStatus(`Loaded "${meta.name}" ✓`);
  } catch (err) {
    callbacks.setStatus('Error loading Drive file');
  }
}

export async function saveTabToDrive(tab, isAuto = false) {
  if (!accessToken) return false;
  const content = tab.doc.getValue();

  if (tab.fileId) {
    callbacks.setStatus(isAuto ? 'Auto-saving...' : 'Saving to Drive...');
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${tab.fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': tab.mimeType },
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

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
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
  return false;
}

export function renameDriveFile(fileId, newTitle) {
  if (!accessToken || !fileId) return;
  fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newTitle })
  }).then(() => callbacks.setStatus(`Renamed to "${newTitle}"`));
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

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=folder,name&fields=files(id,name,mimeType)&pageSize=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();

  listEl.innerHTML = '';
  (data.files || []).forEach(f => {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    const row = document.createElement('div');
    row.className = 'file-row';
    row.textContent = `${isFolder ? '📁' : '📄'} ${f.name}`;
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
