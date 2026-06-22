import React from 'react';
import './LeftPanel.css';

export default function LeftPanel({ onAddNode, apartmentMode }) {
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="left-panel">
      <div className="panel-section">
        <h3 className="panel-title">Objects</h3>
        <div className="tools-grid">
          {!apartmentMode && (
            <>
              <div
                className="tool-item plant-tool"
                draggable
                onDragStart={(e) => onDragStart(e, 'plant')}
                onClick={() => onAddNode('plant')}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8Z" />
                </svg>
                <span>Plant</span>
              </div>

              <div
                className="tool-item waterer-tool"
                draggable
                onDragStart={(e) => onDragStart(e, 'waterer')}
                onClick={() => onAddNode('waterer')}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12,3.77L11.25,4.61C11.25,4.61 9.97,6.06 8.68,7.94C7.39,9.82 6,12.07 6,14.23A6,6 0 0,0 12,20.23A6,6 0 0,0 18,14.23C18,12.07 16.61,9.82 15.32,7.94C14.03,6.06 12.75,4.61 12.75,4.61L12,3.77M12,6.9C12.44,7.42 12.84,7.85 13.68,9.07C14.89,10.83 16,13.07 16,14.23C16,16.45 14.22,18.23 12,18.23C9.78,18.23 8,16.45 8,14.23C8,13.07 9.11,10.83 10.32,9.07C11.16,7.85 11.56,7.42 12,6.9Z" />
                </svg>
                <span>Waterer</span>
              </div>
            </>
          )}

          {apartmentMode && (
            <>
              <div
                className="tool-item room-tool"
                draggable
                onDragStart={(e) => onDragStart(e, 'room')}
                onClick={() => onAddNode('room')}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                </svg>
                <span>Room</span>
              </div>

              <div
                className="tool-item garden-tool"
                draggable
                onDragStart={(e) => onDragStart(e, 'garden')}
                onClick={() => onAddNode('garden')}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="#5a8c5a" stroke="#5a8c5a" strokeWidth="1.5">
                  <rect x="4" y="4" width="16" height="16" rx="1" fill="#c8e0c5" />
                </svg>
                <span>Garden</span>
              </div>

              <div
                className="tool-item terrace-tool"
                draggable
                onDragStart={(e) => onDragStart(e, 'terrace')}
                onClick={() => onAddNode('terrace')}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="#6b6b6b" stroke="#2f2f2f" strokeWidth="1.5">
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                </svg>
                <span>Terrace</span>
              </div>

              <div
                className="tool-item furniture-tool"
                draggable
                onDragStart={(e) => onDragStart(e, 'furniture')}
                onClick={() => onAddNode('furniture')}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="#c69a6b" stroke="#7c5436" strokeWidth="1.5">
                  <rect x="4" y="7" width="16" height="10" rx="1" />
                </svg>
                <span>Furniture</span>
              </div>
            </>
          )}
        </div>
        <div className="panel-hint">
          {apartmentMode
            ? 'Drag onto canvas or click to add'
            : 'Drag onto canvas or click to add'}
        </div>
      </div>

      {apartmentMode && (
        <div className="panel-section">
          <h3 className="panel-title">Doors & Windows</h3>
          <div className="panel-hint">
            Hover a room's wall and click to add a door or window.
            Drag an existing one to reposition it, or right-click it to
            change its type or remove it.
          </div>
        </div>
      )}
    </div>
  );
}
