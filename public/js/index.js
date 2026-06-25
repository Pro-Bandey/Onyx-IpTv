/**
 * ONYX IPTV - Main Application Coordinator
 * Boots the unified runtime, controls PWA routing, and manages TV-optimized UI layouts.
 */

import { SpatialNavigation } from './navigation.js';
import { OnyxPlayer } from './player.js';
import { OnyxApi } from './api.js';

class OnyxAppCoordinator {
  constructor() {
    this.activeView = 'home';
    this.activeCountry = 'us'; // Default startup country
    this.activeChannelsList = []; // Holds channels of currently displayed shard
    this.currentPlayingChannelIndex = -1;
    
    this.COUNTRY_NAMES = {
      us: 'United States',
      in: 'India',
      pk: 'Pakistan',
      ru: 'Russia'
    };
  }

  /**
   * Application Bootstrapper. Runs API mappings and triggers UI bindings.
   */
  async boot() {
    console.log('[SYSTEM] Initializing Onyx IPTV Web System...');
    
    // Resolve CDN addresses and boot engines
    OnyxApi.init();
    SpatialNavigation.init();
    OnyxPlayer.init();

    this.startSystemClock();
    this.bindSidebarEvents();
    this.bindUtilityEvents();
    this.bindGlobalPlayerSwaps();

    try {
      this.updateBootStatus('Fetching channel manifests...');
      const index = await OnyxApi.fetchIndex();
      
      this.updateBootStatus('Populating layouts...');
      this.renderHome(index);
      
      // Attempt background prefetch to speed up initial D-Pad operations
      OnyxApi.prefetchPopularShards(index.countries, index.categories);
      
      this.dismissSplashScreen();
    } catch (error) {
      console.error('[SYSTEM] Critical error during core database boot phase:', error);
      this.updateBootStatus('DATABASE ERROR: Check connection and redeploy pipeline.');
    }
  }

  /* ----------------- CORE INTERFACES & DOM BINDINGS ----------------- */

  bindSidebarEvents() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Detect click events on navigation sidebar anchors
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
    // Return to dashboard from sharded channel views
    document.getElementById('btn-back-grid')?.addEventListener('click', () => {
      this.switchView('countries');
    });

    // Quick Play Billboard Button
    document.getElementById('billboard-quickplay')?.addEventListener('click', () => {
      this.triggerQuickPlay();
    });

    // Update settings buttons logic
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

    // Favorites Mutation Listener
    window.addEventListener('favorites-updated', () => {
      if (this.activeView === 'favorites') {
        this.renderFavorites();
      }
    });
  }

  /**
   * Seamless background stream navigation handler (Channel Zapping).
   * Catches media-layer skip triggers to transition to adjoining channels instantly.
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
        OnyxPlayer.playChannel(targetChannel);
      }
    });
  }

  /* ----------------- VIEW ROUTING & STATE CONTROLS ----------------- */

  switchView(viewId) {
    if (this.activeView === viewId && viewId !== 'channel-grid') return;

    console.log(`[ROUTER] Swapping focus view to: [${viewId}]`);
    
    // Hide active overlays if users navigate back out to sidebars
    if (viewId !== 'player-hud') {
      OnyxPlayer.hideHud();
    }

    // Toggle viewport container display states
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    const activePanel = document.getElementById(`view-${viewId}`);
    if (activePanel) {
      activePanel.classList.add('active');
    }

    // Sync active state highlighted on Sidebar elements
    document.querySelectorAll('#sidebar .nav-item').forEach(item => {
      if (item.getAttribute('data-view') === viewId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    this.activeView = viewId;
    SpatialNavigation.activeView = viewId;

    // Set logical breadcrumb pathways
    const currentBreadcrumb = document.getElementById('breadcrumb-current');
    if (currentBreadcrumb) {
      currentBreadcrumb.textContent = viewId.toUpperCase();
    }

    // Build specific layouts on-demand
    if (viewId === 'favorites') {
      this.renderFavorites();
    } else if (viewId === 'search') {
      this.initSearch();
    }

    // Return focus automatically into the newly rendered panel workspace
    setTimeout(() => {
      SpatialNavigation.syncFocus();
    }, 50);
  }

  /* ----------------- PAGE COMPILING & RENDERERS ----------------- */

  renderHome(indexData) {
    this.renderHomeCountries(indexData.countries);
    this.renderHomeCategories(indexData.categories);
    
    // Populate root view grids
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

  /**
   * Binds card selection routes (navigating from indices directly down to stream selectors).
   */
  bindGridSelectionEvents(container) {
    container.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        const id = e.currentTarget.getAttribute('data-target-id');
        
        if (type === 'country') {
          this.activeCountry = id;
          // Dynamically fetch and display categories inside country context
          await this.loadCountryShardsView(id);
        } else if (type === 'category') {
          // Defaults query category targeting currently selected active country
          await this.loadChannelsGrid(this.activeCountry, id);
        }
      });
    });
  }

  async loadCountryShardsView(countryCode) {
    const categories = await OnyxApi.fetchCountryCategories(countryCode);
    const grid = document.getElementById('categories-grid');
    
    // Automatically swap viewports to Categories panel with context filtered categories
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

  /**
   * Loads specific dynamic channel feeds, rendering visual lists and setting player scopes.
   */
  async loadChannelsGrid(countryCode, categorySlug) {
    const listContainer = document.getElementById('channel-list-container');
    const title = document.getElementById('channel-grid-title');
    const subtitle = document.getElementById('channel-grid-subtitle');
    
    if (!listContainer) return;

    title.textContent = 'Loading manifest...';
    subtitle.textContent = 'Contacting edge CDN servers...';
    
    this.switchView('channel-grid');

    const channels = await OnyxApi.fetchChannels(countryCode, categorySlug);
    this.activeChannelsList = channels; // Cache scope for skip zapping

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

    // Bind click actions to load standard player frames
    listContainer.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.getAttribute('data-channel-index'), 10);
        const channel = this.activeChannelsList[index];
        if (channel) {
          this.currentPlayingChannelIndex = index;
          OnyxPlayer.playChannel(channel);
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
    this.activeChannelsList = favs; // Scope current channel skipping to Favorites if selected

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
          this.currentPlayingChannelIndex = index;
          OnyxPlayer.playChannel(channel);
        }
      });
    });
  }

  /* ----------------- SEARCH & VIRTUAL KEYBOARD ----------------- */

  initSearch() {
    const searchField = document.getElementById('search-field');
    const kbd = document.getElementById('tv-keyboard');
    if (!searchField || !kbd || kbd.children.length > 0) return; // Prevent double keyboard builds

    const keys = [
      'A', 'B', 'C', 'D', 'E', 'F',
      'G', 'H', 'I', 'J', 'K', 'L',
      'M', 'N', 'O', 'P', 'Q', 'R',
      'S', 'T', 'U', 'V', 'W', 'X',
      'Y', 'Z', '0', '1', '2', '3',
      '4', '5', '6', '7', '8', '9',
      'Space', 'Back'
    ];

    kbd.innerHTML = keys.map(key => {
      let cssClass = 'key';
      if (key === 'Space') cssClass += ' space';
      if (key === 'Back') cssClass += ' backspace';
      return `<button class="${cssClass}" data-focusable="true" data-val="${key}">${key}</button>`;
    }).join('');

    // Bind keyboard input event handlers
    kbd.querySelectorAll('.key').forEach(button => {
      button.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-val');
        let currentText = searchField.value;

        if (val === 'Space') {
          currentText += ' ';
        } else if (val === 'Back') {
          currentText = currentText.slice(0, -1);
        } else {
          currentText += val;
        }

        searchField.value = currentText;
        this.executeChannelSearch(currentText);
      });
    });

    document.getElementById('search-clear-btn')?.addEventListener('click', () => {
      searchField.value = '';
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
    this.activeChannelsList = matches; // Scope skip zapping to matches grid

    if (matches.length === 0) {
      resultsGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      emptyState.querySelector('p').textContent = `No channels match the query keyword: [${query.toUpperCase()}].`;
      return;
    }

    emptyState.classList.add('hidden');
    
    resultsGrid.innerHTML = matches.map((channel, idx) => {
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

    resultsGrid.querySelectorAll('.onyx-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.getAttribute('data-channel-index'), 10);
        const channel = this.activeChannelsList[index];
        if (channel) {
          this.currentPlayingChannelIndex = index;
          OnyxPlayer.playChannel(channel);
        }
      });
    });
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
      hours = hours ? hours : 12; // Formats hour '0' directly to '12'
      const formattedHours = String(hours).padStart(2, '0');

      clockEl.textContent = `${formattedHours}:${minutes} ${ampm}`;
    };

    tick();
    setInterval(tick, 1000);
  }

  triggerQuickPlay() {
    // Looks for any registered channel in cache, playing the first hit
    const fallbackChannel = Array.from(OnyxApi.indexedChannels.values())[0];
    if (fallbackChannel) {
      OnyxPlayer.playChannel(fallbackChannel);
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
}

// Global runtime execution coordinator
const OnyxApp = new OnyxAppCoordinator();
window.addEventListener('DOMContentLoaded', () => OnyxApp.boot());