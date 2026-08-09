import { state, TAG_GROUPS_KEY, HIDDEN_TAGS_KEY } from '../state.js';
import { tagGroupsModal, groupManageList, tagAssignList, toggleHiddenTagsBtn, newGroupInput } from '../dom.js';

import { getAllTagNames, getTagsByGroup } from './tweets.js';
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

// Splits a group name like "Purpose/Reminders" into its parent and sub
// parts. A plain name like "Quality" has no sub (sub: null). Only the
// first "/" counts, so "A/B/C" is parent "A", sub "B/C" — one level of
// nesting is all the sidebar/manage-modal render, deeper paths just show
// the whole remainder as the sub's label.
export function splitGroupPath(name) {
    const idx = name.indexOf('/');
    if (idx === -1) return { parent: name, sub: null };
    return { parent: name.slice(0, idx), sub: name.slice(idx + 1) };
}

// Folds the flat state.tagGroups list + a tag-bucket map (group name ->
// tags[]) into a parent -> subgroups tree, preserving the order groups
// appear in state.tagGroups. A parent that only exists implicitly (e.g.
// only "Purpose/Reminders" was ever added, never bare "Purpose") still
// gets a node here with an empty `tags` array, so callers don't need to
// special-case it.
//
// Returns: [{ name, tags, subgroups: [{ name, fullName, tags }] }, ...]
// `fullName` on a subgroup is the real group key ("Purpose/Reminders") —
// use that (not `name`) for assignment/rename/delete/reorder/collapse.
export function buildGroupTree(tagsByGroup) {
    const nodes = new Map(); // parent name -> node
    const order = [];
    state.tagGroups.forEach(fullName => {
        const { parent, sub } = splitGroupPath(fullName);
        let node = nodes.get(parent);
        if (!node) {
            node = { name: parent, tags: [], subgroups: [] };
            nodes.set(parent, node);
            order.push(node);
        }
        if (sub === null) {
            node.tags = tagsByGroup.get(fullName) || [];
        } else {
            node.subgroups.push({ name: sub, fullName, tags: tagsByGroup.get(fullName) || [] });
        }
    });
    return order;
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

export function saveHiddenTagsState() {
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
    if(!state.showHiddenTags) state.hiddenTags.forEach(tag => {state.excludedTags.delete(tag);});
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
    const tagsByGroup = getTagsByGroup(true);

    // Custom groups first, 'Uncategorized' last — matches the sidebar.
    // Nested tree so subgroups render indented under their parent.
    const tree = buildGroupTree(tagsByGroup).filter(node => node.name !== 'Uncategorized');
    tree.forEach(node => {
        groupManageList.appendChild(buildGroupManageCard(node.name, (node.tags || []).sort()));
        node.subgroups.forEach(sub => {
            groupManageList.appendChild(buildGroupManageCard(sub.fullName, (sub.tags || []).sort(), { indent: true }));
        });
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
    //im too lazy for a proper solution rn
    groupManageList.appendChild(document.createElement('div'));
    groupManageList.appendChild(document.createElement('div'));
    groupManageList.appendChild(document.createElement('div'));
    groupManageList.appendChild(document.createElement('div'));
    groupManageList.appendChild(document.createElement('div'));

    const icon = toggleHiddenTagsBtn.querySelector("i");
    if(state.showHiddenTags) {
        icon.classList.remove('bi-eye-slash');
        icon.classList.add('bi-eye-fill');
    } else {
        icon.classList.remove('bi-eye-fill');
        icon.classList.add('bi-eye-slash');
    }
}

let draggedGroupName = null;

// Moves `draggedName` in state.tagGroups to just before/after `targetName`.
// 'Uncategorized' never participates (it has no draggable card — see
// renderGroupManageList), so this can't disturb its pinned trailing position.
function reorderTagGroups(draggedName, targetName, insertAfter) {
    if (draggedName === targetName) return;
    const fromIndex = state.tagGroups.indexOf(draggedName);
    if (fromIndex === -1) return;
    state.tagGroups.splice(fromIndex, 1);
    let toIndex = state.tagGroups.indexOf(targetName);
    if (toIndex === -1) {
        state.tagGroups.push(draggedName);
        return;
    }
    if (insertAfter) toIndex++;
    state.tagGroups.splice(toIndex, 0, draggedName);
}

// Renames a group in place, carrying over every tag assignment and any
// collapsed-state that pointed at the old name.
function renameTagGroup(oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName) return;
    if (clean.toLowerCase() === 'uncategorized') {
        alert('"Uncategorized" is reserved and can\'t be used as a group name.');
        return;
    }
    const collision = state.tagGroups.some(g => g !== oldName && g.toLowerCase() === clean.toLowerCase());
    if (collision) {
        alert('A group with that name already exists.');
        return;
    }

    const idx = state.tagGroups.indexOf(oldName);
    if (idx !== -1) state.tagGroups[idx] = clean;

    Object.keys(state.tagGroupAssignments).forEach(tag => {
        if (state.tagGroupAssignments[tag] === oldName) state.tagGroupAssignments[tag] = clean;
    });

    if (state.collapsedGroups.has(oldName)) {
        state.collapsedGroups.delete(oldName);
        state.collapsedGroups.add(clean);
    }

    saveTagGroupState();
    renderGroupManageList();
    renderTagsSidebar();
}

function renameTagGroupPrompt(group) {
    const newName = prompt('Rename group:', group);
    if (newName === null) return;
    renameTagGroup(group, newName);
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

function buildGroupManageCard(fullName, tagsInGroup, { indent = false } = {}) {
    const card = document.createElement('div');
    card.className = indent ? 'group-manage-card group-manage-card-indent' : 'group-manage-card';

    // When indented (a subgroup card), show just the sub's own name
    // ("Reminders") rather than the full "Purpose/Reminders" key — the
    // indentation + parent card above already establish context.
    const displayLabel = indent ? splitGroupPath(fullName).sub : fullName;

    // Drag-to-reorder target — the whole card accepts drops, but only the
    // grip handle (below) can start a drag, so grabbing text elsewhere in
    // the card behaves normally.
    card.addEventListener('dragover', (e) => {
        if (!draggedGroupName || draggedGroupName === fullName) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = card.getBoundingClientRect();
        const insertAfter = (e.clientY - rect.top) > rect.height / 2;
        card.style.borderTop = insertAfter ? '' : '2px solid #3b82f6';
        card.style.borderBottom = insertAfter ? '2px solid #3b82f6' : '';
    });
    card.addEventListener('dragleave', () => {
        card.style.borderTop = '';
        card.style.borderBottom = '';
    });
    card.addEventListener('drop', (e) => {
        if (!draggedGroupName || draggedGroupName === fullName) return;
        e.preventDefault();
        const rect = card.getBoundingClientRect();
        const insertAfter = (e.clientY - rect.top) > rect.height / 2;
        reorderTagGroups(draggedGroupName, fullName, insertAfter);
        draggedGroupName = null;
        saveTagGroupState();
        renderGroupManageList();
    });

    const header = document.createElement('div');
    header.className = 'group-manage-card-header';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    header.appendChild(left);
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    header.appendChild(right);

    const grip = document.createElement('i');
    grip.className = 'bi bi-grip-vertical';
    grip.title = 'Drag to reorder';
    grip.style.cssText = 'cursor:grab;opacity:0.6;margin-right:2px;';
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
        draggedGroupName = fullName;
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.4';
    });
    grip.addEventListener('dragend', () => {
        draggedGroupName = null;
        card.style.opacity = '';
        card.style.borderTop = '';
        card.style.borderBottom = '';
    });
    left.appendChild(grip);

    const name = document.createElement('span');
    name.className = 'xb-group-name';
    name.textContent = `${displayLabel} (${tagsInGroup.length})`;
    left.appendChild(name);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'icon-btn';
    renameBtn.title = indent ? 'Rename subgroup (type a full "Parent/Sub" path to move it)' : 'Rename group';
    const renameIcon = document.createElement('i');
    renameIcon.className = 'bi bi-pencil';
    renameBtn.appendChild(renameIcon);
    renameBtn.addEventListener('click', () => renameTagGroupPrompt(fullName));
    right.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Delete group (tags return to Uncategorized)';
    const icon = document.createElement('i');
    icon.className = 'bi bi-trash3';
    delBtn.appendChild(icon);
    delBtn.addEventListener('click', () => deleteTagGroup(fullName));
    right.appendChild(delBtn);

    card.appendChild(header);

    // Chips for the tags currently in this group.
    card.appendChild(buildTagChipsRow(tagsInGroup, {
        removable: true,
        onRemove: tag => { setTagGroup(tag, 'Uncategorized'); renderGroupManageList(); },
        emptyText: fullName === 'Uncategorized' ? 'Nothing uncategorized.' : 'No tags in this group yet.'
    }));

    // Autocomplete input to add another tag to this group.
    if (fullName !== 'Uncategorized') {
        card.appendChild(buildTagAddInput({
            placeholder: 'Add a tag to this group…',
            isAlreadyIn: t => tagGroupOf(t) === fullName,
            onCommit: tag => { setTagGroup(tag, fullName); renderGroupManageList(); }
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

       const assigned = new Set(Object.keys(state.tagGroupAssignments));
        const matches = Array.from(getAllTagNames())
            .filter(t => !assigned.has(t) && t.toLowerCase().includes(q))
            .sort((a, b) => 100*(a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q)) + (a.length - b.length));
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