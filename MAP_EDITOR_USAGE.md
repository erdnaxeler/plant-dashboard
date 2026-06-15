# Map Editor Usage Guide

## Overview

The Map Editor has been completely refactored to use a **MapObject and Connection** architecture instead of directly manipulating Clusters. This provides a more flexible, visual way to design your plant watering system layout.

## Key Concepts

### MapObjects
- **Plants** 🌱: Individual plant objects that need watering
- **Waterers** 💧: Watering device objects that deliver water

### Connections
- Lines drawn between objects to indicate relationships
- When plants are connected to a waterer, clusters are automatically formed
- Valid cluster: 1 waterer + 1-3 plants (all plants must share same watering_group)
- Invalid configurations (0 or 4+ plants) clear cluster assignments

### Visual Indicators

**Object Colors:**
- **Plants:**
  - Blue (#569cd6): Not in a cluster
  - Green (#4ec9b0): Part of a valid cluster
  
- **Waterers:**
  - Amber (#dcdcaa): Not in a cluster
  - Purple (#c586c0): Part of a valid cluster

**Layer List Status Dots:**
- Green: Object is part of a cluster
- Gray: Object is not part of a cluster

## How to Use

### 1. Adding Objects

**Add a Plant:**
1. Click the "Plant" tool (🌱) in the left sidebar
2. Click anywhere on the canvas to place the plant
3. The plant appears as a blue circle with a plant icon

**Add a Waterer:**
1. Click the "Waterer" tool (💧) in the left sidebar
2. Click anywhere on the canvas to place the waterer
3. The waterer appears as an amber circle with a water droplet icon

### 2. Creating Connections

**Connect Objects:**
1. Click the "Connect Objects" tool (🔗) in the left sidebar
2. Click on the first object (e.g., a plant)
3. The object is highlighted with a blue border
4. Click on the second object (e.g., a waterer)
5. A dashed line appears connecting the two objects
6. If the connection forms a valid cluster, both objects change color

**Connection Rules:**
- You can connect plants to waterers
- You can connect plants to other plants (for grouping)
- The system prevents duplicate connections
- The system prevents self-connections (object to itself)

### 3. Moving Objects

**Drag to Reposition:**
1. Click and hold on any object
2. Drag it to a new position
3. Release to drop
4. Position is automatically saved
5. Connected lines update dynamically

### 4. Editing Objects

**Rename an Object:**
1. Click on an object to select it
2. The right panel opens showing object details
3. Edit the "Name" field
4. Click outside the field to save (blur event)

**View Object Details:**
- Type (Plant or Waterer)
- Cluster Status (In Cluster #X or No Cluster)
- Connections list
- Position (X, Y coordinates)

### 5. Deleting

**Delete a Connection:**
1. Select an object that has connections
2. In the right panel, find the "Connections" section
3. Click "Delete" next to the connection you want to remove
4. Confirm the deletion
5. Cluster assignments automatically recalculate

**Delete an Object:**
1. Select the object
2. In the right panel, click the red "Delete Plant" or "Delete Waterer" button
3. Confirm the deletion
4. All connections to this object are automatically removed
5. Related clusters are recalculated

### 6. Saving

**Auto-save:**
- Object positions are automatically saved when you drag them
- Name changes are saved on blur

**Manual Save All:**
- Click the "💾 Save All" button in the top toolbar
- Saves all current object positions

## Cluster Formation Logic

### Automatic Cluster Formation

The backend automatically creates and updates clusters based on connections:

**Valid Cluster Configuration:**
- 1 waterer + 1-3 plants
- All plants must share the same `watering_group` (configured in dashboard)
- When valid, a cluster is created/updated automatically
- Objects are assigned a `cluster_id`

**Invalid Configurations:**
- Waterer with 0 plants → cluster assignment cleared
- Waterer with 4+ plants → cluster assignment cleared
- Plants with different watering groups → cluster assignment cleared

**Visual Feedback:**
- When a valid cluster forms, objects change color to indicate cluster membership
- Layer list shows green status dots for clustered objects
- Right panel shows cluster ID when object is in a cluster

### Connection Scenarios

**Example 1: Simple Cluster**
```
Plant A → Waterer X
Plant B → Waterer X
Plant C → Waterer X
```
✅ Valid cluster (3 plants, 1 waterer)

**Example 2: Too Many Plants**
```
Plant A → Waterer X
Plant B → Waterer X
Plant C → Waterer X
Plant D → Waterer X
```
❌ Invalid (4 plants) - cluster assignment cleared

**Example 3: No Plants**
```
Waterer X (alone)
```
❌ Invalid (0 plants) - cluster assignment cleared

## Tips & Best Practices

1. **Plan Your Layout:**
   - Place waterers near their physical locations
   - Group related plants around their waterers
   - Use the grid to align objects

2. **Use Zoom Controls:**
   - Zoom in (+) for detailed work
   - Zoom out (−) to see the big picture
   - Reset zoom (⟲) to return to 100%

3. **Layer Management:**
   - Use the Layers panel to select objects by name
   - Active object is highlighted in the layer list
   - Layer list shows cluster status at a glance

4. **Connection Strategy:**
   - Connect all plants to their intended waterer
   - Check for green color to confirm cluster formation
   - Delete and recreate connections if cluster doesn't form

5. **Naming Convention:**
   - Give objects meaningful names (e.g., "Tomato A", "Garden Waterer")
   - Good names help identify objects in the layer list

## Keyboard Shortcuts

- **ESC**: Cancel connection mode (when in middle of creating connection)
- **Click empty canvas**: Deselect object / cancel tool

## Troubleshooting

### Objects Won't Form a Cluster

**Check:**
1. Is there exactly 1 waterer?
2. Are there 1-3 plants?
3. Do all plants have the same watering_group? (Configure in main dashboard)
4. Are the connections actually created? (Check in object details panel)

### Connection Won't Create

**Possible Reasons:**
1. Connection already exists (check reverse direction too)
2. Trying to connect object to itself
3. API error (check browser console)

### Object Stuck or Won't Move

**Solutions:**
1. Click to select, then try dragging again
2. Reload the page
3. Check browser console for errors

### Colors Not Updating After Connection

**Solutions:**
1. Wait a moment - cluster calculation happens server-side
2. Reload the page to refresh cluster status
3. Check that backend API is running correctly

## Technical Details

### API Endpoints Used

- `GET /api/app/map-objects` - Load all objects
- `POST /api/app/map-objects` - Create new object
- `PUT /api/app/map-objects/<id>` - Update object (position, name)
- `DELETE /api/app/map-objects/<id>` - Delete object (cascade deletes connections)
- `GET /api/app/connections` - Load all connections
- `POST /api/app/connections` - Create connection (triggers cluster formation)
- `DELETE /api/app/connections/<id>` - Delete connection (triggers cluster recalculation)

### Data Flow

1. **Load:** Frontend fetches MapObjects and Connections from API
2. **Render:** Canvas displays objects as circles with icons and lines for connections
3. **Interact:** User adds/moves/connects objects
4. **Save:** Changes sent to API via PUT/POST/DELETE
5. **Update:** Backend calculates cluster assignments automatically
6. **Refresh:** Frontend reloads objects to show updated cluster status (color changes)

### File Structure

- `/static/map-editor.js` - Frontend JavaScript (Fabric.js canvas)
- `/templates/map-editor.html` - HTML template and CSS
- `/app.py` - Backend API endpoints (lines 1412-1730)
- `API_ENDPOINTS.md` - Complete API documentation

## Migration from Old System

The old map editor directly created and manipulated Clusters. The new system:

**Old Way:**
- Click to add "Cluster" object
- Cluster was a single unit
- Configure cluster in dashboard to add plants

**New Way:**
- Click to add individual Plants and Waterers
- Draw connections between them
- Clusters form automatically based on connections
- More visual and flexible

**Note:** Old cluster data is preserved. The MapObject system is additive - it creates new MapObjects when you use the new editor, but doesn't affect existing clusters created the old way.

## Future Enhancements

Potential improvements for future versions:

- [ ] Undo/Redo functionality
- [ ] Multi-select and bulk operations
- [ ] Connection labels showing flow direction
- [ ] Visual indication of watering_group compatibility before connecting
- [ ] Snap-to-grid option
- [ ] Export/import layout as JSON
- [ ] Connection validation warnings in real-time
- [ ] Visual preview of cluster formation before completing connection

## Support

For issues or questions:
- Check browser console for error messages
- Review `API_ENDPOINTS.md` for API details
- Check server logs in terminal running Flask app
- Verify authentication token is valid (stored in sessionStorage)
