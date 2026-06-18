/**
 * ONYX IPTV - Polymorphic Media Engine
 * Dynamically adapts between HLS.js, Dash.js, and Native progressive HTML5 streams.
 */
window.TVPlayer = {
    // Engine Instances
    hlsInstance: null,
    dashInstance: null,

    // DOM Elements Cache
    playerLayerEl: null,
    videoEl: null,
    osdEl: null,
    progressBarEl: null,

    // Operational Playback State
    currentName: '',
    currentUrls: [],
    urlIndex: 0,
    osdTimeout: null,
    loadingSimInterval: null,

    init() {
        this.videoEl = document.getElementById('tv-video');
        this.playerLayerEl = document.getElementById('player-layer');
        this.osdEl = document.getElementById('osd');
        this.progressBarEl = document.getElementById('osd-progress');

        // Listen for raw native video tags errors (important fallback for progressive mp4 streams)
        this.videoEl.addEventListener('error', (e) => this.handleNativeVideoError(e));
    },

    /**
     * Initializes playback and handles UI layer activation
     */
    play(channelName, urls) {
        if (!urls || urls.length === 0) {
            console.error("[PLAYER] Failed to start: URL array is empty.");
            return;
        }

        this.currentName = channelName;
        this.currentUrls = urls;
        this.urlIndex = 0; // Reset index to primary link

        // Show player viewport
        this.playerLayerEl.classList.remove('player-hidden');
        
        this.updateOSD("Connecting...", "buffering");
        this.startOsdProgressBarSimulation();

        this.loadCurrentStream();
    },

    /**
     * Polimorphically detects stream type and provisions the appropriate player engine
     */
    loadCurrentStream() {
        const streamUrl = this.currentUrls[this.urlIndex];
        console.log(`[PLAYER] Loading stream index ${this.urlIndex}: ${streamUrl}`);

        this.cleanUpActivePlayers();

        const format = this.detectFormat(streamUrl);
        this.updateFormatBadge(format);

        if (format === 'DASH') {
            this.initializeDashStream(streamUrl);
        } else if (format === 'HLS') {
            this.initializeHlsStream(streamUrl);
        } else {
            this.initializeNativeStream(streamUrl);
        }
    },

    /**
     * Formats supported check based on file extension matching
     */
    detectFormat(url) {
        const cleanUrl = url.split('?')[0].toLowerCase();
        if (cleanUrl.endsWith('.mpd') || cleanUrl.includes('/manifest')) {
            return 'DASH';
        }
        if (cleanUrl.endsWith('.m3u8') || cleanUrl.includes('.m3u8?')) {
            return 'HLS';
        }
        return 'NATIVE';
    },

    /* --------------------------------------------------------------------------
       STREAM TYPES INITIALIZATION
       -------------------------------------------------------------------------- */

    initializeHlsStream(url) {
        // Use Hls.js library if supported by browser/TV platform (Tizen, webOS, Android TV)
        if (Hls.isSupported()) {
            this.hlsInstance = new Hls({
                maxBufferLength: 8,       // TV Optimized: limit buffer footprint
                enableWorker: true,        // Multi-thread decode assistance
                lowLatencyMode: true
            });

            this.hlsInstance.loadSource(url);
            this.hlsInstance.attachMedia(this.videoEl);

            this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                this.triggerPlaySuccess();
            });

            this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.warn(`[PLAYER-HLS] Fatal HLS error encountered: ${data.details}`);
                    this.handleStreamError();
                }
            });
        } 
        // Fallback for native Safari, iOS, and Apple TV HLS handling
        else if (this.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            this.videoEl.src = url;
            this.videoEl.addEventListener('loadedmetadata', () => {
                this.triggerPlaySuccess();
            });
        } else {
            console.warn("[PLAYER-HLS] HLS playback is not supported on this platform.");
            this.handleStreamError();
        }
    },

    initializeDashStream(url) {
        if (typeof dashjs !== 'undefined') {
            this.dashInstance = dashjs.MediaPlayer().create();
            
            // Apply TV-First hardware playback settings
            this.dashInstance.updateSettings({
                streaming: {
                    buffer: {
                        stableBufferDelay: 4, // Quicker initial playback start
                        bufferTimeAtTopQuality: 10
                    }
                }
            });

            this.dashInstance.initialize(this.videoEl, url, true);

            // Listen for play verification events
            this.dashInstance.on(dashjs.MediaPlayer.events.CAN_PLAY, () => {
                this.triggerPlaySuccess();
            });

            // Listen for internal player errors
            this.dashInstance.on(dashjs.MediaPlayer.events.ERROR, (e) => {
                console.warn("[PLAYER-DASH] Fatal DASH error encountered:", e);
                this.handleStreamError();
            });
        } else {
            console.warn("[PLAYER-DASH] Dash.js engine library not loaded.");
            this.handleStreamError();
        }
    },

    initializeNativeStream(url) {
        this.videoEl.src = url;
        this.videoEl.play()
            .then(() => {
                this.triggerPlaySuccess();
            })
            .catch(() => {
                this.handleStreamError();
            });
    },

    /* --------------------------------------------------------------------------
       PLAYBACK LIFECYCLE CONTROLS
       -------------------------------------------------------------------------- */

    triggerPlaySuccess() {
        this.videoEl.play().catch(() => {});
        this.stopOsdProgressBarSimulation(true);
        this.updateOSD("Active Live Stream", "playing");
        this.hideOsdAfterDelay();
    },

    /**
     * Intercepts media playback failure and initiates the redundancy search loop
     */
    handleStreamError() {
        this.urlIndex++;

        if (this.urlIndex < this.currentUrls.length) {
            this.updateOSD(`Fallback activated (Stream ${this.urlIndex + 1}/${this.currentUrls.length})...`, "buffering");
            this.startOsdProgressBarSimulation();

            // Breather delay protects TV hardware loop locks
            setTimeout(() => {
                this.loadCurrentStream();
            }, 800);
        } else {
            this.stopOsdProgressBarSimulation(false);
            this.updateOSD("Stream Currently Offline", "error");
            
            // Keep error visible on panel indefinitely
            if (this.osdTimeout) clearTimeout(this.osdTimeout);
        }
    },

    handleNativeVideoError(e) {
        // Native events fire on the video element for progressive stream format crashes
        if (this.videoEl.src) {
            console.warn("[PLAYER] Native video element reported playback error.");
            this.handleStreamError();
        }
    },

    /**
     * Resets video frame registers, pauses decoders, and releases TV system memory
     */
    stop() {
        this.cleanUpActivePlayers();

        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();

        this.playerLayerEl.classList.add('player-hidden');
        
        if (this.osdTimeout) clearTimeout(this.osdTimeout);
        this.stopOsdProgressBarSimulation(false);

        // RESTORE PIP PREVIEW: Seamless return back to the silent live panel dashboard!
        if (window.App && typeof window.App.updateHeroBanner === 'function') {
            const focusedCard = document.querySelector('.channel-card.focused');
            if (focusedCard) {
                // Instantly re-ignites the PIP preview of the channel you returned to
                window.App.updateHeroBanner(focusedCard);
            }
        }
    },

    cleanUpActivePlayers() {
        if (this.hlsInstance) {
            this.hlsInstance.destroy();
            this.hlsInstance = null;
        }
        if (this.dashInstance) {
            this.dashInstance.reset(); // Correct cleanup call for DashJS v4
            this.dashInstance = null;
        }
    },

    /* --------------------------------------------------------------------------
       OSD UI GRAPHICS UTILITIES
       -------------------------------------------------------------------------- */

    updateOSD(statusText, statusClass) {
        document.getElementById('osd-channel-name').innerText = this.currentName;
        
        const dotEl = document.getElementById('osd-status-dot');
        const textEl = document.getElementById('osd-status-text');

        dotEl.className = `status-dot ${statusClass}`;
        textEl.innerText = statusText;

        this.osdEl.classList.remove('osd-hidden');
    },

    updateFormatBadge(format) {
        const badge = document.getElementById('osd-format-badge');
        if (badge) badge.innerText = format;
    },

    hideOsdAfterDelay() {
        if (this.osdTimeout) clearTimeout(this.osdTimeout);
        this.osdTimeout = setTimeout(() => {
            this.osdEl.classList.add('osd-hidden');
        }, 4000);
    },

    /**
     * Animates the loading bar line for better user feedback
     */
    startOsdProgressBarSimulation() {
        if (this.loadingSimInterval) clearInterval(this.loadingSimInterval);
        
        let progress = 0;
        this.progressBarEl.style.width = '0%';
        
        this.loadingSimInterval = setInterval(() => {
            if (progress < 85) {
                progress += Math.floor(Math.random() * 8) + 2;
                this.progressBarEl.style.width = `${progress}%`;
            }
        }, 150);
    },

    stopOsdProgressBarSimulation(isSuccess) {
        if (this.loadingSimInterval) {
            clearInterval(this.loadingSimInterval);
            this.loadingSimInterval = null;
        }
        this.progressBarEl.style.width = isSuccess ? '100%' : '0%';
    }
};

// Auto bootloader hook
document.addEventListener('DOMContentLoaded', () => {
    window.TVPlayer.init();
});