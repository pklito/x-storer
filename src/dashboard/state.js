// Central mutable state shared across modules.
//
// Import it as `import { state } from './state.js'` and read/write
// PROPERTIES on the object (e.g. `state.allTweets = [...]`).
// Never reassign the export itself (`state = ...`) — that would only
// rebind the local variable in that one file, not the shared object.

export const state = {
    allTweets: [],
    selectedTags: new Set(),   // tags included via normal click
    excludedTags: new Set(),   // tags excluded via shift-click
    searchTerm: '',
    currentEditTweetId: null,
    currentEditTagsDiv: null,

    // Tag Groups (categorization)
    tagGroups: ['Uncategorized'],     // ordered list of group names; 'Uncategorized' is implicit/default
    tagGroupAssignments: {},          // tag -> groupName (absent = Uncategorized)
    collapsedGroups: new Set(),       // group names currently collapsed in the sidebar

    // Search Tabs (saved filter combinations)
    searchTabs: [{ id: 'default', name: 'All', selectedTags: [], excludedTags: [], hiddenOnly: false }],
    activeTabId: 'default',
    defaultTabId: 'default', // which tab is auto-selected when the dashboard opens

    // Tag editor modal (per-tweet)
    currentQuoteTags: [], // tags being edited in modal, as Array of Strings

    filteredTweetsCache: [],
    renderedCount: 0,
    renderToken: 0, 

    // Local media folder access
    mediaRootHandle: null,        
    mediaPermissionGranted: false,
    mediaSubdirCache: new Map(),  
    activeObjectUrls: [],         

    // Mass tagging mode
    massTagModeActive: false,
    massTagSelectedTags: [],

    hiddenTags: new Set(), 
    showHiddenTags: false, 
};

export const RENDER_BATCH_SIZE = 200;
export const TAG_GROUPS_KEY = 'xbookmarks_tag_groups_v1';
export const SEARCH_TABS_KEY = 'xbookmarks_search_tabs_v1';
export const MEDIA_DB_NAME = 'media-folder-store';
export const MEDIA_DB_STORE = 'handles';
export const MEDIA_HANDLE_KEY = 'mediaRoot';
export const RECENTLY_REMOVED_KEY = 'xb_recently_removed';
export const HIDDEN_TAGS_KEY = 'xbookmarks_hidden_tags_v1';
export const SIDEBAR_WIDTH_KEY = 'xbookmarks_sidebar_width_v1';

export const BUILT_IN_TAG_NAMES = ['video', 'gif', 'text-only', 'cw', 'untagged'];