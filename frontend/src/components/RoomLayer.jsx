import React from 'react';
import './RoomLayer.css';

export default function RoomLayer({ rooms, onRoomClick, isLocked }) {
  if (!rooms || rooms.length === 0) return null;

  return (
    <div className={`room-layer ${isLocked ? 'locked' : ''}`}>
      <svg className="room-layer-svg">
        {rooms.map((room) => {
          const doors = room.doors || [];
          const windows = room.windows || [];
          
          return (
            <g key={room.id} className="room-group">
              {/* Room rectangle */}
              <rect
                x={room.x}
                y={room.y}
                width={room.width}
                height={room.height}
                className="room-rect"
                onClick={(e) => !isLocked && onRoomClick && onRoomClick(room.id, e)}
              />
              
              {/* Doors */}
              {doors.map((door) => {
                const doorProps = getDoorPosition(door, room);
                return (
                  <rect
                    key={door.id}
                    {...doorProps}
                    className="room-door"
                  />
                );
              })}
              
              {/* Windows */}
              {windows.map((window) => {
                const windowProps = getWindowPosition(window, room);
                return (
                  <g key={window.id}>
                    <rect
                      {...windowProps}
                      className="room-window"
                    />
                    {/* Window pane divider */}
                    {window.wall === 'top' || window.wall === 'bottom' ? (
                      <line
                        x1={windowProps.x + 20}
                        y1={windowProps.y}
                        x2={windowProps.x + 20}
                        y2={windowProps.y + windowProps.height}
                        className="window-divider"
                      />
                    ) : (
                      <line
                        x1={windowProps.x}
                        y1={windowProps.y + 20}
                        x2={windowProps.x + windowProps.width}
                        y2={windowProps.y + 20}
                        className="window-divider"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function getDoorPosition(door, room) {
  const doorSize = 40;
  const wallThickness = 3;
  
  switch (door.wall) {
    case 'top':
      return {
        x: room.x + door.offset,
        y: room.y - wallThickness,
        width: doorSize,
        height: wallThickness,
      };
    case 'bottom':
      return {
        x: room.x + door.offset,
        y: room.y + room.height,
        width: doorSize,
        height: wallThickness,
      };
    case 'left':
      return {
        x: room.x - wallThickness,
        y: room.y + door.offset,
        width: wallThickness,
        height: doorSize,
      };
    case 'right':
      return {
        x: room.x + room.width,
        y: room.y + door.offset,
        width: wallThickness,
        height: doorSize,
      };
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function getWindowPosition(window, room) {
  const windowSize = 40;
  const wallThickness = 3;
  
  switch (window.wall) {
    case 'top':
      return {
        x: room.x + window.offset,
        y: room.y - wallThickness,
        width: windowSize,
        height: wallThickness,
      };
    case 'bottom':
      return {
        x: room.x + window.offset,
        y: room.y + room.height,
        width: windowSize,
        height: wallThickness,
      };
    case 'left':
      return {
        x: room.x - wallThickness,
        y: room.y + window.offset,
        width: wallThickness,
        height: windowSize,
      };
    case 'right':
      return {
        x: room.x + room.width,
        y: room.y + window.offset,
        width: wallThickness,
        height: windowSize,
      };
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}
