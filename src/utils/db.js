/**
 * IndexedDB Wrapper for XBookmark - RELEASE VERSION (V1.0)
 * Handles storage of tweets, tags, and tracking of deleted items.
 * Logic: 
 * - deleteTweet(id, permanent=false):
 *    - permanent=true (Dashboard trash): Adds to 'deleted_tweets' (Blacklist).
 *    - permanent=false (X Unbookmark): Only removes from 'tweets' (Allow re-add later).
 * - addTweet:
 *    - Checks blacklist.
 *    - If manual_click, removes from blacklist and adds.
 */

const DB_NAME = 'XBookmarkDB';
const DB_VERSION = 2;
const STORE_TWEETS = 'tweets';
const STORE_TAGS = 'tags';
const STORE_DELETED = 'deleted_tweets';

class XBookmarkDB {
  constructor() {
    this.db = null;
    this.initPromise = this._init();
  }

  _init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_TWEETS)) {
          const tweetStore = db.createObjectStore(STORE_TWEETS, { keyPath: 'id' });
          tweetStore.createIndex('timestamp', 'timestamp', { unique: false });
          tweetStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }

        if (!db.objectStoreNames.contains(STORE_TAGS)) {
          db.createObjectStore(STORE_TAGS, { keyPath: 'name' });
        }

        if (!db.objectStoreNames.contains(STORE_DELETED)) {
          db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
        }
      };
    });
  }

  async addTweet(newTweet) {
    await this.initPromise;

    // 1. Check if deleted (If user explicitly banished it via Dashboard)
    const isDeleted = await this.isDeleted(newTweet.id);

    // If it's in the ban list...
    if (isDeleted) {
      if (newTweet.source === 'manual_click') {
        // User manually clicked bookmark on X -> Unban it!
        // This is crucial: Manual action overrides blacklist.
        await this.removeFromDeleted(newTweet.id);
      } else {
        // Auto-scan ignores banned tweets
        return null;
      }
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TWEETS], 'readwrite');
      const store = transaction.objectStore(STORE_TWEETS);

      const getRequest = store.get(newTweet.id);

      getRequest.onsuccess = () => {
        const existingTweet = getRequest.result;
        const now = Date.now();

        if (existingTweet) {
          // MERGE: Keep existing tags, update content
          newTweet.tags = existingTweet.tags || [];
          newTweet.addedAt = existingTweet.addedAt || now;
        } else {
          if (!newTweet.tags) newTweet.tags = [];
          newTweet.addedAt = now;
        }

        const putRequest = store.put(newTweet);
        putRequest.onsuccess = () => resolve(newTweet);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async getTweets() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TWEETS], 'readonly');
      const store = transaction.objectStore(STORE_TWEETS);
      const request = store.getAll();

      request.onsuccess = () => {
        const tweets = request.result;

        // Sort by Timestamp (Newest first), fallback to AddedAt
        tweets.sort((a, b) => {
          const dateA = new Date(a.timestamp).getTime();
          const dateB = new Date(b.timestamp).getTime();

          if (!isNaN(dateA) && !isNaN(dateB) && dateA !== dateB) {
            return dateB - dateA;
          }

          const addedA = a.addedAt || 0;
          const addedB = b.addedAt || 0;
          return addedB - addedA;
        });

        resolve(tweets);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateTweetTags(tweetId, tags) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_TWEETS], 'readwrite');
      const store = transaction.objectStore(STORE_TWEETS);
      const getRequest = store.get(tweetId);

      getRequest.onsuccess = () => {
        const tweet = getRequest.result;
        if (tweet) {
          tweet.tags = tags;
          const updateRequest = store.put(tweet);
          updateRequest.onsuccess = () => resolve(tweet);
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error('Tweet not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // Modified deleteTweet: 
  // - permanent=true (Dashboard trash): Adds to 'deleted_tweets' (Blacklist)
  // - permanent=false (X Unbookmark): Only removes from 'tweets' (Allow re-add later)
  async deleteTweet(id, permanent = false) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const stores = permanent ? [STORE_TWEETS, STORE_DELETED] : [STORE_TWEETS];
      const transaction = this.db.transaction(stores, 'readwrite');

      const tweetStore = transaction.objectStore(STORE_TWEETS);
      tweetStore.delete(id);

      if (permanent) {
        const deletedStore = transaction.objectStore(STORE_DELETED);
        deletedStore.put({ id: id, deletedAt: new Date().toISOString() });
      }

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async isDeleted(id) {
    await this.initPromise;
    return new Promise((resolve) => {
      const transaction = this.db.transaction([STORE_DELETED], 'readonly');
      const store = transaction.objectStore(STORE_DELETED);
      const request = store.get(id);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  }

  async removeFromDeleted(id) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_DELETED], 'readwrite');
      const store = transaction.objectStore(STORE_DELETED);
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

export const db = new XBookmarkDB();
