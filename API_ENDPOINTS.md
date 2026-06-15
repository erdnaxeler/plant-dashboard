# Map Objects & Connections API Endpoints

## Overview

New API endpoints for managing map objects (plants and waterers) and their connections in the plant dashboard map editor. These endpoints enable the new cluster formation workflow via visual connections.

---

## MapObjects Endpoints

### `GET /api/app/map-objects`
List all map objects (plants and waterers).

**Response:**
```json
[
  {
    "id": 1,
    "type": "plant",
    "name": "Basil Plant",
    "map_x": 100.0,
    "map_y": 200.0,
    "cluster_id": 5,
    "created_at": "2026-06-15T19:00:00+00:00",
    "updated_at": "2026-06-15T19:00:00+00:00"
  }
]
```

---

### `POST /api/app/map-objects`
Create a new map object (plant or waterer).

**Request Body:**
```json
{
  "type": "plant",      // Required: "plant" or "waterer"
  "name": "My Plant",   // Optional: defaults to "Plant" or "Waterer"
  "x": 150.0,          // Required: x coordinate
  "y": 250.0           // Required: y coordinate
}
```

**Response:** `201 Created`
```json
{
  "id": 1,
  "type": "plant",
  "name": "My Plant",
  "map_x": 150.0,
  "map_y": 250.0,
  "cluster_id": null,
  "created_at": "2026-06-15T19:00:00+00:00",
  "updated_at": "2026-06-15T19:00:00+00:00"
}
```

---

### `PUT /api/app/map-objects/<object_id>`
Update a map object's position and/or name.

**Request Body:**
```json
{
  "name": "Updated Name",  // Optional
  "x": 175.0,             // Optional
  "y": 275.0              // Optional
}
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "type": "plant",
  "name": "Updated Name",
  "map_x": 175.0,
  "map_y": 275.0,
  "cluster_id": null,
  "created_at": "2026-06-15T19:00:00+00:00",
  "updated_at": "2026-06-15T19:05:00+00:00"
}
```

---

### `DELETE /api/app/map-objects/<object_id>`
Delete a map object and all its connections.

**Behavior:**
- Deletes all connections involving this object
- If object is a waterer with a cluster, deletes the cluster and clears cluster_id from connected plants

**Response:** `200 OK`
```json
{
  "ok": true
}
```

---

## Connections Endpoints

### `GET /api/app/connections`
List all connections between map objects.

**Response:**
```json
[
  {
    "id": 1,
    "from_object_id": 2,
    "to_object_id": 3,
    "created_at": "2026-06-15T19:00:00+00:00"
  }
]
```

---

### `POST /api/app/connections`
Create a connection between two map objects.

**Request Body:**
```json
{
  "from_object_id": 2,  // Required: source object ID
  "to_object_id": 3     // Required: target object ID
}
```

**Validation:**
- Objects must exist
- Cannot connect an object to itself
- Connection cannot already exist (in either direction)
- If connecting to a waterer, triggers cluster formation logic

**Cluster Formation Logic:**
- When a connection involves a waterer, the system automatically creates or updates a cluster
- Valid configuration: 1 waterer + 1-3 plants
- Invalid configurations (0 or 4+ plants) clear the cluster

**Response:** `201 Created`
```json
{
  "id": 1,
  "from_object_id": 2,
  "to_object_id": 3,
  "created_at": "2026-06-15T19:00:00+00:00"
}
```

**Error Response (400):**
```json
{
  "error": "Waterer not found"
}
```

---

### `DELETE /api/app/connections/<connection_id>`
Delete a connection.

**Behavior:**
- Removes the connection
- If either object is a waterer, recalculates cluster assignments
- May delete the cluster if configuration becomes invalid

**Response:** `200 OK`
```json
{
  "ok": true
}
```

---

## Cluster Detection Logic

The system automatically manages cluster assignments based on connections:

### When Connection is Created
1. Check if either object is a waterer
2. Find all objects connected to that waterer
3. **Valid Configuration (1 waterer + 1-3 plants):**
   - Create or update a Cluster
   - Assign cluster_id to the waterer and all connected plants
   - Name cluster as `"{waterer.name} Cluster"`
   - Set `is_calibrated = False` (requires manual calibration)

4. **Invalid Configuration (0 or 4+ plants):**
   - Delete any existing cluster
   - Clear cluster_id from all affected objects

### When Connection is Deleted
1. Check if either object is a waterer
2. Recalculate cluster assignments using same logic as above
3. May delete cluster if configuration becomes invalid

### When Map Object is Deleted
1. Delete all connections involving the object
2. If object is a waterer with a cluster:
   - Clear cluster_id from all map objects in that cluster
   - Delete the cluster

---

## Database Models

### MapObject
```python
class MapObject(db.Model):
    id: int                      # Primary key
    type: str                    # 'plant' or 'waterer'
    name: str                    # Display name
    map_x: float                 # X coordinate
    map_y: float                 # Y coordinate
    cluster_id: Optional[int]    # Foreign key to Cluster (auto-assigned)
    created_at: datetime
    updated_at: datetime
```

### Connection
```python
class Connection(db.Model):
    id: int                      # Primary key
    from_object_id: int          # Foreign key to MapObject
    to_object_id: int            # Foreign key to MapObject
    created_at: datetime
```

---

## Authentication

All endpoints require dashboard authentication:
- Set `Authorization: Bearer <DASHBOARD_PASSWORD>` header
- Or no authentication if `DASHBOARD_PASSWORD` environment variable is not set

---

## Next Steps

After the API is deployed, the frontend (`map-editor.js`) should be updated to:
1. Use MapObjects instead of Clusters for visual representation
2. Allow users to create plants and waterers by clicking
3. Draw lines between objects to create connections
4. Display cluster formation status visually
5. Allow editing object positions by dragging
6. Show which objects belong to which cluster
