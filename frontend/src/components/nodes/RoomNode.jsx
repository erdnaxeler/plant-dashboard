import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import './NodeStyles.css';

const OPENING_SIZE = 40; // keep in sync with offset math in MapEditor.jsx

export default function RoomNode({ data, selected }) {
  const doors = data.doors || [];
  const windows = data.windows || [];
  const locked = !!data.locked;
  const roomRef = useRef(null);
  const lastResizeDirection = useRef([0, 0]);
  const { screenToFlowPosition } = useReactFlow();

  // While dragging a door/window we track a live offset locally so the
  // UI is instantly responsive, then commit the final value on mouseup
  // rather than firing a save on every mousemove.
  const [dragState, setDragState] = useState(null); // { type, id, wall, offset, moved } | null
  const DRAG_THRESHOLD = 3; // px of movement before we treat it as a drag, not a click

  // Click an empty spot on a wall to place a door/window there. The wall
  // hit-zones are always active (just hover-highlighted via CSS) — there's
  // no separate "tool" to turn on first. Offset is computed in *flow*
  // coordinates via screenToFlowPosition so placement stays correct at
  // any zoom/pan level, rather than relying on getBoundingClientRect()
  // (which is in screen pixels and drifts from the stored flow-space
  // offset as soon as you're not at 100% zoom).
  const handleWallClick = (e, wall) => {
    if (locked) return;
    e.stopPropagation();
    if (!data.onWallClick) return;

    const roomEl = roomRef.current;
    if (!roomEl) return;
    const roomRect = roomEl.getBoundingClientRect();
    const flowClick = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const flowRoomOrigin = screenToFlowPosition({ x: roomRect.left, y: roomRect.top });

    const isHorizontalWall = wall === 'top' || wall === 'bottom';
    const rawOffset = isHorizontalWall
      ? flowClick.x - flowRoomOrigin.x
      : flowClick.y - flowRoomOrigin.y;
    const offset = Math.max(0, rawOffset - OPENING_SIZE / 2);

    data.onWallClick(wall, offset, e.clientX, e.clientY);
  };

  // Right-click an existing door/window to reopen the same popup (now
  // pre-filled) so it can be converted to the other type or deleted.
  const handleOpeningContextMenu = (e, type, opening) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    if (data.onOpeningContextMenu) {
      data.onOpeningContextMenu(type, opening, e.clientX, e.clientY);
    }
  };

  // Start dragging an existing door/window along its wall
  const handleOpeningMouseDown = (e, type, opening) => {
    if (locked || e.button !== 0) return; // left-click only; right-click is handled by context menu
    e.stopPropagation();
    e.preventDefault();
    setDragState({
      type,
      id: opening.id,
      wall: opening.wall,
      offset: opening.offset,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e) => {
      const roomEl = roomRef.current;
      if (!roomEl) return;
      const rect = roomEl.getBoundingClientRect();
      const isHorizontalWall = dragState.wall === 'top' || dragState.wall === 'bottom';
      const wallLength = isHorizontalWall ? rect.width : rect.height;
      const raw = isHorizontalWall ? e.clientX - rect.left : e.clientY - rect.top;
      const clamped = Math.max(0, Math.min(raw - OPENING_SIZE / 2, wallLength - OPENING_SIZE));

      const movedPx = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);

      setDragState((prev) => prev && {
        ...prev,
        offset: clamped,
        moved: prev.moved || movedPx > DRAG_THRESHOLD,
      });
    };

    const handleMouseUp = () => {
      setDragState((prev) => {
        if (prev && prev.moved && data.onOpeningMove) {
          data.onOpeningMove(prev.type, prev.id, prev.offset);
        }
        return prev ? { ...prev, justFinished: true } : null;
      });
      setTimeout(() => setDragState(null), 0);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.id, dragState?.type]);

  // Resolve the offset to render for a given opening: live drag value if
  // it's the one being dragged, otherwise its stored value.
  const resolvedOffset = (type, opening) =>
    dragState && dragState.type === type && dragState.id === opening.id
      ? dragState.offset
      : opening.offset;

  return (
    <div className={`room-node ${selected && !locked ? 'selected' : ''} ${locked ? 'locked' : ''}`} ref={roomRef}>
      {!locked && (
        <NodeResizer
          minWidth={120}
          minHeight={100}
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

      {/* Render doors */}
      {doors.map((door) => (
        <div
          key={door.id}
          className={`door-opening nodrag ${door.wall} ${dragState?.id === door.id ? 'dragging' : ''}`}
          style={{
            [door.wall === 'top' || door.wall === 'bottom' ? 'left' : 'top']: `${resolvedOffset('door', door)}px`,
            cursor: locked ? 'default' : 'grab',
          }}
          onMouseDown={(e) => handleOpeningMouseDown(e, 'door', door)}
          onContextMenu={(e) => handleOpeningContextMenu(e, 'door', door)}
        />
      ))}
      
      {/* Render windows */}
      {windows.map((window) => (
        <div
          key={window.id}
          className={`window-opening nodrag ${window.wall} ${dragState?.id === window.id ? 'dragging' : ''}`}
          style={{
            [window.wall === 'top' || window.wall === 'bottom' ? 'left' : 'top']: `${resolvedOffset('window', window)}px`,
            cursor: locked ? 'default' : 'grab',
          }}
          onMouseDown={(e) => handleOpeningMouseDown(e, 'window', window)}
          onContextMenu={(e) => handleOpeningContextMenu(e, 'window', window)}
        >
          <div className="window-pane-divider" />
        </div>
      ))}

      {/* Wall hit-zones — always active when unlocked. Hover reveals a
          highlight + crosshair cursor via CSS; click opens the placement
          popup. No separate "tool" needs to be turned on first. */}
      {!locked && (
        <>
          <div className="wall-click-area nodrag top" onClick={(e) => handleWallClick(e, 'top')} />
          <div className="wall-click-area nodrag right" onClick={(e) => handleWallClick(e, 'right')} />
          <div className="wall-click-area nodrag bottom" onClick={(e) => handleWallClick(e, 'bottom')} />
          <div className="wall-click-area nodrag left" onClick={(e) => handleWallClick(e, 'left')} />
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
