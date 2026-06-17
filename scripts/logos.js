import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import sharp from 'sharp';

const DB_BRANCH_URL = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/db`;
const OUTPUT_DIR = './logos';
const INDEX_FILE = path.join(OUTPUT_DIR, 'logo-index.json');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Load existing state to prevent re-processing
let logoState = {};
if (fs.existsSync(INDEX_FILE)) {
    logoState = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
}

function generateHash(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

async function processLogos() {
    console.log('🖼️ Starting ONYX Logo Optimization Pipeline...');
    
    try {
        // Fetch index.json from DB branch
        console.log(`Fetching DB Index from: ${DB_BRANCH_URL}/index.json`);
        const indexRes = await axios.get(`${DB_BRANCH_URL}/index.json`);
        const countries = Object.keys(indexRes.data.countries);

        let processCount = 0;

        for (const code of countries) {
            try {
                const countryRes = await axios.get(`${DB_BRANCH_URL}/countries/${code}.json`);
                const channels = countryRes.data;

                for (const channel of channels) {
                    if (!channel.logo) continue;

                    const hash = generateHash(channel.logo);
                    const fileName = `${channel.id}.webp`;
                    const filePath = path.join(OUTPUT_DIR, fileName);

                    // Skip if hash hasn't changed AND file exists
                    if (logoState[channel.id] === hash && fs.existsSync(filePath)) {
                        continue;
                    }

                    try {
                        const imgRes = await axios.get(channel.logo, { responseType: 'arraybuffer', timeout: 5000 });
                        
                        await sharp(imgRes.data)
                            .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                            .webp({ quality: 80 })
                            .toFile(filePath);

                        logoState[channel.id] = hash; // Update state
                        processCount++;
                        console.log(`✅ Optimized: ${fileName}`);
                    } catch (err) {
                        console.log(`⚠️ Skipped dead logo for ${channel.id}`);
                    }
                }
            } catch (err) {
                console.error(`Failed to fetch country JSON for ${code}`);
            }
        }

        // Save updated state map
        fs.writeFileSync(INDEX_FILE, JSON.stringify(logoState, null, 2));
        console.log(`🎉 Logo pipeline complete. Processed ${processCount} new/changed logos.`);

    } catch (err) {
        console.error('❌ Critical Pipeline Error:', err.message);
    }
}

processLogos();
