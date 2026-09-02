import { state } from '../../state.js';
import { tagGroupOf } from '../tagGroups.js';
import { config } from './config.js';


export const IGNORED_TAGS = ['video', 'gif', 'text-only', 'cw', 'old-untagged','art'];

/** @type {Map<string,string[]>} */
const TAG_TO_IDS = new Map();
/** @type {Map<string, {tags:string[], connections:number}>} */
const ID_TO_DATA = new Map();
const NODES = [];
const NODE_LINKS = [];

// Fake tweets dont  have ids?
function tweetNodeId(t, i) {
    return `${t.id ?? t.tweetId ?? `${t.timestamp || 'na'}-${i}`}`;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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


function buildNodeConnections(tags, tweetId){
    if (config.linksPerTweet < 1)
        return;
    const tagSet = new Set(tags);
    while(tagSet.size > 0){
        //Populate a nodefrequency map, 
        /** @type {Map<string, Set>} */
        const nodeFrequency = new Map()
        tagSet.forEach((e) => {
            TAG_TO_IDS.get(e)?.forEach((id) => {
                if(!nodeFrequency.has(id)) nodeFrequency.set(id, new Set());
                nodeFrequency.get(id).add(e)
            })
        })

        if(nodeFrequency.size == 0)
            break;
        
        for(let i = 0; i < config.linksPerTweet; i++){
            if(nodeFrequency.size === 0)
                break;
            let evalEntry = (entry) => {
                const connections = ID_TO_DATA.get(entry[0])?.connections ?? 0;
                return (10 * (entry[1].size));
            };

            var bestNode = shuffle([...nodeFrequency.entries()])
                .reduce((max, entry) =>
                    evalEntry(max) >= evalEntry(entry) ? max : entry
                );

            var link = {
                source: tweetId,
                target: bestNode[0]
            };

            NODE_LINKS.push(link);
            ID_TO_DATA.get(tweetId).connections += 1;
            ID_TO_DATA.get(bestNode[0]).connections += 1;

            nodeFrequency.delete(bestNode[0]);
        }
        bestNode[1].forEach((e)=>{tagSet.delete(e);});
    }
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

    //Reset the variables for a new graph
    TAG_TO_IDS.clear();
    ID_TO_DATA.clear();
    NODES.length = 0;
    NODE_LINKS.length = 0;
    
    capped.forEach((t, i) => {
        /** @type {string[]} */
        const tags = (t.tags || []).filter(tag =>!IGNORED_TAGS.includes(tag));
        if(!config.showUntaggedTweets && !tags.length)
            return;
        const id = t.id;
        ID_TO_DATA.set(id, {tags:tags, connections: 0})
        //Create links
        buildNodeConnections(tags, id);
        //Create Node
        var p = positionCache.has(id) ? positionCache.get(id) : {x: Math.random()*900, y: Math.random()*450}
        NODES.push({ id: id, tweet: t, x: p.x, y: p.y, group: tagGroupOf(t.tags[0]) });

        

        // POST 
        tags.forEach(tag => {
            if (!TAG_TO_IDS.has(tag)) TAG_TO_IDS.set(tag, []);
            TAG_TO_IDS.get(tag).push(id);
        });
    });

    return {
        nodes: NODES,
        links: NODE_LINKS,
        shownCount: NODES.length,
    };
}