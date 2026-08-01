import { state, TAG_GROUPS_KEY, HIDDEN_TAGS_KEY } from '../state.js';
import { tagGroupsModal, groupManageList, tagAssignList, toggleHiddenTagsBtn, newGroupInput } from '../dom.js';

import { getAllTagNames } from './tweets.js';
import { renderTagsSidebar } from './tagsSidebar.js';
import { renderSearchTabs } from './searchTabs.js';

export function addTagGroupAction() {
    addTagGroup(newGroupInput.value);
    newGroupInput.value = '';
}

export function tagGroupInputKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addTagGroup(newGroupInput.value);
        newGroupInput.value = '';
    }
}

export function loadTagGroupState() {
    try {
        const raw = localStorage.getItem(TAG_GROUPS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.groups) && data.groups.length) state.tagGroups = data.groups;
            if (data.assignments) state.tagGroupAssignments = data.assignments;
            if (Array.isArray(data.collapsed)) state.collapsedGroups = new Set(data.collapsed);
        }
    } catch (err) {
        console.error('Failed to load tag group settings:', err);
    }
    if (!state.tagGroups.includes('Uncategorized')) state.tagGroups.push('Uncategorized');
}

export function saveTagGroupState() {
    try {
        localStorage.setItem(TAG_GROUPS_KEY, JSON.stringify({
            groups: state.tagGroups,
            assignments: state.tagGroupAssignments,
            collapsed: Array.from(state.collapsedGroups)
        }));
    } catch (err) {
        console.error('Failed to save tag group settings:', err);
    }
}

export function tagGroupOf(tag) {
    return state.tagGroupAssignments[tag] || 'Uncategorized';
}

function addTagGroup(name) {
    const clean = name.trim();
    if (!clean) return;
    const exists = state.tagGroups.some(g => g.toLowerCase() === clean.toLowerCase());
    if (exists) return;
    // Keep 'Uncategorized' at the end so custom groups list first
    state.tagGroups = state.tagGroups.filter(g => g !== 'Uncategorized').concat(clean, 'Uncategorized');
    saveTagGroupState();
    renderGroupManageList();
    renderTagAssignList();
    renderTagsSidebar();
}

function deleteTagGroup(group) {
    if (group === 'Uncategorized') return;
    state.tagGroups = state.tagGroups.filter(g => g !== group);
    Object.keys(state.tagGroupAssignments).forEach(tag => {
        if (state.tagGroupAssignments[tag] === group) delete state.tagGroupAssignments[tag];
    });
    state.collapsedGroups.delete(group);
    saveTagGroupState();
    renderGroupManageList();
    renderTagAssignList();
    renderTagsSidebar();
}

function setTagGroup(tag, group) {
    if (group === 'Uncategorized') {
        delete state.tagGroupAssignments[tag];
    } else {
        state.tagGroupAssignments[tag] = group;
    }
    saveTagGroupState();
    renderTagsSidebar();
}


export function loadHiddenTagsState() {
    try {
        const raw = localStorage.getItem(HIDDEN_TAGS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data)) state.hiddenTags = new Set(data);
        }
    } catch (err) {
        console.error('Failed to load hidden tags:', err);
    }
}

function saveHiddenTagsState() {
    try {
        localStorage.setItem(HIDDEN_TAGS_KEY, JSON.stringify(Array.from(state.hiddenTags)));
    } catch (err) {
        console.error('Failed to save hidden tags:', err);
    }
}

function addHiddenTag(tag) {
    state.hiddenTags.add(tag);
    state.excludedTags.add(tag);
    saveHiddenTagsState();
    renderGroupManageList();
    renderTagsSidebar();
}

function removeHiddenTag(tag) {
    state.hiddenTags.delete(tag);
    state.excludedTags.delete(tag);
    saveHiddenTagsState();
    renderGroupManageList();
    renderTagsSidebar();
}

export function toggleHiddenTagsBtnAction() {
    state.showHiddenTags = !state.showHiddenTags;
    state.hiddenTags.forEach(tag => {state.excludedTags.add(tag);});
    //update where tags are used
    renderTagsSidebar();
    renderGroupManageList();
    renderSearchTabs();
}

export function openTagGroupsModal() {
    renderGroupManageList();
    tagGroupsModal.classList.add('active');
}

export function closeTagGroupsModal() {
    tagGroupsModal.classList.remove('active');
}

function renderGroupManageList() {
    groupManageList.replaceChildren();
    tagAssignList.replaceChildren();
    // Union of tags that currently exist on a tweet AND tags that were
    // pre-assigned to a group but aren't in use yet (so an assignment you
    // just made doesn't seem to vanish before any tweet has that tag).
    const allTagNames = new Set([...getAllTagNames(), ...Object.keys(state.tagGroupAssignments)]);
    if(!state.showHiddenTags) state.hiddenTags.forEach(tag => allTagNames.delete(tag));

    const tagsByGroup = new Map();
    state.tagGroups.forEach(g => tagsByGroup.set(g, []));
    allTagNames.forEach(tag => {
        const g = tagGroupOf(tag);
        if (!tagsByGroup.has(g)) tagsByGroup.set(g, []);
        tagsByGroup.get(g).push(tag);
    });

    // Custom groups first, 'Uncategorized' last — matches the sidebar.
    const orderedGroups = state.tagGroups.filter(g => g !== 'Uncategorized');
    orderedGroups.forEach(group => {
        groupManageList.appendChild(buildGroupManageCard(group, (tagsByGroup.get(group) || []).sort()));
    });
    tagsByGroup.get('Uncategorized').sort().forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'group-manage-tag-chip';
        chip.appendChild(document.createTextNode('#' + tag));
        tagAssignList.appendChild(chip);
    });

    if (state.showHiddenTags) {
        groupManageList.appendChild(buildHiddenTagsCard(Array.from(state.hiddenTags).sort()));
    }

    const icon = toggleHiddenTagsBtn.querySelector("i");
    if(state.showHiddenTags) {
        icon.classList.remove('bi-eye-slash');
        icon.classList.add('bi-eye-fill');
    } else {
        icon.classList.remove('bi-eye-fill');
        icon.classList.add('bi-eye-slash');
    }
}

// Shared chip row builder used by both real groups and the hidden-tags card.
function buildTagChipsRow(tags, { removable = false, onRemove = null, emptyText }) {
    const chipsRow = document.createElement('div');
    chipsRow.className = 'group-manage-chips-row';

    if (tags.length === 0) {
        const empty = document.createElement('span');
        empty.textContent = emptyText;
        empty.className = 'xb-group-empty-text';
        chipsRow.appendChild(empty);
        return chipsRow;
    }

    tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'group-manage-tag-chip';
        chip.appendChild(document.createTextNode('#' + tag));
        if (removable) {
            const remove = document.createElement('button');
            remove.textContent = '×';
            remove.title = 'Remove from this group';
            remove.className = 'xb-chip-remove-btn';
            remove.addEventListener('click', () => onRemove(tag));
            chip.appendChild(remove);
        }
        chipsRow.appendChild(chip);
    });

    return chipsRow;
}

function buildGroupManageCard(group, tagsInGroup) {
    const card = document.createElement('div');
    card.className = 'group-manage-card';

    const header = document.createElement('div');
    header.className = 'group-manage-card-header';

    const name = document.createElement('span');
    name.className = 'xb-group-name';
    name.textContent = `${group} (${tagsInGroup.length})`;
    header.appendChild(name);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Delete group (tags return to Uncategorized)';
    const icon = document.createElement('i');
    icon.className = 'bi bi-trash3';
    delBtn.appendChild(icon);
    delBtn.addEventListener('click', () => deleteTagGroup(group));
    header.appendChild(delBtn);

    card.appendChild(header);

    // Chips for the tags currently in this group.
    card.appendChild(buildTagChipsRow(tagsInGroup, {
        removable: true,
        onRemove: tag => { setTagGroup(tag, 'Uncategorized'); renderGroupManageList(); },
        emptyText: group === 'Uncategorized' ? 'Nothing uncategorized.' : 'No tags in this group yet.'
    }));

    // Autocomplete input to add another tag to this group.
    if (group !== 'Uncategorized') {
        card.appendChild(buildTagAddInput({
            placeholder: 'Add a tag to this group…',
            isAlreadyIn: t => tagGroupOf(t) === group,
            onCommit: tag => { setTagGroup(tag, group); renderGroupManageList(); }
        }));
    }

    return card;
}

// Tags hidden via toggleHiddenTagsBtnAction. This is a separate persisted
// concept from group assignment (state.hiddenTags / HIDDEN_TAGS_KEY, not
// tagGroupAssignments), so it gets its own add/remove that goes through
// addHiddenTag/removeHiddenTag rather than setTagGroup.
function buildHiddenTagsCard(tags) {
    const card = document.createElement('div');
    card.className = 'group-manage-card';

    const header = document.createElement('div');
    header.className = 'group-manage-card-header';

    const name = document.createElement('span');
    name.className = 'xb-group-name hidden';
    name.textContent = `~Hidden Tags~ (${tags.length})`;
    header.appendChild(name);

    card.appendChild(header);
    card.appendChild(buildTagChipsRow(tags, {
        removable: true,
        onRemove: removeHiddenTag,
        emptyText: 'No hidden tags.'
    }));
    card.appendChild(buildTagAddInput({
        placeholder: 'Hide a tag…',
        isAlreadyIn: t => state.hiddenTags.has(t),
        onCommit: addHiddenTag
    }));

    return card;
}

// Self-contained type-to-add autocomplete — same interaction as the
// per-tweet tag editor (type, see matches, click or Enter to add), built
// fresh here since that editor's suggestion box is a singleton bound to
// its own input/state. `isAlreadyIn` filters suggestions down to tags not
// already in the target collection; `onCommit` does the actual add.
function buildTagAddInput({ placeholder, isAlreadyIn, onCommit }) {
    const wrap = document.createElement('div');
    wrap.className = 'xb-group-add-input-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.className = 'tag-input-wrapper smaller';
    wrap.appendChild(input);

    const suggestions = document.createElement('div');
    suggestions.className = 'tag-suggestions-list';
    wrap.appendChild(suggestions);

    function commit(tagName) {
        const clean = tagName.trim().replace(/^#/, '');
        if (!clean) return;
        onCommit(clean);
    }

    function showSuggestions(query) {
        const q = query.trim().toLowerCase();
        suggestions.style.display = 'none';
        if (!q) return;

        const allTagNames = new Set([...getAllTagNames(), ...Object.keys(state.tagGroupAssignments), ...state.hiddenTags]);
        const matches = Array.from(allTagNames)
            .filter(t => t.toLowerCase().includes(q) && !isAlreadyIn(t))
            .sort();
        if (matches.length === 0) return;

        suggestions.replaceChildren();
        matches.forEach(t => {
            const item = document.createElement('div');
            item.textContent = '#' + t;
            item.className = 'xb-group-add-suggestion-item';
            item.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so 'blur' doesn't fire first
            item.addEventListener('click', () => {
                input.value = '';
                suggestions.style.display = 'none';
                commit(t);
            });
            suggestions.appendChild(item);
        });
        suggestions.style.display = 'block';
    }

    input.addEventListener('input', () => showSuggestions(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim();
            if (val) {
                input.value = '';
                suggestions.style.display = 'none';
                commit(val);
            }
        } else if (e.key === 'Escape') {
            suggestions.style.display = 'none';
        }
    });
    input.addEventListener('blur', () => { suggestions.style.display = 'none'; });

    return wrap;
}