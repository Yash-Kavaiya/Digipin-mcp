# DIGIPIN MCP Server

A Model Context Protocol (MCP) server for India Post's **DIGIPIN** geocoding system - the Digital Public Infrastructure for standardized, geo-coded addressing in India.

## Overview

DIGIPIN is a national-level addressing grid system developed by the Department of Posts in collaboration with IIT Hyderabad and NRSC, ISRO. It divides India's geographical territory into uniform **~4m × 4m grid cells**, each assigned a unique **10-character alphanumeric code** derived from latitude and longitude coordinates.

### Key Features

- 🗺️ **Precise Location Encoding**: ~3.8m × 3.8m resolution across India
- 🧭 **Directional Properties**: Logical naming pattern with built-in directional attributes
- 🌐 **Offline Capability**: Works without internet connection
- 🔒 **Privacy-Respecting**: Represents location only, stores no personal information
- 📍 **Comprehensive Coverage**: Entire Indian territory including maritime EEZ
- 🎯 **Standards-Based**: Uses EPSG:4326 (WGS84) coordinate system

## What is DIGIPIN?

DIGIPIN provides "Address as a Service" (AaaS) for India by creating a standardized addressing reference system. Each DIGIPIN code:

- Is a **10-character alphanumeric code** (format: `XXX-XXX-XXXX`)
- Uses symbols: `2,3,4,5,6,7,8,9,C,F,J,K,L,M,P,T`
- Represents a hierarchical grid from 1000km regions down to ~4m cells
- Can be encoded/decoded to precise latitude/longitude coordinates

### Example

**Dak Bhawan, New Delhi**
- Coordinates: `28.622788°N, 77.213033°E`
- DIGIPIN: `39J-49L-L8T4`

## Installation

```bash
npm install @indiapost/digipin-mcp
```

Or install from source:

```bash
git clone https://github.com/Yash-Kavaiya/Digipin-mcp.git
cd Digipin-mcp
npm install
npm run build
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "digipin": {
      "command": "node",
      "args": ["/path/to/Digipin-mcp/dist/index.js"]
    }
  }
}
```

### Other MCP Clients

The server communicates via standard I/O and can be used with any MCP-compatible client:

```bash
node dist/index.js
```

## Available Tools

### 1. `encode_digipin`

Convert latitude/longitude coordinates to a DIGIPIN code.

**Parameters:**
- `latitude` (number): Latitude in decimal degrees (2.5° to 38.5°N)
- `longitude` (number): Longitude in decimal degrees (63.5° to 99.5°E)

**Example:**
```json
{
  "latitude": 28.622788,
  "longitude": 77.213033
}
```

**Response:**
```json
{
  "success": true,
  "digipin": "39J-49L-L8T4",
  "coordinates": {
    "latitude": 28.622788,
    "longitude": 77.213033
  },
  "gridSize": "~3.8m x 3.8m"
}
```

### 2. `decode_digipin`

Convert a DIGIPIN code to latitude/longitude coordinates.

**Parameters:**
- `digipin` (string): 10-character DIGIPIN code (with or without hyphens)

**Example:**
```json
{
  "digipin": "39J-49L-L8T4"
}
```

**Response:**
```json
{
  "success": true,
  "digipin": "39J-49L-L8T4",
  "coordinates": {
    "latitude": 28.622788,
    "longitude": 77.213033
  }
}
```

### 3. `validate_digipin`

Validate the format of a DIGIPIN code.

**Parameters:**
- `digipin` (string): DIGIPIN code to validate

**Example:**
```json
{
  "digipin": "39J-49L-L8T4"
}
```

**Response:**
```json
{
  "success": true,
  "valid": true,
  "digipin": "39J-49L-L8T4"
}
```

### 4. `get_digipin_info`

Get detailed information about a DIGIPIN code.

**Parameters:**
- `digipin` (string): DIGIPIN code to analyze

**Response:**
```json
{
  "success": true,
  "code": "39J-49L-L8T4",
  "coordinates": {
    "lat": 28.622788,
    "lon": 77.213033
  },
  "level1Region": "3",
  "level2Region": "39",
  "level3Region": "39J",
  "gridSize": "~3.8m x 3.8m",
  "hierarchy": {
    "level1": "3 (1000km x 1000km region)",
    "level2": "39 (250km x 250km region)",
    "level3": "39J (62.5km x 62.5km region)",
    "level10": "39J-49L-L8T4 (~3.8m x 3.8m cell)"
  }
}
```

### 5. `validate_coordinates`

Check if coordinates are within the DIGIPIN bounding box.

**Parameters:**
- `latitude` (number): Latitude in decimal degrees
- `longitude` (number): Longitude in decimal degrees

**Response:**
```json
{
  "success": true,
  "valid": true,
  "coordinates": {
    "latitude": 28.622788,
    "longitude": 77.213033
  },
  "bounds": {
    "latitude": "2.5°N - 38.5°N",
    "longitude": "63.5°E - 99.5°E",
    "coverage": "India including maritime EEZ"
  }
}
```

## DIGIPIN Specification

### Bounding Box
- **Latitude**: 2.5°N to 38.5°N
- **Longitude**: 63.5°E to 99.5°E
- **CRS**: EPSG:4326 (WGS84)
- **Coverage**: All of India including maritime Exclusive Economic Zone (EEZ)

### Grid Hierarchy

| Level | Code Length | Grid Size | Approx. Distance |
|-------|-------------|-----------|------------------|
| 1     | 1 char      | 9° × 9°   | ~1000 km         |
| 2     | 2 chars     | 2.25° × 2.25° | ~250 km      |
| 3     | 3 chars     | 33.75′ × 33.75′ | ~62.5 km   |
| 4     | 4 chars     | 8.44′ × 8.44′ | ~15.6 km     |
| 5     | 5 chars     | 2.11′ × 2.11′ | ~3.9 km      |
| 6     | 6 chars     | 0.53′ × 0.53′ | ~1 km        |
| 7     | 7 chars     | 0.13′ × 0.13′ | ~250 m       |
| 8     | 8 chars     | 0.03′ × 0.03′ | ~60 m        |
| 9     | 9 chars     | 0.5″ × 0.5″ | ~15 m          |
| 10    | 10 chars    | 0.12″ × 0.12″ | ~3.8 m       |

### Character Set

DIGIPIN uses 16 alphanumeric symbols arranged in a 4×4 grid:

```
F  C  9  8
J  3  2  7
K  4  5  6
L  M  P  T
```

Labels are assigned in an **anticlockwise spiral** pattern, providing directional properties.

## Use Cases

### Emergency Services
```
"Send ambulance to DIGIPIN 39J-49L-L8T4"
```
Precise location without complex addresses, reducing response time.

### Delivery Services
```
Package delivery to remote areas with no traditional addresses
```

### Banking & KYC
```
Enhanced address verification using DIGIPIN as additional attribute
```

### Government Services
```
Linking beneficiaries to precise locations for service delivery
```

### Urban Planning
```
GIS-based infrastructure mapping and planning
```

## Technical Details

### Design Principles

1. **Hierarchical Partitioning**: Each level divides the previous level into a 4×4 grid
2. **Reversible Encoding**: DIGIPIN ↔ Lat/Lon conversion without data loss
3. **Human-Readable**: Intuitive format with directional meaning
4. **Permanent Infrastructure**: Codes don't change with urban development
5. **Efficient Representation**: Minimal length for maximum coverage

### Grid Line Alignment

- Level-1 grids align with Survey of India's 0.25° × 0.25° toposheets
- Ensures compatibility with existing mapping infrastructure
- Level-1 lines avoid cutting through major population centers

### Boundary Handling

Coordinates on grid lines follow these rules:
- **Vertical lines** (N-S): Assigned to eastern (right) grid
- **Horizontal lines** (E-W): Assigned to northern (upper) grid
- **Intersections**: Assigned to top-right grid
- **Exceptions**: Top and right boundaries assigned to southern/western grids

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode (watch)
npm run dev

# Start server
npm start
```

## API Reference

### Core Functions

#### `encodeDIGIPIN(lat: number, lon: number): string`
Encode coordinates to DIGIPIN code.

#### `decodeDIGIPIN(digipin: string): { lat: number, lon: number }`
Decode DIGIPIN to coordinates.

#### `validateDIGIPIN(digipin: string): { valid: boolean, error?: string }`
Validate DIGIPIN format.

#### `validateCoordinates(lat: number, lon: number): { valid: boolean, error?: string }`
Check if coordinates are in bounds.

#### `getDIGIPINInfo(digipin: string): object`
Get detailed DIGIPIN information.

## Testing

Test with known locations:

```javascript
// Dak Bhawan, New Delhi
encodeDIGIPIN(28.622788, 77.213033)
// Returns: "39J-49L-L8T4"

decodeDIGIPIN("39J-49L-L8T4")
// Returns: { lat: 28.622788, lon: 77.213033 }
```

## Contributing

This implementation is based on the official DIGIPIN technical specification (March 2025) from the Department of Posts, Ministry of Communications, Government of India.

Contributions are welcome! Please ensure:
- Code follows TypeScript best practices
- All functions have proper type definitions
- Changes align with official DIGIPIN specification
- Tests cover new functionality

## License

MIT License - See LICENSE file for details

## Acknowledgments

- **Department of Posts**, Ministry of Communications, Government of India
- **IIT Hyderabad** - Technical collaboration
- **NRSC, ISRO** - Geospatial infrastructure support

## Resources

- [National Geospatial Policy 2022](https://dst.gov.in/national-geospatial-policy-2022)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- Survey of India Topographical Maps

## Version History

### 1.0.0 (2025)
- Initial release based on final DIGIPIN specification (March 2025)
- Complete implementation of encoding/decoding algorithms
- MCP server with 5 tools
- Full coverage of India including maritime EEZ

---

**DIGIPIN** - Digital Public Infrastructure for Addressing
*Developed by Department of Posts, Government of India*
