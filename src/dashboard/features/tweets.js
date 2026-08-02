import { db } from '../../utils/db.js';
import { state } from '../state.js';
import { feedTitle } from '../dom.js';
import { renderGrid } from './grid.js';
import { renderTagsSidebar } from './tagsSidebar.js';
import { searchInput } from '../dom.js';
import { tagGroupOf } from './tagGroups.js';

let debounceTimer;
export function searchInputUpdate(e) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        state.searchTerm = e.target.value.toLowerCase();
        updateUI();
    }, 300);
}

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

    if (getExcludedOrHiddenTags().size > 0) {
        filtered = filtered.filter(t => !getEffectiveTags(t).some(tag => getExcludedOrHiddenTags().has(tag)));
    }

    if (state.searchTerm) {
        const match = state.searchTerm.match(/before:(\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))/);
        if (match) {
            const beforeDate = new Date(match[1]);
            filtered = filtered.filter(t => new Date(t.timestamp) <= beforeDate);
        }
        const matchAfter = state.searchTerm.match(/after:(\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))/);
        if (matchAfter) {
            const afterDate = new Date(matchAfter[1]);
            filtered = filtered.filter(t => new Date(t.timestamp) >= afterDate);
        }

        const searchTerm = state.searchTerm.replace(/before:\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/, '').replace(/after:\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/, '').trim();
        if (searchTerm) {
            filtered = filtered.filter(t =>
                (t.text && t.text.toLowerCase().includes(searchTerm)) ||
                (t.authorName && t.authorName.toLowerCase().includes(searchTerm)) ||
                (t.authorHandle && t.authorHandle.toLowerCase().includes(searchTerm))
            );
        }
    }

    return filtered;
}

export function updateUI() {
    const tweets = getFilteredTweets();

    const parts = [];
    if (state.selectedTags.size > 0) parts.push(Array.from(state.selectedTags).map(t => '#' + t).join(', '));
    if (state.excludedTags.size > 0) parts.push(Array.from(state.excludedTags).map(t => '−#' + t).join(', '));
    feedTitle.textContent = parts.length > 0 ? `Filtered: ${state.selectedTags.size} included, ${state.excludedTags.size} excluded` : 'All Bookmarks';

    renderGrid(tweets);
    renderTagsSidebar();
}


// TAGS

export function getBuiltInTagsForTweet(tweet) {
    const media = (tweet.media && tweet.media.length)
        ? tweet.media
        : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);

    const tags = [];
    if (media.some(m => m.type === 'video')) tags.push('video');
    if (media.some(m => m.type === 'gif')) tags.push('gif');
    if (media.length === 0) tags.push('text-only');
    if (tweet.isSensitive) tags.push('cw');
    if (!tweet.tags || tweet.tags.length === 0) tags.push('untagged');
    return tags;
}

// Stored tags + computed built-in tags, for filtering/search purposes only.
export function getEffectiveTags(tweet) {
    return (tweet.tags || []).concat(getBuiltInTagsForTweet(tweet));
}

export function getAllTagNames() {
    const set = new Set();
    state.allTweets.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
    if(!state.showHiddenTags) state.hiddenTags.forEach(tag => set.delete(tag));
    return Array.from(set).sort();
}

export function getAllTagCounts() {
    const tagCounts = {};
    state.allTweets.forEach(t => {
        (t.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });
    if(!state.showHiddenTags) state.hiddenTags.forEach(tag => delete tagCounts[tag]);
    return tagCounts;
}

export function getSelectedTags() {
    return state.selectedTags
}

export function getExcludedOrHiddenTags() {
    if(state.showHiddenTags) return state.excludedTags;
    return new Set([...state.excludedTags, ...state.hiddenTags]);
}

export function getTagsByGroup(includeGroupAssignments = false) {
    const allTagNames = new Set(getAllTagNames());
    if(includeGroupAssignments) {
        Object.keys(state.tagGroupAssignments).forEach(tag => allTagNames.add(tag));
    }
    // must erase if tagGroupAssignments has a hidden tag
    if(!state.showHiddenTags) state.hiddenTags.forEach(tag => allTagNames.delete(tag));

    const tagsByGroup = new Map();
    state.tagGroups.forEach(g => tagsByGroup.set(g, []));
    allTagNames.forEach(tag => {
        const g = tagGroupOf(tag);
        if (!tagsByGroup.has(g)) tagsByGroup.set(g, []);
        tagsByGroup.get(g).push(tag);
    }); 
    return tagsByGroup;
}