/**
 * DIGIPIN Core Implementation
 * Based on Department of Posts technical specification (March 2025)
 *
 * DIGIPIN is a national-level addressing grid system that divides India's geographical
 * territory into uniform 4m x 4m units, each with a unique 10-digit alphanumeric code.
 */
/**
 * Validates if coordinates are within DIGIPIN bounding box
 */
export declare function validateCoordinates(lat: number, lon: number): {
    valid: boolean;
    error?: string;
};
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
export declare function encodeDIGIPIN(lat: number, lon: number): string;
/**
 * Decodes a DIGIPIN code into latitude-longitude coordinates
 *
 * @param digipin - 10-digit DIGIPIN code (with or without hyphens)
 * @returns Object containing latitude and longitude (center of the grid cell)
 *
 * @example
 * decodeDIGIPIN("39J-49L-L8T4") // Returns { lat: 28.622788, lon: 77.213033 }
 */
export declare function decodeDIGIPIN(digipin: string): {
    lat: number;
    lon: number;
};
/**
 * Validates a DIGIPIN code format
 */
export declare function validateDIGIPIN(digipin: string): {
    valid: boolean;
    error?: string;
};
/**
 * Gets information about a DIGIPIN code
 */
export declare function getDIGIPINInfo(digipin: string): {
    code: string;
    coordinates: {
        lat: number;
        lon: number;
    };
    level1Region: string;
    level2Region: string;
    level3Region: string;
    gridSize: string;
};
//# sourceMappingURL=digipin.d.ts.map