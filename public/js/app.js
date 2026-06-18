/**
 * ONYX IPTV - Main Application Orchestrator
 * Handles Sharded DB loading, Row Generation, Favorites, and PIP Previews.
 */
const App = {
    // Relative paths to your generated files on GitHub Pages
    // dbBaseUrl: './db', 
    // logosBaseUrl: './logos',
    dbBaseUrl: 'https://raw.githubusercontent.com/Pro-Bandey/Onyx-IpTv/db', 
    logosBaseUrl: 'https://raw.githubusercontent.com/Pro-Bandey/Onyx-IpTv//logos',

    // Favorites track
    favorites: [],
    
    // Debounce timer for picture-in-picture zapping
    pipDebounceTimeout: null,
    pipHlsInstance: null,

    async init() {
        console.log("[SYSTEM] ONYX App Booting...");

        this.loadFavorites();
        this.setupSidebarClickHandlers();

        // 1. Fetch initial Index metadata
        try {
            const indexResponse = await fetch(`${this.dbBaseUrl}/index.json`);
            if (!indexResponse.ok) throw new Error("Index file missing");
            const indexData = await indexResponse.json();

            // 2. Select initial channels to display.
            // We load the first 3 categories as distinct Netflix-style swimlane rows.
            const categoriesToLoad = indexData.categories ? indexData.categories.slice(0, 3) : [];
            await this.buildNetflixLayout(categoriesToLoad);

        } catch (error) {
            console.warn("[SYSTEM] DB index not found. Booting with offline mock data for local testing.");
            this.buildMockLayout();
        }
    },

    /* --------------------------------------------------------------------------
       FAVORITES & LOCAL STORAGE
       -------------------------------------------------------------------------- */

    loadFavorites() {
        try {
            const stored = localStorage.getItem('onyx_favorites');
            this.favorites = stored ? JSON.parse(stored) : [];
        } catch (e) {
            this.favorites = [];
        }
    },

    toggleFavorite(channel) {
        const index = this.favorites.findIndex(fav => fav.id === channel.id);
        if (index === -1) {
            this.favorites.push(channel);
        } else {
            this.favorites.splice(index, 1);
        }
        localStorage.setItem('onyx_favorites', JSON.stringify(this.favorites));
        
        // Reload layout to reflect favorite changes instantly
        this.init();
    },

    /* --------------------------------------------------------------------------
       SIDEBAR & MENU NAVIGATION
       -------------------------------------------------------------------------- */

    setupSidebarClickHandlers() {
        document.querySelectorAll('#sidebar .nav-item').forEach(item => {
            item.onclick = () => {
                const navType = item.dataset.nav;
                console.log(`[NAV] Navigating to: ${navType}`);
                
                if (navType === 'favorites') {
                    this.buildFavoritesOnlyLayout();
                } else if (navType === 'home') {
                    this.init(); // Reload Home View
                } else {
                    // Placeholder for future expandability (Categories/Countries dialogs)
                    alert(`${navType.toUpperCase()} directory loading via DB branches...`);
                }
            };
        });
    },

    /* --------------------------------------------------------------------------
       DYNAMIC ROW BUILDERS (SHARD FETCHES)
       -------------------------------------------------------------------------- */

    /**
     * Builds standard homepage containing Favorites row + category swimlanes
     */
    async buildNetflixLayout(categories) {
        const container = document.getElementById('rows-container');
        container.innerHTML = ''; // Reset container

        // Row 0: Favorites (Always present if entries exist)
        if (this.favorites.length > 0) {
            this.createRowElement("Your Favorites", this.favorites);
        }

        // Fetch each category's sharded JSON file sequentially
        for (const cat of categories) {
            try {
                const response = await fetch(`${this.dbBaseUrl}/channels/${cat}.json`);
                if (response.ok) {
                    const channels = await response.json();
                    if (channels.length > 0) {
                        this.createRowElement(cat.replace(/_/g, ' '), channels);
                    }
                }
            } catch (err) {
                console.error(`Failed loading row: ${cat}`, err);
            }
        }

        // Inform spatial nav engine to map newly added DOM elements
        SpatialNav.update();
    },

    /**
     * Isolates and shows favorites only in a focused view
     */
    buildFavoritesOnlyLayout() {
        const container = document.getElementById('rows-container');
        container.innerHTML = '';
        
        if (this.favorites.length > 0) {
            this.createRowElement("Your Favorites", this.favorites);
        } else {
            container.innerHTML = `
                <div style="padding: var(--tv-safe-padding); text-align: center; color: var(--text-muted);">
                    <h2>No Favorites Added Yet</h2>
                    <p>Highlight a channel card and press the appropriate shortcut/Enter to favorite it.</p>
                </div>
            `;
        }
        SpatialNav.update();
    },

    /**
     * Appends a horizontal swimlane row structure into the DOM
     */
    createRowElement(titleText, channels) {
        const container = document.getElementById('rows-container');

        const swimlane = document.createElement('div');
        swimlane.className = 'swimlane-row';

        const title = document.createElement('h2');
        title.className = 'row-title';
        title.innerText = titleText;
        swimlane.appendChild(title);

        const viewport = document.createElement('div');
        viewport.className = 'row-viewport';

        const cardContainer = document.createElement('div');
        cardContainer.className = 'row-cards-container';

        channels.forEach(channel => {
            const card = document.createElement('div');
            card.className = 'channel-card focusable';
            
            // Embed configuration data attributes
            card.dataset.id = channel.id;
            card.dataset.name = channel.name;
            card.dataset.urls = JSON.stringify(channel.urls);
            card.dataset.country = channel.country ? channel.country.toUpperCase() : 'Global';
            card.dataset.category = channel.categories ? channel.categories.join(', ') : 'Live';
            card.dataset.logo = channel.logo || '';
            card.dataset.raw = JSON.stringify(channel); // For favoring purposes

            // When OK is pressed on TV remote, open stream fullscreen
            card.onclick = () => {
                if (window.TVPlayer) {
                    this.stopPipPreview(); // Kill the preview PIP first
                    window.TVPlayer.play(channel.name, channel.urls);
                }
            };

            // Inject optimized WebP logo (or fallback text label)
            if (channel.logo) {
                const img = document.createElement('img');
                img.className = 'channel-logo';
                img.src = `${this.logosBaseUrl}/${channel.logo}.webp`;
                
                img.onerror = () => {
                    img.style.display = 'none';
                    const text = document.createElement('div');
                    text.className = 'channel-name';
                    text.innerText = channel.name;
                    card.appendChild(text);
                };
                card.appendChild(img);
            } else {
                const text = document.createElement('div');
                text.className = 'channel-name';
                text.innerText = channel.name;
                card.appendChild(text);
            }

            cardContainer.appendChild(card);
        });

        viewport.appendChild(cardContainer);
        swimlane.appendChild(viewport);
        container.appendChild(swimlane);
    },

    /* --------------------------------------------------------------------------
       SPATIAL ACTION: HERO BANNER SYNC & PIP DEBOUNCER
       -------------------------------------------------------------------------- */

    /**
     * Triggered automatically by SpatialNav when focus shifts to a new card
     */
    updateHeroBanner(focusedCard) {
        const title = document.getElementById('hero-title');
        const country = document.getElementById('hero-country');
        const category = document.getElementById('hero-category');
        const desc = document.getElementById('hero-description');

        const chName = focusedCard.dataset.name;
        const chCountry = focusedCard.dataset.country;
        const chCategory = focusedCard.dataset.category;
        const chUrls = JSON.parse(focusedCard.dataset.urls);

        title.innerText = chName;
        country.innerText = chCountry;
        category.innerText = chCategory;
        desc.innerText = `Watch Live stream from ${chCountry} in high quality. Streams verified via ONYX IPTV automated workflows.`;

        // Reset/stop current PIP operation immediately
        this.stopPipPreview();

        // DEBOUNCE PIP: Do not load video stream if user is rapidly navigating cards.
        // Wait 1.2 seconds of stable rest before starting video playback.
        this.pipDebounceTimeout = setTimeout(() => {
            this.startPipPreview(chUrls);
        }, 1200);
    },

    startPipPreview(urls) {
        if (!urls || urls.length === 0) return;
        const streamUrl = urls[0];

        const pipVideo = document.getElementById('pip-video');
        const statusOverlay = document.getElementById('pip-status-overlay');
        
        statusOverlay.innerText = "Loading Preview...";
        console.log(`[PIP] Loading preview stream: ${streamUrl}`);

        if (streamUrl.endsWith('.m3u8') && Hls.isSupported()) {
            this.pipHlsInstance = new Hls({ maxBufferLength: 5, enableWorker: true });
            this.pipHlsInstance.loadSource(streamUrl);
            this.pipHlsInstance.attachMedia(pipVideo);
            this.pipHlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                pipVideo.play().then(() => {
                    statusOverlay.innerText = "LIVE PREVIEW";
                }).catch(() => {});
            });
        } else {
            // Native video element playback (MPEG-DASH preview omitted for PIP RAM safety)
            pipVideo.src = streamUrl;
            pipVideo.play().then(() => {
                statusOverlay.innerText = "LIVE PREVIEW";
            }).catch(() => {});
        }
    },

    stopPipPreview() {
        if (this.pipDebounceTimeout) {
            clearTimeout(this.pipDebounceTimeout);
            this.pipDebounceTimeout = null;
        }

        const pipVideo = document.getElementById('pip-video');
        const statusOverlay = document.getElementById('pip-status-overlay');
        
        if (statusOverlay) statusOverlay.innerText = "Preview Window";

        if (this.pipHlsInstance) {
            this.pipHlsInstance.destroy();
            this.pipHlsInstance = null;
        }

        if (pipVideo) {
            pipVideo.pause();
            pipVideo.removeAttribute('src');
            pipVideo.load();
        }
    },

    /* --------------------------------------------------------------------------
       OFFLINE DEV MOCK LAYOUT (FOR LOCAL TESTING)
       -------------------------------------------------------------------------- */
    buildMockLayout() {
        const mockChannels = [
            { id: "mock-1", name: "Classic Film Channel", urls: ["https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"], country: "us", categories: ["movies"], logo: "" },
            { id: "mock-2", name: "Live Big Buck Bunny", urls: ["https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"], country: "us", categories: ["entertainment"], logo: "" },
            { id: "mock-3", name: "HLS Multitrack Video", urls: ["https://playertest.longtailvideo.com/adaptive/bipbop/gear4/prog_index.m3u8"], country: "gb", categories: ["educational"], logo: "" }
        ];

        const container = document.getElementById('rows-container');
        container.innerHTML = '';

        this.createRowElement("Featured Streams", mockChannels);
        this.createRowElement("Education & Documentaries", mockChannels);

        SpatialNav.update();
    }
};

// Initial Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
    window.App = App;
    App.init();
});