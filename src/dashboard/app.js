import { db } from '../utils/db.js';

// State
let allTweets = [];
let selectedTags = new Set();
let searchTerm = '';
let currentEditTweetId = null;

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

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    setupEventListeners();
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

// Resolve a tweet's media file on disk. Returns a File, or null if it can't
// be found locally (caller should fall back to the remote mediaUrl).
async function resolveLocalMediaFile(tweet) {
    if (!mediaRootHandle || !tweet.mediaUrl || !tweet.authorHandle) return null;
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
        filename = decodeURIComponent(new URL(tweet.mediaUrl).pathname.split('/').pop());
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

    if (selectedTags.size > 0) {
        feedTitle.textContent = `Filtered: ${Array.from(selectedTags).map(t => '#' + t).join(', ')}`;
    } else {
        feedTitle.textContent = 'All Bookmarks';
    }

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

        // Make Zooming faster, but causes some tweet jumping around
        // card.style.contentVisibility = 'auto';
        // card.style.containIntrinsicSize = '350px 480px';

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

        // Media
        if (tweet.mediaUrl) {
            const mediaDiv = document.createElement('div');
            mediaDiv.className = 'tweet-media';

            const img = document.createElement('img');
            img.src = tweet.mediaUrl; // remote URL as the immediate default
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.addEventListener('error', function () { this.parentElement.style.display = 'none'; });

            mediaDiv.appendChild(img);
            card.appendChild(mediaDiv);

            // If a media folder is set up, swap in the local copy once it resolves
            if (mediaRootHandle) {
                resolveLocalMediaFile(tweet).then(file => {
                    if (!file) return; // not found locally, keep the remote URL
                    const objectUrl = URL.createObjectURL(file);
                    activeObjectUrls.push(objectUrl);
                    img.src = objectUrl;
                });
            }
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

    tagList.replaceChildren();
    const sortedTags = Object.keys(tagCounts).sort();

    if (selectedTags.size > 0) {
        const clearBtn = document.createElement('div');
        clearBtn.className = 'tag-chip';
        clearBtn.style.color = 'var(--text-secondary)';
        clearBtn.style.borderColor = 'var(--card-border)';
        const clearIcon = document.createElement('i');
        clearIcon.className = 'bi bi-x-lg';
        clearBtn.appendChild(clearIcon);
        clearBtn.appendChild(document.createTextNode(' Clear'));
        clearBtn.addEventListener('click', () => { selectedTags.clear(); updateUI(); });
        tagList.appendChild(clearBtn);
    }

    sortedTags.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'tag-chip';
        if (selectedTags.has(tag)) chip.classList.add('active');

        chip.textContent = `#${tag} (${tagCounts[tag]})`;

        chip.addEventListener('click', () => {
            if (selectedTags.has(tag)) {
                selectedTags.delete(tag);
            } else {
                selectedTags.add(tag);
            }
            updateUI();
        });

        tagList.appendChild(chip);
    });
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
        if (tweet.mediaUrl) content += `![media](${tweet.mediaUrl})\n\n`;
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