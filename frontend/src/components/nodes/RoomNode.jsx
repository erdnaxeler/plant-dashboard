import React from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import './NodeStyles.css';

export default function RoomNode({ data, selected }) {
  const doors = data.doors || [];
  const windows = data.windows || [];
  const locked = !!data.locked;

  // Handle wall clicks to add door/window when in cursor mode
  const handleWallClick = (e, wall) => {
    if (locked) return;
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
    if (locked) return;
    e.stopPropagation();
    if (data.onOpeningClick) {
      data.onOpeningClick(type, id);
    }
  };

  return (
    <div className={`room-node ${selected && !locked ? 'selected' : ''} ${locked ? 'locked' : ''}`}>
      {!locked && (
        <NodeResizer
          minWidth={120}
          minHeight={100}
          isVisible={selected}
          onResizeEnd={(_, params) => data.onResize && data.onResize(params.width, params.height)}
        />
      )}

      {/* Render doors */}
      {doors.map((door) => (
        <div
          key={door.id}
          className={`door-opening ${door.wall}`}
          style={{
            [door.wall === 'top' || door.wall === 'bottom' ? 'left' : 'top']: `${door.offset}px`,
            cursor: locked ? 'default' : 'pointer',
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
            cursor: locked ? 'default' : 'pointer',
          }}
          onClick={(e) => handleOpeningClick(e, 'window', window.id)}
        >
          <div className="window-pane-divider" />
        </div>
      ))}

      {/* Invisible click areas for walls - inert and unrendered once locked */}
      {!locked && (
        <>
          <div className="wall-click-area top" onClick={(e) => handleWallClick(e, 'top')} />
          <div className="wall-click-area right" onClick={(e) => handleWallClick(e, 'right')} />
          <div className="wall-click-area bottom" onClick={(e) => handleWallClick(e, 'bottom')} />
          <div className="wall-click-area left" onClick={(e) => handleWallClick(e, 'left')} />
        </>
      )}

      {/* Handles for ReactFlow connections - rooms don't connect to anything,
          kept only if you want to wire room-to-room adjacency later */}
      {!locked && (
        <>
          <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
          <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </>
      )}
    </div>
  );
}
