import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

// Paths mapped relative to how the GitHub Action mounts them
const DB_CHANNELS_DIR = '../data/channels';
const LOGOS_OUT_DIR = '../logos/logos';
const LOGOS_INDEX_FILE = '../logos/logos.json';

// SHA256 Hash generator for delta checking
const hashUrl = (url) => crypto.createHash('sha256').update(url).digest('hex');

async function buildLogos() {
  await fs.mkdir(LOGOS_OUT_DIR, { recursive: true });

  // Load state map (logo-index)
  let logoState = {};
  try {
    const data = await fs.readFile(LOGOS_INDEX_FILE, 'utf-8');
    logoState = JSON.parse(data);
  } catch (e) {
    console.log('[LOGOS] No existing logo state found. Starting fresh.');
  }

  // Read all sharded channel files
  let channelFiles = [];
  try {
    channelFiles = await fs.readdir(DB_CHANNELS_DIR);
  } catch(e) {
    console.error('[LOGOS] Error reading DB branch data. Ensure DB workflow ran first.');
    return;
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

      // Check Delta State: If hash matches, skip download completely
      if (logoState[channel.logoId] === urlHash) {
        skippedCount++;
        continue;
      }

      // Download and process new/changed image
      try {
        console.log(`[LOGOS] Downloading: ${channel.logoUrl}`);
        const res = await fetch(channel.logoUrl);
        if (!res.ok) throw new Error('Dead image link');
        
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Sharp Pipeline: Optimize & convert
        await sharp(buffer)
          .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(LOGOS_OUT_DIR, expectedFileName));

        // Update state map upon success
        logoState[channel.logoId] = urlHash;
        downloadedCount++;
        
      } catch (error) {
        console.log(`[LOGOS] Failed to process ${channel.logoId}: ${error.message}`);
      }
    }
  }

  // Save the updated state map back to logos.json
  await fs.writeFile(LOGOS_INDEX_FILE, JSON.stringify(logoState, null, 2));

  console.log(`[LOGOS] Pipeline complete. Processed: ${downloadedCount} | Skipped: ${skippedCount}`);
}

buildLogos().catch(console.error);