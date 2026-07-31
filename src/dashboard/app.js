import { state } from '@components/state.js';
import {
    massTagBtn, tagModal, tagInput, tagEditorContainer, searchInput,
    suggestionsBox, clearTagsBtn, configureTagsBtn, tagGroupsModal,
    newGroupInput, addGroupBtn, closeGroupsModalBtn, addTabBtn
} from '@components/dom.js';

import { loadData, updateUI, getFilteredTweets } from '@components/tweets.js';
import { initCarousel } from '@components/carousel.js';

import { loadTagGroupState, addTagGroup, openTagGroupsModal, closeTagGroupsModal } from '@components/tagGroups.js';
import { loadSearchTabsState, applyActiveTabSilently, renderSearchTabs, addSearchTab } from '@components/searchTabs.js';
import { createMediaFolderButton, initMediaFolder } from '@components/mediaFolder.js';
import { openMassTagSelectModal, endMassTagMode } from '@components/massTagging.js';
import { createImportButton, exportTweets, exportJSON } from '@components/importExport.js';
import { createRecentlyRemovedButton } from '@components/recentlyRemoved.js';
import { closeTagModal, saveTags } from '@components/tagModal.js';
import { addTagToEditor, removeTagFromEditor } from '@components/tagEditor.js';

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
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            state.searchTerm = e.target.value.toLowerCase();
            updateUI();
        }, 300);
    });

    document.getElementById('close-modal').addEventListener('click', closeTagModal);
    document.getElementById('save-tags').addEventListener('click', saveTags);
    tagModal.addEventListener('click', (e) => { if (e.target === tagModal) closeTagModal(); });

    document.getElementById('export-all-btn').addEventListener('click', () => exportTweets(getFilteredTweets()));
    document.getElementById('export-json-btn').addEventListener('click', () => exportJSON(getFilteredTweets()));

    // Clear tag filters (lives above the tag list, next to "Tags")
    clearTagsBtn.addEventListener('click', () => {
        state.selectedTags.clear();
        state.excludedTags.clear();
        updateUI();
    });

    massTagBtn.addEventListener('click', () => {
        if (state.massTagModeActive) {
            endMassTagMode();
        } else {
            openMassTagSelectModal();
        }
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

    // --- Tag Editor Logic (per-tweet tag modal input) ---

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
        else if (e.key === 'Backspace' && val === '' && state.currentQuoteTags.length > 0) {
            removeTagFromEditor(state.currentQuoteTags.length - 1);
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
        state.allTweets.forEach(t => (t.tags || []).forEach(tag => allTags.add(tag)));

        // Filter matches (exclude already added tags)
        const matches = Array.from(allTags).filter(tag =>
            tag.toLowerCase().includes(val) &&
            !state.currentQuoteTags.includes(tag)
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
