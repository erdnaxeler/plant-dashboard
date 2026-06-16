import React from 'react';
import { Handle, Position } from 'reactflow';
import './NodeStyles.css';

export default function PlantNode({ data }) {
  return (
    <div className="custom-node plant-node">
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
    </div>
  );
}
