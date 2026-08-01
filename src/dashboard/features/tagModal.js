import { db } from '../../utils/db.js';
import { state } from '../state.js';
import { tagModal, tagInput } from '../dom.js';
import { renderTagCapsules, addTagToEditor } from './tagEditor.js';

import { suggestionsBox } from '../dom.js';

export function openTagModal(tweetId) {
    state.currentEditTweetId = tweetId;
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
        if (tweet) tweet.tags = tags;
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