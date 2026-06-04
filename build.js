const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION: Define your filtering rules
// ==========================================

// Empty arrays disable filtering for that parameter (keeps all items)
const SELECTED_CATEGORIES = ["news", "sports", "movies", "music", "kids", "documentary", "general"];
const SELECTED_REGIONS = ["IN", "AR", "PK", "BN"]; // ISO 3166-1 alpha-2 country codes
const FILTER_NSFW = true; // Auto-removes adult content

async function buildDatabase() {
    try {
        console.log('Fetching live datasets from iptv-org API...');
        
        // Fetch channels, streams, and logos from the official API endpoints
        const [channelsRes, streamsRes, logosRes] = await Promise.all([
            fetch('https://iptv-org.github.io/api/channels.json'),
            fetch('https://iptv-org.github.io/api/streams.json'),
            fetch('https://iptv-org.github.io/api/logos.json')
        ]);

        if (!channelsRes.ok || !streamsRes.ok || !logosRes.ok) {
            throw new Error('Failed to retrieve upstream api payloads.');
        }

        const channels = await channelsRes.json();
        const streams = await streamsRes.json();
        const logos = await logosRes.json();

        console.log(`Payload loaded: ${channels.length} channels, ${streams.length} streams, ${logos.length} logos.`);

        // 1. Index Logos by Channel ID (IPTV-org removed logo from channels.json in late 2025)
        console.log('Indexing logo mapping...');
        const logoMap = new Map();
        for (const entry of logos) {
            if (entry.channel) {
                // If there are duplicates, prioritize the one marked active/in_use
                if (!logoMap.has(entry.channel) || entry.in_use) {
                    logoMap.set(entry.channel, entry.url);
                }
            }
        }

        // 2. Index Streams by Channel ID
        console.log('Indexing stream URLs...');
        const streamMap = new Map();
        for (const stream of streams) {
            if (stream.channel) {
                if (!streamMap.has(stream.channel)) {
                    streamMap.set(stream.channel, []);
                }
                
                // Save only necessary properties to minimize JSON file size
                streamMap.get(stream.channel).push({
                    url: stream.url,
                    quality: stream.quality || null,
                    referrer: stream.referrer || null,
                    user_agent: stream.user_agent || null
                });
            }
        }

        // 3. Process and filter channel array
        console.log('Applying filtering rules & merging files...');
        const processedChannels = [];

        for (const ch of channels) {
            // Rule A: Remove explicit channels
            if (FILTER_NSFW && ch.is_nsfw) continue;

            // Rule B: Channel must contain active streams
            const chStreams = streamMap.get(ch.id);
            if (!chStreams || chStreams.length === 0) continue;

            // Rule C: Filter by selected regions (if defined)
            if (SELECTED_REGIONS.length > 0 && ch.country) {
                if (!SELECTED_REGIONS.includes(ch.country.toUpperCase())) {
                    continue;
                }
            }

            // Rule D: Filter by selected categories (if defined)
            if (SELECTED_CATEGORIES.length > 0) {
                const categories = ch.categories || [];
                const matchesCategory = categories.some(cat => SELECTED_CATEGORIES.includes(cat.toLowerCase()));
                if (!matchesCategory) {
                    continue;
                }
            }

            // Get logo URL if mapped, or default to null
            const logoUrl = logoMap.get(ch.id) || null;

            // Compile the channel object
            processedChannels.push({
                id: ch.id,
                name: ch.name,
                country: ch.country,
                categories: ch.categories || [],
                logo: logoUrl,
                streams: chStreams
            });
        }

        console.log(`Processing complete: Compiled ${processedChannels.length} qualified channels.`);

        // Create dist directory to prepare deployment file
        const distDir = path.join(__dirname, 'dist');
        if (!fs.existsSync(distDir)){
            fs.mkdirSync(distDir);
        }

        // Write the database output
        const outputPath = path.join(distDir, 'db.min.json');
        fs.writeFileSync(outputPath, JSON.stringify(processedChannels));
        
        console.log(`Success! File generated at: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB)`);

    } catch (error) {
        console.error('An error occurred while compiling the database:', error);
        process.exit(1);
    }
}

buildDatabase();
