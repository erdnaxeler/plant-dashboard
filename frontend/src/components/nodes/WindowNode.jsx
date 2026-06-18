import React from 'react';
import './NodeStyles.css';

export default function WindowNode({ data }) {
  return (
    <div className="window-node">
      <div className="window-line">
        <div className="window-pane"></div>
        <div className="window-pane"></div>
      </div>
    </div>
  );
}
