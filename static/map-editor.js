// Map Editor - Full-screen visual editor for plant dashboard
// Built with Fabric.js

let canvas = null;
let selectedTool = null;
let clusterObjects = {}; // Map of cluster public_id -> fabric object
let clusters = [];
let zoomLevel = 1;
let activeClusterId = null;

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
  async getClusters() {
    const res = await fetch('/api/app/clusters', { 
      headers: authHeaders() 
    });
    if (!res.ok) throw new Error('Failed to load clusters');
    return res.json();
  },

  async createCluster(name) {
    const res = await fetch('/api/app/clusters', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to create cluster');
    return res.json();
  },

  async updatePosition(publicId, x, y) {
    const res = await fetch(`/api/app/clusters/${encodeURIComponent(publicId)}/position`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ map_x: x, map_y: y })
    });
    if (!res.ok) throw new Error('Failed to update position');
    return res.json();
  },

  async renameCluster(publicId, name) {
    const res = await fetch(`/api/app/clusters/${encodeURIComponent(publicId)}/rename`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to rename');
    return res.json();
  },

  async deleteCluster(publicId) {
    const res = await fetch(`/api/app/clusters/${encodeURIComponent(publicId)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed to delete');
    return res.json();
  }
};

// Toast notifications
function toast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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
    if (e.selected && e.selected[0] && e.selected[0].clusterId) {
      selectCluster(e.selected[0].clusterId);
    }
  });

  canvas.on('selection:updated', (e) => {
    if (e.selected && e.selected[0] && e.selected[0].clusterId) {
      selectCluster(e.selected[0].clusterId);
    }
  });

  canvas.on('selection:cleared', () => {
    closePanel();
  });

  // Handle object movement
  canvas.on('object:modified', async (e) => {
    const obj = e.target;
    if (obj && obj.clusterId) {
      await savePosition(obj.clusterId, obj.left, obj.top);
    }
  });

  // Handle canvas click for adding objects
  canvas.on('mouse:down', (e) => {
    if (selectedTool && !e.target) {
      const pointer = canvas.getPointer(e.e);
      createObject(selectedTool, pointer.x, pointer.y);
      clearToolSelection();
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
  toast(`Click on canvas to place ${type}`, false);
}

function clearToolSelection() {
  selectedTool = null;
  document.querySelectorAll('.tool-item').forEach(item => {
    item.classList.remove('selected');
  });
}

// Create object on canvas
async function createObject(type, x, y) {
  try {
    const name = type === 'plant' ? 'New Plant' : 'New Waterer';
    const cluster = await API.createCluster(name);
    
    // Save position immediately
    await API.updatePosition(cluster.public_id, x, y);
    cluster.map_x = x;
    cluster.map_y = y;
    
    // Add to clusters array
    clusters.push(cluster);
    
    // Render on canvas
    renderCluster(cluster);
    
    // Update layers
    updateLayers();
    
    toast(`${name} created`, false);
  } catch (error) {
    console.error('Failed to create object:', error);
    toast('Failed to create object', true);
  }
}

// Render cluster on canvas
function renderCluster(cluster) {
  const x = cluster.map_x || 100;
  const y = cluster.map_y || 100;
  
  // Determine color based on status
  let fillColor = '#666666'; // gray = uncalibrated
  let strokeColor = '#444444';
  
  if (cluster.is_calibrated) {
    if (cluster.device_status === 'fault_pump_max') {
      fillColor = '#f48771'; // red = fault
      strokeColor = '#d66952';
    } else if (cluster.watering_armed && cluster.has_device) {
      fillColor = '#4ec9b0'; // green = armed & ready
      strokeColor = '#3ba085';
    } else if (cluster.has_device) {
      fillColor = '#569cd6'; // blue = device connected
      strokeColor = '#4179b3';
    } else {
      fillColor = '#dcdcaa'; // amber = needs pairing
      strokeColor = '#b3b377';
    }
  }
  
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
  
  // Create label
  const label = new fabric.Text(cluster.name || 'Cluster', {
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
  
  // Group circle and label
  const group = new fabric.Group([circle, label], {
    left: x,
    top: y,
    hasControls: false,
    hasBorders: true,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true
  });
  
  group.clusterId = cluster.public_id;
  
  // Store reference
  clusterObjects[cluster.public_id] = group;
  
  // Add to canvas
  canvas.add(group);
  canvas.renderAll();
}

// Load all clusters
async function loadClusters() {
  try {
    clusters = await API.getClusters();
    
    // Clear existing objects
    canvas.getObjects().forEach(obj => {
      if (obj.clusterId) {
        canvas.remove(obj);
      }
    });
    clusterObjects = {};
    
    // Render each cluster
    clusters.forEach(cluster => {
      renderCluster(cluster);
    });
    
    updateLayers();
  } catch (error) {
    console.error('Failed to load clusters:', error);
    toast('Failed to load clusters', true);
  }
}

// Update layers list
function updateLayers() {
  const list = document.getElementById('layersList');
  
  if (clusters.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 24px 0;">
        <div style="font-size: 32px; opacity: 0.3;">📋</div>
        <div style="font-size: 12px; margin-top: 8px;">No objects yet</div>
      </div>
    `;
    return;
  }
  
  list.innerHTML = clusters.map(cluster => {
    let statusClass = 'gray';
    
    if (cluster.is_calibrated) {
      if (cluster.device_status === 'fault_pump_max') {
        statusClass = 'red';
      } else if (cluster.watering_armed && cluster.has_device) {
        statusClass = 'green';
      } else if (cluster.has_device) {
        statusClass = 'green';
      } else {
        statusClass = 'amber';
      }
    }
    
    const isActive = activeClusterId === cluster.public_id;
    
    return `
      <div class="layer-item ${isActive ? 'active' : ''}" onclick="selectClusterFromLayer('${cluster.public_id}')">
        <div class="layer-name">${escapeHtml(cluster.name)}</div>
        <div class="layer-status ${statusClass}"></div>
      </div>
    `;
  }).join('');
}

// Select cluster from layer click
function selectClusterFromLayer(publicId) {
  const obj = clusterObjects[publicId];
  if (obj) {
    canvas.setActiveObject(obj);
    canvas.renderAll();
    selectCluster(publicId);
  }
}

// Select cluster and show details panel
function selectCluster(publicId) {
  activeClusterId = publicId;
  const cluster = clusters.find(c => c.public_id === publicId);
  
  if (!cluster) return;
  
  updateLayers();
  showClusterPanel(cluster);
}

// Show cluster details in right panel
function showClusterPanel(cluster) {
  const panel = document.getElementById('rightPanel');
  const title = document.getElementById('panelTitle');
  const content = document.getElementById('panelContent');
  
  title.textContent = cluster.name || 'Cluster';
  
  // Determine status
  let statusBadge = 'gray';
  let statusText = 'Uncalibrated';
  
  if (cluster.is_calibrated) {
    if (cluster.device_status === 'fault_pump_max') {
      statusBadge = 'red';
      statusText = 'Fault';
    } else if (cluster.watering_armed && cluster.has_device) {
      statusBadge = 'green';
      statusText = 'Active';
    } else if (cluster.has_device) {
      statusBadge = 'green';
      statusText = 'Connected';
    } else {
      statusBadge = 'amber';
      statusText = 'Needs Pairing';
    }
  }
  
  const plantsList = (cluster.catalog_plants || []).map(p => p.name).join(', ') || 'None';
  
  content.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">Status</div>
      <div class="status-badge ${statusBadge}">
        <div class="status-dot"></div>
        ${statusText}
      </div>
    </div>
    
    <div class="panel-section">
      <div class="panel-section-title">Details</div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" id="clusterName" value="${escapeHtml(cluster.name)}" 
          onblur="updateClusterName('${cluster.public_id}')">
      </div>
      
      <div class="property-row">
        <span class="property-label">Calibrated</span>
        <span class="property-value">${cluster.is_calibrated ? 'Yes' : 'No'}</span>
      </div>
      
      ${cluster.is_calibrated ? `
        <div class="property-row">
          <span class="property-label">Pot Size</span>
          <span class="property-value">${cluster.pot_size || '—'}</span>
        </div>
        
        <div class="property-row">
          <span class="property-label">Watering</span>
          <span class="property-value">${cluster.watering_group || '—'}</span>
        </div>
        
        <div class="property-row">
          <span class="property-label">Water/Week</span>
          <span class="property-value">${cluster.effective_ml_per_week || 0} ml</span>
        </div>
      ` : ''}
      
      <div class="property-row">
        <span class="property-label">Device</span>
        <span class="property-value">${cluster.has_device ? 'Paired' : 'Not paired'}</span>
      </div>
    </div>
    
    ${cluster.is_calibrated ? `
      <div class="panel-section">
        <div class="panel-section-title">Plants</div>
        <div style="font-size: 13px; color: var(--text); line-height: 1.6;">
          ${plantsList}
        </div>
      </div>
    ` : ''}
    
    <div class="panel-section">
      <div class="panel-section-title">Position</div>
      <div class="property-row">
        <span class="property-label">X</span>
        <span class="property-value">${Math.round(cluster.map_x || 0)}</span>
      </div>
      <div class="property-row">
        <span class="property-label">Y</span>
        <span class="property-value">${Math.round(cluster.map_y || 0)}</span>
      </div>
    </div>
    
    <div class="panel-section">
      <button class="btn" onclick="openDashboard('${cluster.public_id}')">
        Configure in Dashboard
      </button>
      <button class="btn btn-danger" onclick="deleteClusterFromMap('${cluster.public_id}')">
        Delete Cluster
      </button>
    </div>
  `;
  
  panel.classList.remove('hidden');
}

// Close panel
function closePanel() {
  const panel = document.getElementById('rightPanel');
  panel.classList.add('hidden');
  activeClusterId = null;
  canvas.discardActiveObject();
  canvas.renderAll();
  updateLayers();
}

// Update cluster name
async function updateClusterName(publicId) {
  const input = document.getElementById('clusterName');
  const newName = input.value.trim();
  
  if (!newName) {
    toast('Name cannot be empty', true);
    await loadClusters();
    return;
  }
  
  try {
    await API.renameCluster(publicId, newName);
    
    // Update local data
    const cluster = clusters.find(c => c.public_id === publicId);
    if (cluster) {
      cluster.name = newName;
    }
    
    // Update canvas object
    const obj = clusterObjects[publicId];
    if (obj && obj._objects && obj._objects[1]) {
      obj._objects[1].set('text', newName);
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
async function savePosition(publicId, x, y) {
  try {
    await API.updatePosition(publicId, x, y);
    
    // Update local data
    const cluster = clusters.find(c => c.public_id === publicId);
    if (cluster) {
      cluster.map_x = x;
      cluster.map_y = y;
    }
  } catch (error) {
    console.error('Failed to save position:', error);
    toast('Failed to save position', true);
  }
}

// Save all positions
async function saveAllPositions() {
  try {
    const promises = clusters.map(cluster => {
      const obj = clusterObjects[cluster.public_id];
      if (obj) {
        return API.updatePosition(cluster.public_id, obj.left, obj.top);
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

// Delete cluster
async function deleteClusterFromMap(publicId) {
  if (!confirm('Delete this cluster? This will remove it from the dashboard.')) {
    return;
  }
  
  try {
    await API.deleteCluster(publicId);
    
    // Remove from canvas
    const obj = clusterObjects[publicId];
    if (obj) {
      canvas.remove(obj);
      delete clusterObjects[publicId];
    }
    
    // Remove from clusters array
    clusters = clusters.filter(c => c.public_id !== publicId);
    
    // Close panel if this cluster was selected
    if (activeClusterId === publicId) {
      closePanel();
    }
    
    updateLayers();
    canvas.renderAll();
    
    toast('Cluster deleted', false);
  } catch (error) {
    console.error('Failed to delete cluster:', error);
    toast('Failed to delete cluster', true);
  }
}

// Open dashboard to configure cluster
function openDashboard(publicId) {
  window.location.href = `/dashboard#cluster-${publicId}`;
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
  await loadClusters();
});
