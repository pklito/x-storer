import { state, SIDEBAR_WIDTH_KEY } from './state.js';
// import {
//     tagModal, tagInput, tagEditorContainer, 
//     suggestionsBox,  configureTagsBtn, tagGroupsModal,
//     newGroupInput, addGroupBtn, closeGroupsModalBtn, addTabBtn,
//      searchInput, massTagBtn, clearTagsBtn, toggleHiddenTagsBtn
// } from './dom.js';
import * as DOM from './dom.js';

import { loadData, updateUI, getFilteredTweets } from './features/tweets.js';
import { initCarousel } from './features/carousel.js';

import { loadHiddenTagsState ,loadTagGroupState, tagGroupInputKeydown, addTagGroupAction, openTagGroupsModal, closeTagGroupsModal, toggleHiddenTagsBtnAction } from './features/tagGroups.js';
import { loadSearchTabsState, applyActiveTabSilently, renderSearchTabs, addSearchTab } from './features/searchTabs.js';
import { createMediaFolderButton, initMediaFolder } from './features/mediaFolder.js';
import { createImportButton, exportTweets, exportJSON } from './features/importExport.js';
import { createFakeTweetButton } from './features/fakeTweet.js';
import { createRecentlyRemovedButton } from './features/recentlyRemoved.js';
import { closeTagModal, saveTags, tagInputUpdate, tagInputKeydown,
    addTagToEditor, removeTagFromEditor } from './features/tagModal.js';

import { searchInputUpdate } from './features/tweets.js';
import { setupEventHandlersMassTagging } from './features/massTagging.js';
import { setupEventHandlersTagAll } from './features/tagAll.js';

import { clearTagsBtnAction, tagSearchInputUpdate, toggleTagMatchMode } from './features/tagsSidebar.js';
import { initViewModeSwitch, getViewMode } from './features/viewMode.js';

document.addEventListener('DOMContentLoaded', async () => {
    loadHiddenTagsState();
    loadTagGroupState();
    loadSearchTabsState();
    applyActiveTabSilently();
    await loadData();
    setupEventListeners();
    renderSearchTabs();
    createMediaFolderButton();
    await initMediaFolder();
    createImportButton();
    createFakeTweetButton();
    createRecentlyRemovedButton();
        initCarousel();
});

function setupEventListeners() {
    initSidebarResize();
    setupEventHandlersMassTagging();
    setupEventHandlersTagAll();


    initViewModeSwitch();

    DOM.searchInput.addEventListener('input', searchInputUpdate);

    document.getElementById('close-modal').addEventListener('click', closeTagModal);
    document.getElementById('save-tags').addEventListener('click', saveTags);
    DOM.tagModal.addEventListener('click', (e) => { if (e.target === DOM.tagModal) closeTagModal(); });

    document.getElementById('export-all-btn').addEventListener('click', () => exportTweets(getFilteredTweets()));

    document.getElementById('export-json-btn').addEventListener('click', () => {
       const includeHidden = document.getElementById('export-include-hidden-checkbox').checked;
       exportJSON(includeHidden ? state.allTweets : getFilteredTweets());
   });

    DOM.clearTagsBtn.addEventListener('click', clearTagsBtnAction);
    // Tag Groups configuration modal
    DOM.configureTagsBtn.addEventListener('click', openTagGroupsModal);
    DOM.closeGroupsModalBtn.addEventListener('click', closeTagGroupsModal);

    DOM.tagGroupsModal.addEventListener('click', (e) => { if (e.target === DOM.tagGroupsModal) closeTagGroupsModal(); });
    DOM.addGroupBtn.addEventListener('click', addTagGroupAction);
    
    DOM.newGroupInput.addEventListener('keydown', tagGroupInputKeydown);

    // Search tabs
    DOM.addTabBtn.addEventListener('click', addSearchTab);

    // --- Tag Editor Logic (per-tweet tag modal input) ---

    // Focus input when clicking anywhere in the container
    DOM.tagEditorContainer.addEventListener('click', () => DOM.tagInput.focus());

    DOM.tagInput.addEventListener('keydown', tagInputKeydown);
    DOM.tagInput.addEventListener('input', tagInputUpdate);

    // Hide suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!DOM.tagEditorContainer.contains(e.target) && !DOM.suggestionsBox.contains(e.target)) {
            DOM.suggestionsBox.classList.remove('active');
        }
    });

    document.getElementById('tag-search-input').addEventListener('input', tagSearchInputUpdate);
    DOM.tagMatchModeBtn.addEventListener('click', toggleTagMatchMode);

    DOM.toggleHiddenTagsBtn.addEventListener('click', toggleHiddenTagsBtnAction);
}

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = 240; // matches .app-container's original 240px track

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// The variable lives on .app-container (not .sidebar) because
// grid-template-columns is defined there — a custom property set on a
// child never cascades back up to affect its parent's own rules.
function setSidebarWidth(container, width) {
    const clamped = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    container.style.setProperty('--sidebar-width', clamped + 'px');
    return clamped;
}

// Call once at startup (e.g. alongside your other init*() calls). Safe to
// call even if .app-container/.sidebar aren't in the DOM yet — it just no-ops.
export function initSidebarResize() {
    if (!DOM.appContainer || !DOM.sidebar) return;

    // Restore last-used width before the handle is even attached, so there's
    // no flash of the default width on reload.
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
    if (!Number.isNaN(saved)) setSidebarWidth(DOM.appContainer, saved);

    const handle = document.createElement('div');
    handle.className = 'sidebar-resize-handle';
    DOM.sidebar.appendChild(handle);

    let startX = 0;
    let startWidth = 0;

    function onPointerMove(e) {
        const delta = e.clientX - startX; // dragging right = wider (sidebar is on the left)
        setSidebarWidth(DOM.appContainer, startWidth + delta);
    }

    function onPointerUp() {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.body.classList.remove('sidebar-resizing');
        DOM.sidebar.classList.remove('resizing');
        const finalWidth = DOM.sidebar.getBoundingClientRect().width;
        try {
            localStorage.setItem(SIDEBAR_WIDTH_KEY, Math.round(finalWidth));
        } catch (err) {
            console.error('Failed to save sidebar width:', err);
        }
    }

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = DOM.sidebar.getBoundingClientRect().width;
        document.body.classList.add('sidebar-resizing');
        DOM.sidebar.classList.add('resizing');
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    });

    // Double-click the handle to reset to the default width.
    handle.addEventListener('dblclick', () => {
        setSidebarWidth(DOM.appContainer, DEFAULT_SIDEBAR_WIDTH);
        try {
            localStorage.removeItem(SIDEBAR_WIDTH_KEY);
        } catch (err) {
            console.error('Failed to clear saved sidebar width:', err);
        }
    });
}

