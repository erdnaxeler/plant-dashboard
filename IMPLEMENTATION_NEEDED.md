# Frontend Implementation Still Needed

## Backend Status: ✅ COMPLETE
The backend is fully ready with:
- `plant_type_id` - Reference to CatalogPlant (Basil, Parsley, etc.)
- `plant_nickname` - Optional custom nickname
- `plant_pot_size` - Pot size dropdown
- `plant_watering_schedule` - Schedule dropdown
- `plant_watering_amount` - ML amount
- `waterer_optimized_pot_size` - Pot size waterer is optimized for
- `waterer_schedule` - Schedule waterer provides

## Frontend Tasks Remaining:

### 1. Update PlantPanel.jsx
Replace the current name editing section with:
```jsx
{/* Plant Type Dropdown */}
<div className="property-group">
  <label>Plant Type</label>
  <select 
    value={plantTypeId || ''} 
    onChange={(e) => handlePlantTypeChange(e.target.value)}
  >
    <option value="">Select plant type...</option>
    {catalogPlants.map(plant => (
      <option key={plant.id} value={plant.id}>{plant.name}</option>
    ))}
  </select>
</div>

{/* Optional Nickname */}
<div className="property-group">
  <label>Nickname (Optional)</label>
  <input
    type="text"
    value={nickname || ''}
    onChange={(e) => handleNicknameChange(e.target.value)}
    placeholder="e.g., Kitchen Basil"
  />
</div>

{/* Pot Size */}
<div className="property-group">
  <label>Pot Size</label>
  <select value={potSize || ''} onChange={(e) => handlePotSizeChange(e.target.value)}>
    <option value="">Select pot size...</option>
    <option value="5.5x4.5">5.5" × 4.5"</option>
    <option value="8x7">8" × 7"</option>
    <option value="9.5x8.5">9.5" × 8.5"</option>
    <option value="12x11">12" × 11"</option>
  </select>
</div>

{/* Preferred Schedule */}
<div className="property-group">
  <label>Preferred Watering Schedule</label>
  <select value={schedule || ''} onChange={(e) => handleScheduleChange(e.target.value)}>
    <option value="">Select schedule...</option>
    <option value="daily">Daily (7x/week)</option>
    <option value="twice_weekly">Twice Weekly (2x/week)</option>
    <option value="weekly">Weekly (1x/week)</option>
  </select>
</div>
```

### 2. Update WatererPanel.jsx
Add editable fields for waterer properties:
```jsx
{/* Waterer Properties Section */}
{!cluster && (
  <>
    <div className="property-group">
      <label>Optimized Pot Size</label>
      <select value={optimizedPotSize || ''} onChange={(e) => handleOptimizedPotSizeChange(e.target.value)}>
        <option value="">Select pot size...</option>
        <option value="5.5x4.5">5.5" × 4.5"</option>
        <option value="8x7">8" × 7"</option>
        <option value="9.5x8.5">9.5" × 8.5"</option>
        <option value="12x11">12" × 11"</option>
      </select>
    </div>

    <div className="property-group">
      <label>Watering Schedule</label>
      <select value={watererSchedule || ''} onChange={(e) => handleWatererScheduleChange(e.target.value)}>
        <option value="">Select schedule...</option>
        <option value="daily">Daily (7x/week)</option>
        <option value="twice_weekly">Twice Weekly (2x/week)</option>
        <option value="weekly">Weekly (1x/week)</option>
      </select>
    </div>
  </>
)}

{/* Display Connected Plants Pot Sizes */}
{connectedPlants.length > 0 && (
  <div className="property-group">
    <label>Connected Plants</label>
    {connectedPlants.map(plant => (
      <div key={plant.id} style={{ 
        padding: '6px 8px', 
        background: 'var(--bg-light)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        fontSize: '13px',
        marginBottom: '4px'
      }}>
        <div>{plant.name}</div>
        {plant.pot_size && (
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            Pot: {plant.pot_size}
            {optimizedPotSize && plant.pot_size !== optimizedPotSize && (
              <span style={{ color: 'var(--red)', marginLeft: '6px' }}>⚠ Mismatch!</span>
            )}
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

### 3. Add Auto-Naming Logic for Waterers
In `MapEditor.jsx`, when a connection is created between a plant and waterer:
```jsx
const onConnect = useCallback(async (params) => {
  // ... existing code ...
  
  // After connection is created, check if waterer needs auto-naming
  if (watererNode && !watererNode.data.hasCustomName) {
    // Get plant catalog type
    const plantData = await MapObjectsAPI.get(plantNode.data.objectId);
    if (plantData.plant_type_id) {
      const catalogPlant = catalogPlants.find(p => p.id === plantData.plant_type_id);
      if (catalogPlant) {
        // Auto-name waterer based on first plant
        await MapObjectsAPI.update(watererNode.data.objectId, {
          name: `${catalogPlant.name} Waterer`
        });
        // Reload to show new name
        await loadMapData();
      }
    }
  }
}, [nodes, catalogPlants]);
```

### 4. Update MapObjectsAPI in useApi.js
Add GET endpoint:
```js
export const MapObjectsAPI = {
  getAll: () => api.get('/map-objects').then(res => res.data),
  get: (id) => api.get(`/map-objects/${id}`).then(res => res.data), // ADD THIS
  create: (type, name, x, y) => api.post('/map-objects', { type, name, x, y }).then(res => res.data),
  update: (id, data) => api.put(`/map-objects/${id}`, data).then(res => res.data),
  delete: (id) => api.delete(`/map-objects/${id}`).then(res => res.data),
};
```

### 5. Load Catalog Plants in MapEditor
In `MapEditor.jsx`:
```jsx
const [catalogPlants, setCatalogPlants] = useState([]);

useEffect(() => {
  loadCatalogPlants();
}, []);

const loadCatalogPlants = async () => {
  try {
    const plants = await CatalogPlantsAPI.getAll();
    setCatalogPlants(plants);
  } catch (error) {
    console.error('Failed to load catalog plants:', error);
  }
};
```

## Quick Implementation Order:
1. Add `get` method to MapObjectsAPI
2. Load catalogPlants in both PlantPanel and WatererPanel
3. Replace PlantPanel name field with dropdown + nickname
4. Add waterer property fields to WatererPanel
5. Add mismatch warnings
6. Add auto-naming logic for waterers on first connection

## API Endpoints Ready:
- `PUT /api/app/map-objects/{id}` - Accepts all new fields
- `GET /api/app/catalog-plants` - Returns plant types
- `GET /api/app/map-objects` - Returns all nodes with properties
- `GET /api/app/map-objects/{id}` - Need to add this (simple)

That's it! The backend is 100% ready, just need to wire up the UI forms.
