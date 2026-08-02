import { state, BUILT_IN_TAG_NAMES } from '../state.js';
import { tagList, clearTagsBtn } from '../dom.js';
import { tagGroupOf, saveTagGroupState } from './tagGroups.js';
import { updateUI, getBuiltInTagsForTweet, getAllTagCounts } from './tweets.js';

export function clearTagsBtnAction() {
    state.selectedTags.clear();
    state.excludedTags.clear();
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
    clearTagsBtn.style.display = (state.selectedTags.size > 0 || state.excludedTags.size > 0) ? 'flex' : 'none';

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

    // Bucket tags by their assigned group, in tagGroups order
    const byGroup = new Map();
    state.tagGroups.forEach(g => byGroup.set(g, []));
    sortedTagNames.forEach(tag => {
        const group = tagGroupOf(tag);
        if (!byGroup.has(group)) byGroup.set(group, []); // safety net
        byGroup.get(group).push(tag);
    });

    state.tagGroups.forEach(group => {
        const tagsInGroup = byGroup.get(group) || [];
        if (tagsInGroup.length === 0) return; // hide empty groups from the sidebar

        const groupEl = document.createElement('div');
        groupEl.className = 'tag-group';

        const collapsed = state.collapsedGroups.has(group);
        const header = document.createElement('div');
        header.className = 'tag-group-header';
        const caret = document.createElement('i');
        caret.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
        header.appendChild(caret);
        header.appendChild(document.createTextNode(` ${group} (${tagsInGroup.length})`));
        header.addEventListener('click', () => {
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            saveTagGroupState();
            renderTagsSidebar();
        });
        groupEl.appendChild(header);

        if (!collapsed) {
            const body = document.createElement('div');
            body.className = 'tag-group-body';
            tagsInGroup.forEach(tag => body.appendChild(createTagChip(tag, tagCounts[tag])));
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
