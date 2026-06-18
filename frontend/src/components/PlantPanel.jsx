import React, { useState, useEffect } from 'react';
import { MapObjectsAPI, ClustersAPI, CatalogPlantsAPI } from '../hooks/useApi';
import './PropertiesPanel.css';

const WATERING_GROUPS = {
  daily: 'Daily (7x/week)',
  twice_weekly: 'Twice Weekly (2x/week)',
  weekly: 'Weekly (1x/week)'
};

export default function PlantPanel({ 
  plantNode, 
  cluster,
  onUpdate,
  onDelete 
}) {
  const [catalogPlants, setCatalogPlants] = useState([]);
  const [plantTypeId, setPlantTypeId] = useState(null);
  const [nickname, setNickname] = useState('');
  const [potSize, setPotSize] = useState('');
  const [schedule, setSchedule] = useState('');
  const [wateringHistory, setWateringHistory] = useState([]);
  const [recommendedSchedule, setRecommendedSchedule] = useState(null);

  useEffect(() => {
    loadCatalogPlants();
  }, []);

  useEffect(() => {
    if (plantNode) {
      loadPlantData();
    }
  }, [plantNode]);

  useEffect(() => {
    if (cluster) {
      loadWateringHistory();
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

  const loadPlantData = async () => {
    if (!plantNode) return;
    
    try {
      const plantData = await MapObjectsAPI.get(plantNode.data.objectId);
      setPlantTypeId(plantData.plant_type_id || null);
      setNickname(plantData.plant_nickname || '');
      setPotSize(plantData.plant_pot_size || '');
      setSchedule(plantData.plant_watering_schedule || '');
    } catch (error) {
      console.error('Failed to load plant data:', error);
    }
  };

  const loadWateringHistory = async () => {
    if (!cluster) return;
    
    try {
      const response = await fetch(`/api/app/cluster/${cluster.public_id}/waterings`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('dashToken')}`
        }
      });
      const data = await response.json();
      setWateringHistory(data.slice(0, 10)); // Last 10 waterings
    } catch (error) {
      console.error('Failed to load watering history:', error);
    }
  };

  const handlePlantTypeChange = async (newPlantTypeId) => {
    if (!plantNode) return;
    
    setPlantTypeId(newPlantTypeId ? parseInt(newPlantTypeId) : null);
    
    // Task #1: Auto-select ideal watering cycle and mark as recommended
    if (newPlantTypeId) {
      const selectedPlant = catalogPlants.find(p => p.id === parseInt(newPlantTypeId));
      if (selectedPlant && selectedPlant.watering_group) {
        setSchedule(selectedPlant.watering_group);
        setRecommendedSchedule(selectedPlant.watering_group);
      }
    } else {
      setRecommendedSchedule(null);
    }
    
    try {
      const updates = { 
        plant_type_id: newPlantTypeId ? parseInt(newPlantTypeId) : null 
      };
      
      // Also update schedule if plant type was selected
      if (newPlantTypeId) {
        const selectedPlant = catalogPlants.find(p => p.id === parseInt(newPlantTypeId));
        if (selectedPlant && selectedPlant.watering_group) {
          updates.plant_watering_schedule = selectedPlant.watering_group;
        }
      }
      
      await MapObjectsAPI.update(plantNode.data.objectId, updates);
      
      // Update the node label in the map
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      console.error('Failed to update plant type:', error);
      alert('Failed to update plant type');
    }
  };

  const handleNicknameChange = async (newNickname) => {
    if (!plantNode) return;
    
    setNickname(newNickname);
    
    try {
      await MapObjectsAPI.update(plantNode.data.objectId, { 
        plant_nickname: newNickname || null 
      });
      // Update the node label in the map
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      console.error('Failed to update nickname:', error);
      alert('Failed to update nickname');
    }
  };

  const handlePotSizeChange = async (newPotSize) => {
    if (!plantNode) return;
    
    setPotSize(newPotSize);
    
    try {
      await MapObjectsAPI.update(plantNode.data.objectId, { 
        plant_pot_size: newPotSize || null 
      });
      // Task #2: Don't call onUpdate() to prevent panel from closing
    } catch (error) {
      console.error('Failed to update pot size:', error);
      alert('Failed to update pot size');
    }
  };

  const handleScheduleChange = async (newSchedule) => {
    if (!plantNode) return;
    
    setSchedule(newSchedule);
    
    try {
      await MapObjectsAPI.update(plantNode.data.objectId, { 
        plant_watering_schedule: newSchedule || null 
      });
      // Task #2: Don't call onUpdate() to prevent panel from closing
    } catch (error) {
      console.error('Failed to update schedule:', error);
      alert('Failed to update schedule');
    }
  };

  if (!plantNode) {
    return null;
  }

  const hasScheduleConflict = cluster && cluster.watering_group && schedule &&
                               cluster.watering_group !== schedule;
  
  const hasPotSizeMismatch = cluster && cluster.pot_size && potSize &&
                              cluster.pot_size !== potSize;

  return (
    <div className="properties-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3,13A9,9 0 0,0 12,22C12.5,22 12.97,21.96 13.42,21.88C13.15,21.32 13,20.68 13,20A7,7 0 0,1 20,13C20.68,13 21.32,13.15 21.88,13.42C21.96,12.97 22,12.5 22,12A9,9 0 0,0 13,3V12L7.5,6.5C5.08,8.14 3.43,10.89 3,14H3M23,20C23,22.21 21.21,24 19,24C18.23,24 17.5,23.77 16.89,23.36L13,21.07L16.89,18.78C17.5,18.37 18.23,18.14 19,18.14C21.21,18.14 23,19.93 23,22.14" />
          </svg>
          <h3 style={{ margin: 0 }}>
            {plantNode.data.label}
          </h3>
        </div>
        <button className="btn-icon" onClick={onDelete} title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
          </svg>
        </button>
      </div>

      <div className="panel-content">
        {/* Plant Type Dropdown */}
        <div className="property-group">
          <label>Plant Type</label>
          <select 
            value={plantTypeId || ''} 
            onChange={(e) => handlePlantTypeChange(e.target.value)}
          >
            <option value="">Select plant type...</option>
            {catalogPlants.map(plant => (
              <option key={plant.id} value={plant.id}>{plant.name}</option>
            ))}
          </select>
        </div>

        {/* Optional Nickname */}
        <div className="property-group">
          <label>Nickname (Optional)</label>
          <input
            type="text"
            value={nickname || ''}
            onChange={(e) => handleNicknameChange(e.target.value)}
            placeholder="e.g., Kitchen Basil"
          />
        </div>

        {/* Pot Size */}
        <div className="property-group">
          <label>Pot Size</label>
          <select value={potSize || ''} onChange={(e) => handlePotSizeChange(e.target.value)}>
            <option value="">Select pot size...</option>
            <option value="5.5x4.5">5.5" × 4.5"</option>
            <option value="8x7">8" × 7"</option>
            <option value="9.5x8.5">9.5" × 8.5"</option>
            <option value="12x11">12" × 11"</option>
          </select>
        </div>

        {/* Preferred Schedule */}
        <div className="property-group">
          <label>Preferred Watering Schedule</label>
          <select value={schedule || ''} onChange={(e) => handleScheduleChange(e.target.value)}>
            <option value="">Select schedule...</option>
            <option value="daily">
              Daily (7x/week){recommendedSchedule === 'daily' ? ' (recommended)' : ''}
            </option>
            <option value="twice_weekly">
              Twice Weekly (2x/week){recommendedSchedule === 'twice_weekly' ? ' (recommended)' : ''}
            </option>
            <option value="weekly">
              Weekly (1x/week){recommendedSchedule === 'weekly' ? ' (recommended)' : ''}
            </option>
          </select>
        </div>

        {/* Pot Size Mismatch Warning */}
        {hasPotSizeMismatch && (
          <div className="property-group">
            <div style={{ 
              padding: '12px', 
              background: '#f6e05e', 
              color: '#1a202c',
              borderRadius: '6px',
              fontSize: '14px',
              marginTop: '8px'
            }}>
              <strong>⚠️ Pot Size Mismatch</strong>
              <div style={{ marginTop: '4px' }}>
                This plant has a <strong>{potSize}</strong> pot but the 
                cluster is optimized for <strong>{cluster.pot_size}</strong>.
              </div>
              <div style={{ marginTop: '6px', fontSize: '13px', opacity: 0.9 }}>
                Consider moving this plant to a cluster with matching pot size.
              </div>
            </div>
          </div>
        )}

        {/* Schedule Conflict Warning */}
        {hasScheduleConflict && (
          <div className="property-group">
            <div style={{ 
              padding: '12px', 
              background: '#f6e05e', 
              color: '#1a202c',
              borderRadius: '6px',
              fontSize: '14px',
              marginTop: '8px'
            }}>
              <strong>⚠️ Schedule Conflict</strong>
              <div style={{ marginTop: '4px' }}>
                This plant prefers <strong>{WATERING_GROUPS[schedule]}</strong> but the 
                cluster is set to <strong>{WATERING_GROUPS[cluster.watering_group]}</strong>.
              </div>
              <div style={{ marginTop: '6px', fontSize: '13px', opacity: 0.9 }}>
                Consider moving this plant to a cluster with matching schedule or adjusting its preference.
              </div>
            </div>
          </div>
        )}

        {/* Watering History */}
        {cluster && (
          <>
            <div className="divider"></div>
            
            <div className="property-group">
              <label>Recent Watering History</label>
              {wateringHistory.length === 0 && (
                <div className="property-value" style={{ fontSize: '14px', color: '#a0aec0' }}>
                  No watering events yet
                </div>
              )}
              {wateringHistory.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  {/* Simple chart visualization */}
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '6px',
                    maxHeight: '200px',
                    overflowY: 'auto'
                  }}>
                    {wateringHistory.map((event, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px',
                          background: 'var(--bg-light)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          fontSize: '13px'
                        }}
                      >
                        <span>{new Date(event.created_at).toLocaleDateString()}</span>
                        <span style={{ fontWeight: '600', color: '#4ec9b0' }}>
                          {event.ml} ml
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Simple bar chart */}
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0aec0', marginBottom: '8px' }}>
                      Volume Distribution
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'flex-end', 
                      gap: '4px',
                      height: '80px',
                      borderBottom: '1px solid #4a5568',
                      paddingBottom: '4px'
                    }}>
                      {wateringHistory.slice(0, 7).reverse().map((event, idx) => {
                        const maxMl = Math.max(...wateringHistory.map(e => e.ml));
                        const height = (event.ml / maxMl) * 100;
                        return (
                          <div
                            key={idx}
                            style={{
                              flex: 1,
                              height: `${height}%`,
                              background: '#4ec9b0',
                              borderRadius: '2px 2px 0 0',
                              minHeight: '4px',
                              position: 'relative'
                            }}
                            title={`${event.ml} ml on ${new Date(event.created_at).toLocaleDateString()}`}
                          />
                        );
                      })}
                    </div>
                    <div style={{ fontSize: '11px', color: '#718096', marginTop: '4px', textAlign: 'center' }}>
                      Last 7 waterings
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
