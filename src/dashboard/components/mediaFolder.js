// Lets images/video load from a local "downloads" directory (one subfolder
// per account, matching authorHandle, containing media files with their
// original filenames) instead of hitting the network.

import { state, MEDIA_DB_NAME, MEDIA_DB_STORE, MEDIA_HANDLE_KEY } from '@components/state.js';
import { totalCount } from '@components/dom.js';
import { updateUI } from '@components/tweets.js';

let mediaFolderBtn = null;
let mediaFolderClearBtn = null;

export function createMediaFolderButton() {
    if (mediaFolderBtn || !totalCount.parentElement) return;
    mediaFolderBtn = document.createElement('button');
    mediaFolderBtn.id = 'media-folder-btn';
    mediaFolderBtn.className = 'icon-btn';
    mediaFolderBtn.textContent = 'Choose Media Folder';
    mediaFolderBtn.addEventListener('click', chooseMediaFolder);
    totalCount.parentElement.appendChild(mediaFolderBtn);

    mediaFolderClearBtn = document.createElement('button');
    mediaFolderClearBtn.id = 'media-folder-clear-btn';
    mediaFolderClearBtn.className = 'icon-btn';
    mediaFolderClearBtn.title = 'Stop using the local media folder and load media from the network instead';
    const clearIcon = document.createElement('i');
    clearIcon.className = 'bi bi-x-circle';
    mediaFolderClearBtn.appendChild(clearIcon);
    mediaFolderClearBtn.appendChild(document.createTextNode(' Cancel Media Folder'));
    mediaFolderClearBtn.style.display = 'none'; // only shown once a folder is set
    mediaFolderClearBtn.addEventListener('click', clearMediaFolder);
    totalCount.parentElement.appendChild(mediaFolderClearBtn);
}

function updateMediaFolderButton() {
    if (!mediaFolderBtn) return;
    if (!state.mediaRootHandle) {
        mediaFolderBtn.textContent = 'Choose Media Folder';
    } else if (!state.mediaPermissionGranted) {
        mediaFolderBtn.textContent = 'Restore Media Folder Access';
    } else {
        mediaFolderBtn.textContent = 'Change Media Folder';
    }
    if (mediaFolderClearBtn) {
        mediaFolderClearBtn.style.display = state.mediaRootHandle ? '' : 'none';
    }
}

// Forgets the chosen media folder entirely (not just permission) and falls
// back to loading all media from the network again.
export async function clearMediaFolder() {
    state.mediaRootHandle = null;
    state.mediaPermissionGranted = false;
    state.mediaSubdirCache.clear();
    try {
        const db2 = await openMediaDb();
        await new Promise((resolve, reject) => {
            const tx = db2.transaction(MEDIA_DB_STORE, 'readwrite');
            tx.objectStore(MEDIA_DB_STORE).delete(MEDIA_HANDLE_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error('Failed to clear stored media folder handle:', err);
    }
    updateMediaFolderButton();
    updateUI();
}

function openMediaDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(MEDIA_DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(MEDIA_DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveMediaRootHandle(handle) {
    const db2 = await openMediaDb();
    await new Promise((resolve, reject) => {
        const tx = db2.transaction(MEDIA_DB_STORE, 'readwrite');
        tx.objectStore(MEDIA_DB_STORE).put(handle, MEDIA_HANDLE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function loadMediaRootHandle() {
    const db2 = await openMediaDb();
    return new Promise((resolve, reject) => {
        const tx = db2.transaction(MEDIA_DB_STORE, 'readonly');
        const req = tx.objectStore(MEDIA_DB_STORE).get(MEDIA_HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

// queryPermission works anytime; requestPermission needs an active user
// gesture (e.g. inside a click handler), or the browser will just deny it.
async function ensureMediaPermission(handle) {
    if (!handle) return false;
    const opts = { mode: 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    try {
        return (await handle.requestPermission(opts)) === 'granted';
    } catch {
        return false;
    }
}

export async function initMediaFolder() {
    if (!window.showDirectoryPicker) {
        if (mediaFolderBtn) {
            mediaFolderBtn.disabled = true;
            mediaFolderBtn.title = 'Local folder access isn\'t supported in this browser';
        }
        return;
    }
    try {
        const stored = await loadMediaRootHandle();
        if (stored) {
            state.mediaRootHandle = stored;
            state.mediaPermissionGranted = (await stored.queryPermission({ mode: 'read' })) === 'granted';
        }
    } catch (err) {
        console.error('Could not restore media folder handle:', err);
    }
    updateMediaFolderButton();
}

async function chooseMediaFolder() {
    try {
        // If we have a remembered handle but lost permission (typical after a
        // browser restart), just re-confirm access to the SAME folder — no picker.
        if (state.mediaRootHandle && !state.mediaPermissionGranted) {
            const granted = await ensureMediaPermission(state.mediaRootHandle);
            state.mediaPermissionGranted = granted;
            if (granted) {
                state.mediaSubdirCache.clear();
                updateMediaFolderButton();
                updateUI();
            }
            return;
        }

        // No handle yet, or permission is already fine and the user explicitly
        // clicked "Change Media Folder" — always show the picker in this case.
        const handle = await window.showDirectoryPicker();
        state.mediaRootHandle = handle;
        state.mediaPermissionGranted = true; // showDirectoryPicker grants permission on selection
        state.mediaSubdirCache.clear();
        await saveMediaRootHandle(handle);
        updateMediaFolderButton();
        updateUI();
    } catch (err) {
        if (err.name !== 'AbortError') console.error('Media folder selection failed:', err);
    }
}

// Resolve a specific media item's file on disk. Returns a File, or null if
// it can't be found locally (caller should fall back to the remote URL).
// `mediaUrl` is an individual item's url (tweet.media[i].url), not the
// whole tweet, since a tweet can now have several media files.
export async function resolveLocalMediaFile(tweet, mediaUrl) {
    if (!state.mediaRootHandle || !mediaUrl || !tweet.authorHandle) return null;
    if (!(await ensureMediaPermission(state.mediaRootHandle))) return null;

    let subDir = state.mediaSubdirCache.get(tweet.authorHandle);
    if (subDir === undefined) {
        try {
            subDir = await state.mediaRootHandle.getDirectoryHandle(tweet.authorHandle);
        } catch {
            subDir = null; // no folder for this account
        }
        state.mediaSubdirCache.set(tweet.authorHandle, subDir);
    }
    if (!subDir) return null;

    let filename;
    try {
        filename = decodeURIComponent(new URL(mediaUrl).pathname.split('/').pop());
    } catch {
        return null;
    }

    try {
        const fileHandle = await subDir.getFileHandle(filename);
        return await fileHandle.getFile();
    } catch {
        return null; // file not present locally
    }
}

// Best-effort lookup for an actual playable video/gif file in the local
// media folder, for a video/gif media item whose `url` is only a poster
// thumbnail (the real video source can't be recovered from the DOM — see
// parseTweet.js). This can't know the real filename your downloader used,
// so it guesses: same basename as the poster image, common video
// extensions. If your local files are named differently, this simply
// won't find a match and the poster + "open on X to watch" fallback is
// used instead.
const LOCAL_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'gif'];

export async function resolveLocalVideoFile(tweet, posterUrl) {
    if (!state.mediaRootHandle || !posterUrl || !tweet.authorHandle) return null;
    if (!(await ensureMediaPermission(state.mediaRootHandle))) return null;

    let subDir = state.mediaSubdirCache.get(tweet.authorHandle);
    if (subDir === undefined) {
        try {
            subDir = await state.mediaRootHandle.getDirectoryHandle(tweet.authorHandle);
        } catch {
            subDir = null;
        }
        state.mediaSubdirCache.set(tweet.authorHandle, subDir);
    }
    if (!subDir) return null;

    let baseName;
    try {
        const posterFilename = decodeURIComponent(new URL(posterUrl).pathname.split('/').pop());
        baseName = posterFilename.replace(/\.[a-zA-Z0-9]+$/, ''); // strip extension
    } catch {
        return null;
    }
    if (!baseName) return null;

    for (const ext of LOCAL_VIDEO_EXTENSIONS) {
        try {
            const fileHandle = await subDir.getFileHandle(`${baseName}.${ext}`);
            return await fileHandle.getFile();
        } catch {
            // try the next extension
        }
    }
    return null;
}
