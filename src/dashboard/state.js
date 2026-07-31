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

    // Tag Groups (categorization)
    tagGroups: ['Uncategorized'],     // ordered list of group names; 'Uncategorized' is implicit/default
    tagGroupAssignments: {},          // tag -> groupName (absent = Uncategorized)
    collapsedGroups: new Set(),       // group names currently collapsed in the sidebar

    // Search Tabs (saved filter combinations)
    searchTabs: [{ id: 'default', name: 'All', selectedTags: [], excludedTags: [] }],
    activeTabId: 'default',

    // Tag editor modal (per-tweet)
    currentQuoteTags: [], // tags being edited in modal, as Array of Strings

    // Batched async grid rendering (avoid building 5000 cards in one blocking pass)
    filteredTweetsCache: [],
    renderedCount: 0,
    masonryColumns: [],
    renderToken: 0, // bumped every time a new render starts, so stale in-flight batches bail out

    // Local media folder access
    mediaRootHandle: null,        // FileSystemDirectoryHandle for the chosen root folder
    mediaPermissionGranted: false, // whether we currently have read access to mediaRootHandle
    mediaSubdirCache: new Map(),  // authorHandle -> FileSystemDirectoryHandle | null
    activeObjectUrls: [],         // object URLs created for the current render, revoked on next render

    // Mass tagging mode
    massTagModeActive: false,
    massTagSelectedTags: [],
};

export const RENDER_BATCH_SIZE = 100;
export const TAG_GROUPS_KEY = 'xbookmarks_tag_groups_v1';
export const SEARCH_TABS_KEY = 'xbookmarks_search_tabs_v1';
export const MEDIA_DB_NAME = 'media-folder-store';
export const MEDIA_DB_STORE = 'handles';
export const MEDIA_HANDLE_KEY = 'mediaRoot';
export const RECENTLY_REMOVED_KEY = 'xb_recently_removed';

// 'video', 'gif', and 'text-only' are computed from a tweet's actual media
// on the fly — never written to tweet.tags / the DB. They live in their
// own 'Built-in' sidebar section but still work with select/exclude
// filtering exactly like a normal tag (see tags.js -> getEffectiveTags).
export const BUILT_IN_TAG_NAMES = ['video', 'gif', 'text-only', 'cw'];
