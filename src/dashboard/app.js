import { state } from './state.js';
import {
    tagModal, tagInput, tagEditorContainer, 
    suggestionsBox,  configureTagsBtn, tagGroupsModal,
    newGroupInput, addGroupBtn, closeGroupsModalBtn, addTabBtn,
     searchInput, massTagBtn, clearTagsBtn, toggleHiddenTagsBtn
} from './dom.js';

import { loadData, updateUI, getFilteredTweets } from './features/tweets.js';
import { initCarousel } from './features/carousel.js';

import { loadTagGroupState, tagGroupInputKeydown, addTagGroupAction, openTagGroupsModal, closeTagGroupsModal, toggleHiddenTagsBtnAction } from './features/tagGroups.js';
import { loadSearchTabsState, applyActiveTabSilently, renderSearchTabs, addSearchTab } from './features/searchTabs.js';
import { createMediaFolderButton, initMediaFolder } from './features/mediaFolder.js';
import { createImportButton, exportTweets, exportJSON } from './features/importExport.js';
import { createRecentlyRemovedButton } from './features/recentlyRemoved.js';
import { closeTagModal, saveTags, tagInputUpdate, tagInputKeydown } from './features/tagModal.js';
import { addTagToEditor, removeTagFromEditor } from './features/tagEditor.js';

import { searchInputUpdate } from './features/tweets.js';
import { massTaggingBtnAction } from './features/massTagging.js';
import { clearTagsBtnAction } from './features/tagsSidebar.js';

document.addEventListener('DOMContentLoaded', async () => {
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
    searchInput.addEventListener('input', searchInputUpdate);

    document.getElementById('close-modal').addEventListener('click', closeTagModal);
    document.getElementById('save-tags').addEventListener('click', saveTags);
    tagModal.addEventListener('click', (e) => { if (e.target === tagModal) closeTagModal(); });

    document.getElementById('export-all-btn').addEventListener('click', () => exportTweets(getFilteredTweets()));
    document.getElementById('export-json-btn').addEventListener('click', () => exportJSON(getFilteredTweets()));

    massTagBtn.addEventListener('click', massTaggingBtnAction);
    clearTagsBtn.addEventListener('click', clearTagsBtnAction);
    // Tag Groups configuration modal
    configureTagsBtn.addEventListener('click', openTagGroupsModal);
    closeGroupsModalBtn.addEventListener('click', closeTagGroupsModal);

    tagGroupsModal.addEventListener('click', (e) => { if (e.target === tagGroupsModal) closeTagGroupsModal(); });
    addGroupBtn.addEventListener('click', addTagGroupAction);
    
    newGroupInput.addEventListener('keydown', tagGroupInputKeydown);

    // Search tabs
    addTabBtn.addEventListener('click', addSearchTab);

    // --- Tag Editor Logic (per-tweet tag modal input) ---

    // Focus input when clicking anywhere in the container
    tagEditorContainer.addEventListener('click', () => tagInput.focus());

    tagInput.addEventListener('keydown', tagInputKeydown);
    tagInput.addEventListener('input', tagInputUpdate);

    // Hide suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!tagEditorContainer.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.remove('active');
        }
    });

    toggleHiddenTagsBtn.addEventListener('click', toggleHiddenTagsBtnAction);
}
