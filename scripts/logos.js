import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

const DB_CHANNELS_DIR = 'https://raw.githubusercontent.com/Pro-Bandey/Onyx-IpTv/db/channels';
const LOGOS_OUT_DIR = '../logos/logos';
const LOGOS_INDEX_FILE = '../logos/logos.json';

const hashUrl = (url) => crypto.createHash('sha256').update(url).digest('hex');

async function buildLogos() {
  console.log('[LOGOS] Starting Logo Optimization Pipeline...');
  await fs.mkdir(LOGOS_OUT_DIR, { recursive: true });

  let logoState = {};
  try {
    const data = await fs.readFile(LOGOS_INDEX_FILE, 'utf-8');
    logoState = JSON.parse(data);
    console.log(`[LOGOS] Loaded existing state with ${Object.keys(logoState).length} logos.`);
  } catch (e) {
    console.log('[LOGOS] No existing logos.json found. Starting fresh database.');
  }

  let channelFiles = [];
  try {
    channelFiles = await fs.readdir(DB_CHANNELS_DIR);
    console.log(`[LOGOS] Found ${channelFiles.length} sharded channel files to scan.`);
  } catch(e) {
    throw new Error(`CRITICAL: Cannot read ${DB_CHANNELS_DIR}. Did the DB workflow run successfully first? Error: ${e.message}`);
  }

  let downloadedCount = 0;
  let skippedCount = 0;

  for (const file of channelFiles) {
    if (!file.endsWith('.json')) continue;
    
    const channelData = JSON.parse(await fs.readFile(path.join(DB_CHANNELS_DIR, file), 'utf-8'));

    for (const channel of channelData) {
      if (!channel.logoUrl) continue;

      const urlHash = hashUrl(channel.logoUrl);
      const expectedFileName = `${channel.logoId}.webp`;

      if (logoState[channel.logoId] === urlHash) {
        skippedCount++;
        continue;
      }

      try {
        const res = await fetch(channel.logoUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await sharp(buffer)
          .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(LOGOS_OUT_DIR, expectedFileName));

        logoState[channel.logoId] = urlHash;
        downloadedCount++;
        console.log(`[LOGOS] ✅ Processed: ${channel.logoId}`);
      } catch (error) {
        console.log(`[LOGOS] ❌ Failed ${channel.logoId} (${channel.logoUrl}): ${error.message}`);
      }
    }
  }

  await fs.writeFile(LOGOS_INDEX_FILE, JSON.stringify(logoState, null, 2));
  console.log(`[LOGOS] SUCCESS! Pipeline complete. Downloaded: ${downloadedCount} | Skipped: ${skippedCount}`);
}

buildLogos().catch(err => {
  console.error('\n[FATAL ERROR]');
  console.error(err);
  process.exit(1); 
});