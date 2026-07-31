import { state } from './state.js';

// Computes the built-in tags (video / gif / text-only / cw) for a tweet
// from its actual media — these are never stored in tweet.tags / the DB.
export function getBuiltInTagsForTweet(tweet) {
    const media = (tweet.media && tweet.media.length)
        ? tweet.media
        : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);

    const tags = [];
    if (media.some(m => m.type === 'video')) tags.push('video');
    if (media.some(m => m.type === 'gif')) tags.push('gif');
    if (media.length === 0) tags.push('text-only');
    if (tweet.isSensitive) tags.push('cw');
    return tags;
}

// Stored tags + computed built-in tags, for filtering/search purposes only.
export function getEffectiveTags(tweet) {
    return (tweet.tags || []).concat(getBuiltInTagsForTweet(tweet));
}

export function getAllTagNames() {
    const set = new Set();
    state.allTweets.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
    return Array.from(set).sort();
}
