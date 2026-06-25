/**
 * ONYX IPTV - CDN Data API Wrapper
 * Performs dynamic CDN resolution, automatic edge-caching, and index prefetching.
 */

class OnyxApiService {
  constructor() {
    this.dbBase = 'https://raw.githubusercontent.com/pro-bandey/Onyx-IpTv/db/';
    this.logoBase = 'https://raw.githubusercontent.com/pro-bandey/Onyx-IpTv/logos/logos';
    this.cache = {
      index: null,
      countries: {}, // ISO -> Categories map cache
      shards: {}     // Country_Category -> Channels map cache
    };
    
    // In-memory registry of all fetched channels to enable lightning-fast client-side search
    this.indexedChannels = new Map();
  }

  /**
   * Evaluates window.location coordinates to resolve raw GitHub Page assets to high-speed CDN edges.
   */
  init() {
    const loc = window.location;
    
    if (loc.hostname.includes('github.io')) {
      // Matches: https://username.github.io/repository-name/
      const pathParts = loc.pathname.split('/').filter(Boolean);
      const owner = loc.hostname.split('.')[0];
      const repo = pathParts[0] || '';

      if (owner && repo) {
        // Leverages jsDelivr's global edge network to fetch files directly from database branches
        this.dbBase = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@db/`;
        this.logoBase = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@logos/logos/`;
        console.log(`[API] Production CDN activated: [${this.dbBase}]`);
        return;
      }
    }
    
    console.log('[API] Local relative database routes activated.');
  }

  /**
   * Fetches the root database descriptor index.
   * @returns {Promise<Object>} Contents of index.json
   */
  async fetchIndex() {
    if (this.cache.index) {
      return this.cache.index;
    }

    try {
      const url = `${this.dbBase}index.json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP status ${response.status}`);
      
      const data = await response.json();
      this.cache.index = data;
      return data;
    } catch (error) {
      console.error('[API] Failed to fetch root database index:', error);
      throw error;
    }
  }

  /**
   * Fetches category filters supported by a specific country code.
   * @param {string} countryCode - ISO 2-letter country code (e.g., 'us', 'pk')
   * @returns {Promise<Array>} List of category slugs
   */
  async fetchCountryCategories(countryCode) {
    const iso = countryCode.toLowerCase();
    if (this.cache.countries[iso]) {
      return this.cache.countries[iso];
    }

    try {
      const url = `${this.dbBase}countries/${iso}.json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP status ${response.status}`);
      
      const data = await response.json();
      this.cache.countries[iso] = data;
      return data;
    } catch (error) {
      console.error(`[API] Failed to retrieve categories for country [${iso}]:`, error);
      return [];
    }
  }

  /**
   * Loads a specific sharded channel JSON file.
   * @param {string} countryCode - ISO country code
   * @param {string} categorySlug - Slugified category
   * @returns {Promise<Array>} List of normalized channel schemas
   */
  async fetchChannels(countryCode, categorySlug) {
    const country = countryCode.toLowerCase();
    const category = categorySlug.toLowerCase();
    const shardKey = `${country}_${category}`;

    if (this.cache.shards[shardKey]) {
      return this.cache.shards[shardKey];
    }

    try {
      const url = `${this.dbBase}channels/${shardKey}.json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP status ${response.status}`);
      
      const channels = await response.json();
      this.cache.shards[shardKey] = channels;

      // Register the retrieved channels in our in-memory global registry
      for (const channel of channels) {
        if (channel && channel.id) {
          this.indexedChannels.set(channel.id, channel);
        }
      }

      return channels;
    } catch (error) {
      console.error(`[API] Failed to load channel shard [${shardKey}]:`, error);
      return [];
    }
  }

  /**
   * Resolves a standardized, web-ready optimized WebP logo path.
   * @param {string} logoId - The slugified channel logo identity
   * @returns {string} Fully qualified CDN image URL or a default fallback vector
   */
  getLogoUrl(logoId) {
    if (!logoId) return '';
    return `${this.logoBase}${logoId}.webp`;
  }

  /**
   * Real-time client-side search across all currently loaded shards.
   * @param {string} query - Clean search string
   * @returns {Array} Matched channel array
   */
  searchLocal(query) {
    if (!query) return [];
    
    const cleanQuery = query.toLowerCase().trim();
    const matches = [];

    for (const channel of this.indexedChannels.values()) {
      if (
        channel.name.toLowerCase().includes(cleanQuery) ||
        channel.id.includes(cleanQuery)
      ) {
        matches.push(channel);
      }
    }

    return matches;
  }

  /**
   * TV Optimization Helper: Prefetches top index shards.
   * Smooths D-pad transitions by downloading most-accessed shards in the background.
   */
  async prefetchPopularShards(countriesList, topCategories) {
    if (!countriesList || !topCategories) return;
    
    const maxPrefetchCount = 3;
    let prefetched = 0;

    for (const country of countriesList.slice(0, 2)) {
      for (const category of topCategories.slice(0, 2)) {
        if (prefetched >= maxPrefetchCount) break;
        const shardKey = `${country.toLowerCase()}_${category.toLowerCase()}`;
        
        if (!this.cache.shards[shardKey]) {
          // Fire-and-forget fetch to populate the memory cache silently
          this.fetchChannels(country, category).catch(() => {});
          prefetched++;
        }
      }
    }
  }
}

export const OnyxApi = new OnyxApiService();