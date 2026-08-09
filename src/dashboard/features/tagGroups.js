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
            if (data.colors) state.tagGroupColors = data.colors;
            if (data.icons) state.tagGroupIcons = data.icons;
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
            collapsed: Array.from(state.collapsedGroups),
            colors: state.tagGroupColors,
            icons: state.tagGroupIcons
        }));
    } catch (err) {
        console.error('Failed to save tag group settings:', err);
    }
}

export function tagGroupOf(tag) {
    return state.tagGroupAssignments[tag] || 'Uncategorized';
}

// Effective display color for a group. A subgroup with no color of its
// own inherits its parent's — so setting "Purpose" once colors all its
// subgroups by default, and any subgroup can still override individually.
// Returns null (not a fallback color) when nothing's configured anywhere
// in the chain, so callers can tell "use the default CSS color" apart
// from "a real color was chosen".
export function groupColorOf(fullName) {
    if (state.tagGroupColors[fullName]) return state.tagGroupColors[fullName];
    const { parent, sub } = splitGroupPath(fullName);
    if (sub !== null && state.tagGroupColors[parent]) return state.tagGroupColors[parent];
    return null;
}

function setGroupColor(fullName, color) {
    if (!color) {
        delete state.tagGroupColors[fullName];
    } else {
        state.tagGroupColors[fullName] = color;
    }
    saveTagGroupState();
    renderTagsSidebar();
}

// Same inheritance rule as groupColorOf: a subgroup with no icon of its
// own falls back to its parent's.
export function groupIconOf(fullName) {
    if (state.tagGroupIcons[fullName]) return state.tagGroupIcons[fullName];
    const { parent, sub } = splitGroupPath(fullName);
    if (sub !== null && state.tagGroupIcons[parent]) return state.tagGroupIcons[parent];
    return null;
}

function setGroupIcon(fullName, icon) {
    const clean = (icon || '').trim().replace(/^bi-/, '');
    if (!clean) {
        delete state.tagGroupIcons[fullName];
    } else {
        state.tagGroupIcons[fullName] = clean;
    }
    saveTagGroupState();
    renderTagsSidebar();
}

// Converts a "#rrggbb" (or shorthand "#rgb") color into an rgba() string
// at the given alpha, for use as a translucent background tint — a flat
// hex background would fully hide the tag chips sitting on top of it.
export function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
// Returns: [{ name, tags, subgroups, explicit }, ...] where each subgroup
// is { name, fullName, tags }. `fullName` on a subgroup is the real group
// key ("Purpose/Reminders") — use that (not `name`) for
// assignment/rename/delete/reorder/collapse. `explicit` on a top-level
// node is false when the parent only exists because a subgroup implies it
// (only "Source/Debug" was ever added, "Source" itself never was) — such
// a parent isn't a real entry in state.tagGroups, so nothing should be
// assignable to it directly.
export function buildGroupTree(tagsByGroup) {
    const nodes = new Map(); // parent name -> node
    const order = [];
    state.tagGroups.forEach(fullName => {
        const { parent, sub } = splitGroupPath(fullName);
        let node = nodes.get(parent);
        if (!node) {
            node = { name: parent, tags: [], subgroups: [], explicit: false };
            nodes.set(parent, node);
            order.push(node);
        }
        if (sub === null) {
            node.tags = tagsByGroup.get(fullName) || [];
            node.explicit = true;
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
        groupManageList.appendChild(buildGroupManageCard(node.name, (node.tags || []).sort(), { explicit: node.explicit }));
        node.subgroups.forEach(sub => {
            groupManageList.appendChild(buildGroupManageCard(sub.fullName, (sub.tags || []).sort(), { indent: true }));
        });
    });
    tagsByGroup.get('Uncategorized').sort().forEach(tag => {
        tagAssignList.appendChild(buildUnassignedTagChip(tag));
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

    if (pendingFocusKey) {
        const key = pendingFocusKey;
        pendingFocusKey = null;
        // Wait a frame — the elements above were just appended and won't
        // reliably accept focus synchronously in every browser.
        requestAnimationFrame(() => {
            const target = groupManageList.querySelector(`[data-focus-key="${CSS.escape(key)}"] input`);
            if (target) target.focus();
        });
    }
}

let draggedGroupName = null;

// Which unassigned tag (if any) currently has its "match to an assigned
// tag" input expanded in place of its plain chip label.
let activeAssignTag = null;

// Set by an add-input's onCommit right before it triggers a re-render, so
// the newly-rebuilt input (a full DOM replacement, not a patch) can regain
// focus on the next render instead of leaving you re-clicking after every
// single tag. Consumed (reset to null) inside renderGroupManageList.
let pendingFocusKey = null;
const HIDDEN_TAGS_FOCUS_KEY = '__hidden_tags__';

// Purely a starting value for the <input type="color"> swatch when a
// group has no color configured yet — never written to state unless the
// person actually changes it.
const DEFAULT_SWATCH_COLOR = '#9ca3af';

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

// A modest curated set of icons for the <datalist> suggestion dropdown —
// not the full bootstrap-icons set (~1800 icons), just common ones. Any
// valid "bi-*" name works when typed, whether it's in this list or not;
// this is only a convenience, not a whitelist.
const ICON_SUGGESTIONS = [
    'palette', 'brush', 'image', 'images', 'camera', 'camera-video',
    'controller', 'joystick', 'dice-5', 'dice-5-fill',
    'code-slash', 'terminal', 'cpu', 'gear', 'gear-fill', 'tools', 'wrench', 'wrench-adjustable',
    'heart', 'heart-fill', 'star', 'star-fill', 'eye', 'eye-fill', 'eye-slash',
    'person', 'person-fill', 'people', 'people-fill', 'gem', 'lightning', 'lightning-fill', 'fire',
    'moon-stars', 'moon-stars-fill', 'sun', 'sun-fill', 'cloud', 'cloud-fill', 'cloud-lightning',
    'droplet', 'droplet-fill', 'snow', 'water', 'umbrella',
    'tree', 'flower1', 'flower2', 'flower3', 'bug', 'bug-fill', 'robot', 'rocket', 'rocket-fill',
    'easel', 'easel-fill', 'pencil', 'pencil-fill', 'pen', 'feather',
    'book', 'book-fill', 'bookmark', 'bookmark-fill', 'tag', 'tag-fill', 'tags', 'tags-fill',
    'folder', 'folder-fill', 'archive', 'archive-fill', 'box', 'box-fill',
    'gift', 'gift-fill', 'trophy', 'trophy-fill', 'award', 'award-fill',
    'shield', 'shield-fill', 'shield-check', 'shield-exclamation',
    'exclamation-triangle', 'exclamation-triangle-fill', 'question-circle', 'question-circle-fill',
    'chat', 'chat-fill', 'music-note', 'music-note-beamed', 'music-note-list',
    'film', 'camera-reels', 'camera-reels-fill', 'emoji-smile', 'emoji-heart-eyes'
];

let iconDatalistBuilt = false;
function ensureIconDatalist() {
    if (iconDatalistBuilt) return;
    iconDatalistBuilt = true;
    const list = document.createElement('datalist');
    list.id = 'xb-group-icon-options';
    ICON_SUGGESTIONS.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
    });
    document.body.appendChild(list);
}

// Icon-name text input (native <datalist> autocomplete) + a native color
// swatch, each with its own clear button that only appears once *this
// exact group* has that property explicitly set (not just inherited —
// see groupColorOf/groupIconOf). `onIconInput`/`onColorInput` fire on
// every keystroke/drag tick, before the value is committed to state, so
// the caller (the manage card) can live-preview its own icon badge and
// background tint without waiting for a full re-render.
function buildGroupStylePicker(fullName, { onIconInput, onColorInput } = {}) {
    ensureIconDatalist();
    const wrap = document.createElement('span');
    wrap.className = 'xb-group-style-wrap';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'xb-group-icon-wrap';
    const iconInput = document.createElement('input');
    iconInput.type = 'text';
    iconInput.className = 'xb-group-icon-input';
    iconInput.placeholder = 'icon…';
    iconInput.setAttribute('list', 'xb-group-icon-options');
    iconInput.value = groupIconOf(fullName) || '';
    iconInput.addEventListener('input', () => {
        if (onIconInput) onIconInput(iconInput.value.trim().replace(/^bi-/, ''));
    });
    iconInput.addEventListener('change', () => {
        setGroupIcon(fullName, iconInput.value);
        renderGroupManageList(); // discrete one-off commit (not a drag), safe to fully rebuild — this is what makes the clear button appear/disappear
    });
    iconWrap.appendChild(iconInput);
    if (state.tagGroupIcons[fullName]) {
        const clearIcon = document.createElement('button');
        clearIcon.className = 'icon-btn xb-group-style-clear';
        clearIcon.title = 'Remove icon';
        clearIcon.textContent = '×';
        clearIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            setGroupIcon(fullName, null);
            renderGroupManageList();
        });
        iconWrap.appendChild(clearIcon);
    }
    wrap.appendChild(iconWrap);

    const colorWrap = document.createElement('span');
    colorWrap.className = 'xb-group-color-wrap';
    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'xb-group-color-input';
    swatch.title = 'Background tint for this group';
    swatch.value = groupColorOf(fullName) || DEFAULT_SWATCH_COLOR;
    swatch.addEventListener('input', () => {
        setGroupColor(fullName, swatch.value); // already cheap/frequent-safe — only re-renders the sidebar, not this modal
        if (onColorInput) onColorInput(swatch.value);
    });
    colorWrap.appendChild(swatch);
    if (state.tagGroupColors[fullName]) {
        const clearColor = document.createElement('button');
        clearColor.className = 'icon-btn xb-group-style-clear';
        clearColor.title = 'Reset background tint';
        clearColor.textContent = '×';
        clearColor.addEventListener('click', (e) => {
            e.stopPropagation();
            setGroupColor(fullName, null);
            renderGroupManageList();
        });
        colorWrap.appendChild(clearColor);
    }
    wrap.appendChild(colorWrap);

    return wrap;
}

function buildGroupManageCard(fullName, tagsInGroup, { indent = false, explicit = true } = {}) {
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

    const previewIcon = document.createElement('i');
    const startingIcon = groupIconOf(fullName);
    previewIcon.className = `bi ${startingIcon ? 'bi-' + startingIcon : ''} xb-group-name-icon`;
    left.appendChild(previewIcon);

    const name = document.createElement('span');
    name.className = 'xb-group-name';
    name.textContent = explicit ? `${displayLabel} (${tagsInGroup.length})` : displayLabel;
    left.appendChild(name);

    if(explicit) {
        const startingColor = groupColorOf(fullName);
        if (startingColor) card.style.backgroundColor = hexToRgba(startingColor, 0.12);

        right.appendChild(buildGroupStylePicker(fullName, {
            onIconInput: val => { previewIcon.className = `bi ${val ? 'bi-' + val : ''} xb-group-name-icon`; },
            onColorInput: val => { card.style.backgroundColor = hexToRgba(val, 0.12); }
        }));

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
    }

    card.appendChild(header);

    // Chips for the tags currently in this group.
    card.appendChild(buildTagChipsRow(tagsInGroup, {
        removable: true,
        onRemove: tag => { setTagGroup(tag, 'Uncategorized'); renderGroupManageList(); },
        emptyText: fullName === 'Uncategorized' ? 'Nothing uncategorized.' : explicit ? 'No tags in this group yet.' : `${fullName} hasn't been created`
    }));

    // Autocomplete input to add another tag to this group. Hidden for a
    // purely implicit parent (explicit === false) — e.g. only
    // "Source/Debug" was ever added, so "Source" isn't a real group you
    // can assign tags into directly; only its subgroup card gets one.
    if (fullName !== 'Uncategorized' && explicit) {
        const addInput = buildTagAddInput({
            placeholder: 'Add a tag to this group…',
            candidates: () => Array.from(getAllTagNames()).filter(t => tagGroupOf(t) === 'Uncategorized'),
            onCommit: tag => {
                setTagGroup(tag, fullName);
                pendingFocusKey = fullName; // re-render rebuilds this input from scratch — reclaim focus so multi-tag entry doesn't need a re-click each time
                renderGroupManageList();
            }
        });
        addInput.dataset.focusKey = fullName;
        card.appendChild(addInput);
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
    const hideInput = buildTagAddInput({
        placeholder: 'Hide a tag…',
        candidates: () => Array.from(getAllTagNames()).filter(t => !state.hiddenTags.has(t)),
        onCommit: tag => {
            pendingFocusKey = HIDDEN_TAGS_FOCUS_KEY; // addHiddenTag() re-renders the list — reclaim focus so multi-tag entry doesn't need a re-click each time
            addHiddenTag(tag);
        }
    });
    hideInput.dataset.focusKey = HIDDEN_TAGS_FOCUS_KEY;
    card.appendChild(hideInput);

    return card;
}

// A clickable chip for an unassigned tag. Clicking it swaps its plain
// label for an inline "match to an assigned tag" input — pick (or type)
// any already-grouped tag and this tag joins that exact group (including
// subgroups), so you never have to remember/type a group name by hand.
function buildUnassignedTagChip(tag) {
    const chip = document.createElement('span');
    chip.className = 'group-manage-tag-chip group-manage-tag-chip-clickable';

    if (activeAssignTag !== tag) {
        chip.appendChild(document.createTextNode('#' + tag));
        chip.title = 'Click to assign by matching an already-grouped tag';
        chip.addEventListener('click', () => {
            activeAssignTag = tag;
            renderGroupManageList();
        });
        return chip;
    }

    chip.classList.add('active');
    const addInput = buildTagAddInput({
        placeholder: `Match "${tag}" to a tag…`,
        candidates: () => Array.from(getAllTagNames()).filter(t => t !== tag && tagGroupOf(t) !== 'Uncategorized'),
        requireMatch: true, // committing arbitrary text means nothing here — must resolve to a real, grouped tag
        onCommit: matchedTag => {
            setTagGroup(tag, tagGroupOf(matchedTag));
            activeAssignTag = null;
            renderGroupManageList();
        },
        onBlur: () => {
            // Deferred: if a click on a *different* unassigned chip is what
            // caused this blur, that click's own handler already reassigned
            // activeAssignTag by the time this runs, so the check below
            // no-ops instead of clobbering the new selection or (worse)
            // re-rendering mid-click and dropping the click's target node.
            setTimeout(() => {
                if (activeAssignTag === tag) {
                    activeAssignTag = null;
                    renderGroupManageList();
                }
            }, 0);
        }
    });
    chip.appendChild(addInput);
    requestAnimationFrame(() => addInput.querySelector('input')?.focus());

    return chip;
}

// Self-contained type-to-add/type-to-match autocomplete. Used for:
//  - adding an existing tag into a group ("Add a tag to this group…")
//  - hiding a tag ("Hide a tag…")
//  - matching an unassigned tag to an already-assigned one, so it inherits
//    that tag's group without you needing to remember the group's name
//
// `candidates` is a function (not an array) so the suggestion pool reflects
// live state on every keystroke without the caller rebuilding the box.
// `requireMatch: true` restricts Enter/Tab to committing an exact existing
// candidate — used for the "match" flow, where committing arbitrary typed
// text wouldn't mean anything. `onBlur` fires only if the box closes
// without a commit (used to collapse an inline chip back to its label).
function buildTagAddInput({ placeholder, candidates, requireMatch = false, onCommit, onBlur }) {
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

    let topSuggestion = null;
    let committed = false;

    function getMatches(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return candidates()
            .filter(t => t.toLowerCase().includes(q))
            .sort((a, b) => 100 * (a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q)) + (a.length - b.length));
    }

    function commit(raw) {
        const clean = (raw || '').trim().replace(/^#/, '');
        if (!clean) return;
        if (requireMatch) {
            const exact = candidates().find(t => t.toLowerCase() === clean.toLowerCase());
            if (!exact) return; // must resolve to a real, existing tag
            committed = true;
            onCommit(exact);
            return;
        }
        committed = true;
        onCommit(clean);
    }

    function showSuggestions(query) {
        const matches = getMatches(query);
        topSuggestion = matches.length > 0 ? matches[0] : null;
        suggestions.style.display = 'none';
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
            if (!val) return;
            commit(requireMatch ? (topSuggestion || val) : val);
            if (committed) {
                input.value = '';
                suggestions.style.display = 'none';
            }
        } else if (e.key === 'Tab' && input.value.trim() && topSuggestion) {
            e.preventDefault();
            commit(topSuggestion);
            input.value = '';
            suggestions.style.display = 'none';
        } else if (e.key === 'Escape') {
            suggestions.style.display = 'none';
            input.blur();
        }
    });
    input.addEventListener('blur', () => {
        suggestions.style.display = 'none';
        if (!committed && onBlur) onBlur();
    });

    return wrap;
}