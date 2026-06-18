/**
 * ONYX IPTV - Advanced Structural Spatial Navigation Engine
 * Optimized for Smart TVs (Samsung Tizen, LG webOS, Android TV, Apple TV)
 */
const SpatialNav = {
    // Current Navigation State
    activeArea: 'rows', // 'sidebar' | 'rows'
    sidebarIndex: 0,
    rowIndex: 0,
    colIndex: 0,

    // DOM Elements Cache
    sidebarEl: null,
    rowsContainerEl: null,
    sidebarItems: [],
    rows: [], // Array of row objects: { element: HTMLElement, cards: HTMLElement[] }

    // Constants matching CSS step dimensions
    CARD_STEP: 220, // var(--card-width) 200px + gap 20px
    ROW_STEP: 210,  // swimlane-row height 185px + margin-bottom 25px

    init() {
        this.sidebarEl = document.getElementById('sidebar');
        this.rowsContainerEl = document.getElementById('rows-container');

        this.update();

        // Global Event Listener for Key Inputs (Remotes & Keyboards)
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
    },

    /**
     * Call this whenever dynamic cards or rows are loaded into the DOM
     */
    update() {
        this.sidebarItems = Array.from(document.querySelectorAll('#sidebar .nav-item'));
        
        const rowElements = Array.from(document.querySelectorAll('.swimlane-row'));
        this.rows = rowElements.map(rowEl => ({
            element: rowEl,
            cards: Array.from(rowEl.querySelectorAll('.channel-card'))
        }));

        // Reset indexes safely if boundaries changed
        if (this.sidebarIndex >= this.sidebarItems.length) this.sidebarIndex = 0;
        if (this.rowIndex >= this.rows.length) this.rowIndex = 0;
        
        this.applyFocus();
    },

    handleKeyDown(e) {
        // Prevent default browser behavior (like page scrolling or back history)
        const blockKeys = [8, 13, 27, 37, 38, 39, 40, 461, 10009];
        if (blockKeys.includes(e.keyCode)) {
            e.preventDefault();
        }

        // TV / Keyboard Key Mapping
        switch (e.keyCode) {
            case 37: // LEFT
                this.moveLeft();
                break;
            case 39: // RIGHT
                this.moveRight();
                break;
            case 38: // UP
                this.moveUp();
                break;
            case 40: // DOWN
                this.moveDown();
                break;
            case 13: // ENTER / OK
                this.triggerEnter();
                break;
            case 8:     // Backspace
            case 27:    // Escape
            case 461:   // LG webOS BACK
            case 10009: // Samsung Tizen BACK
                this.triggerBack();
                break;
        }
    },

    /* --------------------------------------------------------------------------
       NAVIGATION DIRECTIONS
       -------------------------------------------------------------------------- */

    moveLeft() {
        if (this.activeArea === 'rows') {
            if (this.colIndex > 0) {
                this.colIndex--;
                this.applyFocus();
            } else {
                // If on the first card, move left into the sidebar navigation
                this.activeArea = 'sidebar';
                this.applyFocus();
            }
        }
    },

    moveRight() {
        if (this.activeArea === 'sidebar') {
            // Leave sidebar and return to the grid area
            this.activeArea = 'rows';
            this.applyFocus();
        } else if (this.activeArea === 'rows') {
            const currentRow = this.rows[this.rowIndex];
            if (currentRow && this.colIndex < currentRow.cards.length - 1) {
                this.colIndex++;
                this.applyFocus();
            }
        }
    },

    moveUp() {
        if (this.activeArea === 'sidebar') {
            if (this.sidebarIndex > 0) {
                this.sidebarIndex--;
                this.applyFocus();
            }
        } else if (this.activeArea === 'rows') {
            if (this.rowIndex > 0) {
                this.rowIndex--;
                // Ensure column index is kept within safe limits for the row above
                const nextRow = this.rows[this.rowIndex];
                if (nextRow && this.colIndex >= nextRow.cards.length) {
                    this.colIndex = Math.max(0, nextRow.cards.length - 1);
                }
                this.applyFocus();
            }
        }
    },

    moveDown() {
        if (this.activeArea === 'sidebar') {
            if (this.sidebarIndex < this.sidebarItems.length - 1) {
                this.sidebarIndex++;
                this.applyFocus();
            }
        } else if (this.activeArea === 'rows') {
            if (this.rowIndex < this.rows.length - 1) {
                this.rowIndex++;
                // Ensure column index is kept within safe limits for the row below
                const nextRow = this.rows[this.rowIndex];
                if (nextRow && this.colIndex >= nextRow.cards.length) {
                    this.colIndex = Math.max(0, nextRow.cards.length - 1);
                }
                this.applyFocus();
            }
        }
    },

    /* --------------------------------------------------------------------------
       DOM FOCUS MANAGEMENT & SLIDING CAROUSEL MATH
       -------------------------------------------------------------------------- */

    applyFocus() {
        // 1. Remove focus classes globally
        document.querySelectorAll('.focusable').forEach(el => el.classList.remove('focused'));

        if (this.activeArea === 'sidebar') {
            // Expand Left Drawer visually
            this.sidebarEl.classList.add('sidebar-expanded');

            const itemToFocus = this.sidebarItems[this.sidebarIndex];
            if (itemToFocus) {
                itemToFocus.classList.add('focused');
            }
        } else {
            // Collapse Left Drawer
            this.sidebarEl.classList.remove('sidebar-expanded');

            const currentRow = this.rows[this.rowIndex];
            if (currentRow) {
                const cardToFocus = currentRow.cards[this.colIndex];
                if (cardToFocus) {
                    cardToFocus.classList.add('focused');
                    
                    // Trigger Hero Metadata Update based on focused channel
                    if (window.App && typeof window.App.updateHeroBanner === 'function') {
                        window.App.updateHeroBanner(cardToFocus);
                    }
                }

                // 2. Horizontally Slide the active row cards container
                const container = currentRow.element.querySelector('.row-cards-container');
                if (container) {
                    const translateX = -(this.colIndex * this.CARD_STEP);
                    container.style.transform = `translateX(${translateX}px)`;
                }
            }

            // 3. Vertically Slide the main content container wrapper
            if (this.rowsContainerEl) {
                const translateY = -(this.rowIndex * this.ROW_STEP);
                this.rowsContainerEl.style.transform = `translateY(${translateY}px)`;
            }
        }
    },

    /* --------------------------------------------------------------------------
       INTERACTION TRIGGERS
       -------------------------------------------------------------------------- */

    triggerEnter() {
        if (this.activeArea === 'sidebar') {
            const activeItem = this.sidebarItems[this.sidebarIndex];
            if (activeItem) activeItem.click();
        } else {
            const currentRow = this.rows[this.rowIndex];
            if (currentRow) {
                const activeCard = currentRow.cards[this.colIndex];
                if (activeCard) activeCard.click();
            }
        }
    },

    triggerBack() {
        const playerLayer = document.getElementById('player-layer');
        // If fullscreen player is running, stop it and return to shell
        if (playerLayer && !playerLayer.classList.contains('player-hidden')) {
            if (window.TVPlayer && typeof window.TVPlayer.stop === 'function') {
                window.TVPlayer.stop();
            }
        } else {
            console.log("[SYSTEM] Exit Request");
            // Standard web apps can trigger a window close or widget exit here if desired
        }
    }
};

// Auto-run once DOM scripts are evaluation-ready
document.addEventListener('DOMContentLoaded', () => {
    SpatialNav.init();
});