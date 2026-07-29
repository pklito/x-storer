import { db } from '../utils/db.js';

// State
let allTweets = [];
let selectedTags = new Set();   // tags included via normal click
let excludedTags = new Set();   // tags excluded via shift-click
let searchTerm = '';
let currentEditTweetId = null;

// Tag Groups (categorization)
const TAG_GROUPS_KEY = 'xbookmarks_tag_groups_v1';
let tagGroups = ['Uncategorized'];     // ordered list of group names; 'Uncategorized' is implicit/default
let tagGroupAssignments = {};          // tag -> groupName (absent = Uncategorized)
let collapsedGroups = new Set();       // group names currently collapsed in the sidebar

// Search Tabs (saved filter combinations)
const SEARCH_TABS_KEY = 'xbookmarks_search_tabs_v1';
let searchTabs = [{ id: 'default', name: 'All', selectedTags: [], excludedTags: [] }];
let activeTabId = 'default';

// New State for Tag Editor
let currentQuoteTags = []; // Stores tags being edited in modal as Array of Strings

// Batched async grid rendering (avoid building 5000 cards in one blocking pass)
const RENDER_BATCH_SIZE = 100;
let filteredTweetsCache = [];
let renderedCount = 0;
let masonryColumns = [];
let renderToken = 0; // bumped every time a new render starts, so stale in-flight batches bail out

// Local media folder access (load images from disk instead of the network)
const MEDIA_DB_NAME = 'media-folder-store';
const MEDIA_DB_STORE = 'handles';
const MEDIA_HANDLE_KEY = 'mediaRoot';
let mediaRootHandle = null;       // FileSystemDirectoryHandle for the chosen root folder
let mediaPermissionGranted = false; // whether we currently have read access to mediaRootHandle
let mediaSubdirCache = new Map(); // authorHandle -> FileSystemDirectoryHandle | null
let activeObjectUrls = [];        // object URLs created for the current render, revoked on next render
let mediaFolderBtn = null;
let mediaFolderClearBtn = null;

// Mass tagging mode: pick a set of tags once, then click tweets to
// toggle that whole set on/off per tweet without opening the tag editor.
let massTagModeActive = false;
let massTagSelectedTags = [];
let massTagBtn = null;
let massTagStatusBar = null;
let massTagSelectModal = null; // built lazily on first open

const tweetsGrid = document.getElementById('tweets-grid');
const feedTitle = document.getElementById('feed-title');
const tagList = document.getElementById('tag-list');
const tagModal = document.getElementById('tag-modal');
const tagInput = document.getElementById('tag-input-field');
const tagEditorContainer = document.getElementById('tag-editor-container');
const totalCount = document.getElementById('total-count');
const searchInput = document.getElementById('search-input');
const suggestionsBox = document.getElementById('tag-suggestions');
const clearTagsBtn = document.getElementById('clear-tags-btn');
const configureTagsBtn = document.getElementById('configure-tags-btn');
const tagGroupsModal = document.getElementById('tag-groups-modal');
const newGroupInput = document.getElementById('new-group-input');
const addGroupBtn = document.getElementById('add-group-btn');
const groupManageList = document.getElementById('group-manage-list');
const tagAssignList = document.getElementById('tag-assign-list');
const closeGroupsModalBtn = document.getElementById('close-groups-modal');
const searchTabsEl = document.getElementById('search-tabs');
const addTabBtn = document.getElementById('add-tab-btn');

document.addEventListener('DOMContentLoaded', async () => {
    loadTagGroupState();
    loadSearchTabsState();
    applyActiveTabSilently();
    await loadData();
    setupEventListeners();
    renderSearchTabs();
    createMediaFolderButton();
    await initMediaFolder();
    createMassTagButton();
    createImportButton();
});


async function loadData() {
    try {
        allTweets = await db.getTweets();
        updateUI();
    } catch (err) {
        console.error('Failed to load tweets:', err);
    }
}

// 'video', 'gif', and 'text-only' are computed from a tweet's actual media
// on the fly — never written to tweet.tags / the DB. They live in their
// own 'Built-in' sidebar section but still work with select/exclude
// filtering exactly like a normal tag (see getEffectiveTags below).
const BUILT_IN_TAG_NAMES = ['video', 'gif', 'text-only'];

function getBuiltInTagsForTweet(tweet) {
    const media = (tweet.media && tweet.media.length)
        ? tweet.media
        : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);

    const tags = [];
    if (media.some(m => m.type === 'video')) tags.push('video');
    if (media.some(m => m.type === 'gif')) tags.push('gif');
    if (media.length === 0) tags.push('text-only');
    return tags;
}

// Stored tags + computed built-in tags, for filtering/search purposes only.
function getEffectiveTags(tweet) {
    return (tweet.tags || []).concat(getBuiltInTagsForTweet(tweet));
}

// --- Tag Groups (categorization) ---

function loadTagGroupState() {
    try {
        const raw = localStorage.getItem(TAG_GROUPS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.groups) && data.groups.length) tagGroups = data.groups;
            if (data.assignments) tagGroupAssignments = data.assignments;
            if (Array.isArray(data.collapsed)) collapsedGroups = new Set(data.collapsed);
        }
    } catch (err) {
        console.error('Failed to load tag group settings:', err);
    }
    if (!tagGroups.includes('Uncategorized')) tagGroups.push('Uncategorized');
}

function saveTagGroupState() {
    try {
        localStorage.setItem(TAG_GROUPS_KEY, JSON.stringify({
            groups: tagGroups,
            assignments: tagGroupAssignments,
            collapsed: Array.from(collapsedGroups)
        }));
    } catch (err) {
        console.error('Failed to save tag group settings:', err);
    }
}

function tagGroupOf(tag) {
    return tagGroupAssignments[tag] || 'Uncategorized';
}

function getAllTagNames() {
    const set = new Set();
    allTweets.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
    return Array.from(set).sort();
}

function addTagGroup(name) {
    const clean = name.trim();
    if (!clean) return;
    const exists = tagGroups.some(g => g.toLowerCase() === clean.toLowerCase());
    if (exists) return;
    // Keep 'Uncategorized' at the end so custom groups list first
    tagGroups = tagGroups.filter(g => g !== 'Uncategorized').concat(clean, 'Uncategorized');
    saveTagGroupState();
    renderGroupManageList();
    renderTagAssignList();
    renderTagsSidebar();
}

function deleteTagGroup(group) {
    if (group === 'Uncategorized') return;
    tagGroups = tagGroups.filter(g => g !== group);
    Object.keys(tagGroupAssignments).forEach(tag => {
        if (tagGroupAssignments[tag] === group) delete tagGroupAssignments[tag];
    });
    collapsedGroups.delete(group);
    saveTagGroupState();
    renderGroupManageList();
    renderTagAssignList();
    renderTagsSidebar();
}

function setTagGroup(tag, group) {
    if (group === 'Uncategorized') {
        delete tagGroupAssignments[tag];
    } else {
        tagGroupAssignments[tag] = group;
    }
    saveTagGroupState();
    renderTagsSidebar();
}

function openTagGroupsModal() {
    renderGroupManageList();
    renderTagAssignList();
    tagGroupsModal.classList.add('active');
}

function closeTagGroupsModal() {
    tagGroupsModal.classList.remove('active');
}

function renderGroupManageList() {
    groupManageList.replaceChildren();
    const customGroups = tagGroups.filter(g => g !== 'Uncategorized');

    if (customGroups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'group-manage-empty';
        empty.textContent = 'No custom groups yet — add one above.';
        groupManageList.appendChild(empty);
        return;
    }

    customGroups.forEach(group => {
        const row = document.createElement('div');
        row.className = 'group-manage-row';

        const name = document.createElement('span');
        name.textContent = group;
        row.appendChild(name);

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn danger';
        delBtn.title = 'Delete group (tags return to Uncategorized)';
        const icon = document.createElement('i');
        icon.className = 'bi bi-trash3';
        delBtn.appendChild(icon);
        delBtn.addEventListener('click', () => deleteTagGroup(group));
        row.appendChild(delBtn);

        groupManageList.appendChild(row);
    });
}

function renderTagAssignList() {
    tagAssignList.replaceChildren();
    const tags = getAllTagNames();

    if (tags.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'group-manage-empty';
        empty.textContent = 'No tags yet.';
        tagAssignList.appendChild(empty);
        return;
    }

    tags.forEach(tag => {
        const row = document.createElement('div');
        row.className = 'tag-assign-row';

        const label = document.createElement('span');
        label.textContent = '#' + tag;
        row.appendChild(label);

        const select = document.createElement('select');
        select.className = 'group-select';
        const currentGroup = tagGroupOf(tag);
        tagGroups.forEach(group => {
            const opt = document.createElement('option');
            opt.value = group;
            opt.textContent = group;
            if (group === currentGroup) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', () => setTagGroup(tag, select.value));
        row.appendChild(select);

        tagAssignList.appendChild(row);
    });
}

// --- End Tag Groups ---

// --- Search Tabs (saved filter combinations) ---

function loadSearchTabsState() {
    try {
        const raw = localStorage.getItem(SEARCH_TABS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.tabs) && data.tabs.length) searchTabs = data.tabs;
            if (data.activeTabId) activeTabId = data.activeTabId;
        }
    } catch (err) {
        console.error('Failed to load search tabs:', err);
    }
    if (!searchTabs.some(t => t.id === 'default')) {
        searchTabs.unshift({ id: 'default', name: 'All', selectedTags: [], excludedTags: [] });
    }
}

function saveSearchTabsState() {
    try {
        localStorage.setItem(SEARCH_TABS_KEY, JSON.stringify({ tabs: searchTabs, activeTabId }));
    } catch (err) {
        console.error('Failed to save search tabs:', err);
    }
}

// Restores the active tab's filters into state WITHOUT re-rendering (tweets
// haven't loaded yet at startup) — the first updateUI() call picks it up.
function applyActiveTabSilently() {
    const tab = searchTabs.find(t => t.id === activeTabId) || searchTabs[0];
    selectedTags = new Set(tab.selectedTags || []);
    excludedTags = new Set(tab.excludedTags || []);
    activeTabId = tab.id;
}

function applySearchTab(id) {
    const tab = searchTabs.find(t => t.id === id);
    if (!tab) return;
    activeTabId = id;
    selectedTags = new Set(tab.selectedTags || []);
    excludedTags = new Set(tab.excludedTags || []);
    saveSearchTabsState();
    updateUI();
    renderSearchTabs();
}

function addSearchTab() {
    const name = prompt('Name this search tab:', `Search ${searchTabs.length}`);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const tab = {
        id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        name: trimmed,
        selectedTags: Array.from(selectedTags),
        excludedTags: Array.from(excludedTags)
    };
    searchTabs.push(tab);
    activeTabId = tab.id;
    saveSearchTabsState();
    renderSearchTabs();
}

function deleteSearchTab(id) {
    if (id === 'default') return;
    searchTabs = searchTabs.filter(t => t.id !== id);
    if (activeTabId === id) {
        activeTabId = 'default';
        selectedTags = new Set();
        excludedTags = new Set();
        updateUI();
    }
    saveSearchTabsState();
    renderSearchTabs();
}

function renderSearchTabs() {
    if (!searchTabsEl) return;
    searchTabsEl.querySelectorAll('.search-tab').forEach(el => el.remove());

    searchTabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'search-tab' + (tab.id === activeTabId ? ' active' : '');

        const label = document.createTextNode(tab.name);
        btn.appendChild(label);

        if (tab.id !== 'default') {
            const closeBtn = document.createElement('span');
            closeBtn.className = 'search-tab-close';
            const icon = document.createElement('i');
            icon.className = 'bi bi-x';
            closeBtn.appendChild(icon);
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSearchTab(tab.id);
            });
            btn.appendChild(closeBtn);
        }

        btn.addEventListener('click', () => applySearchTab(tab.id));
        searchTabsEl.insertBefore(btn, addTabBtn);
    });
}

// --- End Search Tabs ---

// --- Local Media Folder Access ---
// Lets images load from a local "downloads" directory (one subfolder per
// account, matching authorHandle, containing media files with their
// original filenames) instead of hitting the network.

function createMediaFolderButton() {
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
    if (!mediaRootHandle) {
        mediaFolderBtn.textContent = 'Choose Media Folder';
    } else if (!mediaPermissionGranted) {
        mediaFolderBtn.textContent = 'Restore Media Folder Access';
    } else {
        mediaFolderBtn.textContent = 'Change Media Folder';
    }
    if (mediaFolderClearBtn) {
        mediaFolderClearBtn.style.display = mediaRootHandle ? '' : 'none';
    }
}

// Forgets the chosen media folder entirely (not just permission) and falls
// back to loading all media from the network again.
async function clearMediaFolder() {
    mediaRootHandle = null;
    mediaPermissionGranted = false;
    mediaSubdirCache.clear();
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

async function initMediaFolder() {
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
            mediaRootHandle = stored;
            mediaPermissionGranted = (await stored.queryPermission({ mode: 'read' })) === 'granted';
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
        if (mediaRootHandle && !mediaPermissionGranted) {
            const granted = await ensureMediaPermission(mediaRootHandle);
            mediaPermissionGranted = granted;
            if (granted) {
                mediaSubdirCache.clear();
                updateMediaFolderButton();
                updateUI();
            }
            return;
        }

        // No handle yet, or permission is already fine and the user explicitly
        // clicked "Change Media Folder" — always show the picker in this case.
        const handle = await window.showDirectoryPicker();
        mediaRootHandle = handle;
        mediaPermissionGranted = true; // showDirectoryPicker grants permission on selection
        mediaSubdirCache.clear();
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
async function resolveLocalMediaFile(tweet, mediaUrl) {
    if (!mediaRootHandle || !mediaUrl || !tweet.authorHandle) return null;
    if (!(await ensureMediaPermission(mediaRootHandle))) return null;

    let subDir = mediaSubdirCache.get(tweet.authorHandle);
    if (subDir === undefined) {
        try {
            subDir = await mediaRootHandle.getDirectoryHandle(tweet.authorHandle);
        } catch {
            subDir = null; // no folder for this account
        }
        mediaSubdirCache.set(tweet.authorHandle, subDir);
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
// --- End Local Media Folder Access ---

// Best-effort lookup for an actual playable video/gif file in the local
// media folder, for a video/gif media item whose `url` is only a poster
// thumbnail (the real video source can't be recovered from the DOM — see
// parseTweet.js). This can't know the real filename your downloader used,
// so it guesses: same basename as the poster image, common video
// extensions. If your local files are named differently, this simply
// won't find a match and the poster + "open on X to watch" fallback is
// used instead.
const LOCAL_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'gif'];

async function resolveLocalVideoFile(tweet, posterUrl) {
    if (!mediaRootHandle || !posterUrl || !tweet.authorHandle) return null;
    if (!(await ensureMediaPermission(mediaRootHandle))) return null;

    let subDir = mediaSubdirCache.get(tweet.authorHandle);
    if (subDir === undefined) {
        try {
            subDir = await mediaRootHandle.getDirectoryHandle(tweet.authorHandle);
        } catch {
            subDir = null;
        }
        mediaSubdirCache.set(tweet.authorHandle, subDir);
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

// --- Mass Tagging Mode ---
// Pick a set of tags once in a small selection window, then click tweets
// (anywhere on the card) to toggle that whole tag set on/off for each one,
// without opening the per-tweet tag editor each time.

function createMassTagButton() {
    if (massTagBtn || !totalCount.parentElement) return;
    massTagBtn = document.createElement('button');
    massTagBtn.id = 'mass-tag-btn';
    massTagBtn.className = 'icon-btn';
    massTagBtn.title = 'Pick tags, then click tweets to apply/remove them in bulk';
    const icon = document.createElement('i');
    icon.className = 'bi bi-tags';
    massTagBtn.appendChild(icon);
    massTagBtn.appendChild(document.createTextNode(' Mass Tag'));
    massTagBtn.addEventListener('click', () => {
        if (massTagModeActive) {
            endMassTagMode();
        } else {
            openMassTagSelectModal();
        }
    });
    totalCount.parentElement.appendChild(massTagBtn);
}

// Builds (once) and shows the tag-selection window used to choose which
// tags mass tagging mode will apply.
function openMassTagSelectModal() {
    if (!massTagSelectModal) {
        massTagSelectModal = buildMassTagSelectModal();
        document.body.appendChild(massTagSelectModal.overlay);
    }
    massTagSelectModal.refresh();
    massTagSelectModal.overlay.style.display = 'flex';
}

function closeMassTagSelectModal() {
    if (massTagSelectModal) massTagSelectModal.overlay.style.display = 'none';
}

function buildMassTagSelectModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.55);' +
        'align-items:center;justify-content:center;';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMassTagSelectModal(); });

    const box = document.createElement('div');
    box.style.cssText = 'background:#192734;color:#ffffff;' +
        'width:340px;max-width:90vw;max-height:80vh;border-radius:10px;padding:16px;' +
        'display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,0.4);';
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = 'Mass Tagging — choose tags';
    title.style.cssText = 'font-weight:600;font-size:15px;';
    box.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Select existing tags and/or add new ones, then start tagging. Click any tweet to apply all of them; click it again to remove them.';
    hint.style.cssText = 'font-size:12px;opacity:0.75;line-height:1.4;';
    box.appendChild(hint);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;overflow-y:auto;max-height:220px;padding:4px 0;';
    box.appendChild(list);

    const newTagRow = document.createElement('div');
    newTagRow.style.cssText = 'display:flex;gap:6px;';
    const newTagInput = document.createElement('input');
    newTagInput.type = 'text';
    newTagInput.placeholder = 'Add a new tag…';
    newTagInput.style.cssText = 'flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);' +
        'background:rgba(255,255,255,0.08);color:#ffffff;';
    const addTagBtnEl = document.createElement('button');
    addTagBtnEl.textContent = 'Add';
    addTagBtnEl.style.cssText = 'background:rgba(255,255,255,0.12);color:#ffffff;border:1px solid rgba(255,255,255,0.25);' +
        'border-radius:6px;padding:6px 12px;cursor:pointer;';
    newTagRow.appendChild(newTagInput);
    newTagRow.appendChild(addTagBtnEl);
    box.appendChild(newTagRow);

    const pendingNewTags = new Set(); // typed-in tags not yet in getAllTagNames()
    const chosen = new Set(); // currently checked tag names

    function chip(tag) {
        const el = document.createElement('div');
        el.textContent = '#' + tag;
        el.dataset.tag = tag;
        const isChosen = chosen.has(tag);
        el.style.cssText = 'padding:5px 10px;border-radius:999px;font-size:13px;cursor:pointer;user-select:none;' +
            'border:1px solid rgba(255,255,255,0.25);' +
            (isChosen ? 'background:#1d9bf0;color:#ffffff;' : 'background:rgba(255,255,255,0.08);color:#ffffff;');
        el.addEventListener('click', () => {
            if (chosen.has(tag)) chosen.delete(tag); else chosen.add(tag);
            el.style.background = chosen.has(tag) ? '#1d9bf0' : 'rgba(255,255,255,0.08)';
            el.style.color = '#ffffff';
        });
        return el;
    }

    function refresh() {
        list.replaceChildren();
        const names = new Set([...getAllTagNames(), ...pendingNewTags]);
        Array.from(names).sort().forEach(tag => list.appendChild(chip(tag)));
    }

    function addNewTag() {
        const val = newTagInput.value.trim().replace(/^#/, '');
        if (!val) return;
        pendingNewTags.add(val);
        chosen.add(val);
        newTagInput.value = '';
        refresh();
    }
    addTagBtnEl.addEventListener('click', addNewTag);
    newTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'background:rgba(255,255,255,0.12);color:#ffffff;border:1px solid rgba(255,255,255,0.25);' +
        'border-radius:6px;padding:6px 14px;cursor:pointer;';
    cancelBtn.addEventListener('click', closeMassTagSelectModal);
    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start Tagging';
    startBtn.style.cssText = 'background:#1d9bf0;color:#ffffff;border:none;border-radius:6px;' +
        'padding:6px 14px;cursor:pointer;font-weight:600;';
    startBtn.addEventListener('click', () => {
        if (chosen.size === 0) return;
        startMassTagMode(Array.from(chosen));
        closeMassTagSelectModal();
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(startBtn);
    box.appendChild(footer);

    return { overlay, refresh: () => { chosen.clear(); pendingNewTags.clear(); refresh(); } };
}

function createMassTagStatusBar() {
    if (massTagStatusBar) return;
    massTagStatusBar = document.createElement('div');
    massTagStatusBar.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:999;' +
        'background:#1d9bf0;color:#ffffff;padding:10px 16px;' +
        'align-items:center;justify-content:center;gap:14px;font-size:14px;' +
        'box-shadow:0 2px 10px rgba(0,0,0,0.3);';

    const label = document.createElement('span');
    label.id = 'mass-tag-status-label';
    massTagStatusBar.appendChild(label);

    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop Mass Tagging';
    stopBtn.style.cssText = 'background:rgba(0,0,0,0.25);color:#fff;border:none;border-radius:6px;' +
        'padding:4px 10px;cursor:pointer;font-size:13px;';
    stopBtn.addEventListener('click', endMassTagMode);
    massTagStatusBar.appendChild(stopBtn);

    document.body.appendChild(massTagStatusBar);
}

function startMassTagMode(tags) {
    massTagSelectedTags = tags;
    massTagModeActive = true;
    createMassTagStatusBar();
    document.getElementById('mass-tag-status-label').textContent =
        `Mass Tagging: ${tags.map(t => '#' + t).join(' ')} — click tweets to toggle`;
    massTagStatusBar.style.display = 'flex';
    if (massTagBtn) massTagBtn.classList.add('active');
    document.body.style.paddingTop = '42px'; // room for the fixed status bar
}

function endMassTagMode() {
    massTagModeActive = false;
    massTagSelectedTags = [];
    if (massTagStatusBar) massTagStatusBar.style.display = 'none';
    if (massTagBtn) massTagBtn.classList.remove('active');
    document.body.style.paddingTop = '';
    renderTagsSidebar(); // tag counts may have drifted while blitzing through tweets
}

// --- End Mass Tagging Mode ---

// --- Import ---
// Import a previously exported JSON file (see exportJSON — tags are always
// included there now). Two modes: 'append' upserts into the current
// collection (existing ids are updated, new ones added, nothing else is
// touched); 'replace' wipes the current collection first. Replace shows an
// extra native confirm() on top of the inline warning before it runs.

let importFileInput = null;
let importModalEls = null; // built lazily on first use
let pendingImportTweets = null;

function createImportButton() {
    if (!totalCount.parentElement || document.getElementById('import-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'import-btn';
    btn.className = 'icon-btn';
    btn.title = 'Import a previously exported JSON file';
    const icon = document.createElement('i');
    icon.className = 'bi bi-upload';
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(' Import'));
    btn.addEventListener('click', () => {
        if (!importFileInput) {
            importFileInput = document.createElement('input');
            importFileInput.type = 'file';
            importFileInput.accept = 'application/json,.json';
            importFileInput.style.display = 'none';
            importFileInput.addEventListener('change', handleImportFileSelected);
            document.body.appendChild(importFileInput);
        }
        importFileInput.value = ''; // so re-selecting the same file still fires 'change'
        importFileInput.click();
    });
    totalCount.parentElement.appendChild(btn);
}

async function handleImportFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (err) {
        alert('Could not read that file as JSON: ' + err.message);
        return;
    }

    if (!Array.isArray(data)) {
        alert('Expected a JSON array of tweets (the format produced by "Export JSON").');
        return;
    }
    const valid = data.filter(t => t && typeof t === 'object' && t.id);
    if (valid.length === 0) {
        alert('No valid tweets found in that file (each entry needs at least an "id").');
        return;
    }

    pendingImportTweets = valid;
    openImportModal(valid.length, data.length - valid.length);
}

function openImportModal(validCount, skippedCount) {
    if (!importModalEls) importModalEls = buildImportModal();
    importModalEls.reset(validCount, skippedCount);
    importModalEls.overlay.style.display = 'flex';
}

function closeImportModal() {
    if (importModalEls) importModalEls.overlay.style.display = 'none';
    pendingImportTweets = null;
}

function buildImportModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.55);' +
        'align-items:center;justify-content:center;';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeImportModal(); });

    const box = document.createElement('div');
    box.style.cssText = 'background:#192734;color:#ffffff;width:360px;max-width:90vw;border-radius:10px;' +
        'padding:16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,0.4);';
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = 'Import Bookmarks';
    title.style.cssText = 'font-weight:600;font-size:15px;';
    box.appendChild(title);

    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:13px;opacity:0.85;line-height:1.4;';
    box.appendChild(summary);

    let importMode = 'append';
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:16px;font-size:14px;';

    function radioOption(value, labelText) {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'import-mode';
        radio.value = value;
        radio.checked = value === 'append';
        radio.addEventListener('change', () => {
            importMode = value;
            warningEl.style.display = (importMode === 'replace') ? 'block' : 'none';
        });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(labelText));
        return label;
    }
    modeRow.appendChild(radioOption('append', 'Append (add/update)'));
    modeRow.appendChild(radioOption('replace', 'Replace (wipe first)'));
    box.appendChild(modeRow);

    const warningEl = document.createElement('div');
    warningEl.textContent = '⚠ This will permanently delete your entire current bookmark collection before importing.';
    warningEl.style.cssText = 'display:none;font-size:12px;color:#ffb020;background:rgba(255,176,32,0.12);' +
        'border:1px solid rgba(255,176,32,0.4);border-radius:6px;padding:8px 10px;line-height:1.4;';
    box.appendChild(warningEl);

    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-size:13px;opacity:0.85;min-height:16px;';
    box.appendChild(statusEl);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'background:rgba(255,255,255,0.12);color:#ffffff;border:1px solid rgba(255,255,255,0.25);' +
        'border-radius:6px;padding:6px 14px;cursor:pointer;';
    cancelBtn.addEventListener('click', closeImportModal);

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Import';
    confirmBtn.style.cssText = 'background:#1d9bf0;color:#ffffff;border:none;border-radius:6px;' +
        'padding:6px 14px;cursor:pointer;font-weight:600;';
    confirmBtn.addEventListener('click', async () => {
        if (!pendingImportTweets) return;

        // Extra explicit warning specifically for replace, on top of the
        // inline banner, since it's destructive and irreversible.
        if (importMode === 'replace') {
            const ok = confirm(
                `This will permanently delete all ${allTweets.length} bookmark(s) currently in your collection ` +
                `and replace them with the ${pendingImportTweets.length} tweet(s) from this file. This cannot be undone. Continue?`
            );
            if (!ok) return;
        }

        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        statusEl.textContent = 'Importing…';

        try {
            const result = await runImport(pendingImportTweets, importMode);
            statusEl.textContent = `Done — ${result.added} added, ${result.updated} updated` +
                (importMode === 'replace' ? `, ${result.deleted} removed` : '') + '.';
            await loadData();
            setTimeout(closeImportModal, 1200);
        } catch (err) {
            console.error('Import failed:', err);
            statusEl.textContent = 'Import failed — see console for details.';
        } finally {
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    box.appendChild(footer);

    document.body.appendChild(overlay);

    return {
        overlay,
        reset: (validCount, skippedCount) => {
            summary.textContent = `Found ${validCount} tweet(s) in this file` +
                (skippedCount > 0 ? ` (${skippedCount} entr${skippedCount === 1 ? 'y' : 'ies'} skipped — missing an id).` : '.');
            statusEl.textContent = '';
            importMode = 'append';
            box.querySelector('input[value="append"]').checked = true;
            warningEl.style.display = 'none';
        }
    };
}

// Writes imported tweets into the DB.
// ASSUMPTION FLAGGED: this calls `db.saveTweet(tweetObject)` as an upsert,
// by analogy with the 'SAVE_TWEET' message the content script already
// sends (src/content/index.js) — I don't have db.js in this conversation
// to confirm the real method name/signature, so please double-check this
// against your actual db.js and rename if needed.
async function runImport(tweets, mode) {
    let deleted = 0;
    if (mode === 'replace') {
        for (const existing of allTweets) {
            await db.deleteTweet(existing.id, true);
            deleted++;
        }
    }

    const existingIds = new Set(mode === 'replace' ? [] : allTweets.map(t => t.id));
    let added = 0, updated = 0;

    for (const tweet of tweets) {
        const isUpdate = existingIds.has(tweet.id);
        await db.saveTweet({ ...tweet, tags: tweet.tags || [] });
        if (isUpdate) updated++; else added++;
    }

    return { added, updated, deleted };
}
// --- End Import ---

function setupEventListeners() {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchTerm = e.target.value.toLowerCase();
            updateUI();
        }, 300);
    });

    document.getElementById('close-modal').addEventListener('click', closeTagModal);
    document.getElementById('save-tags').addEventListener('click', saveTags);
    tagModal.addEventListener('click', (e) => { if (e.target === tagModal) closeTagModal(); });

    document.getElementById('export-all-btn').addEventListener('click', () => exportTweets(getFilteredTweets()));
    document.getElementById('export-json-btn').addEventListener('click', () => exportJSON(getFilteredTweets()));

    // Clear tag filters (now lives above the tag list, next to "Tags")
    clearTagsBtn.addEventListener('click', () => {
        selectedTags.clear();
        excludedTags.clear();
        updateUI();
    });

    // Tag Groups configuration modal
    configureTagsBtn.addEventListener('click', openTagGroupsModal);
    closeGroupsModalBtn.addEventListener('click', closeTagGroupsModal);
    tagGroupsModal.addEventListener('click', (e) => { if (e.target === tagGroupsModal) closeTagGroupsModal(); });
    addGroupBtn.addEventListener('click', () => {
        addTagGroup(newGroupInput.value);
        newGroupInput.value = '';
    });
    newGroupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTagGroup(newGroupInput.value);
            newGroupInput.value = '';
        }
    });

    // Search tabs
    addTabBtn.addEventListener('click', addSearchTab);

    // --- Tag Editor Logic ---

    // Focus input when clicking anywhere in the container
    tagEditorContainer.addEventListener('click', () => tagInput.focus());

    tagInput.addEventListener('keydown', (e) => {
        const val = e.target.value.trim();

        // Add tag on Enter or Comma
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (val) {
                addTagToEditor(val);
                e.target.value = '';
                suggestionsBox.classList.remove('active');
            }
        }
        // Remove last tag on Backspace if input is empty
        else if (e.key === 'Backspace' && val === '' && currentQuoteTags.length > 0) {
            removeTagFromEditor(currentQuoteTags.length - 1);
        }
    });

    tagInput.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();

        if (val.length < 1) {
            suggestionsBox.classList.remove('active');
            return;
        }

        // Suggestions logic
        const allTags = new Set();
        allTweets.forEach(t => (t.tags || []).forEach(tag => allTags.add(tag)));

        // Filter matches (exclude already added tags)
        const matches = Array.from(allTags).filter(tag =>
            tag.toLowerCase().includes(val) &&
            !currentQuoteTags.includes(tag)
        );

        if (matches.length > 0) {
            suggestionsBox.replaceChildren();
            matches.forEach(tag => {
                const item = document.createElement('div');
                item.className = 'tag-suggestion-item';
                item.dataset.tag = tag;
                item.textContent = '#' + tag;

                item.addEventListener('click', () => {
                    addTagToEditor(item.dataset.tag);
                    tagInput.value = '';
                    tagInput.focus();
                    suggestionsBox.classList.remove('active');
                });

                suggestionsBox.appendChild(item);
            });
            suggestionsBox.classList.add('active');
        } else {
            suggestionsBox.classList.remove('active');
        }
    });

    // Hide suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!tagEditorContainer.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.remove('active');
        }
    });
}

// --- Tag Editor Helpers ---

function renderTagCapsules() {
    // Keep the input at the end, remove old capsules
    // Best way: clear container except input, then re-append
    // But we need to maintain input focus and state.

    // Strategy: Remove all .tag-capsule elements
    const capsules = tagEditorContainer.querySelectorAll('.tag-capsule');
    capsules.forEach(el => el.remove());

    // Create capsules
    const fragment = document.createDocumentFragment();
    currentQuoteTags.forEach((tag, index) => {
        const span = document.createElement('span');
        span.className = 'tag-capsule';
        span.textContent = tag + ' ';

        const i = document.createElement('i');
        i.className = 'bi bi-x';
        i.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent focus trigger
            removeTagFromEditor(index);
        });

        span.appendChild(i);
        fragment.appendChild(span);
    });

    // Insert before the input
    tagEditorContainer.insertBefore(fragment, tagInput);
}

function addTagToEditor(tag) {
    const cleanTag = tag.trim().replace(/^#/, ''); // Remove # if user typed it
    if (cleanTag && !currentQuoteTags.includes(cleanTag)) {
        currentQuoteTags.push(cleanTag);
        renderTagCapsules();
    }
}

function removeTagFromEditor(index) {
    currentQuoteTags.splice(index, 1);
    renderTagCapsules();
}

// --- End Tag Editor Helpers ---

function getFilteredTweets() {
    let filtered = allTweets;

    if (selectedTags.size > 0) {
        filtered = filtered.filter(t => getEffectiveTags(t).some(tag => selectedTags.has(tag)));
    }

    if (excludedTags.size > 0) {
        filtered = filtered.filter(t => !getEffectiveTags(t).some(tag => excludedTags.has(tag)));
    }

    if (searchTerm) {
        filtered = filtered.filter(t =>
            (t.text && t.text.toLowerCase().includes(searchTerm)) ||
            (t.authorName && t.authorName.toLowerCase().includes(searchTerm)) ||
            (t.authorHandle && t.authorHandle.toLowerCase().includes(searchTerm))
        );
    }

    return filtered;
}

function updateUI() {
    const tweets = getFilteredTweets();

    const parts = [];
    if (selectedTags.size > 0) parts.push(Array.from(selectedTags).map(t => '#' + t).join(', '));
    if (excludedTags.size > 0) parts.push(Array.from(excludedTags).map(t => '−#' + t).join(', '));
    feedTitle.textContent = parts.length > 0 ? `Filtered: ${parts.join('  ')}` : 'All Bookmarks';

    renderGrid(tweets);
    renderTagsSidebar();
}

function renderGrid(tweets) {
    renderToken++; // invalidate any batch loop still running from a previous render
    const myToken = renderToken;

    // Object URLs from the previous render's local media are no longer referenced
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls = [];

    tweetsGrid.replaceChildren();
    filteredTweetsCache = tweets;
    renderedCount = 0;

    if (tweets.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;';
        const icon = document.createElement('i');
        icon.className = 'bi bi-inbox';
        icon.style.fontSize = '2rem';
        empty.appendChild(icon);
        empty.appendChild(document.createElement('br'));
        empty.appendChild(document.createTextNode('No bookmarks found.'));
        tweetsGrid.appendChild(empty);
        updateRenderProgressUI();
        return;
    }

    const w = window.innerWidth;
    const colCount = w <= 700 ? 1 : w <= 1100 ? 2 : w <= 1500 ? 3 : 4;
    masonryColumns = Array.from({ length: colCount }, () => {
        const col = document.createElement('div');
        col.className = 'masonry-column';
        tweetsGrid.appendChild(col);
        return col;
    });

    renderNextBatch(myToken);
}

// Renders one batch, then schedules the next batch on a fresh animation frame
// instead of doing all 5000 in one go. This keeps the tab responsive (input,
// scrolling, painting all still happen between batches) without skipping any
// tweets the way the scroll-based version did.
function renderNextBatch(token) {
    // A newer renderGrid() call superseded this one (e.g. user kept typing in
    // search) — stop working on stale data.
    if (token !== renderToken) return;

    const batch = filteredTweetsCache.slice(renderedCount, renderedCount + RENDER_BATCH_SIZE);

    batch.forEach((tweet) => {
        const card = createTweetCard(tweet);

        // Balanced masonry: drop into whichever column is currently shortest
        let shortest = 0;
        for (let c = 1; c < masonryColumns.length; c++) {
            if (masonryColumns[c].offsetHeight < masonryColumns[shortest].offsetHeight) shortest = c;
        }
        masonryColumns[shortest].appendChild(card);
    });

    renderedCount += batch.length;
    updateRenderProgressUI();

    if (renderedCount < filteredTweetsCache.length) {
        requestAnimationFrame(() => renderNextBatch(token));
    }
}

// Query how much of the current filtered set has been rendered so far.
// Useful for a progress indicator ("3400 of 5200 tweets done").
function getRenderProgress() {
    return { rendered: renderedCount, total: filteredTweetsCache.length };
}

function updateRenderProgressUI() {
    const { rendered, total } = getRenderProgress();
    totalCount.textContent = rendered < total
        ? `${rendered} of ${total} items…`
        : `${total} items`;
}

function createTweetCard(tweet) {
        const card = document.createElement('article');
        card.className = 'tweet-card animate-in';
        card.addEventListener('animationend', () => card.classList.remove('animate-in'), { once: true });

        // Skip layout/paint for off-screen cards. Without this, every one of
        // the (potentially thousands of) mounted cards gets fully re-measured
        // on any full-page reflow — including browser zoom — which is what
        // makes zooming slow. contain-intrinsic-size is a rough placeholder
        // size used only while a card is skipped; tweak it if your cards run
        // noticeably bigger/smaller than this on average.
        card.style.contentVisibility = 'auto';
        card.style.containIntrinsicSize = '350px 480px';
        card.style.position = 'relative'; // positioning context for the local-media badge below

        // Shown when at least one of this tweet's media items successfully
        // loaded from the local media folder instead of the network.
        const localMediaBadge = document.createElement('div');
        localMediaBadge.className = 'local-media-badge';
        localMediaBadge.title = 'Loaded from your local media folder';
        localMediaBadge.style.cssText = 'display:none;position:absolute;top:8px;right:8px;z-index:5;' +
            'width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;' +
            'align-items:center;justify-content:center;font-size:13px;pointer-events:none;';
        const localMediaBadgeIcon = document.createElement('i');
        localMediaBadgeIcon.className = 'bi bi-hdd-fill';
        localMediaBadge.appendChild(localMediaBadgeIcon);
        card.appendChild(localMediaBadge);
        const showLocalMediaBadge = () => { localMediaBadge.style.display = 'flex'; };

        // Header
        const header = document.createElement('div');
        header.className = 'tweet-header';

        const avatar = document.createElement('img');
        avatar.className = 'avatar';
        avatar.src = tweet.authorAvatar || '';
        avatar.referrerPolicy = 'no-referrer';
        avatar.addEventListener('error', function () { this.style.backgroundColor = '#333'; });
        header.appendChild(avatar);

        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'display-name';
        nameSpan.textContent = tweet.authorName;
        userInfo.appendChild(nameSpan);

        const handleSpan = document.createElement('span');
        handleSpan.className = 'handle';
        handleSpan.textContent = tweet.authorHandle;
        userInfo.appendChild(handleSpan);

        header.appendChild(userInfo);
        card.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = 'tweet-content';
        appendLinkifiedText(content, tweet.text);
        card.appendChild(content);

        // Media gallery (photos, videos, gifs). Falls back to the legacy
        // single-mediaUrl shape for tweets saved before multi-media support.
        const mediaItems = (tweet.media && tweet.media.length)
            ? tweet.media
            : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);

        if (mediaItems.length) {
            const mediaDiv = document.createElement('div');
            mediaDiv.className = 'tweet-media';
            mediaDiv.style.display = 'grid';
            mediaDiv.style.gap = '4px';
            if (mediaItems.length > 1) {
                mediaDiv.classList.add('tweet-media-grid');
                mediaDiv.style.gridTemplateColumns = '1fr 1fr';
            }

            mediaItems.forEach(item => {
                const itemWrap = document.createElement('div');
                itemWrap.className = 'tweet-media-item';
                itemWrap.style.position = 'relative';
                itemWrap.style.overflow = 'hidden';

                const img = document.createElement('img');
                img.src = item.url; // remote URL (or poster, for video/gif) as the immediate default
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';
                img.style.width = '100%';
                img.style.display = 'block';
                img.addEventListener('error', function () { this.parentElement.style.display = 'none'; });
                itemWrap.appendChild(img);

                if (item.type === 'video' || item.type === 'gif') {
                    // Overlay badge sitting ON TOP of the thumbnail (not
                    // pushed below it — inline-styled so it renders
                    // correctly with or without extra stylesheet rules).
                    const badge = document.createElement('div');
                    badge.className = 'media-type-badge';
                    badge.style.cssText = 'position:absolute;bottom:6px;right:6px;z-index:3;' +
                        'width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;' +
                        'display:flex;align-items:center;justify-content:center;font-size:16px;pointer-events:none;';
                    const icon = document.createElement('i');
                    icon.className = item.type === 'gif' ? 'bi bi-filetype-gif' : 'bi bi-play-circle-fill';
                    badge.appendChild(icon);
                    itemWrap.appendChild(badge);

                    // We can't recover the real video stream from the DOM
                    // (see parseTweet.js), so by default a video/gif item is
                    // just a poster — make it clickable so it's not a dead
                    // end, opening the original tweet to actually watch it.
                    itemWrap.style.cursor = 'pointer';
                    itemWrap.title = 'Click to watch on X';
                    const openOnX = () => window.open(tweet.url, '_blank', 'noopener,noreferrer');
                    itemWrap.addEventListener('click', openOnX);

                    // Best-effort: if a matching local video file exists,
                    // replace the static poster with an actual playable
                    // <video>, so it becomes watchable in place.
                    if (mediaRootHandle) {
                        resolveLocalVideoFile(tweet, item.url).then(videoFile => {
                            if (!videoFile) return; // no local match — keep the click-to-watch poster
                            const videoEl = document.createElement('video');
                            videoEl.controls = true;
                            videoEl.preload = 'metadata';
                            videoEl.poster = item.url;
                            videoEl.style.width = '100%';
                            videoEl.style.display = 'block';
                            const objectUrl = URL.createObjectURL(videoFile);
                            activeObjectUrls.push(objectUrl);
                            videoEl.src = objectUrl;

                            itemWrap.replaceChild(videoEl, img);
                            badge.style.display = 'none'; // it's genuinely playable now, badge no longer needed
                            itemWrap.style.cursor = 'default';
                            itemWrap.removeEventListener('click', openOnX);
                            showLocalMediaBadge();
                        });
                    }
                } else if (mediaRootHandle) {
                    // Photo item: swap in the local copy once it resolves.
                    resolveLocalMediaFile(tweet, item.url).then(file => {
                        if (!file) return; // not found locally, keep the remote URL
                        const objectUrl = URL.createObjectURL(file);
                        activeObjectUrls.push(objectUrl);
                        img.src = objectUrl;
                        showLocalMediaBadge();
                    });
                }

                mediaDiv.appendChild(itemWrap);
            });

            card.appendChild(mediaDiv);
        }

        // Meta
        const meta = document.createElement('div');
        meta.className = 'tweet-meta';

        const dateSpan = document.createElement('span');
        dateSpan.textContent = new Date(tweet.timestamp).toLocaleDateString();
        meta.appendChild(dateSpan);

        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'tweet-tags';
        (tweet.tags || []).forEach(tag => {
            const tagBadge = document.createElement('span');
            tagBadge.className = 'tweet-tag-badge';
            tagBadge.textContent = '#' + tag;
            tagsDiv.appendChild(tagBadge);
        });
        // Built-in tags (video/gif/text-only) are computed, not stored —
        // shown with a dashed outline so they read as distinct from real tags.
        getBuiltInTagsForTweet(tweet).forEach(tag => {
            const tagBadge = document.createElement('span');
            tagBadge.className = 'tweet-tag-badge tweet-tag-badge-builtin';
            tagBadge.style.cssText = 'border:1px dashed currentColor;opacity:0.75;';
            tagBadge.textContent = '#' + tag;
            tagsDiv.appendChild(tagBadge);
        });
        meta.appendChild(tagsDiv);
        card.appendChild(meta);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'card-actions';

        const mkBtn = (icon, title, cb) => {
            const btn = document.createElement('button');
            btn.className = 'icon-btn';
            btn.title = title;
            const i = document.createElement('i');
            i.className = icon;
            btn.appendChild(i);
            btn.addEventListener('click', cb);
            return btn;
        };

        const editBtn = mkBtn('bi bi-tag', 'Edit Tags', () => openTagModal(tweet.id));
        editBtn.classList.add('edit-tags-btn');
        actions.appendChild(editBtn);

        const exportBtn = mkBtn('bi bi-download', 'Export Markdown', () => exportTweets([tweet]));
        actions.appendChild(exportBtn);

        const linkBtn = document.createElement('a');
        linkBtn.className = 'icon-btn';
        linkBtn.href = tweet.url;
        linkBtn.target = '_blank';
        linkBtn.rel = 'noopener noreferrer';
        linkBtn.title = 'Open on X';
        const linkIcon = document.createElement('i');
        linkIcon.className = 'bi bi-box-arrow-up-right';
        linkBtn.appendChild(linkIcon);
        actions.appendChild(linkBtn);

        const spacer = document.createElement('div');
        spacer.style.flexGrow = '1';
        actions.appendChild(spacer);

        const deleteBtn = mkBtn('bi bi-trash3', 'Delete & Unbookmark', () => deleteTweet(tweet.id));
        deleteBtn.classList.add('danger', 'delete-btn');
        actions.appendChild(deleteBtn);

        card.appendChild(actions);

        // Mass tagging mode: when active, a click anywhere on the card
        // toggles the whole selected tag set on this tweet instead of
        // triggering the normal buttons/links underneath. Capture phase so
        // it runs before — and can suppress — those other click handlers.
        card.addEventListener('click', async (e) => {
            if (!massTagModeActive || massTagSelectedTags.length === 0) return;
            e.preventDefault();
            e.stopPropagation();

            const currentTags = new Set(tweet.tags || []);
            const hasAll = massTagSelectedTags.every(t => currentTags.has(t));
            if (hasAll) {
                massTagSelectedTags.forEach(t => currentTags.delete(t));
            } else {
                massTagSelectedTags.forEach(t => currentTags.add(t));
            }
            const newTags = Array.from(currentTags);
            tweet.tags = newTags; // optimistic local update

            // Refresh just this card's tag badges — avoid a full grid
            // re-render so scroll position holds while blitzing through tweets.
            tagsDiv.replaceChildren();
            newTags.forEach(tag => {
                const tagBadge = document.createElement('span');
                tagBadge.className = 'tweet-tag-badge';
                tagBadge.textContent = '#' + tag;
                tagsDiv.appendChild(tagBadge);
            });
            getBuiltInTagsForTweet(tweet).forEach(tag => {
                const tagBadge = document.createElement('span');
                tagBadge.className = 'tweet-tag-badge tweet-tag-badge-builtin';
                tagBadge.style.cssText = 'border:1px dashed currentColor;opacity:0.75;';
                tagBadge.textContent = '#' + tag;
                tagsDiv.appendChild(tagBadge);
            });

            // Brief flash so it's obvious the click registered: green for
            // "tagged", red for "untagged".
            card.style.outline = hasAll ? '3px solid #e0245e' : '3px solid #17bf63';
            card.style.outlineOffset = '-3px';
            setTimeout(() => { card.style.outline = ''; card.style.outlineOffset = ''; }, 250);

            try {
                await db.updateTweetTags(tweet.id, newTags);
            } catch (err) {
                console.error('Mass tag update failed:', err);
            }
        }, true); // capture phase

        return card;
}

function renderTagsSidebar() {
    const tagCounts = {};
    allTweets.forEach(t => {
        (t.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });

    // Clear button now lives in the header row above the list (see index.html);
    // just toggle its visibility here.
    clearTagsBtn.style.display = (selectedTags.size > 0 || excludedTags.size > 0) ? 'flex' : 'none';

    tagList.replaceChildren();

    // --- Built-in tags (video / gif / text-only) ---
    // Computed from media, never stored in the DB — kept in their own
    // section so they can't be edited/deleted like a real tag, but still
    // work with the same select/exclude click behavior via createTagChip.
    const builtInCounts = {};
    BUILT_IN_TAG_NAMES.forEach(name => { builtInCounts[name] = 0; });
    allTweets.forEach(t => {
        getBuiltInTagsForTweet(t).forEach(name => { builtInCounts[name]++; });
    });
    const builtInWithCounts = BUILT_IN_TAG_NAMES.filter(name => builtInCounts[name] > 0);

    if (builtInWithCounts.length) {
        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        const collapsed = collapsedGroups.has('Built-in');
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        const caret = document.createElement('i');
        caret.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
        header.appendChild(caret);
        header.appendChild(document.createTextNode(` Built-in (${builtInWithCounts.length})`));
        header.addEventListener('click', () => {
            if (collapsedGroups.has('Built-in')) collapsedGroups.delete('Built-in');
            else collapsedGroups.add('Built-in');
            saveTagGroupState();
            renderTagsSidebar();
        });
        groupEl.appendChild(header);

        if (!collapsed) {
            const body = document.createElement('div');
            body.className = 'tag-group-body';
            builtInWithCounts.forEach(name => body.appendChild(createTagChip(name, builtInCounts[name])));
            groupEl.appendChild(body);
        }

        tagList.appendChild(groupEl);
    }

    const sortedTagNames = Object.keys(tagCounts).sort();
    if (sortedTagNames.length === 0) return;

    // Bucket tags by their assigned group, in tagGroups order
    const byGroup = new Map();
    tagGroups.forEach(g => byGroup.set(g, []));
    sortedTagNames.forEach(tag => {
        const group = tagGroupOf(tag);
        if (!byGroup.has(group)) byGroup.set(group, []); // safety net
        byGroup.get(group).push(tag);
    });

    tagGroups.forEach(group => {
        const tagsInGroup = byGroup.get(group) || [];
        if (tagsInGroup.length === 0) return; // hide empty groups from the sidebar

        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        const collapsed = collapsedGroups.has(group);
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        const caret = document.createElement('i');
        caret.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
        header.appendChild(caret);
        header.appendChild(document.createTextNode(` ${group} (${tagsInGroup.length})`));
        header.addEventListener('click', () => {
            if (collapsedGroups.has(group)) collapsedGroups.delete(group);
            else collapsedGroups.add(group);
            saveTagGroupState();
            renderTagsSidebar();
        });
        groupEl.appendChild(header);

        if (!collapsed) {
            const body = document.createElement('div');
            body.className = 'tag-group-body';
            tagsInGroup.forEach(tag => body.appendChild(createTagChip(tag, tagCounts[tag])));
            groupEl.appendChild(body);
        }

        tagList.appendChild(groupEl);
    });
}

// A single tag chip. Click toggles inclusion (selectedTags); shift-click
// toggles exclusion (excludedTags), shown in red.
function createTagChip(tag, count) {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    if (selectedTags.has(tag)) chip.classList.add('active');
    if (excludedTags.has(tag)) chip.classList.add('excluded');

    chip.textContent = `#${tag} (${count})`;

    chip.addEventListener('click', (e) => {
        if (e.shiftKey) {
            if (excludedTags.has(tag)) {
                excludedTags.delete(tag);
            } else {
                excludedTags.add(tag);
                selectedTags.delete(tag); // exclusion overrides inclusion
            }
        } else {
            if (selectedTags.has(tag)) {
                selectedTags.delete(tag);
            } else {
                selectedTags.add(tag);
                excludedTags.delete(tag); // inclusion overrides exclusion
            }
        }
        updateUI();
    });

    return chip;
}

async function deleteTweet(id) {
    if (!confirm('Remove this bookmark permanently from Local Collection?')) return;
    try {
        await db.deleteTweet(id, true); // true = Permanent (Blacklist)
        allTweets = allTweets.filter(t => t.id !== id);
        updateUI();
    } catch (err) {
        console.error(err);
    }
}

function openTagModal(tweetId) {
    currentEditTweetId = tweetId;
    const tweet = allTweets.find(t => t.id === tweetId);
    if (tweet) {
        currentQuoteTags = [...(tweet.tags || [])]; // Load existing tags into editor state
        renderTagCapsules();
        tagInput.value = ''; // Clear input
        tagModal.classList.add('active');
        tagInput.focus();
    }
}

function closeTagModal() {
    tagModal.classList.remove('active');
    currentEditTweetId = null;
    currentQuoteTags = [];
    tagInput.value = '';
}

async function saveTags() {
    if (!currentEditTweetId) return;

    // Auto-add pending text as a tag if user didn't press Enter/Comma
    const pendingText = tagInput.value.trim();
    if (pendingText) {
        addTagToEditor(pendingText);
        tagInput.value = '';
    }

    // Use currentQuoteTags from editor state
    const tags = currentQuoteTags;

    try {
        await db.updateTweetTags(currentEditTweetId, tags);
        const tweet = allTweets.find(t => t.id === currentEditTweetId);
        if (tweet) tweet.tags = tags;
        closeTagModal();
        updateUI();
    } catch (err) {
        console.error(err);
    }
}

function exportTweets(tweets) {
    let content = "";
    tweets.forEach(tweet => {
        content += `---\nid: "${tweet.id}"\nauthor: "${tweet.authorName}"\nurl: "${tweet.url}"\ntags: [${(tweet.tags || []).join(', ')}]\n---\n\n${tweet.text}\n\n`;

        const mediaItems = (tweet.media && tweet.media.length)
            ? tweet.media
            : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);
        mediaItems.forEach((item, i) => {
            const label = item.type === 'video' ? `video ${i + 1} (thumbnail)`
                : item.type === 'gif' ? `gif ${i + 1} (thumbnail)`
                : `media ${i + 1}`;
            content += `![${label}](${item.url})\n\n`;
        });

        content += `___\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tweets.length === 1 ? `tweet-${tweets[0].id}.md` : `bookmarks-export.md`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportJSON(tweets) {
    // Guarantee `tags` is always present (even if empty) so a re-import
    // never has to guess — built-in tags (video/gif/text-only) are
    // intentionally NOT included since they're computed, not stored.
    const exportData = tweets.map(t => ({ ...t, tags: t.tags || [] }));
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookmarks-export.json';
    a.click();
    URL.revokeObjectURL(url);
}

// OG Carousel
(function initCarousel() {
    let idx = 0;
    const total = 4;
    const track = document.getElementById('og-carousel-track');
    const dots = document.querySelectorAll('.og-dot');
    if (!track || !dots.length) return;
    function goTo(i) {
        idx = i;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, j) => {
            d.style.background = j === idx ? 'var(--accent-color)' : 'var(--text-secondary)';
            d.style.opacity = j === idx ? '1' : '0.5';
        });
    }
    dots.forEach(d => d.addEventListener('click', () => goTo(parseInt(d.dataset.index, 10))));

    // Fallback for broken OG images
    document.querySelectorAll('.og-card img').forEach(img => {
        img.addEventListener('error', function() {
            this.style.display = 'none';
            this.nextElementSibling.style.display = 'flex';
        });
    });
    setInterval(() => goTo((idx + 1) % total), 4000);
})();

function appendLinkifiedText(element, text) {
    if (!text) return;
    const regex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            element.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        const a = document.createElement('a');
        a.href = match[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = match[0];
        a.style.color = 'var(--accent-color)';
        element.appendChild(a);

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        element.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
}