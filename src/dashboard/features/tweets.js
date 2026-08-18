import { db } from '../../utils/db.js';
import { state } from '../state.js';
import { feedTitle } from '../dom.js';
import { renderGrid } from './grid.js';
import { renderForceGraph } from './forceGraph.js';
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

// A date token after before:/after: can be "2026-01-01", "20260101"
// (no separators), or just "2026" (resolves to Jan 1 of that year).
// Alternation order matters: the dashed form is tried first, since a bare
// \d{8} or \d{4} would otherwise also happily match a prefix of it.
const DATE_TOKEN_SRC = String.raw`\d{4}-\d{2}-\d{2}|\d{8}|\d{4}`;
const BEFORE_DATE_RE = new RegExp(`before:(${DATE_TOKEN_SRC})`);
const AFTER_DATE_RE = new RegExp(`after:(${DATE_TOKEN_SRC})`);

// Parses whatever BEFORE_DATE_RE/AFTER_DATE_RE captured into a Date, or
// null if it's none of the three known shapes.
function parseFuzzyDate(token) {
    let m = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}`);
    m = token.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}`);
    m = token.match(/^(\d{4})$/);
    if (m) return new Date(`${m[1]}-01-01`);
    return null;
}

function getSearchTerm() {
    return state.searchTerm.replace(BEFORE_DATE_RE, '').replace(AFTER_DATE_RE, '').trim();
}

// Core of getFilteredTweets, but with the exclusion set as a parameter —
// lets a caller ask "what would match if the exclusions were different"
// without duplicating the selected-tags/search logic. `excludedSet` is
// still expected to already fold in hidden tags where relevant (callers
// use getExcludedOrHiddenTags() as the normal case).
function applyTagAndSearchFilters(excludedSet) {
    let filtered = state.allTweets;

    if (state.selectedTags.size > 0) {
        filtered = state.tagMatchAll
            ? filtered.filter(t => {
                const effective = new Set(getEffectiveTags(t));
                return Array.from(state.selectedTags).every(tag => effective.has(tag));
            })
            : filtered.filter(t => getEffectiveTags(t).some(tag => state.selectedTags.has(tag)));
    }

    if (excludedSet.size > 0) {
        filtered = filtered.filter(t => !getEffectiveTags(t).some(tag => excludedSet.has(tag)));
    }

    if (state.searchTerm) {
        const match = state.searchTerm.match(BEFORE_DATE_RE);
        if (match) {
            const beforeDate = parseFuzzyDate(match[1]);
            if (beforeDate) filtered = filtered.filter(t => new Date(t.timestamp) <= beforeDate);
        }
        const matchAfter = state.searchTerm.match(AFTER_DATE_RE);
        if (matchAfter) {
            const afterDate = parseFuzzyDate(matchAfter[1]);
            if (afterDate) filtered = filtered.filter(t => new Date(t.timestamp) >= afterDate);
        }

        const searchTerm = getSearchTerm();
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

export function getFilteredTweets() {
    return applyTagAndSearchFilters(getExcludedOrHiddenTags());
}

// For an excluded tag, "how many tweets would match right now if this one
// exclusion were lifted" — every other active filter (selected tags in
// ALL/ANY mode, every *other* exclusion, search) still applies. This is
// what the sidebar shows next to an excluded tag in ALL mode instead of
// always 0 — a tweet with this tag can never appear in the *actual*
// filtered results while it's excluded, so counting within those results
// is definitionally always zero; this counts within the "what if" set
// instead.
export function getExclusionOverlapCount(tag) {
    const excludedSet = new Set(getExcludedOrHiddenTags());
    excludedSet.delete(tag);
    const wouldBeTweets = applyTagAndSearchFilters(excludedSet);
    return wouldBeTweets.reduce((n, t) => n + (getEffectiveTags(t).includes(tag) ? 1 : 0), 0);
}

export function updateUI() {
    const tweets = getFilteredTweets();

    const parts = [];
    if (state.selectedTags.size > 0) parts.push(Array.from(state.selectedTags).map(t => '#' + t).join(', '));
    if (state.excludedTags.size > 0) parts.push(Array.from(state.excludedTags).map(t => '−#' + t).join(', '));
    const modeLabel = state.selectedTags.size > 1 ? (state.tagMatchAll ? ' [ALL]' : ' [ANY]') : '';
    feedTitle.textContent = `Filtered: ${state.selectedTags.size} included${modeLabel}, ${state.excludedTags.size} excluded` + (getSearchTerm() && getSearchTerm().length > 0 ? `, "${getSearchTerm()}"` : '');
    if (state.selectedTags.size === 0 && state.excludedTags.size === 0 && (!getSearchTerm() || getSearchTerm().length === 0)) {
        feedTitle.textContent = 'All Bookmarks';
    }
    state.currentShownTweets = tweets
    // renderGrid(tweets); // swapped out for the force graph for now — flip back any time
    renderForceGraph(tweets);
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
    if (tweet.source === 'manual_local') tags.push('fake');
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

var cachedTagCounts = {}
export function getAllTagCounts(lazy = false) {
    if(!lazy || Math.random() < 0.05){
        const tagCounts = {};
        state.allTweets.forEach(t => {
            (t.tags || []).forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                cachedTagCounts[tag] = tagCounts[tag]
            });
        });
        if(!state.showHiddenTags) state.hiddenTags.forEach(tag => delete tagCounts[tag]);
        cachedTagCounts = { ...tagCounts }
        return tagCounts;
    }
    return cachedTagCounts
}

// Like getAllTagCounts, but counts within an arbitrary tweet subset
// instead of the whole library — used by the sidebar in "match ALL" mode
// so counts reflect "how many of the currently-matching tweets also have
// this tag" rather than that tag's count across everything.
export function getCoOccurringTagCounts(tweetSubset) {
    const tagCounts = {};
    tweetSubset.forEach(t => {
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