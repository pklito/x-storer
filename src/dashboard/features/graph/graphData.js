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


function buildNodeConnections(tagToNodeIds, tags, tweetId){
    const links = []
    const tagSet = new Set(tags);
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

        if(nodeFrequency.size == 0)
            break;
        
        for(let i = 0; i < config.linksPerTweet; i++){
            if(nodeFrequency.size === 0)
                break;
            var bestNode = [];
            if(i % 2 === 1)
                bestNode = [...nodeFrequency.entries()].reduce((max, entry) => (max[1] > entry[1]) ? max : entry);
            else
                bestNode = [...nodeFrequency.entries()].reduce((max, entry) => (max[1] >= entry[1]) ? max : entry);
            var link = {source : tweetId, target: bestNode[0]}
            links.push(link);
            nodeFrequency.delete(bestNode[0]);
        }
        bestNode[1].forEach((e)=>{tagSet.delete(e);});
    }
    return links;
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
        const tags = (t.tags || []).filter(tag =>!IGNORED_TAGS.includes(tag));
        if(!config.showUntaggedTweets && !tags.length)
            return;
        const id = t.id;

        //Create links
        nodeLinks.push(...buildNodeConnections(tagToNodeIds, tags, id));
        //Create Node
        if(!positionCache.has(id)){
            console.log(`${id} was missing`);
            
        }
        var p = positionCache.has(id) ? positionCache.get(id) : {x: Math.random()*900, y: Math.random()*450}
        nodes.push({ id: id, tweet: t, x: p.x, y: p.y });

        

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