/**
 * ONYX IPTV - Single Entry Point Coordinator
 * Orchestrates unified application lifecycles, global PWA router, M3U compilers, EPG timelines, and TV overlays.
 */

import { SpatialNavigation } from './navigation.js';
import { OnyxPlayer } from './player.js';
import { OnyxApi } from './api.js';

class OnyxAppCoordinator {
  constructor() {
    this.activeView = 'home';
    this.activeCountry = 'us';
    this.activeChannelsList = [];
    this.currentPlayingChannelIndex = -1;
    
    // Virtual Keyboard modal properties
    this.activeInputTarget = null;
    this.kbdModalOpen = false;
    this.preModalFocus = null;

    this.COUNTRY_NAMES = {
      us: 'United States',
      in: 'India',
      pk: 'Pakistan',
      ru: 'Russia'
    };

    // Bind search execution with debounce wrapper
    this.debouncedSearch = this.debounce((query) => this.executeChannelSearch(query), 250);
  }

  /**
   * Main setup runner of the web application.
   */
  async boot() {
    console.log('[SYSTEM] Initiating Onyx IPTV Engine...');
    
    OnyxApi.init();
    SpatialNavigation.init();
    OnyxPlayer.init();

    this.startSystemClock();
    this.bindSidebarEvents();
    this.bindUtilityEvents();
    this.bindGlobalPlayerSwaps();
    this.bindKeyboardModalEvents();
    this.bindStreamSelectorDrawer();

    // Register active focus constraint interceptors with SpatialNavigation
    SpatialNavigation.addKeyListener((code, event) => this.interceptNavigationKeys(code, event));

    try {
      this.updateBootStatus('Fetching channel manifests...');
      const index = await OnyxApi.fetchIndex();
      
      this.updateBootStatus('Populating layouts...');
      this.renderHome(index);
      
      // Load and build any previously compiled M3U playlists
      this.loadCustomM3UFromStorage();
      
      // Refresh recently played panels on home screen
      this.renderRecentlyPlayed();

      OnyxApi.prefetchPopularShards(index.countries, index.categories);
      this.dismissSplashScreen();
    } catch (error) {
      console.error('[SYSTEM] Boot error encountered:', error);
      this.updateBootStatus('DATABASE ERROR: Connect to network or redeploy pipeline.');
    }
  }

  /* ----------------- FOCUS ROUTING INTERCEPTORS ----------------- */

  /**
   * Restricts directional keys when overlay modals or drawers are displayed.
   */
  interceptNavigationKeys(code, event) {
    // 1. Constrain D-Pad focus inside the Virtual Keyboard modal if open
    if (this.kbdModalOpen) {
      const modal = document.getElementById('keyboard-modal');
      const focused = SpatialNavigation.currentFocus;
      
      if (code === SpatialNavigation.KEY_CODES.BACK_ESC || code === SpatialNavigation.KEY_CODES.BACK_NATIVE || code === SpatialNavigation.KEY_CODES.BACK_ALT) {
        this.closeKeyboardModal(false);
        return true;
      }
      
      if (focused && !focused.closest('#keyboard-modal')) {
        const firstKey = modal.querySelector('[data-focusable="true"]');
        if (firstKey) SpatialNavigation.focus(firstKey);
        return true;
      }
    }

    // 2. Constrain focus within the Stream Selector drawer panel
    const streamPanel = document.getElementById('hud-stream-panel');
    if (streamPanel && streamPanel.classList.contains('visible')) {
      if (code === SpatialNavigation.KEY_CODES.BACK_ESC || code === SpatialNavigation.KEY_CODES.BACK_NATIVE || code === SpatialNavigation.KEY_CODES.BACK_ALT) {
        this.toggleStreamSelectorPanel(false);
        return true;
      }

      const focused = SpatialNavigation.currentFocus;
      if (focused && !focused.closest('#hud-stream-panel')) {
        const firstCard = streamPanel.querySelector('[data-focusable="true"]');
        if (firstCard) SpatialNavigation.focus(firstCard);
        return true;
      }
    }

    return false;
  }

  /* ----------------- CORE INTERFACES & DOM BINDINGS ----------------- */

  bindSidebarEvents() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const targetView = e.currentTarget.getAttribute('data-view');
        if (targetView) {
          this.switchView(targetView);
        }
      });
    });
  }

  bindUtilityEvents() {
    // Return to dashboard from channel grids
    document.getElementById('btn-back-grid')?.addEventListener('click', () => {
      this.switchView('countries');
    });

    // Quick Play Billboard Action
    document.getElementById('billboard-quickplay')?.addEventListener('click', () => {
      this.triggerQuickPlay();
    });

    // Form settings togglers
    document.querySelectorAll('.setting-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const isToggle = target.getAttribute('data-toggle') === 'true';
        if (isToggle) {
          const isEnabled = target.classList.contains('enabled');
          if (isEnabled) {
            target.classList.remove('enabled');
            target.querySelector('span').textContent = 'DISABLED';
          } else {
            target.classList.add('enabled');
            target.querySelector('span').textContent = 'ENABLED';
          }
        }
      });
    });

    // Setup input field trigger hooks (Trigger Virtual Keyboard)
    document.querySelectorAll('.clickable-input').forEach(input => {
      input.addEventListener('click', (e) => {
        this.openKeyboardModal(e.currentTarget);
      });
    });

    // Custom M3U playlist compiler trigger
    document.getElementById('btn-load-custom-m3u')?.addEventListener('click', () => {
      this.triggerCustomM3ULoader();
    });

    // Hook into global favorites panel mutations
    window.addEventListener('favorites-updated', () => {
      if (this.activeView === 'favorites') {
        this.renderFavorites();
      }
    });
  }

  /**
   * Sets up standard next/prev channel buttons in the playback overlay.
   */
  bindGlobalPlayerSwaps() {
    window.addEventListener('player-skip-channel', (e) => {
      if (this.activeChannelsList.length === 0 || this.currentPlayingChannelIndex === -1) return;

      const direction = e.detail.direction;
      let targetIndex = this.currentPlayingChannelIndex;

      if (direction === 'next') {
        targetIndex = (targetIndex + 1) % this.activeChannelsList.length;
      } else {
        targetIndex = (targetIndex - 1 + this.activeChannelsList.length) % this.activeChannelsList.length;
      }

      const targetChannel = this.activeChannelsList[targetIndex];
      if (targetChannel) {
        this.currentPlayingChannelIndex = targetIndex;
        this.playSelectedChannel(targetChannel, targetIndex);
      }
    });
  }

  /* ----------------- VIEWPORT NAVIGATION ----------------- */

  switchView(viewId) {
    if (this.activeView === viewId && viewId !== 'channel-grid') return;

    console.log(`[ROUTER] Routing view: [${viewId}]`);
    
    if (viewId !== 'player-hud') {
      OnyxPlayer.hideHud();
    }

    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    const activePanel = document.getElementById(`view-${viewId}`);
    if (activePanel) {
      activePanel.classList.add('active');
    }

    document.querySelectorAll('#sidebar .nav-item').forEach(item => {
      if (item.getAttribute('data-view') === viewId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    this.activeView = viewId;
    SpatialNavigation.activeView = viewId;

    const currentBreadcrumb = document.getElementById('breadcrumb-current');
    if (currentBreadcrumb) {
      currentBreadcrumb.textContent = viewId.toUpperCase();
    }

    if (viewId === 'favorites') {
      this.renderFavorites();
    } else if (viewId === 'home') {
      this.renderRecentlyPlayed();
    }

    setTimeout(() => {
      SpatialNavigation.syncFocus();
    }, 50);
  }

  /* ----------------- COMPILING & UI RENDERING ----------------- */

  renderHome(indexData) {
    this.renderHomeCountries(indexData.countries);
    this.renderHomeCategories(indexData.categories);
    
    this.renderAllCountriesGrid(indexData.countries);
    this.renderAllCategoriesGrid(indexData.categories);
  }

  renderHomeCountries(countries) {
    const grid = document.getElementById('home-countries-grid');
    if (!grid) return;

    grid.innerHTML = countries.map(iso => {
      const name = this.COUNTRY_NAMES[iso.toLowerCase()] || iso.toUpperCase();
      return `
        <div class="onyx-card" data-focusable="true" data-type="country" data-target-id="${iso}">
          <div class="card-aspect-ratio">
            <span class="card-fallback">${iso.toUpperCase()}</span>
          </div>
          <div class="card-title">${name}</div>
        </div>
      `;
    }).join('');

    this.bindGridSelectionEvents(grid);
  }

  renderHomeCategories(categories) {
    const grid = document.getElementById('home-categories-grid');
    if (!grid) return;

    grid.innerHTML = categories.slice(0, 6).map(cat => {
      const displayLabel = cat.replace(/-/g, ' ');
      return `
        <div class="onyx-card" data-focusable="true" data-type="category" data-target-id="${cat}">
          <div class="card-aspect-ratio">
            <span class="card-fallback">GENRE</span>
          </div>
          <div class="card-title" style="text-transform: capitalize;">${displayLabel}</div>
        </div>
      `;
    }).join('');

    this.bindGridSelectionEvents(grid);
  }

  renderAllCountriesGrid(countries) {
    const grid = document.getElementById('countries-grid');
    if (!grid) return;

    grid.innerHTML = countries.map(iso => {
      const name = this.COUNTRY_NAMES[iso.toLowerCase()] || iso.toUpperCase();
      return `
        <div class="onyx-card" data-focusable="true" data-type="country" data-target-id="${iso}">
          <div class="card-aspect-ratio">
            <span class="card-fallback">${iso.toUpperCase()}</span>
          </div>
          <div class="card-title">${name}</div>
        </div>
      `;
    }).join('');

    this.bindGridSelectionEvents(grid);
  }

  renderAllCategoriesGrid(categories) {
    const grid = document.getElementById('categories-grid');
    if (!grid) return;

    grid.innerHTML = categories.map(cat => {
      const displayLabel = cat.replace(/-/g, ' ');
      return `
        <div class="onyx-card" data-focusable="true" data-type="category" data-target-id="${cat}">
          <div class="card-aspect-ratio">
            <span class="card-fallback">GENRE</span>
          </div>
          <div class="card-title" style="text-transform: capitalize;">${displayLabel}</div>
        </div>
      `;
    }).join('');

    this.bindGridSelectionEvents(grid);
  }

  bindGridSelectionEvents(container) {
    container.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        const id = e.currentTarget.getAttribute('data-target-id');
        
        if (type === 'country') {
          this.activeCountry = id;
          await this.loadCountryShardsView(id);
        } else if (type === 'category') {
          await this.loadChannelsGrid(this.activeCountry, id);
        }
      });
    });
  }

  async loadCountryShardsView(countryCode) {
    const categories = await OnyxApi.fetchCountryCategories(countryCode);
    const grid = document.getElementById('categories-grid');
    
    if (grid && categories.length > 0) {
      grid.innerHTML = categories.map(cat => {
        const displayLabel = cat.replace(/-/g, ' ');
        return `
          <div class="onyx-card" data-focusable="true" data-type="category" data-target-id="${cat}">
            <div class="card-aspect-ratio">
              <span class="card-fallback">${countryCode.toUpperCase()}</span>
            </div>
            <div class="card-title" style="text-transform: capitalize;">${displayLabel}</div>
          </div>
        `;
      }).join('');
      
      this.bindGridSelectionEvents(grid);
      this.switchView('categories');
      
      const currentBreadcrumb = document.getElementById('breadcrumb-current');
      if (currentBreadcrumb) {
        currentBreadcrumb.textContent = `${this.COUNTRY_NAMES[countryCode.toLowerCase()]} Categories`;
      }
    }
  }

  async loadChannelsGrid(countryCode, categorySlug) {
    const listContainer = document.getElementById('channel-list-container');
    const title = document.getElementById('channel-grid-title');
    const subtitle = document.getElementById('channel-grid-subtitle');
    
    if (!listContainer) return;

    title.textContent = 'Loading manifest...';
    subtitle.textContent = 'Contacting edge CDN servers...';
    
    this.switchView('channel-grid');

    const channels = await OnyxApi.fetchChannels(countryCode, categorySlug);
    this.activeChannelsList = channels;

    if (channels.length === 0) {
      title.textContent = 'No Channels Found';
      subtitle.textContent = `Manifest for shard [${countryCode}_${categorySlug}] is empty.`;
      listContainer.innerHTML = '';
      return;
    }

    title.textContent = `${categorySlug.replace(/-/g, ' ').toUpperCase()}`;
    subtitle.textContent = `${channels.length} localized channels loaded for ${this.COUNTRY_NAMES[countryCode] || countryCode.toUpperCase()}`;

    listContainer.innerHTML = channels.map((channel, idx) => {
      const logoUrl = OnyxApi.getLogoUrl(channel.logoId);
      const logoTag = logoUrl 
        ? `<img class="card-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`
        : '';
      const displayFallback = channel.name.slice(0, 6);

      return `
        <div class="onyx-card" data-focusable="true" data-channel-index="${idx}">
          <div class="card-aspect-ratio">
            ${logoTag}
            <span class="card-fallback" style="${logoUrl ? 'display:none;' : 'display:block;'}">${displayFallback}</span>
          </div>
          <div class="card-title">${channel.name}</div>
        </div>
      `;
    }).join('');

    listContainer.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.getAttribute('data-channel-index'), 10);
        const channel = this.activeChannelsList[index];
        if (channel) {
          this.playSelectedChannel(channel, index);
        }
      });
    });

    setTimeout(() => {
      SpatialNavigation.syncFocus();
    }, 50);
  }

  renderFavorites() {
    const grid = document.getElementById('favorites-grid');
    const emptyState = document.getElementById('favorites-empty');
    if (!grid || !emptyState) return;

    const favs = JSON.parse(localStorage.getItem('onyx_favorites') || '[]');
    this.activeChannelsList = favs;

    if (favs.length === 0) {
      grid.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    grid.classList.remove('hidden');
    emptyState.classList.add('hidden');

    grid.innerHTML = favs.map((channel, idx) => {
      const logoUrl = OnyxApi.getLogoUrl(channel.logoId);
      const logoTag = logoUrl 
        ? `<img class="card-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`
        : '';
      const displayFallback = channel.name.slice(0, 6);

      return `
        <div class="onyx-card" data-focusable="true" data-channel-index="${idx}">
          <div class="card-aspect-ratio">
            ${logoTag}
            <span class="card-fallback" style="${logoUrl ? 'display:none;' : 'display:block;'}">${displayFallback}</span>
          </div>
          <div class="card-title">${channel.name}</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.getAttribute('data-channel-index'), 10);
        const channel = this.activeChannelsList[index];
        if (channel) {
          this.playSelectedChannel(channel, index);
        }
      });
    });
  }

  /* ----------------- RECENTLY PLAYED CAROUSEL ----------------- */

  addToRecentPlayed(channel) {
    if (!channel) return;
    let recent = JSON.parse(localStorage.getItem('onyx_recent') || '[]');
    
    // De-duplicate matching IDs to slide newly selected stream to front
    recent = recent.filter(ch => ch.id !== channel.id);
    recent.unshift(channel);
    
    // Restrict size limits (12 elements max)
    recent = recent.slice(0, 12);
    localStorage.setItem('onyx_recent', JSON.stringify(recent));
    this.renderRecentlyPlayed();
  }

  renderRecentlyPlayed() {
    const row = document.getElementById('recently-played-row');
    const grid = document.getElementById('home-recent-grid');
    if (!row || !grid) return;

    const recent = JSON.parse(localStorage.getItem('onyx_recent') || '[]');
    if (recent.length === 0) {
      row.classList.add('hidden');
      return;
    }

    row.classList.remove('hidden');
    grid.innerHTML = recent.map((channel, idx) => {
      const logoUrl = OnyxApi.getLogoUrl(channel.logoId) || channel.logoUrl;
      const logoTag = logoUrl 
        ? `<img class="card-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`
        : '';
      const displayFallback = channel.name.slice(0, 6);

      return `
        <div class="onyx-card" data-focusable="true" data-recent-index="${idx}">
          <div class="card-aspect-ratio">
            ${logoTag}
            <span class="card-fallback" style="${logoUrl ? 'display:none;' : 'display:block;'}">${displayFallback}</span>
          </div>
          <div class="card-title">${channel.name}</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-recent-index'), 10);
        const channel = recent[idx];
        if (channel) {
          // Set standard list scopes to make zapping buttons loop on Recent Row items
          this.activeChannelsList = recent;
          this.currentPlayingChannelIndex = idx;
          this.playSelectedChannel(channel, idx);
        }
      });
    });
  }

  /* ----------------- PLAYBACK HUD WRAPPERS ----------------- */

  /**
   * Playback coordinator wrapping watch histories and EPG timelines.
   */
  playSelectedChannel(channel, index) {
    this.currentPlayingChannelIndex = index;
    OnyxPlayer.playChannel(channel);
    
    this.addToRecentPlayed(channel);
    this.updateEPG(channel.name);
    this.buildStreamSelectorPanel(channel);
  }

  /**
   * Realtime EPG timeline calculations.
   */
  updateEPG(channelName) {
    const nowEl = document.getElementById('hud-epg-now');
    const nextEl = document.getElementById('hud-epg-next');
    if (!nowEl || !nextEl) return;

    const currentHour = new Date().getHours();
    const nextHour = (currentHour + 1) % 24;
    const formatTime = (h) => `${String(h).padStart(2, '0')}:00`;

    nowEl.textContent = `Current Program (${formatTime(currentHour)}): ${channelName} Broadcast Live`;
    nextEl.textContent = `Next Program (${formatTime(nextHour)}): Featured Daily Showcase`;
  }

  /* ----------------- STREAM SELECTOR DRAWER ----------------- */

  bindStreamSelectorDrawer() {
    const trigger = document.getElementById('hud-stream-selector');
    trigger?.addEventListener('click', () => {
      const panel = document.getElementById('hud-stream-panel');
      const isVisible = panel && panel.classList.contains('visible');
      this.toggleStreamSelectorPanel(!isVisible);
    });
  }

  toggleStreamSelectorPanel(show) {
    const panel = document.getElementById('hud-stream-panel');
    if (!panel) return;

    if (show) {
      panel.classList.remove('hidden');
      setTimeout(() => {
        panel.classList.add('visible');
        
        // Relocate spatial router focus directly into active selector cards
        const activeCard = panel.querySelector('.hud-stream-card.active') || panel.querySelector('[data-focusable="true"]');
        if (activeCard) SpatialNavigation.focus(activeCard);
      }, 50);
    } else {
      panel.classList.remove('visible');
      panel.addEventListener('transitionend', () => {
        if (!panel.classList.contains('visible')) {
          panel.classList.add('hidden');
        }
      }, { once: true });

      // Return D-pad pointers to the main stream bar
      const selectorTrigger = document.getElementById('hud-stream-selector');
      if (selectorTrigger) SpatialNavigation.focus(selectorTrigger);
    }
  }

  buildStreamSelectorPanel(channel) {
    const list = document.getElementById('hud-streams-list');
    if (!list || !channel || !channel.urls) return;

    list.innerHTML = channel.urls.map((url, idx) => {
      const isActive = idx === OnyxPlayer.activeUrlIndex;
      const cleanUrl = url.split('?')[0].split('/').pop();
      return `
        <button class="hud-stream-card ${isActive ? 'active' : ''}" data-focusable="true" data-url-index="${idx}">
          <p><strong>Source #${idx + 1}</strong></p>
          <p style="font-size:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:4px;">${cleanUrl}</p>
        </button>
      `;
    }).join('');

    list.querySelectorAll('.hud-stream-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const targetIdx = parseInt(e.currentTarget.getAttribute('data-url-index'), 10);
        OnyxPlayer.activeUrlIndex = targetIdx;
        OnyxPlayer.loadActiveUrl();
        this.toggleStreamSelectorPanel(false);
      });
    });
  }

  /* ----------------- GLOBAL TV KEYBOARD MODAL OVERLAY ----------------- */

  bindKeyboardModalEvents() {
    const modal = document.getElementById('keyboard-modal');
    if (!modal) return;

    // Render 6-column TV remote-optimized keyboard
    const kbdGrid = document.getElementById('modal-keyboard');
    const keys = [
      'A', 'B', 'C', 'D', 'E', 'F',
      'G', 'H', 'I', 'J', 'K', 'L',
      'M', 'N', 'O', 'P', 'Q', 'R',
      'S', 'T', 'U', 'V', 'W', 'X',
      'Y', 'Z', '0', '1', '2', '3',
      '4', '5', '6', '7', '8', '9',
      'Space', 'Back'
    ];

    kbdGrid.innerHTML = keys.map(key => {
      let cssClass = 'key';
      if (key === 'Space') cssClass += ' space';
      if (key === 'Back') cssClass += ' backspace';
      return `<button class="${cssClass}" data-focusable="true" data-val="${key}">${key}</button>`;
    }).join('');

    // Keyboard Key Action Handler
    kbdGrid.querySelectorAll('.key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-val');
        const displayInput = document.getElementById('kbd-modal-input');
        let txt = displayInput.value;

        if (val === 'Space') {
          txt += ' ';
        } else if (val === 'Back') {
          txt = txt.slice(0, -1);
        } else {
          txt += val;
        }

        displayInput.value = txt;

        // Perform instant search filtration if the input target is search
        if (this.activeInputTarget && this.activeInputTarget.id === 'search-field') {
          this.activeInputTarget.value = txt;
          this.debouncedSearch(txt);
        }
      });
    });

    // Cancel typing transaction
    document.getElementById('btn-kbd-cancel')?.addEventListener('click', () => {
      this.closeKeyboardModal(false);
    });

    // Commit typing transaction
    document.getElementById('btn-kbd-submit')?.addEventListener('click', () => {
      this.closeKeyboardModal(true);
    });
  }

  openKeyboardModal(targetInput) {
    if (this.kbdModalOpen || !targetInput) return;

    this.activeInputTarget = targetInput;
    this.preModalFocus = SpatialNavigation.currentFocus;

    const displayInput = document.getElementById('kbd-modal-input');
    const modalTitle = document.getElementById('kbd-modal-title');
    
    // Setup initial placeholders depending on source context
    displayInput.value = targetInput.value;
    modalTitle.textContent = targetInput.placeholder || 'Enter Value';

    const modal = document.getElementById('keyboard-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
      modal.classList.add('visible');
      this.kbdModalOpen = true;

      // Transfer active Spatial pointer into modal
      const activeKey = modal.querySelector('.modal-keyboard-grid [data-focusable="true"]');
      if (activeKey) SpatialNavigation.focus(activeKey);
    }, 50);
  }

  closeKeyboardModal(commit) {
    const modal = document.getElementById('keyboard-modal');
    if (!modal || !this.kbdModalOpen) return;

    const displayInput = document.getElementById('kbd-modal-input');
    
    if (commit && this.activeInputTarget) {
      this.activeInputTarget.value = displayInput.value;
      
      // Fire action events if targeting settings portal URL
      if (this.activeInputTarget.id === 'setting-m3u-url') {
        this.activeInputTarget.value = displayInput.value;
      }
    } else if (!commit && this.activeInputTarget && this.activeInputTarget.id === 'search-field') {
      // Revert search fields to last stable state if user cancels
      this.activeInputTarget.value = '';
      this.executeChannelSearch('');
    }

    modal.classList.remove('visible');
    modal.addEventListener('transitionend', () => {
      if (!modal.classList.contains('visible')) {
        modal.classList.add('hidden');
      }
    }, { once: true });

    this.kbdModalOpen = false;

    // Restore focus back to original viewport
    if (this.preModalFocus && document.body.contains(this.preModalFocus)) {
      SpatialNavigation.focus(this.preModalFocus);
    } else {
      SpatialNavigation.syncFocus();
    }
    
    this.activeInputTarget = null;
    this.preModalFocus = null;
  }

  /* ----------------- SEARCH INPUT CONSTRAINTS ----------------- */

  initSearch() {
    // Overriding Search Input keyboard injection to prevent double keyboards.
    // The modal overlay now handles all typing workflows.
    const searchField = document.getElementById('search-field');
    const container = document.querySelector('.tv-keyboard-container');
    if (container) {
      // Hide legacy embedded search keyboard as modal handles everything now
      container.style.display = 'none';
    }

    // Bind Clear Buttons
    document.getElementById('search-clear-btn')?.addEventListener('click', () => {
      if (searchField) searchField.value = '';
      this.executeChannelSearch('');
    });
  }

  executeChannelSearch(query) {
    const resultsGrid = document.getElementById('search-results-grid');
    const emptyState = document.getElementById('search-empty');
    if (!resultsGrid || !emptyState) return;

    if (!query || query.trim().length === 0) {
      resultsGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    const matches = OnyxApi.searchLocal(query);
    this.activeChannelsList = matches;

    if (matches.length === 0) {
      resultsGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      emptyState.querySelector('p').textContent = `No matches found for: [${query.toUpperCase()}].`;
      return;
    }

    emptyState.classList.add('hidden');
    resultsGrid.innerHTML = matches.map((channel, idx) => {
      const logoUrl = OnyxApi.getLogoUrl(channel.logoId) || channel.logoUrl;
      const logoTag = logoUrl 
        ? `<img class="card-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`
        : '';
      const displayFallback = channel.name.slice(0, 6);

      return `
        <div class="onyx-card" data-focusable="true" data-search-index="${idx}">
          <div class="card-aspect-ratio">
            ${logoTag}
            <span class="card-fallback" style="${logoUrl ? 'display:none;' : 'display:block;'}">${displayFallback}</span>
          </div>
          <div class="card-title">${channel.name}</div>
        </div>
      `;
    }).join('');

    resultsGrid.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-search-index'), 10);
        const channel = matches[idx];
        if (channel) {
          this.playSelectedChannel(channel, idx);
        }
      });
    });
  }

  /* ----------------- CUSTOM M3U PLAYLIST LOADER ----------------- */

  async triggerCustomM3ULoader() {
    const input = document.getElementById('setting-m3u-url');
    if (!input || !input.value.trim().startsWith('http')) {
      OnyxPlayer.showToast('Please enter a valid M3U playlist URL.');
      return;
    }

    const m3uUrl = input.value.trim();
    OnyxPlayer.showSpinner('Downloading custom playlist...');

    try {
      const response = await fetch(m3uUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const rawText = await response.text();
      const channels = this.parseM3UContent(rawText);

      if (channels.length === 0) {
        throw new Error('Playlist parsing yielded 0 valid channels.');
      }

      localStorage.setItem('onyx_custom_playlist', JSON.stringify(channels));
      OnyxPlayer.showToast(`Success! Loaded ${channels.length} custom channels.`);
      
      this.loadCustomM3UFromStorage();
    } catch (e) {
      console.error('[PORTAL] Parsing error:', e);
      OnyxPlayer.showToast(`Failed to parse playlist: ${e.message}`);
    } finally {
      OnyxPlayer.hideSpinner();
    }
  }

  parseM3UContent(text) {
    const lines = text.split('\n');
    const channels = [];
    let currentChannel = null;

    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('#EXTINF:')) {
        const nameMatch = line.match(/,(.+)$/);
        const name = nameMatch ? nameMatch[1].trim() : "Custom Channel";
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        const logoUrl = logoMatch ? logoMatch[1] : null;
        const groupMatch = line.match(/group-title="([^"]+)"/);
        const category = groupMatch ? groupMatch[1] : "Custom Portal";

        currentChannel = {
          id: 'custom-' + Math.random().toString(36).substr(2, 9),
          name: name,
          urls: [],
          logoUrl: logoUrl,
          categories: [category],
          isCustom: true
        };
      } else if (line.startsWith('http') && currentChannel) {
        currentChannel.urls.push(line);
        channels.push(currentChannel);
        currentChannel = null;
      }
    }
    return channels;
  }

  loadCustomM3UFromStorage() {
    const customChannels = JSON.parse(localStorage.getItem('onyx_custom_playlist') || '[]');
    if (customChannels.length === 0) return;

    // Register into memory search index
    for (const ch of customChannels) {
      OnyxApi.indexedChannels.set(ch.id, ch);
    }

    // Inject dynamic category into Categories grids
    this.injectCustomCategoryIntoUI();
  }

  injectCustomCategoryIntoUI() {
    const catGrid = document.getElementById('categories-grid');
    if (!catGrid) return;

    const exists = catGrid.querySelector('[data-target-id="custom-portal-playlist"]');
    if (exists) return;

    const customCard = document.createElement('div');
    customCard.className = 'onyx-card';
    customCard.setAttribute('data-focusable', 'true');
    customCard.setAttribute('data-type', 'category');
    customCard.setAttribute('data-target-id', 'custom-portal-playlist');
    customCard.innerHTML = `
      <div class="card-aspect-ratio" style="border-color: var(--accent-color);">
        <span class="card-fallback" style="color: var(--accent-color);">PORTAL</span>
      </div>
      <div class="card-title">My Custom Portal</div>
    `;

    catGrid.insertBefore(customCard, catGrid.firstChild);
    
    // Bind click events on the newly injected custom card
    customCard.addEventListener('click', () => {
      this.loadCustomChannelsGrid();
    });
  }

  loadCustomChannelsGrid() {
    const listContainer = document.getElementById('channel-list-container');
    const title = document.getElementById('channel-grid-title');
    const subtitle = document.getElementById('channel-grid-subtitle');
    
    if (!listContainer) return;

    this.switchView('channel-grid');

    const channels = JSON.parse(localStorage.getItem('onyx_custom_playlist') || '[]');
    this.activeChannelsList = channels;

    title.textContent = 'CUSTOM PORTAL';
    subtitle.textContent = `${channels.length} custom channels parsed from user playlist URL.`;

    listContainer.innerHTML = channels.map((channel, idx) => {
      const logoUrl = channel.logoUrl;
      const logoTag = logoUrl 
        ? `<img class="card-logo" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`
        : '';
      const displayFallback = channel.name.slice(0, 6);

      return `
        <div class="onyx-card" data-focusable="true" data-custom-index="${idx}">
          <div class="card-aspect-ratio">
            ${logoTag}
            <span class="card-fallback" style="${logoUrl ? 'display:none;' : 'display:block;'}">${displayFallback}</span>
          </div>
          <div class="card-title">${channel.name}</div>
        </div>
      `;
    }).join('');

    listContainer.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-custom-index'), 10);
        const channel = channels[idx];
        if (channel) {
          this.playSelectedChannel(channel, idx);
        }
      });
    });

    setTimeout(() => {
      SpatialNavigation.syncFocus();
    }, 50);
  }

  /* ----------------- UTILITIES, SYSTEM CLOCK & PWAs ----------------- */

  startSystemClock() {
    const clockEl = document.getElementById('app-clock');
    if (!clockEl) return;

    const tick = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      
      hours = hours % 12;
      hours = hours ? hours : 12;
      const formattedHours = String(hours).padStart(2, '0');

      clockEl.textContent = `${formattedHours}:${minutes} ${ampm}`;
    };

    tick();
    setInterval(tick, 1000);
  }

  triggerQuickPlay() {
    const fallbackChannel = Array.from(OnyxApi.indexedChannels.values())[0];
    if (fallbackChannel) {
      this.playSelectedChannel(fallbackChannel, 0);
    } else {
      OnyxPlayer.showToast('Please open a country or category grid to register playback manifests first.');
    }
  }

  updateBootStatus(text) {
    const el = document.getElementById('splash-status');
    if (el) el.textContent = text;
  }

  dismissSplashScreen() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('hidden');
      splash.addEventListener('transitionend', () => splash.remove());
    }
  }

  debounce(func, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  }
}

// Global runtime execution coordinator
const OnyxApp = new OnyxAppCoordinator();
window.addEventListener('DOMContentLoaded', () => OnyxApp.boot());