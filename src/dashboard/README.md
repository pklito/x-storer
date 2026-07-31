# app.js split — what changed

Your one ~2000-line `app.js` is now 19 small ES modules, all verified to
import/export correctly against each other (I loaded the whole graph with a
stubbed DOM and it wires up with no missing references). Drop these files
next to your old `app.js` (same folder, so `../utils/db.js` still resolves),
delete the old one, and your HTML's `<script type="module" src="app.js">`
tag needs no changes — the new `app.js` is the entry point.

## How it's organized

**Infrastructure (no UI logic):**
- `state.js` — the one shared mutable state object + constants (localStorage
  keys, IndexedDB names, batch size, built-in tag names). Every other module
  reads/writes `state.someProperty` instead of its own local variable.
- `dom.js` — every `document.getElementById(...)` call, done once.
- `tags.js` — pure functions: built-in tag computation, effective tags,
  "all tag names in use."
- `utils.js` — `widenSidebarIfPossible`.
- `linkify.js` — turns tweet text into text + `<a>` links.

**Features, each roughly matching one of your original `// --- X ---`
comment blocks:**
- `tagModal.js` + `tagEditor.js` — the per-tweet tag editing modal and its
  capsule input widget.
- `tagGroups.js` — categorizing tags into groups, the configure-tags modal.
- `tagsSidebar.js` — rendering the grouped sidebar tag list + chip
  select/exclude.
- `searchTabs.js` — saved filter combinations.
- `mediaFolder.js` — local media folder access (exactly what you asked for).
- `massTagging.js` — mass tagging mode + its tag-picker modal.
- `importExport.js` — JSON import + markdown/JSON export.
- `recentlyRemoved.js` — the undo panel for the unbookmark-detection safety net.
- `lightbox.js` — the single reusable image lightbox.
- `carousel.js` — the OG image carousel.
- `grid.js` — masonry grid rendering, batched rendering loop, and
  `createTweetCard` (the biggest chunk — this is inherently the most
  complex piece since a card touches media, tags, mass-tagging, and delete).
- `render.js` — the glue: `loadData`, `getFilteredTweets`, `updateUI`. Kept
  separate from `grid.js` because several other modules need to trigger a
  UI refresh without needing the grid internals.
- `app.js` — `DOMContentLoaded` init sequence + all the top-level event
  listener wiring. This is now ~180 lines instead of the original ~2000.

## Why a shared `state` object instead of each module having its own variables

ES modules can't reassign another module's exported `let` from outside it.
Putting all the mutable fields on one exported object (`state.allTweets`,
`state.selectedTags`, etc.) means any module can update the shared truth
just by mutating a property, and every other module sees it immediately —
no getter/setter boilerplate needed.

## Circular imports (this is fine, not a bug)

A few modules import each other both ways — e.g. `grid.js` calls
`updateUI()` from `render.js`, and `render.js` calls `renderGrid()` from
`grid.js`. This works in ES modules as long as the imported name is only
*used* inside a function body (never at the top of the file), which is the
case everywhere here. I load-tested the full graph to confirm nothing
breaks.

## `extracted.css`

Pulled every `element.style.cssText = '...'` / repeated inline-style block
out into real CSS classes (prefixed `xb-` to avoid collisions), covering:
modals (mass-tag select / import / recently-removed all shared one
copy-pasted pattern before), buttons, the mass-tag status bar, the import
warning box, the lightbox, the local-media and video/gif badges, the tweet
media grid, and the tag-groups modal.

Copy `extracted.css`'s contents into your existing stylesheet (or link the
file directly) — visually nothing should change, but now every one of those
values is editable in one place instead of buried in JS strings. A couple
of small call-sites that used to write inline styles now just add/remove a
class (`.active`, `.visible`, `.hidden`, `.chosen`) so toggling state and
toggling appearance are separate again.

One thing to double check: `.linkified-url` and `.og-dot` reference
`var(--accent-color)` / `var(--text-secondary)`, same as your original inline
styles did — make sure those custom properties are still defined wherever
your theme variables live.
