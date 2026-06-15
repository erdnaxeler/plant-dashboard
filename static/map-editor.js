// Map Editor - Full-screen visual editor for plant dashboard
// Refactored to use MapObjects and Connections API
// Built with Fabric.js

let canvas = null;
let mapObjects = []; // Array of MapObject data from API
let connections = []; // Array of Connection data from API
let objectShapes = {}; // Map of object_id -> fabric group
let connectionLines = {}; // Map of connection_id -> fabric line
let selectedTool = null; // 'plant' or 'waterer' or 'connection'
let connectionMode = null; // { fromObjectId, tempLine } or null
let zoomLevel = 1;
let activeObjectId = null;

// Auth helper
function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = sessionStorage.getItem('dashToken');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// API Methods
const API = {
  async getMapObjects() {
    const res = await fetch('/api/app/map-objects', { 
      headers: authHeaders() 
    });
    if (!res.ok) throw new Error('Failed to load map objects');
    return res.json();
  },

  async createMapObject(type, name, x, y) {
    const res = await fetch('/api/app/map-objects', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ type, name, x, y })
    });
    if (!res.ok) throw new Error('Failed to create map object');
    return res.json();
  },

  async updateMapObject(id, data) {
    const res = await fetch(`/api/app/map-objects/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update map object');
    return res.json();
  },

  async deleteMapObject(id) {
    const res = await fetch(`/api/app/map-objects/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed to delete map object');
    return res.json();
  },

  async getConnections() {
    const res = await fetch('/api/app/connections', { 
      headers: authHeaders() 
    });
    if (!res.ok) throw new Error('Failed to load connections');
    return res.json();
  },

  async createConnection(fromObjectId, toObjectId) {
    const res = await fetch('/api/app/connections', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ from_object_id: fromObjectId, to_object_id: toObjectId })
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to create connection');
    }
    return res.json();
  },

  async deleteConnection(id) {
    const res = await fetch(`/api/app/connections/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed to delete connection');
    return res.json();
  }
};

// Toast notifications
function toast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  const toastEl = document.createElement('div');
  toastEl.className = 'toast' + (isError ? ' error' : '');
  toastEl.textContent = message;
  container.appendChild(toastEl);
  setTimeout(() => toastEl.remove(), 3000);
}

// Initialize canvas
function initCanvas() {
  const canvasEl = document.getElementById('editorCanvas');
  const container = canvasEl.parentElement;
  
  // Set canvas size to fill container
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  canvasEl.width = width;
  canvasEl.height = height;
  
  canvas = new fabric.Canvas('editorCanvas', {
    backgroundColor: '#1e1e1e',
    selection: true,
    preserveObjectStacking: true
  });

  // Add grid pattern
  addGrid();

  // Handle object selection
  canvas.on('selection:created', (e) => {
    if (e.selected && e.selected[0] && e.selected[0].objectId) {
      selectMapObject(e.selected[0].objectId);
    }
  });

  canvas.on('selection:updated', (e) => {
    if (e.selected && e.selected[0] && e.selected[0].objectId) {
      selectMapObject(e.selected[0].objectId);
    }
  });

  canvas.on('selection:cleared', () => {
    closePanel();
  });

  // Handle object movement
  canvas.on('object:modified', async (e) => {
    const obj = e.target;
    if (obj && obj.objectId) {
      await savePosition(obj.objectId, obj.left, obj.top);
    }
  });

  // Handle canvas click for adding objects or connections
  canvas.on('mouse:down', (e) => {
    if (!e.target) {
      // Clicked on empty canvas
      if (selectedTool && selectedTool !== 'connection') {
        const pointer = canvas.getPointer(e.e);
        createObject(selectedTool, pointer.x, pointer.y);
        clearToolSelection();
      } else if (connectionMode) {
        // Cancel connection mode
        cancelConnectionMode();
      }
    } else if (e.target.objectId) {
      // Clicked on an object
      if (selectedTool === 'connection') {
        handleConnectionClick(e.target.objectId);
      }
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.setDimensions({ width, height });
  });
}

// Add grid pattern to canvas
function addGrid() {
  const gridSize = 50;
  const width = canvas.width;
  const height = canvas.height;

  for (let i = 0; i < width / gridSize; i++) {
    canvas.add(new fabric.Line([i * gridSize, 0, i * gridSize, height], {
      stroke: '#2d2d30',
      strokeWidth: 1,
      selectable: false,
      evented: false
    }));
  }

  for (let i = 0; i < height / gridSize; i++) {
    canvas.add(new fabric.Line([0, i * gridSize, width, i * gridSize], {
      stroke: '#2d2d30',
      strokeWidth: 1,
      selectable: false,
      evented: false
    }));
  }
}

// Tool selection
function selectTool(type) {
  selectedTool = type;
  document.querySelectorAll('.tool-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.type === type);
  });
  
  if (type === 'connection') {
    toast('Click on first object, then second object to connect', false);
  } else {
    toast(`Click on canvas to place ${type}`, false);
  }
}

function clearToolSelection() {
  selectedTool = null;
  document.querySelectorAll('.tool-item').forEach(item => {
    item.classList.remove('selected');
  });
  cancelConnectionMode();
}

// Connection mode handling
function handleConnectionClick(objectId) {
  if (!connectionMode) {
    // Start connection from this object
    connectionMode = { fromObjectId: objectId, tempLine: null };
    highlightObject(objectId, true);
    toast('Now click on target object to complete connection', false);
  } else if (connectionMode.fromObjectId === objectId) {
    // Clicked same object - cancel
    cancelConnectionMode();
    toast('Connection cancelled', false);
  } else {
    // Complete connection
    createConnectionBetween(connectionMode.fromObjectId, objectId);
    cancelConnectionMode();
    clearToolSelection();
  }
}

function cancelConnectionMode() {
  if (connectionMode) {
    highlightObject(connectionMode.fromObjectId, false);
    if (connectionMode.tempLine) {
      canvas.remove(connectionMode.tempLine);
    }
    connectionMode = null;
  }
}

function highlightObject(objectId, highlight) {
  const shape = objectShapes[objectId];
  if (shape && shape._objects && shape._objects[0]) {
    const circle = shape._objects[0];
    if (highlight) {
      circle.set('strokeWidth', 6);
      circle.set('stroke', '#007acc');
    } else {
      circle.set('strokeWidth', 4);
      const obj = mapObjects.find(o => o.id === objectId);
      if (obj) {
        circle.set('stroke', getObjectStrokeColor(obj));
      }
    }
    canvas.renderAll();
  }
}

// Create object on canvas
async function createObject(type, x, y) {
  try {
    const name = type === 'plant' ? 'New Plant' : 'New Waterer';
    const mapObject = await API.createMapObject(type, name, x, y);
    
    // Add to local array
    mapObjects.push(mapObject);
    
    // Render on canvas
    renderMapObject(mapObject);
    
    // Update layers
    updateLayers();
    
    toast(`${name} created`, false);
  } catch (error) {
    console.error('Failed to create object:', error);
    toast('Failed to create object', true);
  }
}

// Create connection between two objects
async function createConnectionBetween(fromObjectId, toObjectId) {
  try {
    const connection = await API.createConnection(fromObjectId, toObjectId);
    
    // Add to local array
    connections.push(connection);
    
    // Render on canvas
    renderConnection(connection);
    
    // Reload objects to get updated cluster_id
    await reloadMapObjects();
    
    toast('Connection created', false);
  } catch (error) {
    console.error('Failed to create connection:', error);
    toast(error.message || 'Failed to create connection', true);
  }
}

// Get object color based on type and cluster status
function getObjectFillColor(obj) {
  if (obj.type === 'plant') {
    return obj.cluster_id ? '#4ec9b0' : '#569cd6'; // green if in cluster, blue otherwise
  } else if (obj.type === 'waterer') {
    return obj.cluster_id ? '#c586c0' : '#dcdcaa'; // purple if in cluster, amber otherwise
  }
  return '#666666';
}

function getObjectStrokeColor(obj) {
  if (obj.type === 'plant') {
    return obj.cluster_id ? '#3ba085' : '#4179b3';
  } else if (obj.type === 'waterer') {
    return obj.cluster_id ? '#9d6b9a' : '#b3b377';
  }
  return '#444444';
}

function getObjectIcon(obj) {
  return obj.type === 'plant' ? '🌱' : '💧';
}

// Render map object on canvas
function renderMapObject(obj) {
  const x = obj.map_x || 100;
  const y = obj.map_y || 100;
  
  const fillColor = getObjectFillColor(obj);
  const strokeColor = getObjectStrokeColor(obj);
  const icon = getObjectIcon(obj);
  
  // Create circle
  const circle = new fabric.Circle({
    left: x,
    top: y,
    radius: 40,
    fill: fillColor,
    stroke: strokeColor,
    strokeWidth: 4,
    originX: 'center',
    originY: 'center',
    hasControls: false,
    hasBorders: true,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true,
    shadow: new fabric.Shadow({
      color: 'rgba(0, 0, 0, 0.3)',
      blur: 10,
      offsetX: 0,
      offsetY: 4
    })
  });
  
  // Create icon (emoji)
  const iconText = new fabric.Text(icon, {
    left: x,
    top: y - 10,
    fontSize: 32,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false
  });
  
  // Create label
  const label = new fabric.Text(obj.name || 'Object', {
    left: x,
    top: y + 55,
    fontSize: 14,
    fill: '#cccccc',
    originX: 'center',
    originY: 'top',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    selectable: false,
    evented: false
  });
  
  // Group circle, icon, and label
  const group = new fabric.Group([circle, iconText, label], {
    left: x,
    top: y,
    hasControls: false,
    hasBorders: true,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true
  });
  
  group.objectId = obj.id;
  
  // Store reference
  objectShapes[obj.id] = group;
  
  // Add to canvas
  canvas.add(group);
  canvas.renderAll();
}

// Render connection (line) on canvas
function renderConnection(conn) {
  const fromObj = mapObjects.find(o => o.id === conn.from_object_id);
  const toObj = mapObjects.find(o => o.id === conn.to_object_id);
  
  if (!fromObj || !toObj) return;
  
  const fromX = fromObj.map_x || 100;
  const fromY = fromObj.map_y || 100;
  const toX = toObj.map_x || 100;
  const toY = toObj.map_y || 100;
  
  const line = new fabric.Line([fromX, fromY, toX, toY], {
    stroke: '#569cd6',
    strokeWidth: 3,
    selectable: false,
    evented: true,
    strokeDashArray: [5, 5],
    opacity: 0.7
  });
  
  line.connectionId = conn.id;
  
  // Store reference
  connectionLines[conn.id] = line;
  
  // Add to canvas (send to back so it's behind objects)
  canvas.add(line);
  line.sendToBack();
  
  // Send grid to back
  canvas.getObjects().forEach(obj => {
    if (!obj.selectable && !obj.connectionId) {
      obj.sendToBack();
    }
  });
  
  canvas.renderAll();
}

// Update connection positions when objects move
function updateConnectionPositions(objectId) {
  // Find all connections involving this object
  const relatedConnections = connections.filter(
    c => c.from_object_id === objectId || c.to_object_id === objectId
  );
  
  relatedConnections.forEach(conn => {
    const line = connectionLines[conn.id];
    if (line) {
      const fromObj = mapObjects.find(o => o.id === conn.from_object_id);
      const toObj = mapObjects.find(o => o.id === conn.to_object_id);
      
      if (fromObj && toObj) {
        line.set({
          x1: fromObj.map_x || 100,
          y1: fromObj.map_y || 100,
          x2: toObj.map_x || 100,
          y2: toObj.map_y || 100
        });
      }
    }
  });
  
  canvas.renderAll();
}

// Load all map objects
async function loadMapObjects() {
  try {
    mapObjects = await API.getMapObjects();
    
    // Clear existing object shapes
    Object.values(objectShapes).forEach(shape => {
      canvas.remove(shape);
    });
    objectShapes = {};
    
    // Render each object
    mapObjects.forEach(obj => {
      renderMapObject(obj);
    });
    
    updateLayers();
  } catch (error) {
    console.error('Failed to load map objects:', error);
    toast('Failed to load map objects', true);
  }
}

// Reload map objects (to get updated cluster_id after connection changes)
async function reloadMapObjects() {
  try {
    mapObjects = await API.getMapObjects();
    
    // Update existing shapes with new colors
    mapObjects.forEach(obj => {
      const shape = objectShapes[obj.id];
      if (shape && shape._objects && shape._objects[0]) {
        const circle = shape._objects[0];
        circle.set('fill', getObjectFillColor(obj));
        circle.set('stroke', getObjectStrokeColor(obj));
      }
    });
    
    canvas.renderAll();
    updateLayers();
  } catch (error) {
    console.error('Failed to reload map objects:', error);
  }
}

// Load all connections
async function loadConnections() {
  try {
    connections = await API.getConnections();
    
    // Clear existing connection lines
    Object.values(connectionLines).forEach(line => {
      canvas.remove(line);
    });
    connectionLines = {};
    
    // Render each connection
    connections.forEach(conn => {
      renderConnection(conn);
    });
  } catch (error) {
    console.error('Failed to load connections:', error);
    toast('Failed to load connections', true);
  }
}

// Load all data
async function loadAllData() {
  await loadMapObjects();
  await loadConnections();
}

// Update layers list
function updateLayers() {
  const list = document.getElementById('layersList');
  
  if (mapObjects.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 24px 0;">
        <div style="font-size: 32px; opacity: 0.3;">📋</div>
        <div style="font-size: 12px; margin-top: 8px;">No objects yet</div>
      </div>
    `;
    return;
  }
  
  list.innerHTML = mapObjects.map(obj => {
    const icon = getObjectIcon(obj);
    const isActive = activeObjectId === obj.id;
    const inCluster = obj.cluster_id ? 'green' : 'gray';
    
    return `
      <div class="layer-item ${isActive ? 'active' : ''}" onclick="selectMapObjectFromLayer(${obj.id})">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
          <span>${icon}</span>
          <div class="layer-name">${escapeHtml(obj.name)}</div>
        </div>
        <div class="layer-status ${inCluster}"></div>
      </div>
    `;
  }).join('');
}

// Select map object from layer click
function selectMapObjectFromLayer(objectId) {
  const shape = objectShapes[objectId];
  if (shape) {
    canvas.setActiveObject(shape);
    canvas.renderAll();
    selectMapObject(objectId);
  }
}

// Select map object and show details panel
function selectMapObject(objectId) {
  activeObjectId = objectId;
  const obj = mapObjects.find(o => o.id === objectId);
  
  if (!obj) return;
  
  updateLayers();
  showObjectPanel(obj);
}

// Show object details in right panel
function showObjectPanel(obj) {
  const panel = document.getElementById('rightPanel');
  const title = document.getElementById('panelTitle');
  const content = document.getElementById('panelContent');
  
  title.textContent = obj.name || 'Object';
  
  // Find connections for this object
  const objConnections = connections.filter(
    c => c.from_object_id === obj.id || c.to_object_id === obj.id
  );
  
  const connectionsList = objConnections.map(conn => {
    const otherObjId = conn.from_object_id === obj.id ? conn.to_object_id : conn.from_object_id;
    const otherObj = mapObjects.find(o => o.id === otherObjId);
    const otherIcon = otherObj ? getObjectIcon(otherObj) : '❓';
    const otherName = otherObj ? otherObj.name : 'Unknown';
    return `
      <div class="property-row">
        <span class="property-label">${otherIcon} ${escapeHtml(otherName)}</span>
        <button class="btn-ghost" style="padding: 4px 8px; font-size: 11px; margin: 0; width: auto;" 
          onclick="deleteConnectionFromPanel(${conn.id})">Delete</button>
      </div>
    `;
  }).join('') || '<div style="font-size: 13px; color: var(--text-dim);">No connections</div>';
  
  const clusterInfo = obj.cluster_id 
    ? `<div class="status-badge green"><div class="status-dot"></div>In Cluster #${obj.cluster_id}</div>`
    : `<div class="status-badge gray"><div class="status-dot"></div>No Cluster</div>`;
  
  content.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">Type</div>
      <div style="font-size: 13px; color: var(--text);">
        ${getObjectIcon(obj)} ${obj.type === 'plant' ? 'Plant' : 'Waterer'}
      </div>
    </div>
    
    <div class="panel-section">
      <div class="panel-section-title">Cluster Status</div>
      ${clusterInfo}
    </div>
    
    <div class="panel-section">
      <div class="panel-section-title">Details</div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" id="objectName" value="${escapeHtml(obj.name)}" 
          onblur="updateObjectName(${obj.id})">
      </div>
    </div>
    
    <div class="panel-section">
      <div class="panel-section-title">Connections (${objConnections.length})</div>
      ${connectionsList}
    </div>
    
    <div class="panel-section">
      <div class="panel-section-title">Position</div>
      <div class="property-row">
        <span class="property-label">X</span>
        <span class="property-value">${Math.round(obj.map_x || 0)}</span>
      </div>
      <div class="property-row">
        <span class="property-label">Y</span>
        <span class="property-value">${Math.round(obj.map_y || 0)}</span>
      </div>
    </div>
    
    <div class="panel-section">
      <button class="btn btn-danger" onclick="deleteMapObjectFromPanel(${obj.id})">
        Delete ${obj.type === 'plant' ? 'Plant' : 'Waterer'}
      </button>
    </div>
  `;
  
  panel.classList.remove('hidden');
}

// Close panel
function closePanel() {
  const panel = document.getElementById('rightPanel');
  panel.classList.add('hidden');
  activeObjectId = null;
  canvas.discardActiveObject();
  canvas.renderAll();
  updateLayers();
}

// Update object name
async function updateObjectName(objectId) {
  const input = document.getElementById('objectName');
  const newName = input.value.trim();
  
  if (!newName) {
    toast('Name cannot be empty', true);
    await loadAllData();
    return;
  }
  
  try {
    await API.updateMapObject(objectId, { name: newName });
    
    // Update local data
    const obj = mapObjects.find(o => o.id === objectId);
    if (obj) {
      obj.name = newName;
    }
    
    // Update canvas object
    const shape = objectShapes[objectId];
    if (shape && shape._objects && shape._objects[2]) {
      shape._objects[2].set('text', newName);
      canvas.renderAll();
    }
    
    updateLayers();
    toast('Name updated', false);
  } catch (error) {
    console.error('Failed to update name:', error);
    toast('Failed to update name', true);
  }
}

// Save position
async function savePosition(objectId, x, y) {
  try {
    await API.updateMapObject(objectId, { x, y });
    
    // Update local data
    const obj = mapObjects.find(o => o.id === objectId);
    if (obj) {
      obj.map_x = x;
      obj.map_y = y;
    }
    
    // Update connection positions
    updateConnectionPositions(objectId);
  } catch (error) {
    console.error('Failed to save position:', error);
    toast('Failed to save position', true);
  }
}

// Save all positions
async function saveAllPositions() {
  try {
    const promises = mapObjects.map(obj => {
      const shape = objectShapes[obj.id];
      if (shape) {
        return API.updateMapObject(obj.id, { x: shape.left, y: shape.top });
      }
      return Promise.resolve();
    });
    
    await Promise.all(promises);
    toast('All positions saved', false);
  } catch (error) {
    console.error('Failed to save positions:', error);
    toast('Failed to save all positions', true);
  }
}

// Delete map object
async function deleteMapObjectFromPanel(objectId) {
  const obj = mapObjects.find(o => o.id === objectId);
  const objType = obj ? (obj.type === 'plant' ? 'plant' : 'waterer') : 'object';
  
  if (!confirm(`Delete this ${objType}? This will also remove all its connections.`)) {
    return;
  }
  
  try {
    await API.deleteMapObject(objectId);
    
    // Remove from canvas
    const shape = objectShapes[objectId];
    if (shape) {
      canvas.remove(shape);
      delete objectShapes[objectId];
    }
    
    // Remove connections involving this object
    const connToRemove = connections.filter(
      c => c.from_object_id === objectId || c.to_object_id === objectId
    );
    connToRemove.forEach(conn => {
      const line = connectionLines[conn.id];
      if (line) {
        canvas.remove(line);
        delete connectionLines[conn.id];
      }
    });
    
    // Remove from local arrays
    mapObjects = mapObjects.filter(o => o.id !== objectId);
    connections = connections.filter(
      c => c.from_object_id !== objectId && c.to_object_id !== objectId
    );
    
    // Close panel if this object was selected
    if (activeObjectId === objectId) {
      closePanel();
    }
    
    updateLayers();
    canvas.renderAll();
    
    // Reload to get updated cluster assignments
    await reloadMapObjects();
    
    toast(`${objType.charAt(0).toUpperCase() + objType.slice(1)} deleted`, false);
  } catch (error) {
    console.error('Failed to delete object:', error);
    toast('Failed to delete object', true);
  }
}

// Delete connection
async function deleteConnectionFromPanel(connectionId) {
  if (!confirm('Delete this connection? This may affect cluster formation.')) {
    return;
  }
  
  try {
    await API.deleteConnection(connectionId);
    
    // Remove from canvas
    const line = connectionLines[connectionId];
    if (line) {
      canvas.remove(line);
      delete connectionLines[connectionId];
    }
    
    // Remove from local array
    connections = connections.filter(c => c.id !== connectionId);
    
    canvas.renderAll();
    
    // Reload objects to get updated cluster_id
    await reloadMapObjects();
    
    // Refresh panel if an object is selected
    if (activeObjectId) {
      const obj = mapObjects.find(o => o.id === activeObjectId);
      if (obj) {
        showObjectPanel(obj);
      }
    }
    
    toast('Connection deleted', false);
  } catch (error) {
    console.error('Failed to delete connection:', error);
    toast('Failed to delete connection', true);
  }
}

// Zoom controls
function zoomIn() {
  zoomLevel = Math.min(zoomLevel + 0.1, 3);
  applyZoom();
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
  applyZoom();
}

function resetZoom() {
  zoomLevel = 1;
  applyZoom();
}

function applyZoom() {
  canvas.setZoom(zoomLevel);
  canvas.renderAll();
  document.getElementById('zoomLevel').textContent = `${Math.round(zoomLevel * 100)}%`;
}

// Utility function
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  initCanvas();
  await loadAllData();
});
