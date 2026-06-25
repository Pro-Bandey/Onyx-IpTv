/**
 * ONYX IPTV - Live Stream Controller
 * Core player handling HLS/MPEG-DASH stream lifecycles, memory recovery, and URL failovers.
 */

import { SpatialNavigation } from './navigation.js';

class OnyxPlayerController {
  constructor() {
    this.videoElement = null;
    this.hudElement = null;
    this.hlsInstance = null;
    this.dashInstance = null;
    
    this.currentChannel = null;
    this.activeUrlIndex = 0;
    this.hudTimeout = null;
    this.preHudFocus = null;
    this.watchdogTimer = null;
    
    this.isMuted = false;
    this.isPlaying = false;
  }

  init() {
    this.videoElement = document.getElementById('onyx-player');
    this.hudElement = document.getElementById('player-hud');
    
    if (!this.videoElement) {
      console.error('[PLAYER] HTML5 video surface element missing.');
      return;
    }

    this.bindVideoEvents();
    this.bindHudControls();
  }

  /**
   * Binds core HTML5 media listeners to supervise buffering speeds and handle stream failures.
   */
  bindVideoEvents() {
    this.videoElement.addEventListener('loadstart', () => this.showSpinner('Connecting Stream Feed...'));
    this.videoElement.addEventListener('waiting', () => this.showSpinner('Rebuffering...'));
    
    this.videoElement.addEventListener('playing', () => {
      this.hideSpinner();
      this.isPlaying = true;
      this.updatePlayPauseUI();
      this.clearWatchdog();
      this.detectResolution();
    });

    this.videoElement.addEventListener('error', (e) => {
      console.warn('[PLAYER] Video element encountered resource loading failure:', e);
      this.handleStreamFailover();
    });
  }

  /**
   * Binds physical buttons inside the TV overlay control HUD.
   */
  bindHudControls() {
    const playBtn = document.getElementById('hud-play');
    const backBtn = document.getElementById('hud-back');
    const prevBtn = document.getElementById('hud-prev');
    const nextBtn = document.getElementById('hud-next');
    const cycleBtn = document.getElementById('hud-cycle-url');
    const favBtn = document.getElementById('hud-favorite');

    playBtn?.addEventListener('click', () => this.togglePlayPause());
    backBtn?.addEventListener('click', () => this.hideHud());
    cycleBtn?.addEventListener('click', () => this.forceCycleUrl());
    
    prevBtn?.addEventListener('click', () => this.triggerGlobalNavigationEvent('prev'));
    nextBtn?.addEventListener('click', () => this.triggerGlobalNavigationEvent('next'));
    favBtn?.addEventListener('click', () => this.toggleFavoriteState());

    // Intercept user D-Pad activity to reset the HUD auto-hide idle timer
    this.hudElement?.addEventListener('keydown', () => this.resetHudTimer());
  }

  /**
   * Safe entrypoint to feed channels directly into the engine.
   */
  playChannel(channel) {
    if (!channel || !channel.urls || channel.urls.length === 0) {
      this.showToast('Invalid stream data payload.');
      return;
    }

    this.currentChannel = channel;
    this.activeUrlIndex = 0;
    
    this.showHud(false); // Display metadata transiently on stream swap
    this.loadActiveUrl();
  }

  /**
   * Cleanly tears down older player instances to reclaim leaks before generating new decoders.
   */
  loadActiveUrl() {
    this.clearWatchdog();
    this.cleanUpPlayers();

    const targetUrl = this.currentChannel.urls[this.activeUrlIndex];
    if (!targetUrl) {
      this.showTerminalError('Feed streams exhausted.');
      return;
    }

    this.updateHudMetadata();
    console.log(`[PLAYER] Instantiating source index [${this.activeUrlIndex}]`);

    // Start watchdog timer to force failover if stream hangs indefinitely
    this.startWatchdog();

    // Route stream formats (MPEG-DASH / HLS / Native Direct MP4)
    if (targetUrl.includes('.mpd')) {
      this.loadDashStream(targetUrl);
    } else if (targetUrl.includes('.m3u8') || targetUrl.includes('/m3u8') || targetUrl.includes('type=m3u8')) {
      this.loadHlsStream(targetUrl);
    } else {
      this.loadNativeStream(targetUrl);
    }
  }

  loadHlsStream(url) {
    if (window.Hls && window.Hls.isSupported()) {
      this.hlsInstance = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 15,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2
      });

      this.hlsInstance.loadSource(url);
      this.hlsInstance.attachMedia(this.videoElement);
      
      this.hlsInstance.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('[HLS] Fatal playback error caught:', data.type);
          this.handleStreamFailover();
        }
      });
    } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      // Direct iOS/Safari Native compatibility fallback
      this.loadNativeStream(url);
    } else {
      this.showTerminalError('Native HLS codecs unsupported.');
    }
  }

  loadDashStream(url) {
    if (window.dashjs) {
      this.dashInstance = window.dashjs.MediaPlayer().create();
      this.dashInstance.initialize(this.videoElement, url, true);
      
      this.dashInstance.on('error', (e) => {
        console.warn('[DASH] Playback engine failure observed:', e);
        this.handleStreamFailover();
      });
    } else {
      this.showTerminalError('MPEG-DASH parser missing.');
    }
  }

  loadNativeStream(url) {
    this.videoElement.src = url;
    this.videoElement.load();
    this.videoElement.play().catch(e => {
      console.warn('[PLAYER] Native element play command rejected:', e.message);
    });
  }

  /**
   * Safely disposes decoder resources to ensure high platform performance.
   */
  cleanUpPlayers() {
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
    if (this.dashInstance) {
      this.dashInstance.reset();
      this.dashInstance = null;
    }
    this.videoElement.src = '';
    this.videoElement.removeAttribute('src');
    this.isPlaying = false;
  }

  /**
   * Watchdog execution pattern that protects TV systems from hanging pipelines.
   */
  startWatchdog() {
    this.watchdogTimer = setTimeout(() => {
      console.warn('[PLAYER] Connection timeout reached (10s). Forcing failover...');
      this.handleStreamFailover();
    }, 10000); // 10-second threshold to register feed failure
  }

  clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Safe URL looping engine. Dispatches alerts, increments indexes, and cycles streams.
   */
  handleStreamFailover() {
    this.clearWatchdog();
    
    if (!this.currentChannel) return;

    const availableUrls = this.currentChannel.urls.length;
    if (this.activeUrlIndex < availableUrls - 1) {
      this.activeUrlIndex++;
      this.showToast(`Stream failed. Attempting URL fallback [${this.activeUrlIndex}]...`);
      this.loadActiveUrl();
    } else {
      this.showTerminalError('Stream unavailable. All fallback sources failed.');
    }
  }

  forceCycleUrl() {
    if (!this.currentChannel || this.currentChannel.urls.length <= 1) {
      this.showToast('No fallback streams configured for this channel.');
      return;
    }
    this.activeUrlIndex = (this.activeUrlIndex + 1) % this.currentChannel.urls.length;
    this.showToast(`Cycling to stream feed [${this.activeUrlIndex}]...`);
    this.loadActiveUrl();
  }

  /**
   * Intercepts media coordinates to query true resolution configurations.
   */
  detectResolution() {
    const resBadge = document.getElementById('hud-resolution-badge');
    if (!resBadge || !this.videoElement) return;

    setTimeout(() => {
      const width = this.videoElement.videoWidth;
      const height = this.videoElement.videoHeight;
      if (width > 0 && height > 0) {
        let label = 'SD';
        if (height >= 1080) label = 'FHD';
        else if (height >= 720) label = 'HD';
        else if (height >= 2160) label = '4K';
        resBadge.textContent = `${label} (${width}x${height})`;
      } else {
        resBadge.textContent = 'AUTO';
      }
    }, 1000);
  }

  /* ----------------- INTERACTIVE STATE & HUD UI ----------------- */

  togglePlayPause() {
    if (!this.currentChannel) return;

    if (this.isPlaying) {
      this.videoElement.pause();
      this.isPlaying = false;
    } else {
      this.videoElement.play().catch(() => {});
      this.isPlaying = true;
    }
    this.updatePlayPauseUI();
    this.resetHudTimer();
  }

  updatePlayPauseUI() {
    const playIcon = document.getElementById('hud-play-icon');
    const pauseIcon = document.getElementById('hud-pause-icon');
    if (this.isPlaying) {
      playIcon?.classList.add('hidden');
      pauseIcon?.classList.remove('hidden');
    } else {
      playIcon?.classList.remove('hidden');
      pauseIcon?.classList.add('hidden');
    }
  }

  showHud(stealFocus = true) {
    if (!this.hudElement) return;

    this.clearHudTimer();
    
    if (stealFocus && !this.hudElement.classList.contains('visible')) {
      this.preHudFocus = SpatialNavigation.currentFocus;
    }

    this.hudElement.classList.add('visible');
    this.updateFavoriteUI();

    if (stealFocus) {
      const playBtn = document.getElementById('hud-play');
      if (playBtn) SpatialNavigation.focus(playBtn);
    }

    this.resetHudTimer();
  }

  hideHud() {
    if (!this.hudElement || !this.hudElement.classList.contains('visible')) return;

    this.clearHudTimer();
    this.hudElement.classList.remove('visible');

    // Return focus coordinates back to the grid surface
    if (this.preHudFocus && document.body.contains(this.preHudFocus)) {
      SpatialNavigation.focus(this.preHudFocus);
    } else {
      SpatialNavigation.syncFocus();
    }
    this.preHudFocus = null;
  }

  resetHudTimer() {
    this.clearHudTimer();
    this.hudTimeout = setTimeout(() => {
      this.hideHud();
    }, 6000); // Overlay auto-collapses in 6 seconds on idle
  }

  clearHudTimer() {
    if (this.hudTimeout) {
      clearTimeout(this.hudTimeout);
      this.hudTimeout = null;
    }
  }

  updateHudMetadata() {
    const nameEl = document.getElementById('hud-channel-name');
    const catBadge = document.getElementById('hud-category-badge');
    const urlBadge = document.getElementById('hud-url-badge');

    if (nameEl && this.currentChannel) {
      nameEl.textContent = this.currentChannel.name;
    }
    if (catBadge && this.currentChannel) {
      catBadge.textContent = (this.currentChannel.categories?.[0] || 'GENERAL').toUpperCase();
    }
    if (urlBadge && this.currentChannel) {
      urlBadge.textContent = `FEED [${this.activeUrlIndex + 1}/${this.currentChannel.urls.length}]`;
    }
  }

  /**
   * Toggles the favorite state of the currently active channel.
   */
  toggleFavoriteState() {
    if (!this.currentChannel) return;
    
    const favs = JSON.parse(localStorage.getItem('onyx_favorites') || '[]');
    const index = favs.findIndex(ch => ch.id === this.currentChannel.id);
    
    if (index > -1) {
      favs.splice(index, 1);
      this.showToast('Removed from Favorites');
    } else {
      favs.push(this.currentChannel);
      this.showToast('Added to Favorites');
    }
    
    localStorage.setItem('onyx_favorites', JSON.stringify(favs));
    this.updateFavoriteUI();
    
    // Dispatches local event notifying system of list mutation
    window.dispatchEvent(new CustomEvent('favorites-updated'));
  }

  updateFavoriteUI() {
    const outlineIcon = document.getElementById('hud-fav-icon-outline');
    const solidIcon = document.getElementById('hud-fav-icon-solid');
    
    if (!outlineIcon || !solidIcon || !this.currentChannel) return;

    const favs = JSON.parse(localStorage.getItem('onyx_favorites') || '[]');
    const isFav = favs.some(ch => ch.id === this.currentChannel.id);

    if (isFav) {
      outlineIcon.classList.add('hidden');
      solidIcon.classList.remove('hidden');
    } else {
      outlineIcon.classList.remove('hidden');
      solidIcon.classList.add('hidden');
    }
  }

  /* ----------------- LOCAL GRAPHICS & SYSTEM UTILITIES ----------------- */

  showSpinner(text) {
    const spinner = document.getElementById('player-spinner');
    const spinnerText = document.getElementById('player-loading-text');
    if (spinner && spinnerText) {
      spinnerText.textContent = text;
      spinner.classList.remove('hidden');
    }
  }

  hideSpinner() {
    const spinner = document.getElementById('player-spinner');
    if (spinner) {
      spinner.classList.add('hidden');
    }
  }

  showTerminalError(errorMsg) {
    this.hideSpinner();
    this.clearWatchdog();
    this.cleanUpPlayers();
    this.showToast(`Playback Error: ${errorMsg}`);
    
    const nameEl = document.getElementById('hud-channel-name');
    if (nameEl) nameEl.textContent = `Error: ${errorMsg}`;
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }

  triggerGlobalNavigationEvent(dir) {
    window.dispatchEvent(new CustomEvent('player-skip-channel', { detail: { direction: dir } }));
  }
}

export const OnyxPlayer = new OnyxPlayerController();