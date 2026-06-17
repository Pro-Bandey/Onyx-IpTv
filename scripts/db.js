const axios = require('axios');
const parser = require('iptv-playlist-parser');
const fs = require('fs-extra');
const path = require('path');
const targetCountries = require('./config/countries.json');

const IPTV_SOURCE = 'https://iptv-org.github.io/iptv/index.m3u';
const OUTPUT_DIR = path.join(__dirname, '../');

// Helper to slugify text safely
const slugify = (text) => {
  return (text || '').toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

async function buildDatabase() {
  console.log('📦 Fetching IPTV-org playlist...');
  const { data } = await axios.get(IPTV_SOURCE);
  const playlist = parser.parse(data);

  const db = {
    channels: {},
    countries: new Set(),
    categories: new Set()
  };

  console.log('⚙️ Processing and deduplicating channels...');
  
  playlist.items.forEach(item => {
    const country = (item.tvg.country || 'unknown').toLowerCase();
    const category = (item.group.title || 'uncategorized').toLowerCase();
    
    // 1. Filter out unwanted countries to keep DB light
    if (country !== 'unknown' && !targetCountries.includes(country)) return;
    
    // 2. Validate URL lightly (skip obvious broken protocols)
    if (!item.url || !item.url.startsWith('http')) return;

    const name = item.name.trim();
    const channelId = slugify(name);
    const logoId = channelId; // Link for logo pipeline

    // 3. Deduplication and URL Fallback logic
    if (!db.channels[channelId]) {
      db.channels[channelId] = {
        id: channelId,
        name: name,
        urls: [],
        country: country,
        categories: [category],
        logo: logoId,
        rawLogoUrl: item.tvg.logo || '', // Temp used for logo pipeline
        tvgId: item.tvg.id || '',
        status: "active"
      };
    }

    // 4. Fallback constraint: Max 3 streams per channel
    if (db.channels[channelId].urls.length < 3 && !db.channels[channelId].urls.includes(item.url)) {
      db.channels[channelId].urls.push(item.url);
    }

    db.countries.add(country);
    db.categories.add(category);
  });

  console.log('📂 Sharding JSON database...');
  await fs.emptyDir(OUTPUT_DIR);
  await fs.ensureDir(path.join(OUTPUT_DIR, 'countries'));
  await fs.ensureDir(path.join(OUTPUT_DIR, 'categories'));
  await fs.ensureDir(path.join(OUTPUT_DIR, 'channels'));

  const channelsArray = Object.values(db.channels);

  // Split by Country
  for (const country of db.countries) {
    const countryChannels = channelsArray.filter(c => c.country === country);
    await fs.writeJson(path.join(OUTPUT_DIR, `countries/${country}.json`), countryChannels);
  }

  // Split by Category
  for (const category of db.categories) {
    const categoryChannels = channelsArray.filter(c => c.categories.includes(category));
    await fs.writeJson(path.join(OUTPUT_DIR, `categories/${category}.json`), categoryChannels);
  }

  // Split by Country_Category (Extremely micro payload for TV frontend)
  for (const country of db.countries) {
    for (const category of db.categories) {
      const filtered = channelsArray.filter(c => c.country === country && c.categories.includes(category));
      if (filtered.length > 0) {
         // Strip rawLogoUrl to save bytes in production
         const cleaned = filtered.map(({ rawLogoUrl, ...rest }) => rest);
         await fs.writeJson(path.join(OUTPUT_DIR, `channels/${country}_${category}.json`), cleaned);
      }
    }
  }

  // Master Index File
  const indexFile = {
    generatedAt: new Date().toISOString(),
    totalChannels: channelsArray.length,
    countries: Array.from(db.countries),
    categories: Array.from(db.categories)
  };
  
  // We save rawLogoUrls in a special file JUST for the logo pipeline action
  await fs.writeJson(path.join(OUTPUT_DIR, 'index.json'), indexFile);
  await fs.writeJson(path.join(OUTPUT_DIR, 'logo-source.json'), channelsArray.map(c => ({ id: c.id, url: c.rawLogoUrl })));

  console.log(`✅ DB Build Complete! Total Channels: ${channelsArray.length}`);
}

buildDatabase().catch(console.error);
