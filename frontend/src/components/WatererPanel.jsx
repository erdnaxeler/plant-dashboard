import React, { useState, useEffect } from 'react';
import { ClustersAPI, CatalogPlantsAPI, MapObjectsAPI } from '../hooks/useApi';
import { localTimeToUTCHour, utcHourToLocalTime } from '../utils/timezone';
import './PropertiesPanel.css';

const POT_SIZES = {
  '5.5x4.5': '5.5" × 4.5"',
  '8x7': '8" × 7"',
  '9.5x8.5': '9.5" × 8.5"',
  '12x11': '12" × 11"'
};

export default function WatererPanel({ 
  watererNode, 
  connectedPlants,
  cluster,
  onUpdate,
  onDelete 
}) {
  const [catalogPlants, setCatalogPlants] = useState([]);
  const [clusterName, setClusterName] = useState('');
  const [potSize, setPotSize] = useState('');
  const [selectedPlantIds, setSelectedPlantIds] = useState([]);
  const [showPairingCode, setShowPairingCode] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [volumePct, setVolumePct] = useState(100);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [optimizedPotSize, setOptimizedPotSize] = useState('');
  const [watererSchedule, setWatererSchedule] = useState('');
  const [connectedPlantsData, setConnectedPlantsData] = useState([]);

  useEffect(() => {
    loadCatalogPlants();
  }, []);

  useEffect(() => {
    if (cluster) {
      setClusterName(cluster.name || '');
      setPotSize(cluster.pot_size || '');
      setSelectedPlantIds(cluster.catalog_plants?.map(p => p.id) || []);
      setVolumePct(cluster.ml_volume_pct || 100);
    }
  }, [cluster]);

  useEffect(() => {
    if (watererNode) {
      setEditedName(watererNode.data.label);
      loadWatererData();
    }
  }, [watererNode]);

  useEffect(() => {
    if (connectedPlants.length > 0) {
      loadConnectedPlantsData();
    }
  }, [connectedPlants]);

  const loadCatalogPlants = async () => {
    try {
      const plants = await CatalogPlantsAPI.getAll();
      setCatalogPlants(plants);
    } catch (error) {
      console.error('Failed to load catalog plants:', error);
    }
  };

  const loadWatererData = async () => {
    if (!watererNode) return;
    
    try {
      const watererData = await MapObjectsAPI.get(watererNode.data.objectId);
      setOptimizedPotSize(watererData.waterer_optimized_pot_size || '');
      setWatererSchedule(watererData.waterer_schedule || '');
    } catch (error) {
      console.error('Failed to load waterer data:', error);
    }
  };

  const loadConnectedPlantsData = async () => {
    try {
      const plantsData = await Promise.all(
        connectedPlants.map(plant => MapObjectsAPI.get(plant.id))
      );
      setConnectedPlantsData(plantsData);
    } catch (error) {
      console.error('Failed to load connected plants data:', error);
    }
  };

  const handleCalibrate = async () => {
    if (!cluster || !potSize || selectedPlantIds.length === 0) {
      alert('Please select pot size and at least one plant type');
      return;
    }

    try {
      await ClustersAPI.calibrate(cluster.public_id, potSize, selectedPlantIds);
      onUpdate();
    } catch (error) {
      console.error('Failed to calibrate cluster:', error);
      alert(error.response?.data?.error || 'Failed to calibrate cluster');
    }
  };

  const handleGetPairingCode = async () => {
    if (!cluster) return;

    try {
      const result = await ClustersAPI.getPairingCode(cluster.public_id);
      setPairingCode(result.pairing_code);
      setShowPairingCode(true);
      setTimeout(() => {
        setShowPairingCode(false);
        setPairingCode('');
      }, 300000); // 5 minutes
    } catch (error) {
      console.error('Failed to get pairing code:', error);
      alert('Failed to get pairing code');
    }
  };

  const handleUnpair = async () => {
    if (!cluster || !confirm('Unpair this device?')) return;

    try {
      await ClustersAPI.unpair(cluster.public_id);
      onUpdate();
    } catch (error) {
      console.error('Failed to unpair:', error);
      alert('Failed to unpair device');
    }
  };

  const handleStartWatering = async () => {
    if (!cluster) return;

    try {
      await ClustersAPI.startWatering(cluster.public_id);
      onUpdate();
    } catch (error) {
      console.error('Failed to start watering:', error);
      alert('Failed to start watering');
    }
  };

  const handlePauseWatering = async () => {
    if (!cluster) return;

    try {
      await ClustersAPI.pauseWatering(cluster.public_id);
      onUpdate();
    } catch (error) {
      console.error('Failed to pause watering:', error);
      alert('Failed to pause watering');
    }
  };

  const handleVolumeChange = async (newPct) => {
    if (!cluster) return;

    setVolumePct(newPct);

    try {
      await ClustersAPI.setVolume(cluster.public_id, newPct);
      onUpdate();
    } catch (error) {
      console.error('Failed to update volume:', error);
      alert('Failed to update volume');
    }
  };

  const handleClearFault = async () => {
    if (!cluster) return;
    try {
      await ClustersAPI.clearFault(cluster.public_id);
      onUpdate();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to clear fault');
    }
  };

  const handleTogglePumpTest = async () => {
    if (!cluster) return;
    try {
      await ClustersAPI.togglePumpTest(cluster.public_id);
      onUpdate();
    } catch (error) {
      alert(error.response?.data?.error || 'Pump test toggle failed');
    }
  };

  const handleLogManualWatering = async () => {
    if (!cluster) return;
    try {
      await ClustersAPI.logManualWatering(cluster.public_id);
      onUpdate();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to log watering');
    }
  };

  // Preferred watering time: UI is local "HH:MM" in the cluster's timezone;
  // we store the UTC hour. Empty string clears the preference.
  const handlePreferredTimeChange = async (localTime) => {
    if (!cluster) return;
    try {
      if (!localTime) {
        await ClustersAPI.setPreferredHour(cluster.public_id, null);
      } else {
        const tz = cluster.timezone || 'UTC';
        const [h, m] = localTime.split(':').map(Number);
        await ClustersAPI.setPreferredHour(cluster.public_id, localTimeToUTCHour(h, m || 0, tz));
      }
      onUpdate();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to set preferred time');
    }
  };

  const togglePlantSelection = (plantId) => {
    if (selectedPlantIds.includes(plantId)) {
      setSelectedPlantIds(selectedPlantIds.filter(id => id !== plantId));
    } else if (selectedPlantIds.length < 3) {
      setSelectedPlantIds([...selectedPlantIds, plantId]);
    }
  };

  const handleSaveName = async () => {
    if (!watererNode || !editedName.trim()) {
      setIsEditingName(false);
      return;
    }

    try {
      await MapObjectsAPI.update(watererNode.data.objectId, { name: editedName.trim() });
      setIsEditingName(false);
      onUpdate();
    } catch (error) {
      console.error('Failed to update name:', error);
      alert('Failed to update name');
    }
  };

  const handleRenameCluster = async () => {
    if (!cluster || !clusterName.trim()) return;

    try {
      await ClustersAPI.rename(cluster.public_id, clusterName.trim());
      onUpdate();
    } catch (error) {
      console.error('Failed to rename cluster:', error);
      alert('Failed to rename cluster');
    }
  };

  const handleOptimizedPotSizeChange = async (newPotSize) => {
    if (!watererNode) return;
    
    setOptimizedPotSize(newPotSize);
    
    try {
      await MapObjectsAPI.update(watererNode.data.objectId, { 
        waterer_optimized_pot_size: newPotSize || null 
      });
      onUpdate();
    } catch (error) {
      console.error('Failed to update optimized pot size:', error);
      alert('Failed to update optimized pot size');
    }
  };

  const handleWatererScheduleChange = async (newSchedule) => {
    if (!watererNode) return;
    
    setWatererSchedule(newSchedule);
    
    try {
      await MapObjectsAPI.update(watererNode.data.objectId, { 
        waterer_schedule: newSchedule || null 
      });
      onUpdate();
    } catch (error) {
      console.error('Failed to update waterer schedule:', error);
      alert('Failed to update waterer schedule');
    }
  };

  if (!watererNode) {
    return null;
  }

  return (
    <div className="properties-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7H14A7,7 0 0,1 21,14H22A1,1 0 0,1 23,15V18A1,1 0 0,1 22,19H21V20A2,2 0 0,1 19,22H5A2,2 0 0,1 3,20V19H2A1,1 0 0,1 1,18V15A1,1 0 0,1 2,14H3A7,7 0 0,1 10,7H11V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2M7.5,10.5C7.5,10.5 8,13 8,15.5C8,16.88 7.21,18 6,18C4.79,18 4,16.88 4,15.5C4,13 4.5,10.5 4.5,10.5H7.5M9,11C9,11 8,13.33 8,15.5C8,16.88 8.79,18 10,18C11.21,18 12,16.88 12,15.5C12,13.33 11,11 11,11H9Z" />
          </svg>
          {isEditingName ? (
            <input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              autoFocus
              style={{ 
                flex: 1, 
                fontSize: '16px', 
                fontWeight: '600',
                border: '1px solid var(--border)',
                background: 'var(--bg-light)',
                color: 'var(--text)',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            />
          ) : (
            <h3 onClick={() => setIsEditingName(true)} style={{ cursor: 'pointer', margin: 0 }}>
              {watererNode.data.label}
            </h3>
          )}
        </div>
        <button className="btn-icon" onClick={onDelete} title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
          </svg>
        </button>
      </div>

      <div className="panel-content">
        {/* Waterer Properties Section (only when not in cluster) */}
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

        {/* Connected Plants Info */}
        <div className="property-group">
          <label>Connected Plants ({connectedPlants.length}/3)</label>
          <div className="property-value">
            {connectedPlants.length === 0 && 'None'}
            {connectedPlants.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {connectedPlantsData.map(plant => {
                  // The device is auto-calibrated from the first usable plant;
                  // flag any plant whose pot size or watering group differs.
                  const potMismatch = cluster?.pot_size && plant.plant_pot_size &&
                                      cluster.pot_size !== plant.plant_pot_size;
                  const groupMismatch = cluster?.watering_group && plant.plant_watering_schedule &&
                                        cluster.watering_group !== plant.plant_watering_schedule;
                  const hasMismatch = potMismatch || groupMismatch;
                  return (
                    <div key={plant.id} style={{
                      padding: '6px 8px',
                      background: 'var(--bg-light)',
                      border: `1px solid ${hasMismatch ? '#f6e05e' : 'var(--border)'}`,
                      borderRadius: '4px',
                      fontSize: '13px'
                    }}>
                      <div>
                        {hasMismatch && <span title="Doesn't match the device config" style={{ marginRight: '4px' }}>⚠️</span>}
                        {plant.name}
                      </div>
                      {plant.plant_pot_size && (
                        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                          Pot: {plant.plant_pot_size}
                          {potMismatch && (
                            <span style={{ color: '#b7791f', marginLeft: '6px', fontWeight: '600' }}>
                              ≠ device {cluster.pot_size}
                            </span>
                          )}
                          {groupMismatch && (
                            <span style={{ color: '#b7791f', marginLeft: '6px', fontWeight: '600' }}>
                              ≠ device {cluster.watering_group}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {cluster && (
          <>
            <div className="divider"></div>
            
            <div className="cluster-section">
              <h4>Device</h4>

              {/* Calibration is derived automatically from the connected
                  plants (pot size + watering group) — no manual step. */}
              {!cluster.is_calibrated ? (
                <div className="property-group">
                  <div className="property-value" style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
                    Not calibrated yet. Connect a plant that has a <strong>pot size</strong> and
                    <strong> type</strong> set — the device calibrates itself from its plants.
                  </div>
                </div>
              ) : (
                <>
                  <div className="property-group">
                    <label>Pot Size</label>
                    <div className="property-value">{POT_SIZES[cluster.pot_size] || 'Not set'}</div>
                  </div>

                  <div className="property-group">
                    <label>Plant Types</label>
                    <div className="property-value">
                      {cluster.catalog_plants?.map(p => p.name).join(', ') || 'None'}
                    </div>
                  </div>

                  <div className="property-group">
                    <label>Watering Group</label>
                    <div className="property-value">{cluster.watering_group || 'Not set'}</div>
                  </div>

                  {cluster.ml_per_event ? (
                    <div className="property-group">
                      <label>Base Amount</label>
                      <div className="property-value">{cluster.ml_per_event} ml per event</div>
                    </div>
                  ) : null}

                  <div className="property-group">
                    <label>Volume Adjustment</label>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      value={volumePct}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                    <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '14px' }}>
                      {volumePct}% {cluster.ml_per_event ? `(${Math.round(cluster.ml_per_event * volumePct / 100)} ml)` : ''}
                    </div>
                  </div>

                  <div className="property-group">
                    <label>Preferred Watering Time{cluster.timezone ? ` (${cluster.timezone})` : ''}</label>
                    <input
                      type="time"
                      value={utcHourToLocalTime(cluster.preferred_watering_hour_utc, cluster.timezone)}
                      onChange={(e) => handlePreferredTimeChange(e.target.value)}
                    />
                    <small style={{ color: 'var(--text-dim)' }}>Leave empty to water anytime</small>
                  </div>

                  {cluster.next_watering_at && (
                    <div className="property-group">
                      <label>Next Watering</label>
                      <div className="property-value">
                        {new Date(cluster.next_watering_at).toLocaleString()}
                      </div>
                    </div>
                  )}

                  <button className="btn-secondary" onClick={handleLogManualWatering}>
                    💧 Log Manual Watering
                  </button>
                </>
              )}

              <div className="divider"></div>

              {/* Pairing is a device link — available regardless of calibration */}
              {!cluster.has_device && (
                <button className="btn-primary" onClick={handleGetPairingCode}>
                  Get Pairing Code
                </button>
              )}

              {showPairingCode && (
                <div className="pairing-code">
                  <div className="code-display">{pairingCode}</div>
                  <small>Code expires in 5 minutes</small>
                </div>
              )}

              {cluster.has_device && (
                <>
                  <div className="property-group">
                    <label>Device Status</label>
                    <div className="property-value">
                      {cluster.device_status === 'ok' ? '✓ Connected' : cluster.device_status}
                      {cluster.status_message ? ` — ${cluster.status_message}` : ''}
                    </div>
                  </div>

                  {cluster.watering_armed ? (
                    <button className="btn-secondary" onClick={handlePauseWatering}>
                      ⏸ Pause Watering
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={handleStartWatering}>
                      ▶ Start Watering
                    </button>
                  )}
                  <button className="btn-secondary" onClick={handleTogglePumpTest} style={{ marginTop: '8px' }}>
                    {cluster.pump_test_mode ? '■ Stop Pump Test' : '⚙ Pump Test'}
                  </button>
                  <button className="btn-secondary" onClick={handleClearFault} style={{ marginTop: '8px' }}>
                    Clear Fault
                  </button>
                  <button className="btn-secondary" onClick={handleUnpair} style={{ marginTop: '8px' }}>
                    Unpair Device
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
