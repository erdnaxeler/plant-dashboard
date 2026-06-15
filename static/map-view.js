// Map View with Fabric.js - Full screen visual editor
let mapCanvas = null;
let mapObjects = {}; // cluster_id -> fabric object
let connections = []; // Lines between objects
let selectedSidebarItem = null;
let activeSidePanel = null;

async function initMapView() {
  if (mapCanvas) return; // Already initialized
  
  const canvasEl = document.getElementById('mapCanvas');
  if (!canvasEl) return;
  
  // Make canvas fill the viewport
  const container = document.getElementById('mapViewContainer');
  const width = container.clientWidth;
  const height = window.innerHeight - 100; // Account for header
  
  canvasEl.width = width;
  canvasEl.height = height;
  
  mapCanvas = new fabric.Canvas('mapCanvas', {
    backgroundColor: '#f5f7f5',
    selection: true,
  });
  
  // Render all clusters on the map
  renderClustersOnMap();
  
  // Handle object movement - update lines
  mapCanvas.on('object:moving', (e) => {
    updateConnectionLines();
  });
  
  // Handle object movement complete - save position
  mapCanvas.on('object:modified', async (e) => {
    const obj = e.target;
    if (obj.clusterId) {
      await saveClusterPosition(obj.clusterId, obj.left, obj.top);
    }
    updateConnectionLines();
  });
  
  // Handle canvas click for sidebar item placement
  mapCanvas.on('mouse:down', (e) => {
    if (selectedSidebarItem && !e.target) {
      const pointer = mapCanvas.getPointer(e.e);
      createObjectFromSidebar(selectedSidebarItem, pointer.x, pointer.y);
      selectedSidebarItem = null;
      clearSidebarSelection();
    }
  });
  
  // Window resize handler
  window.addEventListener('resize', () => {
    const container = document.getElementById('mapViewContainer');
    const width = container.clientWidth;
    const height = window.innerHeight - 100;
    mapCanvas.setDimensions({ width, height });
    updateConnectionLines();
  });
}

async function renderClustersOnMap() {
  if (!mapCanvas) return;
  
  mapCanvas.clear();
  mapObjects = {};
  
  for (const cluster of clusterData) {
    const x = cluster.map_x || 100 + (Math.random() * 400);
    const y = cluster.map_y || 100 + (Math.random() * 300);
    
    // Determine status color
    let fillColor = '#cccccc'; // gray = uncalibrated
    let strokeColor = '#999999';
    
    if (cluster.is_calibrated) {
      if (cluster.device_status === 'fault_pump_max') {
        fillColor = '#c0392b'; // red = fault
        strokeColor = '#962d22';
      } else if (cluster.watering_armed && cluster.has_device) {
        fillColor = '#2d8a4e'; // green = armed & ready
        strokeColor = '#1b5e30';
      } else if (cluster.has_device) {
        fillColor = '#2980b9'; // blue = device connected
        strokeColor = '#21618c';
      } else {
        fillColor = '#d4a017'; // amber = needs pairing
        strokeColor = '#9d7710';
      }
    }
    
    // Create circle for cluster
    const circle = new fabric.Circle({
      left: x,
      top: y,
      radius: 30,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: 3,
      originX: 'center',
      originY: 'center',
      hasControls: false,
      hasBorders: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
    });
    
    // Add label
    const label = new fabric.Text(cluster.name || 'Cluster', {
      left: x,
      top: y + 45,
      fontSize: 12,
      fill: '#1a2e1a',
      originX: 'center',
      originY: 'top',
      selectable: false,
      evented: false,
    });
    
    // Add warning icon if needed
    if (cluster.is_calibrated && cluster.watering_armed) {
      const warning = checkIfWarningNeeded(cluster);
      if (warning) {
        const icon = new fabric.Text('⚠️', {
          left: x + 20,
          top: y - 20,
          fontSize: 20,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        mapCanvas.add(icon);
      } else {
        const checkmark = new fabric.Text('✅', {
          left: x + 20,
          top: y - 20,
          fontSize: 16,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        mapCanvas.add(checkmark);
      }
    }
    
    circle.clusterId = cluster.public_id;
    circle.on('mousedown', () => {
      openClusterSidePanel(cluster.public_id);
    });
    
    mapCanvas.add(circle);
    mapCanvas.add(label);
    
    mapObjects[cluster.public_id] = { circle, label };
  }
  
  mapCanvas.renderAll();
}

function checkIfWarningNeeded(cluster) {
  if (!cluster.last_watering_at || !cluster.next_watering_at) return false;
  
  const now = new Date();
  const nextWatering = new Date(cluster.next_watering_at);
  
  // If next watering is in the past by more than 1 hour, show warning
  const hoursPast = (now - nextWatering) / (1000 * 60 * 60);
  return hoursPast > 1;
}

async function saveClusterPosition(publicId, x, y) {
  try {
    const res = await fetch(`/api/app/clusters/${encodeURIComponent(publicId)}/position`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ map_x: x, map_y: y })
    });
    
    if (!res.ok) {
      throw new Error('Failed to save position');
    }
    
    console.log(`Saved position for ${publicId}: (${x}, ${y})`);
  } catch (e) {
    console.error('Position save failed:', e);
    toast('Failed to save position', true);
  }
}

function toggleView() {
  const listView = document.getElementById('clusterSection');
  const mapView = document.getElementById('mapViewContainer');
  const toggleBtn = document.getElementById('viewToggleText');
  
  if (mapView.style.display === 'none') {
    // Switch to map view
    listView.style.display = 'none';
    mapView.style.display = 'block';
    toggleBtn.textContent = '📋 List View';
    
    // Initialize map if needed
    initMapView();
  } else {
    // Switch to list view
    listView.style.display = 'block';
    mapView.style.display = 'none';
    toggleBtn.textContent = '📍 Map View';
  }
}

function selectSidebarItem(type) {
  selectedSidebarItem = type;
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.type === type);
  });
  toast(`Click on canvas to place ${type}`, false);
}

function clearSidebarSelection() {
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.remove('selected');
  });
}

async function createObjectFromSidebar(type, x, y) {
  if (type === 'plant') {
    // Create a new cluster
    try {
      const res = await API.createCluster('New Plant');
      if (res.error) throw new Error(res.error);
      
      // Add to clusterData
      clusterData.push(res);
      
      // Create visual object at clicked position
      await saveClusterPosition(res.public_id, x, y);
      res.map_x = x;
      res.map_y = y;
      
      // Re-render map
      await renderClustersOnMap();
      updateConnectionLines();
      
      toast('Plant added - click to configure');
    } catch (e) {
      toast(e.message || 'Failed to create plant', true);
    }
  } else if (type === 'waterer') {
    // For now, waterer is also a cluster (device)
    try {
      const res = await API.createCluster('New Waterer');
      if (res.error) throw new Error(res.error);
      
      clusterData.push(res);
      await saveClusterPosition(res.public_id, x, y);
      res.map_x = x;
      res.map_y = y;
      
      await renderClustersOnMap();
      updateConnectionLines();
      
      toast('Waterer added - click to configure');
    } catch (e) {
      toast(e.message || 'Failed to create waterer', true);
    }
  }
}

function updateConnectionLines() {
  // Clear existing connection lines
  connections.forEach(line => mapCanvas.remove(line));
  connections = [];
  
  // For now, no connections - we'll add this when implementing line drawing
  mapCanvas.renderAll();
}

function openClusterSidePanel(publicId) {
  const panel = document.getElementById('sidePanel');
  const content = document.getElementById('sidePanelContent');
  
  if (!panel || !content) return;
  
  const cluster = clusterData.find(c => c.public_id === publicId);
  if (!cluster) return;
  
  // Render cluster details in side panel
  content.innerHTML = renderClusterSidePanelContent(cluster);
  panel.style.display = 'block';
  activeSidePanel = publicId;
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  if (panel) panel.style.display = 'none';
  activeSidePanel = null;
}

function renderClusterSidePanelContent(cluster) {
  // Simple version for now - will expand
  return `
    <h3 style="font-size:1.1rem;margin-bottom:1rem;color:var(--green-dark)">${cluster.name || 'Cluster'}</h3>
    <div style="margin-bottom:1rem">
      <label style="font-size:.85rem;color:var(--text-muted);display:block;margin-bottom:.5rem">Name</label>
      <input type="text" value="${cluster.name || ''}" 
        onchange="updateClusterName('${cluster.public_id}', this.value)"
        style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px">
    </div>
    <div style="margin-bottom:1rem">
      <p style="font-size:.85rem;color:var(--text-muted)">Status: ${cluster.status_message || 'Unknown'}</p>
      <p style="font-size:.85rem;color:var(--text-muted)">Calibrated: ${cluster.is_calibrated ? 'Yes' : 'No'}</p>
    </div>
    <button class="btn btn-danger" onclick="deleteClusterFromMap('${cluster.public_id}')" style="width:100%">Delete</button>
  `;
}

async function updateClusterName(publicId, newName) {
  try {
    await API.clusterRename(publicId, newName);
    const cluster = clusterData.find(c => c.public_id === publicId);
    if (cluster) cluster.name = newName;
    await renderClustersOnMap();
    updateConnectionLines();
    toast('Name updated');
  } catch (e) {
    toast('Failed to update name', true);
  }
}

async function deleteClusterFromMap(publicId) {
  if (!confirm('Delete this object?')) return;
  
  try {
    await API.clusterDelete(publicId);
    clusterData = clusterData.filter(c => c.public_id !== publicId);
    await renderClustersOnMap();
    updateConnectionLines();
    closeSidePanel();
    toast('Deleted');
  } catch (e) {
    toast('Failed to delete', true);
  }
}
