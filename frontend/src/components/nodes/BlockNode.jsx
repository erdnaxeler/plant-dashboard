import React, { useRef } from 'react';
import { NodeResizer } from 'reactflow';
import './NodeStyles.css';

// BlockNode handles garden, terrace, and furniture — the three "block"
// types that are simpler than rooms (no doors, no windows, no wall-click
// areas, no per-edge merge complexity beyond border-drop).
//
// Garden and terrace participate in apartment-level snap + wall-merging
// alongside rooms (driven by their type being in the structural-types
// set in MapEditor). Furniture doesn't snap and supports 90° rotation
// via a small toolbar button that appears when selected.
export default function BlockNode({ data, selected }) {
  const locked = !!data.locked;
  const blockType = data.blockType; // 'garden' | 'terrace' | 'furniture'
  const rotation = data.rotation || 0; // 0 | 90 | 180 | 270
  const lastResizeDirection = useRef([0, 0]);

  const dropBorder = data.touchingEdges || {};
  const borderStyle = {
    borderTopWidth: dropBorder.top ? 0 : undefined,
    borderRightWidth: dropBorder.right ? 0 : undefined,
    borderBottomWidth: dropBorder.bottom ? 0 : undefined,
    borderLeftWidth: dropBorder.left ? 0 : undefined,
  };

  // Furniture rotates as a unit; the underlying node bounding box stays
  // axis-aligned (so at 90/180/270 it tightly fits, at arbitrary angles
  // it would not — but we only allow 90° increments via the toolbar).
  const innerStyle = {
    ...borderStyle,
    transform: blockType === 'furniture' && rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: 'center center',
  };

  const handleRotate = (e) => {
    e.stopPropagation();
    if (data.onRotate) {
      data.onRotate((rotation + 90) % 360);
    }
  };

  return (
    <div
      className={`block-node block-${blockType} ${selected && !locked ? 'selected' : ''} ${locked ? 'locked' : ''}`}
      style={innerStyle}
    >
      {!locked && (
        // All block types resize via NodeResizer. Garden/terrace resizes
        // trigger snap logic on the MapEditor side; furniture resizes
        // just persist new dimensions without snapping (since furniture
        // doesn't participate in the structural snap system).
        <NodeResizer
          minWidth={40}
          minHeight={40}
          isVisible={selected}
          onResize={(_, params) => {
            lastResizeDirection.current = params.direction || [0, 0];
          }}
          onResizeEnd={(_, params) => {
            if (data.onResize) {
              data.onResize(params.x, params.y, params.width, params.height, lastResizeDirection.current);
            }
          }}
        />
      )}

      {!locked && blockType === 'furniture' && (
        // Furniture-specific: a small rotate button in the corner, only
        // visible when selected. Click cycles 0 → 90 → 180 → 270 → 0.
        // Marked `nodrag` so clicking it doesn't also start dragging.
        <button
          className="block-rotate-btn nodrag"
          onClick={handleRotate}
          title={`Rotate (currently ${rotation}°)`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
        </button>
      )}
    </div>
  );
}
