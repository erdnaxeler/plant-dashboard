import React from 'react';
import { Handle, Position } from 'reactflow';
import './NodeStyles.css';

export default function WatererNode({ data }) {
  const hasCluster = data.clusterId != null;
  
  return (
    <div className={`custom-node waterer-node ${hasCluster ? 'has-cluster' : ''}`}>
      <Handle type="source" position={Position.Top} id="n" />
      <Handle type="source" position={Position.Right} id="e" />
      <Handle type="source" position={Position.Bottom} id="s" />
      <Handle type="source" position={Position.Left} id="w" />
      
      <div className="node-circle">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12,3.77L11.25,4.61C11.25,4.61 9.97,6.06 8.68,7.94C7.39,9.82 6,12.07 6,14.23A6,6 0 0,0 12,20.23A6,6 0 0,0 18,14.23C18,12.07 16.61,9.82 15.32,7.94C14.03,6.06 12.75,4.61 12.75,4.61L12,3.77M12,6.9C12.44,7.42 12.84,7.85 13.68,9.07C14.89,10.83 16,13.07 16,14.23C16,16.45 14.22,18.23 12,18.23C9.78,18.23 8,16.45 8,14.23C8,13.07 9.11,10.83 10.32,9.07C11.16,7.85 11.56,7.42 12,6.9Z" />
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
