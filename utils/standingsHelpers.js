/**
 * standingsHelpers.js
 * 
 * Shared helpers for standings across:
 * - utils/updateStandings.js (live standings)
 * - commands/tournament/standings-hf.js (standings command)
 * - utils/generateStandingsImage.js (image generation)
 *
 * Single source of truth. Do NOT duplicate these elsewhere.
 */

/**
 * Sort teams by: points desc, GD desc, GF desc, name asc.
 *
 * Works with both:
 *   - TournamentTeam docs (use teamNameSnapshot)
 *   - Populated TournamentTeam docs (also checks teamId.name)
 *
 * @param {Array} teams - Array of team objects with .stats
 * @returns {Array} Sorted copy
 */
function sortTeams(teams) {
    return [...teams].sort((a, b) => {
        const aStats = a.stats || {};
        const bStats = b.stats || {};

        const aPoints = aStats.points || 0;
        const bPoints = bStats.points || 0;
        if (bPoints !== aPoints) return bPoints - aPoints;

        const aGD = (aStats.gf || 0) - (aStats.ga || 0);
        const bGD = (bStats.gf || 0) - (bStats.ga || 0);
        if (bGD !== aGD) return bGD - aGD;

        const aGF = aStats.gf || 0;
        const bGF = bStats.gf || 0;
        if (bGF !== aGF) return bGF - aGF;

        const aName = a.teamNameSnapshot || a.teamId?.name || '';
        const bName = b.teamNameSnapshot || b.teamId?.name || '';

        return aName.localeCompare(bName);
    });
}

/**
 * Compact a team name to fit within maxLen characters.
 *
 * @param {string} name
 * @param {number} maxLen - Maximum character length
 * @returns {string}
 */
function compactName(name, maxLen = 12) {
    if (!name) return 'Unknown';

    return name.length > maxLen
        ? name.slice(0, maxLen - 2) + '..'
        : name;
}

/**
 * Determine the qualification zone for a given position.
 *
 * LEAGUE VIEW (no groupKey):
 *   - UCL zone: position <= uclQualificationSpots → 'ucl'
 *   - Qualification zone: position > uclQualificationSpots
 *     AND position <= qualificationSpotsPerGroup → 'qualification'
 *   - Everything else → 'neutral'
 *
 * GROUP VIEW (groupKey provided):
 *   - Qualification zone: position <= qualificationSpotsPerGroup
 *     (only if hasKnockout is true) → 'qualification'
 *   - Everything else → 'neutral'
 *
 * IMPORTANT:
 *   - Never defaults qualification to 2. Defaults to 0.
 *   - UCL only applies in league view.
 *
 * @param {Object} params
 * @param {number} params.position - 1-based position in the table
 * @param {Object} params.settings - TournamentSettings doc
 * @param {string|null} params.groupKey - Group key or null for league view
 * @returns {'ucl' | 'qualification' | 'neutral'}
 */
function getQualificationZone({ position, settings, groupKey }) {
    if (!settings) return 'neutral';

    // ── GROUP VIEW ──
    if (groupKey) {
        if (!settings.hasKnockout) return 'neutral';

        const spots = settings.qualificationSpotsPerGroup || 0;

        if (spots > 0 && position <= spots) return 'qualification';

        return 'neutral';
    }

    // ── LEAGUE VIEW ──
    const uclSpots = settings.uclQualificationSpots || 0;
    const qualSpots = settings.qualificationSpotsPerGroup || 0;

    if (uclSpots > 0 && position <= uclSpots) return 'ucl';

    if (
        qualSpots > 0 &&
        position > uclSpots &&
        position <= qualSpots
    ) {
        return 'qualification';
    }

    return 'neutral';
}

/**
 * Truncate text to max characters with ellipsis.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
    const value = String(text || '');

    return value.length > max
        ? value.slice(0, max - 3) + '...'
        : value;
}

module.exports = {
    sortTeams,
    compactName,
    getQualificationZone,
    truncate
};
