#!/usr/bin/env node
/**
 * DIGIPIN MCP Server
 *
 * Model Context Protocol server for India Post's DIGIPIN geocoding system.
 * Provides tools for converting between geographic coordinates and DIGIPIN codes.
 *
 * Based on Department of Posts technical specification (March 2025)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { encodeDIGIPIN, decodeDIGIPIN, validateDIGIPIN, getDIGIPINInfo, validateCoordinates, } from './digipin.js';
// Define available tools
const TOOLS = [
    {
        name: 'encode_digipin',
        description: 'Convert latitude and longitude coordinates to a DIGIPIN code. ' +
            'DIGIPIN is India\'s national addressing grid system that assigns a unique 10-character ' +
            'alphanumeric code to every ~4m x 4m area within India. ' +
            'Valid range: Latitude 2.5°-38.5°N, Longitude 63.5°-99.5°E (covers all of India including EEZ).',
        inputSchema: {
            type: 'object',
            properties: {
                latitude: {
                    type: 'number',
                    description: 'Latitude in decimal degrees (2.5 to 38.5). Example: 28.622788 for New Delhi',
                    minimum: 2.5,
                    maximum: 38.5,
                },
                longitude: {
                    type: 'number',
                    description: 'Longitude in decimal degrees (63.5 to 99.5). Example: 77.213033 for New Delhi',
                    minimum: 63.5,
                    maximum: 99.5,
                },
            },
            required: ['latitude', 'longitude'],
        },
    },
    {
        name: 'decode_digipin',
        description: 'Convert a DIGIPIN code back to latitude and longitude coordinates. ' +
            'Returns the center point of the ~4m x 4m grid cell represented by the DIGIPIN code. ' +
            'The code can be provided with or without hyphens (e.g., "39J-49L-L8T4" or "39J49LL8T4").',
        inputSchema: {
            type: 'object',
            properties: {
                digipin: {
                    type: 'string',
                    description: 'A 10-character DIGIPIN code (with or without hyphens). ' +
                        'Example: "39J-49L-L8T4" for Dak Bhawan, New Delhi. ' +
                        'Valid characters: 2,3,4,5,6,7,8,9,C,F,J,K,L,M,P,T',
                    pattern: '^[2-9CFJKLMPT]{3}-?[2-9CFJKLMPT]{3}-?[2-9CFJKLMPT]{4}$',
                },
            },
            required: ['digipin'],
        },
    },
    {
        name: 'validate_digipin',
        description: 'Validate whether a DIGIPIN code is properly formatted. ' +
            'Checks if the code has the correct length (10 characters) and uses only valid symbols. ' +
            'Does not verify if the location actually exists, only that the code format is valid.',
        inputSchema: {
            type: 'object',
            properties: {
                digipin: {
                    type: 'string',
                    description: 'DIGIPIN code to validate (with or without hyphens)',
                },
            },
            required: ['digipin'],
        },
    },
    {
        name: 'get_digipin_info',
        description: 'Get detailed information about a DIGIPIN code including its coordinates, ' +
            'hierarchical region codes, and grid cell size. Useful for understanding the geographic ' +
            'structure and location represented by a DIGIPIN.',
        inputSchema: {
            type: 'object',
            properties: {
                digipin: {
                    type: 'string',
                    description: 'DIGIPIN code to get information about (with or without hyphens)',
                },
            },
            required: ['digipin'],
        },
    },
    {
        name: 'validate_coordinates',
        description: 'Check if latitude and longitude coordinates are within the DIGIPIN bounding box ' +
            'covering India. Useful for pre-validating coordinates before encoding to DIGIPIN.',
        inputSchema: {
            type: 'object',
            properties: {
                latitude: {
                    type: 'number',
                    description: 'Latitude in decimal degrees',
                },
                longitude: {
                    type: 'number',
                    description: 'Longitude in decimal degrees',
                },
            },
            required: ['latitude', 'longitude'],
        },
    },
];
// Create server instance
const server = new Server({
    name: 'digipin-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: TOOLS,
    };
});
// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'encode_digipin': {
                const { latitude, longitude } = args;
                if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                    throw new Error('Latitude and longitude must be numbers');
                }
                const digipin = encodeDIGIPIN(latitude, longitude);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                digipin,
                                coordinates: {
                                    latitude,
                                    longitude,
                                },
                                info: `Location encoded to DIGIPIN: ${digipin}`,
                                gridSize: '~3.8m x 3.8m',
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'decode_digipin': {
                const { digipin } = args;
                if (typeof digipin !== 'string') {
                    throw new Error('DIGIPIN must be a string');
                }
                const coords = decodeDIGIPIN(digipin);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                digipin: digipin.replace(/-/g, '').replace(/(.{3})(.{3})(.{4})/, '$1-$2-$3'),
                                coordinates: {
                                    latitude: coords.lat,
                                    longitude: coords.lon,
                                },
                                info: `DIGIPIN decoded to coordinates (center of ~3.8m x 3.8m grid cell)`,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'validate_digipin': {
                const { digipin } = args;
                if (typeof digipin !== 'string') {
                    throw new Error('DIGIPIN must be a string');
                }
                const validation = validateDIGIPIN(digipin);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                valid: validation.valid,
                                digipin,
                                ...(validation.error && { error: validation.error }),
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_digipin_info': {
                const { digipin } = args;
                if (typeof digipin !== 'string') {
                    throw new Error('DIGIPIN must be a string');
                }
                const info = getDIGIPINInfo(digipin);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                ...info,
                                hierarchy: {
                                    level1: `${info.level1Region} (1000km x 1000km region)`,
                                    level2: `${info.level2Region} (250km x 250km region)`,
                                    level3: `${info.level3Region} (62.5km x 62.5km region)`,
                                    level10: `${info.code} (${info.gridSize} cell)`,
                                },
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'validate_coordinates': {
                const { latitude, longitude } = args;
                if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                    throw new Error('Latitude and longitude must be numbers');
                }
                const validation = validateCoordinates(latitude, longitude);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                valid: validation.valid,
                                coordinates: {
                                    latitude,
                                    longitude,
                                },
                                ...(validation.error && { error: validation.error }),
                                bounds: {
                                    latitude: '2.5°N - 38.5°N',
                                    longitude: '63.5°E - 99.5°E',
                                    coverage: 'India including maritime EEZ',
                                },
                            }, null, 2),
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: errorMessage,
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log to stderr since stdout is used for MCP communication
    console.error('DIGIPIN MCP Server started');
    console.error('Server info:', {
        name: 'digipin-mcp',
        version: '1.0.0',
        tools: TOOLS.length,
    });
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map