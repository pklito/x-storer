import { state } from '../../state.js';
import { tagGroupOf } from '../tagGroups.js';
import { config } from './config.js';


export const IGNORED_TAGS = ['video', 'gif', 'text-only', 'cw', 'old-untagged','art'];


function tweetNodeId(t, i) {
    return `${t.id ?? t.tweetId ?? `${t.timestamp || 'na'}-${i}`}`;
}

function pickRandom(arr, n) {
    if (arr.length <= n) return arr.slice();
    const pool = arr.slice();
    const picked = [];
    while (picked.length < n && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Builds { nodes, links, shownCount } from a tweet list. Only real
// (user-assigned) tags participate in grouping/linking — IGNORED_TAGS
// and state.hiddenTags are filtered out first. Tweets that end up with
// no tags (either because they never had any, or every tag they had
// got filtered out) are still rendered as nodes — they just have
// nothing to link or hull through, so they sit ungrouped.
//
// NOTE: this function is not deterministic — pickRandom/shuffle mean
// calling it twice with identical inputs produces different link
// sets. Callers that want to know whether topology *actually* needs
// to change (vs. just re-drawing) must not use "call this again and
// diff the result" as their signal; see index.js's updateGraphData
// vs. updateHulls split.
export function buildGraphData(tweets) {
    const capped = tweets.length > config.maxTweets
        ? [...tweets]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, config.maxTweets)
        : tweets;

    const tagCounts = new Map();
    const tagToNodeIds = new Map();
    const nodes = [];

    capped.forEach((t, i) => {
        const tags = (t.tags || []).filter(tag =>
            !IGNORED_TAGS.includes(tag) &&
            (state.showHiddenTags || !state.hiddenTags.has(tag))
        );

        const id = tweetNodeId(t, i);
        nodes.push({ id, tweet: t, tags, x: Math.random()*900, y: Math.random()*450 });

        tags.forEach(tag => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            if (!tagToNodeIds.has(tag)) tagToNodeIds.set(tag, []);
            tagToNodeIds.get(tag).push(id);
        });
    });

    // Dominant tag = the most common of a tweet's own tags, within the
    // current filter — decides which group color the square gets.
    // Tweets with no (remaining) tags have no dominant tag/group and
    // fall back to the neutral node color at render time.
    nodes.forEach(n => {
        if (n.tags.length === 0) {
            n.dominantTag = null;
            n.group = null;
            return;
        }
        n.dominantTag = n.tags.reduce((best, tag) =>
            (tagCounts.get(tag) || 0) > (tagCounts.get(best) || 0) ? tag : best, n.tags[0]);
        n.group = tagGroupOf(n.dominantTag);
    });

    // Each tweet gets a total link budget, decided once up front — not
    // a budget per tag. Without that, a tweet with 3 tags gets 3
    // separate connectivity passes (one per tag), each handing out its
    // own 2-3 links, so two clusters sharing several tags end up with
    // several independent link attempts between them and everything
    // over-connects. Here, once a tweet has spent its budget, later
    // tags it belongs to are skipped entirely — so its total degree
    // stays close to the target regardless of how many tags it has.
    //
    // Picks are still biased toward whichever candidates currently have
    // the fewest links, so a popular tag's tweets don't just keep
    // re-selecting each other and snowballing into tight cliques.
    // Links are deduped across tags, accumulating weight/shared tags
    // for edge thickness and tooltips.
    //
    // Untagged tweets never appear in tagToNodeIds, so this loop never
    // gives them a link — which is correct, there's no shared tag to
    // link them through.
    const budget = new Map(nodes.map(n => [n.id, config.linksPerTweet + (Math.random() < 0.5 ? 0 : 1)]));
    const degree = new Map(nodes.map(n => [n.id, 0]));
    const linkMap = new Map();

    shuffle(Array.from(tagToNodeIds.keys())).forEach(tag => {
        const idsInTag = tagToNodeIds.get(tag);
        shuffle(idsInTag).forEach(id => {
            const remaining = budget.get(id) - degree.get(id);
            if (remaining <= 0) return; // budget already spent via an earlier shared tag

            const others = idsInTag.filter(oid => oid !== id);
            if (others.length === 0) return;

            const count = Math.min(others.length, remaining);
            const lowestDegreeFirst = shuffle(others).sort((a, b) => degree.get(a) - degree.get(b));
            const pool = lowestDegreeFirst.slice(0, Math.min(others.length, count + 3));

            pickRandom(pool, count).forEach(otherId => {
                const key = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
                let link = linkMap.get(key);
                if (!link) {
                    // `id` is the stable key used for DOM/simulation data
                    // joins across re-renders (see index.js) — keep it
                    // distinct from d3-force's own `.index`.
                    link = { id: key, source: id, target: otherId, weight: 0, tags: new Set() };
                    linkMap.set(key, link);
                    degree.set(id, degree.get(id) + 1);
                    degree.set(otherId, degree.get(otherId) + 1);
                }
                link.weight += 1;
                link.tags.add(tag);
            });
        });
    });

    // Shape: a tweet is a square if its links reach neighbors through
    // more than one distinct tag — i.e. it bridges more than one topic
    // in this mesh. A tweet whose links all happen to run through a
    // single shared tag (or an untagged tweet, which has none) stays a
    // circle.
    const incidentTags = new Map(nodes.map(n => [n.id, new Set()]));
    linkMap.forEach(link => {
        link.tags.forEach(tag => {
            incidentTags.get(link.source).add(tag);
            incidentTags.get(link.target).add(tag);
        });
    });
    nodes.forEach(n => {
        n.shape = incidentTags.get(n.id).size > 1 ? 'square' : 'circle';
    });

    return {
        nodes,
        links: Array.from(linkMap.values()),
        shownCount: nodes.length,
    };
}