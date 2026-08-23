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


function connectNode(tagToNodeIds, tweet){
    
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

        const id = t.id;
        /** @type {Set} */
        const tagSet = new Set(tags)
        //Finding the best links for each tag:
        while(tagSet.size > 0){

            //Populate a nodefrequency map, 
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
            if (!tagToNodeIds.has(tag)) tagToNodeIds.set(tag, []);
            tagToNodeIds.get(tag).push(id);
        });
    });

    return {
        nodes,
        links: nodeLinks,
        shownCount: nodes.length,
    };
}