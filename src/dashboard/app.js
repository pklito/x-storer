import { state } from './state.js';
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
import { createRecentlyRemovedButton } from './features/recentlyRemoved.js';
import { closeTagModal, saveTags, tagInputUpdate, tagInputKeydown,
    addTagToEditor, removeTagFromEditor } from './features/tagModal.js';

import { searchInputUpdate } from './features/tweets.js';
import { massTaggingBtnAction } from './features/massTagging.js';
import { clearTagsBtnAction } from './features/tagsSidebar.js';

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
    createRecentlyRemovedButton();
        initCarousel();
});

function setupEventListeners() {
    DOM.searchInput.addEventListener('input', searchInputUpdate);

    document.getElementById('close-modal').addEventListener('click', closeTagModal);
    document.getElementById('save-tags').addEventListener('click', saveTags);
    DOM.tagModal.addEventListener('click', (e) => { if (e.target === DOM.tagModal) closeTagModal(); });

    document.getElementById('export-all-btn').addEventListener('click', () => exportTweets(getFilteredTweets()));
    document.getElementById('export-json-btn').addEventListener('click', () => exportJSON(getFilteredTweets()));

    DOM.massTagBtn.addEventListener('click', massTaggingBtnAction);
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

    DOM.toggleHiddenTagsBtn.addEventListener('click', toggleHiddenTagsBtnAction);
}
