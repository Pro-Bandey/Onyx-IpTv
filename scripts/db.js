import fs from 'fs';
import path from 'path';
import axios from 'axios';

const OUTPUT_DIR = './db';
const COUNTRIES_FILE = './config/countries.json';

// Initialize output directories
if (fs.existsSync(OUTPUT_DIR)) fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, 'countries'), { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, 'channels'), { recursive: true });

const countries = JSON.parse(fs.readFileSync(COUNTRIES_FILE, 'utf8'));

// Lightweight M3U Parser
function parseM3U(m3uData, countryCode) {
    const lines = m3uData.split('\n');
    const channels = new Map();

    let currentMetadata = null;

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            const idMatch = line.match(/tvg-id="([^"]*)"/);
            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            const groupMatch = line.match(/group-title="([^"]*)"/);
            const nameMatch = line.split(',').pop();

            const name = nameMatch ? nameMatch.trim() : 'Unknown';
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const category = groupMatch && groupMatch[1] ? groupMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'general';

            currentMetadata = {
                id: slug,
                name: name,
                tvgId: idMatch ? idMatch[1] : '',
                logo: logoMatch ? logoMatch[1] : '',
                category: category,
                country: countryCode
            };
        } else if (line.startsWith('http') && currentMetadata) {
            const url = line;
            if (channels.has(currentMetadata.id)) {
                // Deduplication: Max 3 Fallback URLs
                const existing = channels.get(currentMetadata.id);
                if (existing.urls.length < 3 && !existing.urls.includes(url)) {
                    existing.urls.push(url);
                    if (!existing.categories.includes(currentMetadata.category)) {
                        existing.categories.push(currentMetadata.category);
                    }
                }
            } else {
                channels.set(currentMetadata.id, {
                    id: currentMetadata.id,
                    name: currentMetadata.name,
                    urls: [url],
                    country: currentMetadata.country,
                    categories: [currentMetadata.category],
                    logo: currentMetadata.logo,
                    tvgId: currentMetadata.tvgId
                });
            }
            currentMetadata = null; // Reset
        }
    }
    return Array.from(channels.values());
}

async function buildDatabase() {
    console.log('🚀 Starting ONYX IPTV Database Build...');
    let globalCategories = new Set();
    let indexData = {
        updatedAt: new Date().toISOString(),
        countries: countries,
        categories: []
    };

    for (const [code, name] of Object.entries(countries)) {
        console.log(`Fetching M3U for ${name} (${code})...`);
        try {
            const res = await axios.get(`https://iptv-org.github.io/iptv/countries/${code}.m3u`, { timeout: 10000 });
            const channels = parseM3U(res.data, code);
            
            // 1. Save Full Country JSON
            fs.writeFileSync(
                path.join(OUTPUT_DIR, 'countries', `${code}.json`), 
                JSON.stringify(channels)
            );

            // 2. Shard by Category
            const categoryMap = new Map();
            channels.forEach(ch => {
                ch.categories.forEach(cat => {
                    globalCategories.add(cat);
                    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
                    categoryMap.get(cat).push(ch);
                });
            });

            for (const [cat, catChannels] of categoryMap.entries()) {
                fs.writeFileSync(
                    path.join(OUTPUT_DIR, 'channels', `${code}_${cat}.json`), 
                    JSON.stringify(catChannels)
                );
            }
            
            console.log(`✅ ${name}: Processed ${channels.length} unique channels.`);
        } catch (err) {
            console.error(`❌ Failed to fetch ${name}:`, err.message);
        }
    }

    // 3. Save Global Index
    indexData.categories = Array.from(globalCategories).sort();
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(indexData, null, 2));
    
    console.log('🎉 Database build complete! Ready for deployment.');
}

buildDatabase();
