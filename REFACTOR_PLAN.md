# Map Editor Refactor Plan

## New Architecture

The map editor is now the main app. Objects on the canvas determine clusters through connections.

### Object Types
1. **Plant** - A plant node (green circle)
2. **Waterer** - A water source/pump (blue circle)
3. **Line** - Connection between plant and waterer

### Cluster Logic
- A **cluster** is formed by:
  - 1 waterer connected to 1-3 plants via lines
  - All connected plants share the same watering group
- Clicking any object in a cluster opens the calibration panel for that cluster

### Data Model Changes Needed
1. Add `MapObject` table:
   - type: 'plant' | 'waterer'
   - name: string
   - map_x, map_y: float
   - cluster_id: foreign key (nullable)

2. Add `Connection` table:
   - from_object_id: foreign key
   - to_object_id: foreign key
   
3. Modify `Cluster`:
   - Keep existing cluster table
   - Linked to MapObjects via cluster_id

### UI Changes
1. Left sidebar tools: Plant | Waterer | Line
2. Canvas shows all map objects
3. Right panel shows cluster calibration for connected objects
4. Layers panel shows all objects grouped by cluster

## Implementation Steps
1. ✓ Redirect / to map editor
2. Add new database models
3. Create API endpoints for map objects
4. Rebuild map-editor.js with new logic
5. Implement line drawing tool
6. Update cluster formation based on connections
7. Test and deploy
