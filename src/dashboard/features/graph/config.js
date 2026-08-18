// Tunables, adjustable live via the toolbar controls (see toolbar.js).
// Kept as a single mutable object (rather than separate `let`s) so every
// module that needs to read or write a tunable can just import `config`.
export const config = {
    maxTweets: 400,           // cap on nodes shown at once, for perf/legibility
    linksPerTweet: 2,         // each tweet's total link budget is linksPerTweet..linksPerTweet+1,
                               // spread across its tags

    // A tag only gets drawn as a hull if its tweets make up at least this
    // fraction of all *tagged* tweets currently shown (0..1). At the
    // default of 0.5, only tags covering half or more of the tagged
    // tweets get a hull; drag the slider down to reveal smaller/rarer
    // tag groupings, or up to declutter down to just the dominant ones.
    groupHullThreshold: 0.5,

    // Fill opacity of the tag hull shapes (0..1). Change this to make
    // hulls more/less prominent relative to the nodes and links.
    hullOpacity: 0.15,
};

// Subtle: bigger tag count = slightly bigger square.
export const NODE_SIZE_RANGE = [7, 11];

// How far a tag's hull balloons out past its outermost tweet.
export const HULL_PAD = 22;
