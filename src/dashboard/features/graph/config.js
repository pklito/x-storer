// Tunables, adjustable live via the toolbar controls (see toolbar.js).
// Kept as a single mutable object (rather than separate `let`s) so every
// module that needs to read or write a tunable can just import `config`.
export const config = {
    maxTweets: 1200,           // cap on nodes shown at once, for perf/legibility
    linksPerTweet: 4,         // each tweet's total link budget is linksPerTweet..linksPerTweet+1,
                               // spread across its tags
    groupHullThreshold: 0.1,
    showUntaggedTweets : false,
    // Fill opacity of the tag hull shapes (0..1). Change this to make
    // hulls more/less prominent relative to the nodes and links.
    hullOpacity: 0.05,
};

// Subtle: bigger tag count = slightly bigger square.
export const NODE_SIZE_RANGE = [7, 11];

// How far a tag's hull balloons out past its outermost tweet.
export const HULL_PAD = 22;
