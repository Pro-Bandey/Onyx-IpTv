import fs from 'fs/promises';
import path from 'path';
import parser from 'iptv-playlist-parser';

const CONFIG_PATH = './scripts/countries.json';
const DIST_DIR = './db';

const slugify = (text) => text?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';

async function buildDb() {
  console.log('[DB] Starting Database Build Pipeline...');
  
  await fs.mkdir(path.join(DIST_DIR, 'countries'), { recursive: true });
  await fs.mkdir(path.join(DIST_DIR, 'categories'), { recursive: true });
  await fs.mkdir(path.join(DIST_DIR, 'channels'), { recursive: true });

  // 1. Load config
  let targetCountries;
  try {
    const fileContent = await fs.readFile(CONFIG_PATH, 'utf-8');
    targetCountries = JSON.parse(fileContent);
    console.log(`[DB] Loaded target countries: ${targetCountries.join(', ')}`);
  } catch (error) {
    throw new Error(`CRITICAL: Cannot read ${CONFIG_PATH}. Did you create the file? Error: ${error.message}`);
  }
  
  const globalCategories = new Set();
  const indexData = { countries: targetCountries, categories: [] };
  let totalChannelsProcessed = 0;

  for (const country of targetCountries) {
    const m3uUrl = `https://iptv-org.github.io/iptv/countries/${country}.m3u`;
    console.log(`[DB] Fetching M3U for ${country.toUpperCase()}: ${m3uUrl}`);
    
    const response = await fetch(m3uUrl);
    if (!response.ok) {
      console.error(`[DB] Warning: Failed to fetch ${country}. HTTP Status: ${response.status}`);
      continue;
    }
    
    const m3uString = await response.text();
    const playlist = parser.parse(m3uString);
    console.log(`[DB] Successfully parsed ${playlist.items.length} raw channels for ${country}.`);
    
    const countryCategories = new Set();
    const channelsMap = new Map();

    playlist.items.forEach(item => {
      const name = item.name || 'Unknown Channel';
      const id = slugify(name);
      const url = item.url;
      const rawCategory = item.group?.title || 'General';
      const category = slugify(rawCategory);
      
      countryCategories.add(category);
      globalCategories.add(category);

      if (channelsMap.has(id)) {
        const existing = channelsMap.get(id);
        if (existing.urls.length < 3 && !existing.urls.includes(url)) {
          existing.urls.push(url);
        }
      } else {
        channelsMap.set(id, {
          id,
          name,
          urls: [url],
          country: country,
          categories: [category],
          logoId: slugify(name),
          logoUrl: item.tvg?.logo || null,
          tvgId: item.tvg?.id || "",
          status: "active"
        });
      }
    });

    const catArray = Array.from(countryCategories);
    await fs.writeFile(path.join(DIST_DIR, 'countries', `${country}.json`), JSON.stringify(catArray));

    const chunkedChannels = {};
    for (const channel of channelsMap.values()) {
      const mainCat = channel.categories[0];
      const chunkKey = `${country}_${mainCat}`;
      if (!chunkedChannels[chunkKey]) chunkedChannels[chunkKey] = [];
      chunkedChannels[chunkKey].push(channel);
      totalChannelsProcessed++;
    }

    for (const [key, channels] of Object.entries(chunkedChannels)) {
      await fs.writeFile(path.join(DIST_DIR, 'channels', `${key}.json`), JSON.stringify(channels));
    }
    
    console.log(`[DB] Sharded ${country} into ${Object.keys(chunkedChannels).length} category files.`);
  }

  indexData.categories = Array.from(globalCategories);
  await fs.writeFile(path.join(DIST_DIR, 'index.json'), JSON.stringify(indexData));
  
  console.log(`[DB] SUCCESS! Database build complete. Total unique channels: ${totalChannelsProcessed}`);
  
  if (totalChannelsProcessed === 0) {
    throw new Error('CRITICAL: 0 channels were processed. Something is blocking the downloads.');
  }
}

// Ensure the GitHub Action fails if the script fails
buildDb().catch(err => {
  console.error('\n[FATAL ERROR]');
  console.error(err);
  process.exit(1);
});