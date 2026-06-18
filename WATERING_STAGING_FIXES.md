# Watering Staging Branch Fixes

## Summary of Changes

This document outlines the fixes implemented for the watering staging branch to address clustering logic and UI issues.

## Issue #1: Dark Theme Background Colors ✅

**Problem**: Some UI elements were using dark theme color `#2d3748` instead of the light theme variables.

**Solution**: Replaced all hardcoded `#2d3748` colors with appropriate CSS variables:
- Changed inline styles in `PlantPanel.jsx` to use `var(--bg-light)`, `var(--border)`, `var(--text)`, `var(--text-dim)`
- Changed inline styles in `WatererPanel.jsx` to use `var(--bg-light)`, `var(--border)`, `var(--text)`
- Ensured consistency with the light theme defined in `index.css`

**Files Modified**:
- `frontend/src/components/PlantPanel.jsx`
- `frontend/src/components/WatererPanel.jsx`

## Issue #2: Fluid Cluster Model Implementation ✅

### A. Cluster Creation Logic

**How it works**:
- A cluster is automatically created when a waterer connects to 1-3 plants
- Clusters are **fluid** - they dynamically form and dissolve based on connections
- Each node (plant or waterer) can belong to at most ONE cluster
- Node properties (name, position, watering preferences) are **independent** and retained when clusters change

### B. Connection Validation

**Implemented Rules**:
1. **Plants can only connect to ONE waterer**
   - If a plant is already connected to a waterer, attempting to connect it to another waterer will fail
   - Error message: "This plant is already connected to a waterer. Disconnect it first."

2. **Waterers can connect to 1-3 plants maximum**
   - Attempting to connect a 4th plant to a waterer will fail
   - Error message: "A waterer can only connect to a maximum of 3 plants"

3. **Clusters automatically form when valid**
   - When a waterer has 1-3 plants connected, a cluster is created
   - When connections are removed or the count goes outside 1-3 range, the cluster is deleted
   - **Important**: Deleting a cluster does NOT delete the nodes - they retain all their properties

**Files Modified**:
- `app.py` - Added validation in `api_connections_create()`

### C. Visual Cluster Indicators

**Node Visual Feedback**:
- Nodes that belong to a cluster show a **visual badge** (dot icon in top-right corner)
- Nodes with clusters have an **accent-colored ring** around them
- This makes it immediately clear which nodes are part of active clusters

**Features**:
- Plant nodes show cluster badge when connected to a waterer
- Waterer nodes show cluster badge when managing 1-3 plants
- Hover effects enhanced for better UX

**Files Modified**:
- `frontend/src/components/nodes/PlantNode.jsx`
- `frontend/src/components/nodes/WatererNode.jsx`
- `frontend/src/components/nodes/NodeStyles.css`

### D. Property Independence

**How Properties are Retained**:
1. **Node-Level Properties** (always retained):
   - Name
   - Position (x, y coordinates)
   - Type (plant or waterer)

2. **Cluster-Level Properties** (independent from nodes):
   - Pot size
   - Watering schedule/group
   - Calibration settings
   - Device pairing
   - Watering history

3. **When Nodes are Disconnected**:
   - Cluster is deleted
   - All node properties remain unchanged
   - Nodes can be reconnected to form new clusters
   - Example: If you repot a plant, just change its pot size preference and connect it to a new waterer

**Database Architecture**:
- `MapObject` table: Stores node data (id, type, name, position, cluster_id reference)
- `Cluster` table: Stores cluster data (id, pot_size, watering_group, calibration, etc.)
- `Connection` table: Stores edges between nodes
- When clusters are deleted, only the `Cluster` record is removed - `MapObject` records persist

### E. Cluster Information Display

**Plant Panel**:
- Shows current cluster assignment
- Displays cluster name and schedule
- Shows watering history chart (last 10 waterings)
- Shows volume distribution bar chart (last 7 waterings)
- Displays pot size and watering volume from cluster
- Shows next scheduled watering time

**Waterer Panel**:
- Shows connected plants count
- Displays cluster configuration options
- Shows pot size optimization (selected during calibration)
- Displays watering schedule
- Shows device pairing status
- Cluster name is editable

### F. Mismatch Warning Highlights

**Schedule Conflict Detection**:
- Plant panel shows a **red warning box** when the plant's preferred watering schedule doesn't match the cluster's actual schedule
- Warning includes:
  - Clear indication of the conflict
  - Plant's preferred schedule vs. cluster's schedule
  - Recommendation to adjust or move the plant

**Example Warning**:
```
⚠️ Schedule Conflict
This plant prefers Daily (7x/week) but the cluster is set to Weekly (1x/week).
Consider moving this plant to a cluster with matching schedule or adjusting its preference.
```

## Testing Checklist

- [x] Background colors use light theme consistently
- [x] Plants cannot connect to multiple waterers
- [x] Waterers cannot connect to more than 3 plants
- [x] Clusters form automatically when waterer connects to 1-3 plants
- [x] Cluster badge appears on nodes when cluster is created
- [x] Deleting connections removes cluster but keeps node properties
- [x] Node names are retained after cluster deletion
- [x] Watering history displays in plant panel
- [x] Pot size displays in waterer panel
- [x] Schedule conflict warnings appear when appropriate
- [x] Reconnecting nodes can form new clusters with retained properties

## Key Behavioral Examples

### Example 1: Creating a Cluster
1. Create a waterer node
2. Create 1-3 plant nodes
3. Connect plants to waterer
4. **Result**: Cluster automatically created, both waterer and plants show cluster badge

### Example 2: Plant Cannot Have Multiple Waterers
1. Plant A is connected to Waterer 1
2. Try to connect Plant A to Waterer 2
3. **Result**: Error - "This plant is already connected to a waterer"
4. Must disconnect from Waterer 1 first

### Example 3: Property Retention
1. Create Waterer A with 2 plants (Cluster created)
2. Calibrate cluster (pot size 8x7, basil plants, weekly schedule)
3. Disconnect one plant
4. **Result**: Cluster deleted, but all 3 nodes keep their names and positions
5. Reconnect plant to waterer
6. **Result**: New cluster created (needs recalibration), old cluster settings were cluster-specific

### Example 4: Repotting Workflow
1. Plant is in a cluster with 5.5"x4.5" pot
2. You repot it to an 8x7" pot
3. Disconnect plant from current waterer
4. Connect to a different waterer configured for 8x7" pots
5. **Result**: Plant retains all its data and joins new cluster optimized for larger pot

## Conclusion

The fluid cluster model ensures:
- **Flexibility**: Clusters form and dissolve dynamically
- **Independence**: Node and cluster properties are separate
- **Validation**: Prevents invalid configurations
- **Clarity**: Visual indicators show cluster membership
- **Safety**: Properties are retained when clusters change
