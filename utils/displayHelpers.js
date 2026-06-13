/**
 * displayHelpers.js
 *
 * Shared display/formatting utilities used across tournament commands.
 * Eliminates copy-pasted prettyPhase, truncate, parseColor, etc.
 */

/* ====================================================
   PHASE FORMATTING
==================================================== */

/** Pretty-print a tournament phase name. */
function prettyPhase(phase) {
    const map = {
        league: 'League',
        group: 'Group Stage',
        qualifier: 'Qualifier',
        eliminator: 'Eliminator',
        quarterfinal: 'Quarter Final',
        semifinal: 'Semi Final',
        final: 'Final',
        custom: 'Custom'
    };

    return map[phase] || phase || 'Fixture';
}

/* ====================================================
   TEXT HELPERS
==================================================== */

/** Truncate text to a max length with ellipsis. */
function truncate(text, max) {
    const value = String(text || '');
    return value.length > max ? value.slice(0, max - 3) + '...' : value;
}

/* ====================================================
   COLOR PARSING
==================================================== */

/**
 * Parse a hex color string into an integer for embed colors.
 * @param {string|null} color - Hex color string (with or without #)
 * @param {number} fallback - Default value when color is null/invalid
 * @returns {number}
 */
function parseColor(color, fallback = 0xFEBE10) {
    if (!color) return fallback;

    const cleaned = String(color).trim().replace('#', '');

    if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
        return parseInt(cleaned, 16);
    }

    return fallback;
}

module.exports = { prettyPhase, truncate, parseColor };
