/**
 * DIGIPIN Core Implementation
 * Based on Department of Posts technical specification (March 2025)
 *
 * DIGIPIN is a national-level addressing grid system that divides India's geographical
 * territory into uniform 4m x 4m units, each with a unique 10-digit alphanumeric code.
 */
// DIGIPIN Labeling Grid - Used at all levels (1-10)
const DIGIPIN_GRID = [
    ['F', 'C', '9', '8'],
    ['J', '3', '2', '7'],
    ['K', '4', '5', '6'],
    ['L', 'M', 'P', 'T']
];
// Bounding Box for India (EPSG:4326 - WGS84)
const BOUNDS = {
    MIN_LAT: 2.5,
    MAX_LAT: 38.5,
    MIN_LON: 63.5,
    MAX_LON: 99.5
};
// Grid division parameters
const GRID_DIVISIONS = 4; // 4x4 grid at each level
const MAX_LEVELS = 10;
/**
 * Validates if coordinates are within DIGIPIN bounding box
 */
export function validateCoordinates(lat, lon) {
    if (lat < BOUNDS.MIN_LAT || lat > BOUNDS.MAX_LAT) {
        return {
            valid: false,
            error: `Latitude ${lat} out of range. Must be between ${BOUNDS.MIN_LAT}° and ${BOUNDS.MAX_LAT}°N`
        };
    }
    if (lon < BOUNDS.MIN_LON || lon > BOUNDS.MAX_LON) {
        return {
            valid: false,
            error: `Longitude ${lon} out of range. Must be between ${BOUNDS.MIN_LON}° and ${BOUNDS.MAX_LON}°E`
        };
    }
    return { valid: true };
}
/**
 * Encodes latitude-longitude coordinates into a 10-digit DIGIPIN code
 *
 * @param lat - Latitude in decimal degrees (2.5°N to 38.5°N)
 * @param lon - Longitude in decimal degrees (63.5°E to 99.5°E)
 * @returns DIGIPIN code in format XXX-XXX-XXXX or error message
 *
 * @example
 * // Dak Bhawan, New Delhi
 * encodeDIGIPIN(28.622788, 77.213033) // Returns "39J-49L-L8T4"
 */
export function encodeDIGIPIN(lat, lon) {
    // Validate coordinates
    const validation = validateCoordinates(lat, lon);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    let digipin = '';
    let minLat = BOUNDS.MIN_LAT;
    let maxLat = BOUNDS.MAX_LAT;
    let minLon = BOUNDS.MIN_LON;
    let maxLon = BOUNDS.MAX_LON;
    for (let level = 1; level <= MAX_LEVELS; level++) {
        const latDivDeg = (maxLat - minLat) / GRID_DIVISIONS;
        const lonDivDeg = (maxLon - minLon) / GRID_DIVISIONS;
        let row = 0;
        let column = 0;
        // Find row (latitude division)
        let nextLvlMaxLat = maxLat;
        let nextLvlMinLat = maxLat - latDivDeg;
        for (let x = 0; x < GRID_DIVISIONS; x++) {
            if (lat >= nextLvlMinLat && lat < nextLvlMaxLat) {
                row = x;
                break;
            }
            else {
                nextLvlMaxLat = nextLvlMinLat;
                nextLvlMinLat = nextLvlMaxLat - latDivDeg;
            }
        }
        // Find column (longitude division)
        let nextLvlMinLon = minLon;
        let nextLvlMaxLon = minLon + lonDivDeg;
        for (let x = 0; x < GRID_DIVISIONS; x++) {
            if (lon >= nextLvlMinLon && lon < nextLvlMaxLon) {
                column = x;
                break;
            }
            else if ((nextLvlMinLon + lonDivDeg) < maxLon) {
                nextLvlMinLon = nextLvlMaxLon;
                nextLvlMaxLon = nextLvlMinLon + lonDivDeg;
            }
            else {
                column = x;
            }
        }
        // Get symbol from grid
        const symbol = DIGIPIN_GRID[row][column];
        // Check for out of bounds at level 1
        if (level === 1 && symbol === '0') {
            throw new Error('Coordinates are out of DIGIPIN bounds');
        }
        digipin += symbol;
        // Add hyphens at positions 3 and 6 for readability (XXX-XXX-XXXX format)
        if (level === 3 || level === 6) {
            digipin += '-';
        }
        // Update boundaries for next level
        minLat = nextLvlMinLat;
        maxLat = nextLvlMaxLat;
        minLon = nextLvlMinLon;
        maxLon = nextLvlMaxLon;
    }
    return digipin;
}
/**
 * Decodes a DIGIPIN code into latitude-longitude coordinates
 *
 * @param digipin - 10-digit DIGIPIN code (with or without hyphens)
 * @returns Object containing latitude and longitude (center of the grid cell)
 *
 * @example
 * decodeDIGIPIN("39J-49L-L8T4") // Returns { lat: 28.622788, lon: 77.213033 }
 */
export function decodeDIGIPIN(digipin) {
    // Remove hyphens
    const cleanDigipin = digipin.replace(/-/g, '');
    // Validate length
    if (cleanDigipin.length !== MAX_LEVELS) {
        throw new Error(`Invalid DIGIPIN: must be ${MAX_LEVELS} characters (got ${cleanDigipin.length})`);
    }
    let minLat = BOUNDS.MIN_LAT;
    let maxLat = BOUNDS.MAX_LAT;
    let minLon = BOUNDS.MIN_LON;
    let maxLon = BOUNDS.MAX_LON;
    for (let level = 0; level < MAX_LEVELS; level++) {
        const char = cleanDigipin.charAt(level);
        // Find character in grid
        let row = -1;
        let col = -1;
        let found = false;
        for (let r = 0; r < GRID_DIVISIONS; r++) {
            for (let c = 0; c < GRID_DIVISIONS; c++) {
                if (DIGIPIN_GRID[r][c] === char) {
                    row = r;
                    col = c;
                    found = true;
                    break;
                }
            }
            if (found)
                break;
        }
        if (!found) {
            throw new Error(`Invalid DIGIPIN: character '${char}' at position ${level + 1} is not valid`);
        }
        const latDivVal = (maxLat - minLat) / GRID_DIVISIONS;
        const lonDivVal = (maxLon - minLon) / GRID_DIVISIONS;
        const lat1 = maxLat - (latDivVal * (row + 1));
        const lat2 = maxLat - (latDivVal * row);
        const lon1 = minLon + (lonDivVal * col);
        const lon2 = minLon + (lonDivVal * (col + 1));
        minLat = lat1;
        maxLat = lat2;
        minLon = lon1;
        maxLon = lon2;
    }
    // Return center of the grid cell
    const centerLat = (maxLat + minLat) / 2;
    const centerLon = (maxLon + minLon) / 2;
    return {
        lat: Number(centerLat.toFixed(6)),
        lon: Number(centerLon.toFixed(6))
    };
}
/**
 * Validates a DIGIPIN code format
 */
export function validateDIGIPIN(digipin) {
    const cleanDigipin = digipin.replace(/-/g, '');
    if (cleanDigipin.length !== MAX_LEVELS) {
        return {
            valid: false,
            error: `Invalid length: expected ${MAX_LEVELS} characters, got ${cleanDigipin.length}`
        };
    }
    // Check all characters are valid
    const validChars = new Set(DIGIPIN_GRID.flat());
    for (let i = 0; i < cleanDigipin.length; i++) {
        const char = cleanDigipin.charAt(i);
        if (!validChars.has(char)) {
            return {
                valid: false,
                error: `Invalid character '${char}' at position ${i + 1}`
            };
        }
    }
    return { valid: true };
}
/**
 * Gets information about a DIGIPIN code
 */
export function getDIGIPINInfo(digipin) {
    const cleanDigipin = digipin.replace(/-/g, '');
    const coords = decodeDIGIPIN(digipin);
    return {
        code: `${cleanDigipin.substring(0, 3)}-${cleanDigipin.substring(3, 6)}-${cleanDigipin.substring(6, 10)}`,
        coordinates: coords,
        level1Region: cleanDigipin.charAt(0),
        level2Region: cleanDigipin.substring(0, 2),
        level3Region: cleanDigipin.substring(0, 3),
        gridSize: '~3.8m x 3.8m'
    };
}
//# sourceMappingURL=digipin.js.map