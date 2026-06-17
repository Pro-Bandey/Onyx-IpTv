import fs from 'fs/promises';
import path from 'path';
import parser from 'iptv-playlist-parser';

const CONFIG_PATH = './config/countries.json';
const DIST_DIR = './db';

const slugify = (text) => text?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';

async function buildDb() {
  await fs.mkdir(path.join(DIST_DIR, 'countries'), { recursive: true });
  await fs.mkdir(path.join(DIST_DIR, 'categories'), { recursive: true });
  await fs.mkdir(path.join(DIST_DIR, 'channels'), { recursive: true });

  const targetCountries = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));

  const globalCategories = new Set();
  const indexData = { countries: targetCountries, categories: [] };

  for (const country of targetCountries) {
    console.log(`[DB] Fetching M3U for: ${country}`);
    const response = await fetch(`https://iptv-org.github.io/iptv/countries/${country}.m3u`);
    if (!response.ok) continue;

    const m3uString = await response.text();
    const playlist = parser.parse(m3uString);

    const countryCategories = new Set();
    const channelsMap = new Map(); // For deduplication

    playlist.items.forEach(item => {
      const name = item.name || 'Unknown Channel';
      const id = slugify(name);
      const url = item.url;
      const rawCategory = item.group?.title || 'General';
      const category = slugify(rawCategory);

      countryCategories.add(category);
      globalCategories.add(category);

      // Deduplication & Fallback Array Logic
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
          logoId: slugify(name), // Logo ID for frontend mapping
          logoUrl: item.tvg?.logo || null, // Original URL for logo pipeline
          tvgId: item.tvg?.id || "",
          status: "active"
        });
      }
    });

    // Write country's category index (e.g. countries/pk.json -> ["news", "sports"])
    const catArray = Array.from(countryCategories);
    await fs.writeFile(path.join(DIST_DIR, 'countries', `${country}.json`), JSON.stringify(catArray));

    // Shard channels into category chunks (e.g. channels/pk_news.json)
    const chunkedChannels = {};
    for (const channel of channelsMap.values()) {
      const mainCat = channel.categories[0];
      const chunkKey = `${country}_${mainCat}`;
      if (!chunkedChannels[chunkKey]) chunkedChannels[chunkKey] = [];
      chunkedChannels[chunkKey].push(channel);
    }

    for (const [key, channels] of Object.entries(chunkedChannels)) {
      await fs.writeFile(path.join(DIST_DIR, 'channels', `${key}.json`), JSON.stringify(channels));
    }
  }

  // Finalize Main Index
  indexData.categories = Array.from(globalCategories);
  await fs.writeFile(path.join(DIST_DIR, 'index.json'), JSON.stringify(indexData));

  console.log('[DB] Database build complete.');
}

buildDb().catch(console.error);