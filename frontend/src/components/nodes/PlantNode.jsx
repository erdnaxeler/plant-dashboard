import React from 'react';
import { Handle, Position } from 'reactflow';
import './NodeStyles.css';

export default function PlantNode({ data }) {
  const hasCluster = data.clusterId != null;
  
  return (
    <div className={`custom-node plant-node ${hasCluster ? 'has-cluster' : ''}`}>
      <Handle type="target" position={Position.Top} id="n" />
      <Handle type="target" position={Position.Right} id="e" />
      <Handle type="target" position={Position.Bottom} id="s" />
      <Handle type="target" position={Position.Left} id="w" />
      
      <div className="node-circle">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8Z" />
        </svg>
      </div>
      
      <div className="node-label">{data.label}</div>
      
      {hasCluster && (
        <div className="node-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M15,12C15,13.66 13.66,15 12,15C10.34,15 9,13.66 9,12C9,10.34 10.34,9 12,9C13.66,9 15,10.34 15,12Z" />
          </svg>
        </div>
      )}
    </div>
  );
}
