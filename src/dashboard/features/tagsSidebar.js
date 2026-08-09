import { state, BUILT_IN_TAG_NAMES } from '../state.js';
import { tagList, clearTagsBtn, searchInput } from '../dom.js';
import { tagGroupOf, saveTagGroupState, buildGroupTree } from './tagGroups.js';

import { reapplyActiveTab } from './searchTabs.js';
// Tags with more bookmarks than this get a bold chip in the sidebar.
const HEAVY_TAG_THRESHOLD = 50;
import { updateUI, getBuiltInTagsForTweet, getAllTagCounts } from './tweets.js';

export function clearTagsBtnAction() {
    reapplyActiveTab();
    searchInput.value = '';
    state.searchTerm = '';
    updateUI();
}

export function renderTagsSidebar() {
    const tagCounts = getAllTagCounts();
    state.selectedTags.forEach(tag => {
        if (!tagCounts[tag]) tagCounts[tag] = 0; // ensure selected tags are shown even if count is 0
    });
    state.excludedTags.forEach(tag => {
        if (!tagCounts[tag] && (!state.hiddenTags.has(tag) || state.showHiddenTags) && !BUILT_IN_TAG_NAMES.includes(tag)) tagCounts[tag] = 0; // ensure excluded tags are shown even if count is 0
    });

    // Clear button lives in the header row above the list (see index.html);
    // just toggle its visibility here.
    var selectedDifferent = state.selectedTags.symmetricDifference(state.tabSelectedTags);
    var excludedDifferent = state.excludedTags.symmetricDifference(state.tabExcludedTags);
    clearTagsBtn.style.display = (selectedDifferent.size > 0 || excludedDifferent.size > 0 || state.searchTerm.length > 0) ? 'flex' : 'none';      

    tagList.replaceChildren();

    // --- Built-in tags (video / gif / text-only / cw) ---
    // Computed from media, never stored in the DB — kept in their own
    // section so they can't be edited/deleted like a real tag, but still
    // work with the same select/exclude click behavior via createTagChip.
    const builtInCounts = {};
    BUILT_IN_TAG_NAMES.forEach(name => { builtInCounts[name] = 0; });
    state.allTweets.forEach(t => {
        getBuiltInTagsForTweet(t).forEach(name => { builtInCounts[name]++; });
    });
    const builtInWithCounts = BUILT_IN_TAG_NAMES.filter(name => builtInCounts[name] > 0);

    if (builtInWithCounts.length) {
        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        const collapsed = state.collapsedGroups.has('Built-in');
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

    const sortedTagNames = Object.keys(tagCounts).sort();
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

        const collapsed = state.collapsedGroups.has(node.name);
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        const caret = document.createElement('i');
        caret.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
        header.appendChild(caret);
        header.appendChild(document.createTextNode(` ${node.name} (${totalCount})`));
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

                const subCollapsed = state.collapsedGroups.has(sub.fullName);
                const subEl = document.createElement('div');
                subEl.className = 'tag-subgroup';

                const subHeader = document.createElement('div');
                subHeader.className = 'tag-group-header tag-subgroup-header';
                const subCaret = document.createElement('i');
                subCaret.className = subCollapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
                subHeader.appendChild(subCaret);
                subHeader.appendChild(document.createTextNode(` ${sub.name} (${sub.tags.length})`));
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
    if (state.selectedTags.has(tag)) chip.classList.add('active');
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