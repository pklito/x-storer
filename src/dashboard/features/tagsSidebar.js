import { state, BUILT_IN_TAG_NAMES } from '../state.js';
import { tagList, clearTagsBtn, tagMatchModeBtn, tagMatchModeLabel, searchInput } from '../dom.js';
import { tagGroupOf, saveTagGroupState, buildGroupTree, groupColorOf, groupIconOf, hexToRgba } from './tagGroups.js';


import { updateUI, getFilteredTweets, getExclusionOverlapCount, getBuiltInTagsForTweet, getAllTagNames, getAllTagCounts, getCoOccurringTagCounts } from './tweets.js';
import { reapplyActiveTab } from './searchTabs.js';

// Tags with more bookmarks than this get a bold chip in the sidebar.
const HEAVY_TAG_THRESHOLD = 50;
// Alpha for a group's background tint
const GROUP_TINT_ALPHA = 0.14;
// When in "match ALL" mode, tags with no overlap are hidden. they are grayed out instead if false
const HIDE_UNRELATED_INTERSECTION_TAGS = false;
// Tags with more bookmarks than this get a bold chip in the sidebar.


export function clearTagsBtnAction() {
    reapplyActiveTab();
    searchInput.value = '';
    state.searchTerm = '';
    updateUI();
}

//tagSearchTerm shows only tags that match. not to be confused with state.searchTerm, for tweets.
export function tagSearchInputUpdate(e) {
    state.tagSearchTerm = e.target.value.trim().toLowerCase();
    renderTagsSidebar();
}

export function toggleTagMatchMode() {
    state.tagMatchAll = !state.tagMatchAll;
    const icon = tagMatchModeBtn.querySelector('i');
    icon.className = state.tagMatchAll ? 'bi bi-toggle2-on' : 'bi bi-toggle2-off';
    tagMatchModeLabel.textContent = state.tagMatchAll ? 'All' : 'Any';
    tagMatchModeBtn.classList.toggle('mode-all', state.tagMatchAll);
    tagMatchModeBtn.classList.toggle('mode-any', !state.tagMatchAll);
    if(state.selectedTags.size > 1) //dont rerender tweets unless necessary
        updateUI(); 
    else
        renderTagsSidebar();
}

export function renderTagsSidebar() {

    const coOccurrenceMode = state.tagMatchAll && state.selectedTags.size > 0;
    const baseTweetsForCounts = coOccurrenceMode ? getFilteredTweets() : state.allTweets;
    const tagCounts = coOccurrenceMode ? getCoOccurringTagCounts(baseTweetsForCounts) : getAllTagCounts();
    if (coOccurrenceMode && !HIDE_UNRELATED_INTERSECTION_TAGS) {

        getAllTagNames().forEach(tag => {
            if (!(tag in tagCounts)) tagCounts[tag] = 0;
        });
    }
    state.selectedTags.forEach(tag => {
        if (!tagCounts[tag]) tagCounts[tag] = 0; // ensure selected tags are shown even if count is 0
    });
    state.excludedTags.forEach(tag => {
        if (!(!state.hiddenTags.has(tag) || state.showHiddenTags) || BUILT_IN_TAG_NAMES.includes(tag)) return;
        // In co-occurrence mode, a normal count is always 0 for an excluded
        // tag by construction — the base tweet set already has every tweet
        // containing it filtered out, so there's nothing left to count.
        // getExclusionOverlapCount answers a more useful question instead:
        // "if this exclusion were lifted, how many would come back" —
        // computed against everything else currently active (selection,
        // other exclusions, search).
        tagCounts[tag] = coOccurrenceMode ? getExclusionOverlapCount(tag) : (tagCounts[tag] || 0);
    });

    
    var selectedDifferent = state.selectedTags.symmetricDifference(state.tabSelectedTags);
    var excludedDifferent = state.excludedTags.symmetricDifference(state.tabExcludedTags);
    clearTagsBtn.style.display = (selectedDifferent.size > 0 || excludedDifferent.size > 0 || state.searchTerm.length > 0) ? 'flex' : 'none'; 

    tagList.replaceChildren();

    // --- Built-in tags (video / gif / text-only / cw) ---
    const builtInCounts = {};
    BUILT_IN_TAG_NAMES.forEach(name => { builtInCounts[name] = 0; });
    baseTweetsForCounts.forEach(t => {
        getBuiltInTagsForTweet(t).forEach(name => { builtInCounts[name]++; });
    });
    if (coOccurrenceMode) {
        // Same fix as the regular-tag exclusion handling above — an
        // excluded built-in (e.g. you've excluded "cw") would otherwise
        // always show 0 here too, for the same reason.
        BUILT_IN_TAG_NAMES.forEach(name => {
            if (state.excludedTags.has(name)) builtInCounts[name] = getExclusionOverlapCount(name);
        });
    }

    // In "gray out" mode, a built-in tag should still only appear at all
    // if it's relevant to the library *at large* (no point graying in
    // "gif" if you've never bookmarked one) — so visibility is gated on
    // the global count, while the number actually shown is the (possibly
    // zero) co-occurrence count.
    let builtInGlobalCounts = builtInCounts;
    if (coOccurrenceMode && !HIDE_UNRELATED_INTERSECTION_TAGS) {
        builtInGlobalCounts = {};
        BUILT_IN_TAG_NAMES.forEach(name => { builtInGlobalCounts[name] = 0; });
        state.allTweets.forEach(t => {
            getBuiltInTagsForTweet(t).forEach(name => { builtInGlobalCounts[name]++; });
        });
    }
    const builtInWithCounts = BUILT_IN_TAG_NAMES
        .filter(name => builtInGlobalCounts[name] > 0)
        .filter(name => !state.tagSearchTerm || name.toLowerCase().includes(state.tagSearchTerm));

    if (builtInWithCounts.length) {
        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        // While a search is active, force every group open — otherwise a
        // match could be sitting inside a group you'd previously collapsed
        // and you'd never see it.
        const collapsed = state.tagSearchTerm ? false : state.collapsedGroups.has('Built-in');
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        const caret = document.createElement('i');
        caret.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
        header.appendChild(caret);
        header.appendChild(document.createTextNode(` Built-in (${builtInWithCounts.length})`));
        header.addEventListener('click', () => {
            if (state.collapsedGroups.has('Built-in')) state.collapsedGroups.delete('Built-in');
            else state.collapsedGroups.add('Built-in');
            saveTagGroupState();
            renderTagsSidebar();
        });
        groupEl.appendChild(header);

        if (!collapsed) {
            const body = document.createElement('div');
            body.className = 'tag-group-body';
            builtInWithCounts.forEach(name => body.appendChild(createTagChip(name, builtInCounts[name])));
            groupEl.appendChild(body);
        }

        tagList.appendChild(groupEl);
    }

    const sortedTagNames = Object.keys(tagCounts)
        .filter(tag => !state.tagSearchTerm || tag.toLowerCase().includes(state.tagSearchTerm))
        .sort();
    if (sortedTagNames.length === 0) return;

    // Bucket tags by their assigned group (full "Parent/Sub" string, or a
    // plain top-level name), then fold that into a parent -> subgroups tree.
    const byGroup = new Map();
    state.tagGroups.forEach(g => byGroup.set(g, []));
    sortedTagNames.forEach(tag => {
        const group = tagGroupOf(tag);
        if (!byGroup.has(group)) byGroup.set(group, []); // safety net
        byGroup.get(group).push(tag);
    });

    const tree = buildGroupTree(byGroup);

    tree.forEach(node => {
        const totalCount = node.tags.length + node.subgroups.reduce((n, s) => n + s.tags.length, 0);
        if (totalCount === 0) return; // hide empty parents (and parents whose subgroups are all empty)

        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        const collapsed = state.tagSearchTerm ? false : state.collapsedGroups.has(node.name);
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        const caret = document.createElement('i');
        caret.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
        header.appendChild(caret);
        const icon = groupIconOf(node.name);
        if (icon) {
            const iconEl = document.createElement('i');
            iconEl.className = `bi bi-${icon} tag-group-icon`;
            header.appendChild(iconEl);
        }
        header.appendChild(document.createTextNode(` ${node.name} (${totalCount})`));
        const color = groupColorOf(node.name);
        if (color) groupEl.style.backgroundColor = hexToRgba(color, GROUP_TINT_ALPHA);
        header.addEventListener('click', () => {
            if (state.collapsedGroups.has(node.name)) state.collapsedGroups.delete(node.name);
            else state.collapsedGroups.add(node.name);
            saveTagGroupState();
            renderTagsSidebar();
        });
        groupEl.appendChild(header);

        if (!collapsed) {
            const body = document.createElement('div');
            body.className = 'tag-group-body';

            // Tags assigned directly to the parent (not inside a subgroup).
            node.tags.forEach(tag => body.appendChild(createTagChip(tag, tagCounts[tag])));

            // Subgroups, indented under the parent, each independently
            // collapsible (keyed by the full "Parent/Sub" name so it
            // doesn't clash with the parent's own collapse state).
            node.subgroups.forEach(sub => {
                if (sub.tags.length === 0) return;

                const subCollapsed = state.tagSearchTerm ? false : state.collapsedGroups.has(sub.fullName);
                const subEl = document.createElement('div');
                subEl.className = 'tag-subgroup';

                const subHeader = document.createElement('div');
                subHeader.className = 'tag-group-header tag-subgroup-header';
                const subCaret = document.createElement('i');
                subCaret.className = subCollapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
                subHeader.appendChild(subCaret);
                const subIcon = groupIconOf(sub.fullName);
                if (subIcon) {
                    const subIconEl = document.createElement('i');
                    subIconEl.className = `bi bi-${subIcon} tag-group-icon`;
                    subHeader.appendChild(subIconEl);
                }
                subHeader.appendChild(document.createTextNode(` ${sub.name} (${sub.tags.length})`));
                // Only paint its own background when this subgroup has an
                // EXPLICIT color (not just inherited) — otherwise leave it
                // transparent so the parent's tint (already on groupEl,
                // which this sits inside) shows through as one uniform
                // wash instead of stacking two translucent layers of the
                // same color into a slightly different shade.
                if (state.tagGroupColors[sub.fullName]) {
                    subEl.style.backgroundColor = hexToRgba(state.tagGroupColors[sub.fullName], GROUP_TINT_ALPHA);
                }
                subHeader.addEventListener('click', () => {
                    if (state.collapsedGroups.has(sub.fullName)) state.collapsedGroups.delete(sub.fullName);
                    else state.collapsedGroups.add(sub.fullName);
                    saveTagGroupState();
                    renderTagsSidebar();
                });
                subEl.appendChild(subHeader);

                if (!subCollapsed) {
                    const subBody = document.createElement('div');
                    subBody.className = 'tag-group-body';
                    sub.tags.forEach(tag => subBody.appendChild(createTagChip(tag, tagCounts[tag])));
                    subEl.appendChild(subBody);
                }

                body.appendChild(subEl);
            });

            groupEl.appendChild(body);
        }

        tagList.appendChild(groupEl);
    });
}

// A single tag chip. Click toggles inclusion (selectedTags); shift-click
// toggles exclusion (excludedTags), shown in red.
export function createTagChip(tag, count) {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    if (count > HEAVY_TAG_THRESHOLD) chip.classList.add('tag-chip-heavy');
    if (count === 0) chip.classList.add('tag-chip-zero-match'); // only ever reached via the backfill above — normal counts are never a key with value 0
    if (state.selectedTags.has(tag)) {
        chip.classList.add('active');
        if (state.tagMatchAll) chip.classList.add('match-all'); // purple instead of blue, so the color itself signals which mode you're filtering in
    }
    if (state.excludedTags.has(tag)) chip.classList.add('excluded');

    chip.textContent = `#${tag} (${count})`;

    chip.addEventListener('click', (e) => {
        if (e.shiftKey) {
            if (state.excludedTags.has(tag)) {
                state.excludedTags.delete(tag);
            } else {
                state.excludedTags.add(tag);
                state.selectedTags.delete(tag); // exclusion overrides inclusion
            }
        } else {
            if (state.selectedTags.has(tag)) {
                state.selectedTags.delete(tag);
            } else if(state.excludedTags.has(tag)) {
                state.excludedTags.delete(tag);
            } else {
                state.selectedTags.add(tag);
                state.excludedTags.delete(tag); // inclusion overrides exclusion
            }
        }
        updateUI();
    });

    return chip;
}