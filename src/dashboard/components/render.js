import { db } from '../../utils/db.js';
import { state } from './state.js';
import { feedTitle } from './dom.js';
import { getEffectiveTags } from './tags.js';
import { renderGrid } from './grid.js';
import { renderTagsSidebar } from './tagsSidebar.js';

export async function loadData() {
    try {
        state.allTweets = await db.getTweets();
        updateUI();
    } catch (err) {
        console.error('Failed to load tweets:', err);
    }
}

export function getFilteredTweets() {
    let filtered = state.allTweets;

    if (state.selectedTags.size > 0) {
        filtered = filtered.filter(t => getEffectiveTags(t).some(tag => state.selectedTags.has(tag)));
    }

    if (state.excludedTags.size > 0) {
        filtered = filtered.filter(t => !getEffectiveTags(t).some(tag => state.excludedTags.has(tag)));
    }

    if (state.searchTerm) {
        filtered = filtered.filter(t =>
            (t.text && t.text.toLowerCase().includes(state.searchTerm)) ||
            (t.authorName && t.authorName.toLowerCase().includes(state.searchTerm)) ||
            (t.authorHandle && t.authorHandle.toLowerCase().includes(state.searchTerm))
        );
    }

    return filtered;
}

export function updateUI() {
    const tweets = getFilteredTweets();

    const parts = [];
    if (state.selectedTags.size > 0) parts.push(Array.from(state.selectedTags).map(t => '#' + t).join(', '));
    if (state.excludedTags.size > 0) parts.push(Array.from(state.excludedTags).map(t => '−#' + t).join(', '));
    feedTitle.textContent = parts.length > 0 ? `Filtered: ${parts.join('  ')}` : 'All Bookmarks';

    renderGrid(tweets);
    renderTagsSidebar();
}
