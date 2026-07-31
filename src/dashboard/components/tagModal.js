import { db } from '@utils/db.js';
import { state } from '@components/state.js';
import { tagModal, tagInput } from '@components/dom.js';
import { renderTagCapsules, addTagToEditor } from '@components/tagEditor.js';

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
