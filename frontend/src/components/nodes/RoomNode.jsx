import React from 'react';
import { Handle, Position } from 'reactflow';
import './NodeStyles.css';

export default function RoomNode({ data, selected }) {
  const doors = data.doors || [];
  const windows = data.windows || [];

  // Handle wall clicks to add door/window when in cursor mode
  const handleWallClick = (e, wall) => {
    e.stopPropagation();
    if (data.onWallClick) {
      const rect = e.currentTarget.getBoundingClientRect();
      let offset;
      
      if (wall === 'top' || wall === 'bottom') {
        offset = e.clientX - rect.left;
      } else {
        offset = e.clientY - rect.top;
      }
      
      data.onWallClick(wall, offset);
    }
  };

  // Handle door/window click for selection/deletion
  const handleOpeningClick = (e, type, id) => {
    e.stopPropagation();
    if (data.onOpeningClick) {
      data.onOpeningClick(type, id);
    }
  };

  return (
    <div className={`room-node ${selected ? 'selected' : ''}`}>
      {/* Render doors */}
      {doors.map((door) => (
        <div
          key={door.id}
          className={`door-opening ${door.wall}`}
          style={{
            [door.wall === 'top' || door.wall === 'bottom' ? 'left' : 'top']: `${door.offset}px`,
          }}
          onClick={(e) => handleOpeningClick(e, 'door', door.id)}
        />
      ))}
      
      {/* Render windows */}
      {windows.map((window) => (
        <div
          key={window.id}
          className={`window-opening ${window.wall}`}
          style={{
            [window.wall === 'top' || window.wall === 'bottom' ? 'left' : 'top']: `${window.offset}px`,
          }}
          onClick={(e) => handleOpeningClick(e, 'window', window.id)}
        >
          <div className="window-pane-divider" />
        </div>
      ))}

      {/* Invisible click areas for walls */}
      <div 
        className="wall-click-area top"
        onClick={(e) => handleWallClick(e, 'top')}
      />
      <div 
        className="wall-click-area right"
        onClick={(e) => handleWallClick(e, 'right')}
      />
      <div 
        className="wall-click-area bottom"
        onClick={(e) => handleWallClick(e, 'bottom')}
      />
      <div 
        className="wall-click-area left"
        onClick={(e) => handleWallClick(e, 'left')}
      />
      
      {/* Handles for ReactFlow connections */}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
