import { state, TAG_GROUPS_KEY } from '@components/state.js';
import { tagGroupsModal, groupManageList, tagAssignList } from '@components/dom.js';
import { getAllTagNames } from '@components/tweets.js';
import { renderTagsSidebar } from '@components/tagsSidebar.js';

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

export function addTagGroup(name) {
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

export function deleteTagGroup(group) {
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

export function setTagGroup(tag, group) {
    if (group === 'Uncategorized') {
        delete state.tagGroupAssignments[tag];
    } else {
        state.tagGroupAssignments[tag] = group;
    }
    saveTagGroupState();
    renderTagsSidebar();
}

export function openTagGroupsModal() {
    renderGroupManageList();
    tagGroupsModal.classList.add('active');
}

export function closeTagGroupsModal() {
    tagGroupsModal.classList.remove('active');
}

export function renderGroupManageList() {
    groupManageList.replaceChildren();
    tagAssignList.replaceChildren();
    // Union of tags that currently exist on a tweet AND tags that were
    // pre-assigned to a group but aren't in use yet (so an assignment you
    // just made doesn't seem to vanish before any tweet has that tag).
    const allTagNames = new Set([...getAllTagNames(), ...Object.keys(state.tagGroupAssignments)]);

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
}

function buildGroupManageCard(group, tagsInGroup) {
    const card = document.createElement('div');
    card.className = 'group-manage-card';

    const header = document.createElement('div');
    header.className = 'group-manage-card-header';
    const name = document.createElement('span');
    name.textContent = `${group} (${tagsInGroup.length})`;
    name.className = 'xb-group-name';
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
    const chipsRow = document.createElement('div');
    chipsRow.className = 'group-manage-chips-row';
    if (tagsInGroup.length === 0) {
        const empty = document.createElement('span');
        empty.textContent = group === 'Uncategorized' ? 'Nothing uncategorized.' : 'No tags in this group yet.';
        empty.className = 'xb-group-empty-text';
        chipsRow.appendChild(empty);
    } else {
        tagsInGroup.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'group-manage-tag-chip';
            chip.appendChild(document.createTextNode('#' + tag));

            const remove = document.createElement('button');
            remove.textContent = '×';
            remove.title = 'Remove from this group';
            remove.className = 'xb-chip-remove-btn';
            remove.addEventListener('click', () => { setTagGroup(tag, 'Uncategorized'); renderGroupManageList(); });
            chip.appendChild(remove);
            chipsRow.appendChild(chip);
        });
    }
    card.appendChild(chipsRow);

    // Autocomplete input to add another tag to this group.
    if (group !== 'Uncategorized') {
        card.appendChild(buildGroupTagAddInput(group));
    }

    return card;
}

// Self-contained type-to-add autocomplete for assigning a tag to `group` —
// same interaction as the per-tweet tag editor (type, see matches, click or
// Enter to add), built fresh here since that editor's suggestion box is a
// singleton bound to its own input/state.
function buildGroupTagAddInput(group) {
    const wrap = document.createElement('div');
    wrap.className = 'xb-group-add-input-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a tag to this group…';
    input.className = 'tag-input-wrapper smaller';
    wrap.appendChild(input);

    const suggestions = document.createElement('div');
    suggestions.className = 'tag-suggestions-list';
    wrap.appendChild(suggestions);

    function commit(tagName) {
        const clean = tagName.trim().replace(/^#/, '');
        if (!clean) return;
        setTagGroup(clean, group);
        renderGroupManageList();
    }

    function showSuggestions(query) {
        const q = query.trim().toLowerCase();
        suggestions.style.display = 'none';
        if (!q) return;

        const allTagNames = new Set([...getAllTagNames(), ...Object.keys(state.tagGroupAssignments)]);
        const matches = Array.from(allTagNames)
            .filter(t => t.toLowerCase().includes(q) && tagGroupOf(t) !== group)
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
