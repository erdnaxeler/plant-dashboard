// Map View with Fabric.js - Drag and drop plant clusters
let mapCanvas = null;
let mapObjects = {}; // cluster_id -> fabric object

async function initMapView() {
  if (mapCanvas) return; // Already initialized
  
  const canvasEl = document.getElementById('mapCanvas');
  if (!canvasEl) return;
  
  mapCanvas = new fabric.Canvas('mapCanvas', {
    backgroundColor: '#f5f7f5',
    selection: false,
  });
  
  // Render all clusters on the map
  renderClustersOnMap();
  
  // Handle object movement
  mapCanvas.on('object:modified', async (e) => {
    const obj = e.target;
    if (obj.clusterId) {
      await saveClusterPosition(obj.clusterId, obj.left, obj.top);
    }
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

function openClusterSidePanel(publicId) {
  // For now, just scroll to the cluster in list view
  // TODO: Implement proper side panel
  toast(`Clicked cluster: ${publicId}. Side panel coming soon!`);
}
