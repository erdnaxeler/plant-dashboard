import React from 'react';
import WatererPanel from './WatererPanel';
import PlantPanel from './PlantPanel';
import './PropertiesPanel.css';

export default function PropertiesPanel({
  selectedNode,
  connectedPlants,
  onDelete,
  cluster,
  onClusterUpdate,
  onNodeRefresh
}) {

  // No node selected - show empty state
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

  // Route to appropriate panel based on node type
  if (selectedNode.type === 'waterer') {
    return (
      <WatererPanel
        watererNode={selectedNode}
        connectedPlants={connectedPlants || []}
        cluster={cluster}
        onUpdate={onClusterUpdate}
        onDelete={onDelete}
      />
    );
  }

  if (selectedNode.type === 'plant') {
    return (
      <PlantPanel
        plantNode={selectedNode}
        cluster={cluster}
        onUpdate={onClusterUpdate}
        onNodeRefresh={onNodeRefresh}
        onDelete={onDelete}
      />
    );
  }

  // Fallback for unknown types
  return null;
}
