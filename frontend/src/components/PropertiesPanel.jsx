import React, { useState, useEffect } from 'react';
import { ClustersAPI, CatalogPlantsAPI } from '../hooks/useApi';
import './PropertiesPanel.css';

const POT_SIZES = {
  '5.5x4.5': '5.5" × 4.5"',
  '8x7': '8" × 7"',
  '9.5x8.5': '9.5" × 8.5"',
  '12x11': '12" × 11"'
};

export default function PropertiesPanel({ 
  selectedNode, 
  onDelete, 
  onUpdateNode,
  cluster,
  onClusterUpdate 
}) {
  const [catalogPlants, setCatalogPlants] = useState([]);
  const [clusterName, setClusterName] = useState('');
  const [potSize, setPotSize] = useState('');
  const [selectedPlants, setSelectedPlants] = useState([]);
  const [showPairingCode, setShowPairingCode] = useState(false);
  const [pairingCode, setPairingCode] = useState('');

  useEffect(() => {
    loadCatalogPlants();
  }, []);

  useEffect(() => {
    if (cluster) {
      setClusterName(cluster.name || '');
      setPotSize(cluster.pot_size || '');
      setSelectedPlants(cluster.catalog_plants?.map(p => p.id) || []);
    }
  }, [cluster]);

  const loadCatalogPlants = async () => {
    try {
      const plants = await CatalogPlantsAPI.getAll();
      setCatalogPlants(plants);
    } catch (error) {
      console.error('Failed to load catalog plants:', error);
    }
  };

  const handleCalibrate = async () => {
    if (!cluster || !potSize || selectedPlants.length === 0) {
      alert('Please select pot size and at least one plant');
      return;
    }

    try {
      await ClustersAPI.calibrate(cluster.public_id, potSize, selectedPlants);
      onClusterUpdate();
    } catch (error) {
      console.error('Failed to calibrate cluster:', error);
      alert('Failed to calibrate cluster');
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
      onClusterUpdate();
    } catch (error) {
      console.error('Failed to unpair:', error);
      alert('Failed to unpair device');
    }
  };

  const handleStartWatering = async () => {
    if (!cluster) return;

    try {
      await ClustersAPI.startWatering(cluster.public_id);
      onClusterUpdate();
    } catch (error) {
      console.error('Failed to start watering:', error);
      alert('Failed to start watering');
    }
  };

  const handlePauseWatering = async () => {
    if (!cluster) return;

    try {
      await ClustersAPI.pauseWatering(cluster.public_id);
      onClusterUpdate();
    } catch (error) {
      console.error('Failed to pause watering:', error);
      alert('Failed to pause watering');
    }
  };

  const togglePlantSelection = (plantId) => {
    if (selectedPlants.includes(plantId)) {
      setSelectedPlants(selectedPlants.filter(id => id !== plantId));
    } else if (selectedPlants.length < 3) {
      setSelectedPlants([...selectedPlants, plantId]);
    }
  };

  if (!selectedNode) {
    return (
      <div className="properties-panel">
        <div className="panel-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
            <path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" />
          </svg>
          <p>Select an object to view properties</p>
        </div>
      </div>
    );
  }

  return (
    <div className="properties-panel">
      <div className="panel-header">
        <h3>{selectedNode.data.label}</h3>
        <button className="btn-icon" onClick={onDelete} title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
          </svg>
        </button>
      </div>

      <div className="panel-content">
        <div className="property-group">
          <label>Type</label>
          <div className="property-value">{selectedNode.type === 'plant' ? 'Plant' : 'Waterer'}</div>
        </div>

        <div className="property-group">
          <label>Position</label>
          <div className="property-value">
            X: {Math.round(selectedNode.position.x)}, Y: {Math.round(selectedNode.position.y)}
          </div>
        </div>

        {cluster && (
          <>
            <div className="divider"></div>
            
            <div className="cluster-section">
              <h4>Cluster Configuration</h4>
              
              <div className="property-group">
                <label>Status</label>
                <div className="status-badge">{cluster.status_message}</div>
              </div>

              {!cluster.is_calibrated && (
                <>
                  <div className="property-group">
                    <label>Pot Size</label>
                    <select value={potSize} onChange={(e) => setPotSize(e.target.value)}>
                      <option value="">Select pot size</option>
                      {Object.entries(POT_SIZES).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="property-group">
                    <label>Plants (1-3)</label>
                    <div className="plant-list">
                      {catalogPlants.map(plant => (
                        <div
                          key={plant.id}
                          className={`plant-item ${selectedPlants.includes(plant.id) ? 'selected' : ''}`}
                          onClick={() => togglePlantSelection(plant.id)}
                        >
                          <span>{plant.name}</span>
                          <span className="plant-group">{plant.watering_group}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button className="btn-primary" onClick={handleCalibrate}>
                    Calibrate Cluster
                  </button>
                </>
              )}

              {cluster.is_calibrated && (
                <>
                  <div className="property-group">
                    <label>Pot Size</label>
                    <div className="property-value">{POT_SIZES[cluster.pot_size]}</div>
                  </div>

                  <div className="property-group">
                    <label>Plants</label>
                    <div className="property-value">
                      {cluster.catalog_plants?.map(p => p.name).join(', ')}
                    </div>
                  </div>

                  <div className="property-group">
                    <label>Watering</label>
                    <div className="property-value">
                      {cluster.ml_per_event} ml per event
                    </div>
                  </div>

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
                      {cluster.watering_armed ? (
                        <button className="btn-secondary" onClick={handlePauseWatering}>
                          Pause Watering
                        </button>
                      ) : (
                        <button className="btn-primary" onClick={handleStartWatering}>
                          Start Watering
                        </button>
                      )}
                      <button className="btn-secondary" onClick={handleUnpair}>
                        Unpair Device
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
