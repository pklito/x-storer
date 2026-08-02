import { db } from '../../utils/db.js';
import { state } from '../state.js';
import {getAllTagNames} from './tweets.js';

import { tagModal, suggestionsBox, tagEditorContainer, tagInput } from '../dom.js';
import {refreshTweetBadges} from './grid.js';

export function openTagModal(tweetId, tagsDiv = null) {
    state.currentEditTweetId = tweetId;
    state.currentEditTagsDiv = tagsDiv;
    const tweet = state.allTweets.find(t => t.id === tweetId);
    if (tweet) {
        state.currentQuoteTags = [...(tweet.tags || [])]; // load existing tags into editor state
        renderTagCapsules();
        tagInput.value = '';
        tagModal.classList.add('active');
        tagInput.focus();
    }
}

export function closeTagModal() {
    tagModal.classList.remove('active');
    state.currentEditTweetId = null;
    state.currentQuoteTags = [];
    tagInput.value = '';
}

export async function saveTags() {
    if (!state.currentEditTweetId) return;

    // Auto-add pending text as a tag if user didn't press Enter/Comma
    const pendingText = tagInput.value.trim();
    if (pendingText) {
        addTagToEditor(pendingText);
        tagInput.value = '';
    }

    const tags = state.currentQuoteTags;

    try {
        await db.updateTweetTags(state.currentEditTweetId, tags);
        const tweet = state.allTweets.find(t => t.id === state.currentEditTweetId);
        if (tweet) {
            tweet.tags = tags;
            if(state.currentEditTagsDiv)
                refreshTweetBadges(state.currentEditTagsDiv, tweet);
        }
        closeTagModal();
        // updateUI(); i dont want this, makes me jump to the
    } catch (err) {
        console.error(err);
    }
}

export function tagInputUpdate(e) {
    const val = e.target.value.trim().toLowerCase();

    if (val.length < 1) {
        suggestionsBox.classList.remove('active');
        return;
    }

    // Suggestions logic
    const allTags = getAllTagNames();

    // Filter matches (exclude already added tags)
    const matches = Array.from(allTags).filter(tag =>
        tag.toLowerCase().includes(val) &&
        !state.currentQuoteTags.includes(tag)
    ).sort((a, b) => a.toLowerCase().indexOf(val) - b.toLowerCase().indexOf(val));

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
}

export function tagInputKeydown(e){
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
}

// Tag editor:

export function renderTagCapsules() {
    // Keep the input at the end, remove old capsules, re-append fresh ones.
    const capsules = tagEditorContainer.querySelectorAll('.tag-capsule');
    capsules.forEach(el => el.remove());

    const fragment = document.createDocumentFragment();
    state.currentQuoteTags.forEach((tag, index) => {
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

    tagEditorContainer.insertBefore(fragment, tagInput);
}

export function addTagToEditor(tag) {
    const cleanTag = tag.trim().replace(/^#/, ''); // remove # if user typed it
    if (cleanTag && !state.currentQuoteTags.includes(cleanTag)) {
        state.currentQuoteTags.push(cleanTag);
        renderTagCapsules();
    }
}

export function removeTagFromEditor(index) {
    state.currentQuoteTags.splice(index, 1);
    renderTagCapsules();
}
