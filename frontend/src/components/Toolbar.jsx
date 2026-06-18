import React from 'react';
import './Toolbar.css';

export default function Toolbar({ onZoomIn, onZoomOut, onFitView, roomsLocked, onToggleRoomsLock }) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8Z" />
          </svg>
          <span>Map Editor</span>
        </div>
      </div>
      
      <div className="toolbar-right">
        <button 
          className={`toolbar-btn ${roomsLocked ? 'active' : ''}`}
          onClick={onToggleRoomsLock} 
          title={roomsLocked ? "Unlock Rooms" : "Lock Rooms"}
        >
          {roomsLocked ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10A2,2 0 0,1 6,8H15V6A3,3 0 0,0 12,3A3,3 0 0,0 9,6H7A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,17A2,2 0 0,0 14,15A2,2 0 0,0 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17Z" />
            </svg>
          )}
        </button>
        <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,13H5V11H19V13Z" />
          </svg>
        </button>
        <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
          </svg>
        </button>
        <button className="toolbar-btn" onClick={onFitView} title="Fit View">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9,3V4H4V9H3V3H9M4,11V13H3V11H4M11,3H13V4H11V3M4,15V17H3V15H4M15,3H17V4H15V3M4,19V20H9V21H3V19H4M19,3V9H20V3H19M11,20V21H13V20H11M15,20V21H17V20H15M20,11V13H21V11H20M20,15V17H21V15H20M20,19V21H14V20H20V19H21" />
          </svg>
        </button>
        <a href="/" className="toolbar-btn">Dashboard</a>
      </div>
    </div>
  );
}
