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
});

async function loadData() {
    try {
        allTweets = await db.getTweets();
        updateUI();
    } catch (err) {
        console.error('Failed to load tweets:', err);
    }
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
        filtered = filtered.filter(t => t.tags && t.tags.some(tag => selectedTags.has(tag)));
    }

    if (excludedTags.size > 0) {
        filtered = filtered.filter(t => !(t.tags && t.tags.some(tag => excludedTags.has(tag))));
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
            if (mediaItems.length > 1) mediaDiv.classList.add('tweet-media-grid');

            mediaItems.forEach(item => {
                const itemWrap = document.createElement('div');
                itemWrap.className = 'tweet-media-item';

                const img = document.createElement('img');
                img.src = item.url; // remote URL (or poster, for video/gif) as the immediate default
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';
                img.addEventListener('error', function () { this.parentElement.style.display = 'none'; });
                itemWrap.appendChild(img);

                // Video/gif items keep their poster as the visible thumbnail
                // (actual video streams can't be persisted from the DOM), but
                // get a badge so they aren't mistaken for a plain photo.
                if (item.type === 'video' || item.type === 'gif') {
                    const badge = document.createElement('div');
                    badge.className = 'media-type-badge';
                    const icon = document.createElement('i');
                    icon.className = item.type === 'gif' ? 'bi bi-filetype-gif' : 'bi bi-play-circle-fill';
                    badge.appendChild(icon);
                    itemWrap.appendChild(badge);
                }

                mediaDiv.appendChild(itemWrap);

                // If a media folder is set up, swap in the local copy once it resolves
                if (mediaRootHandle) {
                    resolveLocalMediaFile(tweet, item.url).then(file => {
                        if (!file) return; // not found locally, keep the remote URL
                        const objectUrl = URL.createObjectURL(file);
                        activeObjectUrls.push(objectUrl);
                        img.src = objectUrl;
                    });
                }
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
    const jsonStr = JSON.stringify(tweets, null, 2);
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