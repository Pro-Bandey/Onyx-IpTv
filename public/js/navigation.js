/**
 * ONYX IPTV - Spatial Navigation Engine
 * Dedicated geometric focus router optimized for TV remote D-Pads and WebOS/Tizen WebViews.
 */

class SpatialNavigationEngine {
  constructor() {
    this.activeView = 'home';
    this.currentFocus = null;
    this.sidebarFocused = false;
    this.lastContentFocus = null;
    this.keyListeners = new Set();
    
    // Standard TV Remote Key Mapping
    this.KEY_CODES = {
      LEFT: 37,
      UP: 38,
      RIGHT: 39,
      DOWN: 40,
      ENTER: 13,
      BACK_NATIVE: 461, // Tizen/webOS Back Key
      BACK_ESC: 27,     // Standard Escape / Keyboard Back
      BACK_ALT: 8       // Backspace
    };
  }

  /**
   * Initializes the event bindings for physical keydown handlers.
   */
  init() {
    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    
    // Auto-focus first element upon application load
    setTimeout(() => {
      this.syncFocus();
    }, 100);
  }

  /**
   * Allows external modules to hook into navigation and back actions.
   * @param {Function} callback - Callback processing (keyCode, event)
   */
  addKeyListener(callback) {
    this.keyListeners.add(callback);
  }

  removeKeyListener(callback) {
    this.keyListeners.delete(callback);
  }

  /**
   * Evaluates if an element is physically visible in the viewport and not obscured.
   */
  isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      window.getComputedStyle(element).display !== 'none' &&
      window.getComputedStyle(element).visibility !== 'hidden' &&
      element.closest('.view-panel.active, #sidebar, #player-hud.visible, .tv-keyboard-container, .search-input-wrapper') !== null
    );
  }

  /**
   * Queries all focusable elements currently active and visible in the DOM.
   */
  getFocusableElements() {
    const rawElements = document.querySelectorAll('[data-focusable="true"]');
    return Array.from(rawElements).filter(el => this.isVisible(el));
  }

  /**
   * Focuses a specific target element, resetting the active state of others.
   */
  focus(element) {
    if (!element) return;

    // Discard focus from previous elements
    if (this.currentFocus) {
      this.currentFocus.classList.remove('focused');
      this.currentFocus.blur();
    }

    this.currentFocus = element;
    this.currentFocus.classList.add('focused');
    
    // Trigger actual system focus for OS keyboard events
    this.currentFocus.focus();

    // Check if newly focused element is within the Sidebar Navigation
    const isSidebar = this.currentFocus.closest('#sidebar') !== null;
    this.toggleSidebarState(isSidebar);

    if (!isSidebar) {
      this.lastContentFocus = this.currentFocus;
    }

    // Handle scroll alignment so focused elements are kept in viewport
    this.scrollIntoViewIfNeeded(element);
  }

  /**
   * Forces the sidebar navigation panel to expand or collapse depending on focus coordinates.
   */
  toggleSidebarState(isFocused) {
    this.sidebarFocused = isFocused;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (isFocused) {
      sidebar.classList.add('expanded');
    } else {
      sidebar.classList.remove('expanded');
    }
  }

  /**
   * Aligns offscreen grids when focused targets move near viewport boundaries.
   */
  scrollIntoViewIfNeeded(element) {
    const parentScroll = element.closest('.viewport-canvas, .horizontal-scroll-grid, .search-results-pane');
    if (!parentScroll) return;

    const parentRect = parentScroll.getBoundingClientRect();
    const elemRect = element.getBoundingClientRect();

    // Horizontal Scrolling Containers (Row Carousel)
    if (parentScroll.classList.contains('horizontal-scroll-grid')) {
      if (elemRect.left < parentRect.left + 20) {
        parentScroll.scrollLeft -= (parentRect.left - elemRect.left + 40);
      } else if (elemRect.right > parentRect.right - 20) {
        parentScroll.scrollLeft += (elemRect.right - parentRect.right + 40);
      }
    } 
    // Vertical Viewport Areas (Grid Shards)
    else {
      if (elemRect.top < parentRect.top + 40) {
        parentScroll.scrollTop -= (parentRect.top - elemRect.top + 80);
      } else if (elemRect.bottom > parentRect.bottom - 40) {
        parentScroll.scrollTop += (elemRect.bottom - parentRect.bottom + 80);
      }
    }
  }

  /**
   * Scans and matches closest elements geometrically in 2D space.
   */
  navigate(direction) {
    if (!this.currentFocus) {
      this.syncFocus();
      return;
    }

    const candidates = this.getFocusableElements();
    if (candidates.length === 0) return;

    const currentRect = this.currentFocus.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestCandidate = null;
    let shortestDistance = Infinity;

    for (const candidate of candidates) {
      if (candidate === this.currentFocus) continue;

      const candRect = candidate.getBoundingClientRect();
      const candCenter = {
        x: candRect.left + candRect.width / 2,
        y: candRect.top + candRect.height / 2
      };

      const dx = candCenter.x - currentCenter.x;
      const dy = candCenter.y - currentCenter.y;

      // Ensure candidates are located in the true requested direction
      let isValidDirection = false;
      switch (direction) {
        case 'LEFT':
          isValidDirection = dx < -2; // Threshold offset to handle slight misalignment
          break;
        case 'RIGHT':
          isValidDirection = dx > 2;
          break;
        case 'UP':
          isValidDirection = dy < -2;
          break;
        case 'DOWN':
          isValidDirection = dy > 2;
          break;
      }

      if (!isValidDirection) continue;

      /**
       * Euclidean Orthogonal Weighted Distance Formula
       * High penalty on orthogonal axis to prioritize straight paths (prevents diagonal column switching)
       */
      let distance;
      if (direction === 'LEFT' || direction === 'RIGHT') {
        distance = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy * 4, 2));
      } else {
        distance = Math.sqrt(Math.pow(dx * 4, 2) + Math.pow(dy, 2));
      }

      if (distance < shortestDistance) {
        shortestDistance = distance;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      this.focus(bestCandidate);
    } else if (direction === 'RIGHT' && this.sidebarFocused) {
      // Exit sidebar context back into active grid space
      this.exitSidebarToContent();
    }
  }

  /**
   * Resumes focus onto last active content card when jumping right out of sidebar.
   */
  exitSidebarToContent() {
    if (this.lastContentFocus && this.isVisible(this.lastContentFocus)) {
      this.focus(this.lastContentFocus);
    } else {
      // Fallback: Locate any active container view focus targets
      const firstContent = this.getFocusableElements().find(el => !el.closest('#sidebar'));
      if (firstContent) this.focus(firstContent);
    }
  }

  /**
   * Auto-selects a logical fallback focus element depending on active panel view.
   */
  syncFocus() {
    const candidates = this.getFocusableElements();
    if (candidates.length === 0) return;

    // Favor existing content elements first
    const contentCandidates = candidates.filter(el => !el.closest('#sidebar'));
    if (contentCandidates.length > 0) {
      this.focus(contentCandidates[0]);
    } else {
      this.focus(candidates[0]);
    }
  }

  /**
   * Direct execution routing for incoming TV key events.
   */
  handleKeyDown(event) {
    const code = event.keyCode;
    let handled = false;

    // Propagate up to active external listener bindings first (e.g. video overlays, settings, keyboard typing)
    for (const listener of this.keyListeners) {
      if (listener(code, event)) {
        event.preventDefault();
        return;
      }
    }

    switch (code) {
      case this.KEY_CODES.LEFT:
        this.navigate('LEFT');
        handled = true;
        break;
      case this.KEY_CODES.UP:
        this.navigate('UP');
        handled = true;
        break;
      case this.KEY_CODES.RIGHT:
        this.navigate('RIGHT');
        handled = true;
        break;
      case this.KEY_CODES.DOWN:
        this.navigate('DOWN');
        handled = true;
        break;
      case this.KEY_CODES.ENTER:
        if (this.currentFocus) {
          this.currentFocus.click();
        }
        handled = true;
        break;
      case this.KEY_CODES.BACK_ESC:
      case this.KEY_CODES.BACK_NATIVE:
      case this.KEY_CODES.BACK_ALT:
        handled = this.handleBackAction();
        break;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  /**
   * Central Back button intercept engine.
   */
  handleBackAction() {
    const playerHud = document.getElementById('player-hud');
    if (playerHud && playerHud.classList.contains('visible')) {
      document.getElementById('hud-back').click();
      return true;
    }

    const currentPanel = document.querySelector('.view-panel.active');
    if (currentPanel && currentPanel.id === 'view-channel-grid') {
      const backBtn = document.getElementById('btn-back-grid');
      if (backBtn) {
        backBtn.click();
        return true;
      }
    }

    if (!this.sidebarFocused) {
      const sidebarHome = document.getElementById('nav-home');
      if (sidebarHome) {
        this.focus(sidebarHome);
        return true;
      }
    }

    return false;
  }
}

export const SpatialNavigation = new SpatialNavigationEngine();