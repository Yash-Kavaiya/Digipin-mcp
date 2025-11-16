# DIGIPIN MCP Usage Examples

## Example Locations in India

### Major Cities

| Location | Latitude | Longitude | DIGIPIN |
|----------|----------|-----------|---------|
| Dak Bhawan, New Delhi | 28.622788 | 77.213033 | 39J-49L-L8T4 |
| Gateway of India, Mumbai | 18.922064 | 72.834646 | 57L-T4K-CML9 |
| Howrah Bridge, Kolkata | 22.585399 | 88.346947 | 68J-8CL-947P |
| Marina Beach, Chennai | 13.049920 | 80.282745 | 58M-MLL-6692 |
| Charminar, Hyderabad | 17.361564 | 78.474701 | 59K-K2M-M2T3 |
| MG Road, Bengaluru | 12.973104 | 77.616219 | 58M-2TC-96J7 |

## Common Use Cases

### 1. Emergency Response

**Scenario**: An ambulance needs to reach an exact location quickly.

```
User: "I need help at coordinates 28.622788, 77.213033"
Assistant: *Uses encode_digipin tool*
Response: "Your DIGIPIN is 39J-49L-L8T4. Share this with emergency services for precise location."
```

### 2. Package Delivery

**Scenario**: Delivering to a location without a traditional address.

```
User: "Where should I deliver this package? The DIGIPIN is 39J-49L-L8T4"
Assistant: *Uses decode_digipin tool*
Response: "Deliver to coordinates 28.622788°N, 77.213033°E (Dak Bhawan area, New Delhi)"
```

### 3. Location Verification

**Scenario**: Verifying if coordinates are within India.

```
User: "Can I use DIGIPIN for coordinates 28.5, 77.2?"
Assistant: *Uses validate_coordinates tool*
Response: "Yes, these coordinates are within the DIGIPIN bounding box covering India."
```

### 4. Address Standardization

**Scenario**: Converting various location formats to a standard code.

```
User: "Standardize this location: Near Red Fort, Delhi (lat: 28.656159, lon: 77.241025)"
Assistant: *Uses encode_digipin tool*
Response: "Standard DIGIPIN: 39J-49C-3254"
```

### 5. Hierarchical Location Understanding

**Scenario**: Understanding the geographic hierarchy of a location.

```
User: "Tell me about DIGIPIN 39J-49L-L8T4"
Assistant: *Uses get_digipin_info tool*
Response: {
  "level1Region": "3 (1000km region covering North India)",
  "level2Region": "39 (250km region around Delhi NCR)",
  "level3Region": "39J (62.5km region in Central Delhi)",
  "finalCell": "39J-49L-L8T4 (~3.8m x 3.8m precise location)"
}
```

## Integration Examples

### Banking KYC Integration

```javascript
// Pseudo-code for KYC address verification
async function verifyCustomerAddress(latitude, longitude) {
  // Generate DIGIPIN
  const digipin = await mcpClient.callTool('encode_digipin', {
    latitude,
    longitude
  });

  // Store as additional address attribute
  customer.address.digipin = digipin.digipin;
  customer.address.verified = true;
  customer.address.verificationDate = new Date();

  return {
    success: true,
    digipin: digipin.digipin,
    message: 'Address verified with precision of ~3.8m'
  };
}
```

### Delivery Route Optimization

```javascript
// Pseudo-code for delivery planning
async function planDeliveryRoute(digipinCodes) {
  const locations = [];

  for (const digipin of digipinCodes) {
    const coords = await mcpClient.callTool('decode_digipin', {
      digipin
    });

    locations.push({
      digipin,
      lat: coords.coordinates.latitude,
      lon: coords.coordinates.longitude
    });
  }

  // Use coordinates for route optimization
  return optimizeRoute(locations);
}
```

### Emergency Services Dispatch

```javascript
// Pseudo-code for emergency dispatch
async function dispatchEmergency(digipin) {
  // Validate DIGIPIN
  const validation = await mcpClient.callTool('validate_digipin', {
    digipin
  });

  if (!validation.valid) {
    return { error: 'Invalid DIGIPIN code' };
  }

  // Get precise coordinates
  const location = await mcpClient.callTool('decode_digipin', {
    digipin
  });

  // Dispatch to nearest unit
  return dispatchNearestUnit({
    lat: location.coordinates.latitude,
    lon: location.coordinates.longitude,
    precision: '3.8m x 3.8m'
  });
}
```

### GIS Application Integration

```javascript
// Pseudo-code for GIS mapping
async function plotLocationOnMap(digipin) {
  // Get detailed info
  const info = await mcpClient.callTool('get_digipin_info', {
    digipin
  });

  // Create map marker
  const marker = {
    position: {
      lat: info.coordinates.lat,
      lng: info.coordinates.lon
    },
    title: `DIGIPIN: ${info.code}`,
    description: `Grid: ${info.gridSize}`,
    icon: 'location-pin'
  };

  // Add to map
  map.addMarker(marker);
  map.setCenter(marker.position);
  map.setZoom(18); // Building level zoom
}
```

## Batch Processing Examples

### Convert Multiple Locations

```javascript
const locations = [
  { name: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
  { name: 'Kolkata', lat: 22.5726, lon: 88.3639 }
];

for (const location of locations) {
  const result = await mcpClient.callTool('encode_digipin', {
    latitude: location.lat,
    longitude: location.lon
  });

  console.log(`${location.name}: ${result.digipin}`);
}
```

### Validate Address Database

```javascript
async function validateAddressDatabase(addresses) {
  const results = [];

  for (const address of addresses) {
    if (address.digipin) {
      const validation = await mcpClient.callTool('validate_digipin', {
        digipin: address.digipin
      });

      results.push({
        id: address.id,
        digipin: address.digipin,
        valid: validation.valid,
        error: validation.error
      });
    }
  }

  return results;
}
```

## Command-Line Usage Patterns

### Quick Location Encoding

```bash
# If using with a CLI wrapper
digipin-encode --lat 28.622788 --lon 77.213033
# Output: 39J-49L-L8T4
```

### Batch Geocoding

```bash
# Input: locations.csv with lat,lon columns
# Output: locations-with-digipin.csv
cat locations.csv | while read line; do
  lat=$(echo $line | cut -d',' -f1)
  lon=$(echo $line | cut -d',' -f2)
  digipin=$(digipin-encode --lat $lat --lon $lon)
  echo "$line,$digipin"
done > locations-with-digipin.csv
```

## Error Handling Examples

### Graceful Validation

```javascript
async function safeEncodeDIGIPIN(lat, lon) {
  try {
    // First validate coordinates
    const validation = await mcpClient.callTool('validate_coordinates', {
      latitude: lat,
      longitude: lon
    });

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        suggestion: 'Coordinates must be within India (2.5°-38.5°N, 63.5°-99.5°E)'
      };
    }

    // Then encode
    const result = await mcpClient.callTool('encode_digipin', {
      latitude: lat,
      longitude: lon
    });

    return {
      success: true,
      digipin: result.digipin
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

## Performance Considerations

### Caching Strategy

```javascript
// Cache DIGIPIN codes to avoid repeated calculations
const digipinCache = new Map();

async function getCachedDIGIPIN(lat, lon) {
  const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;

  if (digipinCache.has(key)) {
    return digipinCache.get(key);
  }

  const result = await mcpClient.callTool('encode_digipin', {
    latitude: lat,
    longitude: lon
  });

  digipinCache.set(key, result.digipin);
  return result.digipin;
}
```

## Regional Coverage Examples

### North India
- Delhi NCR: Level-1 region `3`
- Punjab: Level-1 region `3`
- Uttarakhand: Level-1 region `3`, `4`

### South India
- Tamil Nadu: Level-1 region `5`
- Kerala: Level-1 region `5`, `L`
- Karnataka: Level-1 region `5`, `6`

### East India
- West Bengal: Level-1 region `6`
- Odisha: Level-1 region `6`
- Assam: Level-1 region `4`, `6`

### West India
- Maharashtra: Level-1 region `5`, `6`
- Gujarat: Level-1 region `5`, `K`
- Rajasthan: Level-1 region `3`, `5`, `K`

### Maritime Regions
- Arabian Sea: Various level-1 regions
- Bay of Bengal: Various level-1 regions
- Indian Ocean (EEZ): Level-1 regions `L`, `M`, `P`

## Testing & Validation

### Known Good Locations

Test your implementation with these verified coordinates:

```javascript
const testCases = [
  { lat: 28.622788, lon: 77.213033, expected: '39J-49L-L8T4' }, // Dak Bhawan
  { lat: 18.922064, lon: 72.834646, expected: '57L-T4K-CML9' }, // Gateway of India
  { lat: 22.585399, lon: 88.346947, expected: '68J-8CL-947P' }  // Howrah Bridge
];

for (const test of testCases) {
  const result = await mcpClient.callTool('encode_digipin', {
    latitude: test.lat,
    longitude: test.lon
  });

  console.assert(
    result.digipin === test.expected,
    `Expected ${test.expected}, got ${result.digipin}`
  );
}
```

## Best Practices

1. **Always validate coordinates** before encoding
2. **Cache DIGIPIN codes** for frequently accessed locations
3. **Store both DIGIPIN and coordinates** for redundancy
4. **Use proper precision** (6 decimal places) for coordinates
5. **Handle errors gracefully** with user-friendly messages
6. **Include DIGIPIN in APIs** as an optional address field
7. **Document DIGIPIN usage** in your application's help section

---

For more examples and integration guides, visit the [DIGIPIN MCP GitHub repository](https://github.com/Yash-Kavaiya/Digipin-mcp).
