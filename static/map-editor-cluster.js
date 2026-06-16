// Cluster management functions for map editor
// Integrated cluster configuration in side panel

const POT_SIZES = {
  '5.5x4.5': '5.5" × 4.5"',
  '8x7': '8" × 7"',
  '9.5x8.5': '9.5" × 8.5"',
  '12x11': '12" × 11"'
};

const POT_KEYS = Object.keys(POT_SIZES);

function groupLabel(g) {
  if (g === 'daily') return 'Daily';
  if (g === 'twice_weekly') return '2× / week';
  if (g === 'weekly') return 'Weekly';
  return g || '—';
}

// Cluster calibration functions
function clusterPickPot(publicId, potKey) {
  if (!clusterDraft[publicId]) {
    clusterDraft[publicId] = { pot: null, plantIds: [] };
  }
  clusterDraft[publicId].pot = potKey;
  
  // Update UI
  document.querySelectorAll(`[data-pot-item]`).forEach(t => {
    t.classList.toggle('selected', t.dataset.potKey === potKey);
  });
}

function clusterTogglePlant(publicId, plantId) {
  if (!clusterDraft[publicId]) {
    clusterDraft[publicId] = { pot: null, plantIds: [] };
  }
  
  const d = clusterDraft[publicId];
  const idx = d.plantIds.indexOf(plantId);
  
  if (idx >= 0) {
    d.plantIds.splice(idx, 1);
  } else {
    if (d.plantIds.length >= 3) {
      toast('Maximum 3 plants per cluster', true);
      return;
    }
    
    const p = catalogPlants.find(x => x.id === plantId);
    if (!p) return;
    
    // Check watering group compatibility
    if (d.plantIds.length > 0) {
      const g0 = catalogPlants.find(x => x.id === d.plantIds[0])?.watering_group;
      if (g0 && p.watering_group !== g0) {
        toast('All plants must have same watering rhythm', true);
        return;
      }
    }
    d.plantIds.push(plantId);
  }
  
  // Update UI
  const locked = d.plantIds.length
    ? catalogPlants.find(x => x.id === d.plantIds[0])?.watering_group
    : null;
  
  document.querySelectorAll(`[data-plant-chip]`).forEach(chip => {
    const pid = parseInt(chip.dataset.plantId, 10);
    const g = catalogPlants.find(x => x.id === pid)?.watering_group;
    const selected = d.plantIds.includes(pid);
    const disabled = Boolean(locked && g !== locked && !selected);
    chip.classList.toggle('selected', selected);
    chip.classList.toggle('disabled', disabled);
  });
}

async function saveClusterCalibration(publicId) {
  const d = clusterDraft[publicId];
  if (!d || !d.pot || !d.plantIds.length) {
    toast('Choose a pot size and at least one plant', true);
    return;
  }
  
  try {
    await API.clusterCalibrate(publicId, d.pot, d.plantIds);
    toast('Cluster calibrated successfully');
    
    // Reload data
    clusters = await API.getClusters();
    
    // Refresh panel
    if (activeObjectId) {
      const obj = mapObjects.find(o => o.id === activeObjectId);
      if (obj) {
        showObjectPanel(obj);
      }
    }
  } catch (error) {
    console.error('Failed to calibrate cluster:', error);
    toast('Failed to calibrate cluster', true);
  }
}

async function requestPairingCode(publicId) {
  try {
    const res = await API.clusterPairingCode(publicId);
    const box = document.getElementById('pairingBox');
    if (box) {
      box.innerHTML = `
        <div style="font-size: 12px; margin-bottom: 8px;">Pairing Code:</div>
        <div style="font-size: 24px; font-weight: 700; font-family: monospace; letter-spacing: 0.1em; margin: 8px 0;">
          ${escapeHtml(res.pairing_code)}
        </div>
        <div style="font-size: 11px; color: var(--text-dim);">Enter this code on your ESP32 device</div>
      `;
      box.style.display = 'block';
    }
    toast('Pairing code generated');
  } catch (error) {
    console.error('Failed to get pairing code:', error);
    toast('Failed to get pairing code', true);
  }
}

async function unpairCluster(publicId) {
  if (!confirm('Unpair this device? The ESP32 will need a new pairing code.')) return;
  
  try {
    await API.clusterUnpair(publicId);
    toast('Device unpaired');
    
    // Reload data
    clusters = await API.getClusters();
    
    // Refresh panel
    if (activeObjectId) {
      const obj = mapObjects.find(o => o.id === activeObjectId);
      if (obj) {
        showObjectPanel(obj);
      }
    }
  } catch (error) {
    console.error('Failed to unpair cluster:', error);
    toast('Failed to unpair device', true);
  }
}

async function startClusterWatering(publicId) {
  try {
    await API.clusterStartWatering(publicId);
    toast('Watering schedule started');
    
    // Reload data
    clusters = await API.getClusters();
    
    // Refresh panel
    if (activeObjectId) {
      const obj = mapObjects.find(o => o.id === activeObjectId);
      if (obj) {
        showObjectPanel(obj);
      }
    }
  } catch (error) {
    console.error('Failed to start watering:', error);
    toast('Failed to start watering', true);
  }
}

async function pauseClusterWatering(publicId) {
  try {
    await API.clusterPauseWatering(publicId);
    toast('Watering schedule paused');
    
    // Reload data
    clusters = await API.getClusters();
    
    // Refresh panel
    if (activeObjectId) {
      const obj = mapObjects.find(o => o.id === activeObjectId);
      if (obj) {
        showObjectPanel(obj);
      }
    }
  } catch (error) {
    console.error('Failed to pause watering:', error);
    toast('Failed to pause watering', true);
  }
}

async function saveClusterVolume(publicId) {
  const slider = document.getElementById('volumeSlider');
  if (!slider) return;
  
  const pct = parseFloat(slider.value);
  
  try {
    await API.clusterSetVolume(publicId, pct);
    const valEl = document.getElementById('volumeValue');
    if (valEl) valEl.textContent = pct.toFixed(0) + '%';
  } catch (error) {
    console.error('Failed to save volume:', error);
    toast('Failed to save volume', true);
  }
}

async function saveClusterName(publicId) {
  const input = document.getElementById('clusterNameInput');
  if (!input) return;
  
  const newName = input.value.trim();
  if (!newName) {
    toast('Cluster name cannot be empty', true);
    return;
  }
  
  try {
    await API.clusterRename(publicId, newName);
    toast('Cluster renamed');
    
    // Reload data
    clusters = await API.getClusters();
    
    // Update panel title
    const titleEl = document.getElementById('panelTitle');
    if (titleEl) titleEl.textContent = newName;
  } catch (error) {
    console.error('Failed to rename cluster:', error);
    toast('Failed to rename cluster', true);
  }
}
