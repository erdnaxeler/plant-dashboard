import React from 'react';
import './NodeStyles.css';

export default function RoomNode({ data }) {
  return (
    <div className="room-node">
      <div className="room-label">{data.label}</div>
    </div>
  );
}
