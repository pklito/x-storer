import { state } from '../../state.js';
import { tagGroupOf } from '../tagGroups.js';
import { config } from './config.js';


export const IGNORED_TAGS = ['video', 'gif', 'text-only', 'cw', 'old-untagged','art'];


// Fake tweets dont  have ids?
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


/**
 * 
 * @param {Object[]} tweets 
 * @param {Map} positionCache 
 * @returns 
 */
export function buildGraphData(tweets, positionCache) {
    const capped = tweets.length > config.maxTweets
        ? [...tweets]
            .slice(0, config.maxTweets)
        : tweets;

    const tagCounts = new Map();
    /** @type {Map<string,string[]>} */
    const tagToNodeIds = new Map();
    const nodes = [];
    const nodeLinks = [];

    capped.forEach((t, i) => {
        /** @type {string[]} */
        const tags = (t.tags || []).filter(tag =>
            !IGNORED_TAGS.includes(tag));

        if(!config.showUntaggedTweets && !tags.length)
            return;

        const id = tweetNodeId(t, i);
        /** @type {Set} */
        const tagSet = new Set(tags)
        //Finding the best links for each tag:
        while(tagSet.size > 0){
            /** @type {Map<string, Set>} */
            const nodeFrequency = new Map()
            tagSet.forEach((e) => {
                tagToNodeIds.get(e)?.forEach((id) => {
                    if(!nodeFrequency.has(id)) nodeFrequency.set(id, new Set());
                    nodeFrequency.get(id).add(e)
                })
            })

            var maxNode = null;
            var maxNodeTags = new Set();
            nodeFrequency.forEach((set, id) => {
                if(set.size > maxNodeTags.size){
                    maxNodeTags = set;
                    maxNode = id;
                }
            })
            if(!maxNode)
                break;
            var link = {source : t.id, target: maxNode}
            nodeLinks.push(link);
            maxNodeTags.forEach((e)=>{tagSet.delete(e);});
        }

        var p = positionCache.has(id) ? positionCache[id] : {x: Math.random()*900, y: Math.random()*450}
        nodes.push({ id, tweet: t, tags, x: p.x, y: p.y });

        

        // POST 
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
    // Shape: a tweet is a square if its links reach neighbors through
    // more than one distinct tag — i.e. it bridges more than one topic
    // in this mesh.
    // const incidentTags = new Map(nodes.map(n => [n.id, new Set()]));
    // linkMap.forEach(link => {
    //     link.tags.forEach(tag => {
    //         incidentTags.get(link.source).add(tag);
    //         incidentTags.get(link.target).add(tag);
    //     });
    // });
    // nodes.forEach(n => {
    //     n.shape = incidentTags.get(n.id).size > 1 ? 'square' : 'circle';
    // });

    return {
        nodes,
        links: nodeLinks,
        shownCount: nodes.length,
    };
}