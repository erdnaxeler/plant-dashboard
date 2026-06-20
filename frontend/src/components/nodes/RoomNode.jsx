import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import './NodeStyles.css';

const OPENING_SIZE = 40; // keep in sync with offset math in MapEditor.jsx

export default function RoomNode({ data, selected }) {
  const doors = data.doors || [];
  const windows = data.windows || [];
  const locked = !!data.locked;
  const roomRef = useRef(null);

  // While dragging a door/window we track a live offset locally so the
  // UI is instantly responsive, then commit the final value on mouseup
  // rather than firing a save on every mousemove.
  const [dragState, setDragState] = useState(null); // { type, id, wall, offset, moved } | null
  const DRAG_THRESHOLD = 3; // px of movement before we treat it as a drag, not a click

  // Handle wall clicks to add door/window when in cursor mode
  const handleWallClick = (e, wall) => {
    if (locked || !data.cursorMode) return; // not placing a door/window — let the click through to select/drag the room
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

  // Handle door/window click for selection/deletion — ignored if the
  // preceding mousedown turned into a real drag (handled via dragState).
  const handleOpeningClick = (e, type, id) => {
    if (locked) return;
    e.stopPropagation();
    if (dragState?.moved) return; // this click is the tail end of a drag, not a selection
    if (data.onOpeningClick) {
      data.onOpeningClick(type, id);
    }
  };

  // Start dragging an existing door/window along its wall
  const handleOpeningMouseDown = (e, type, opening) => {
    if (locked || data.cursorMode) return; // don't drag while actively placing new ones
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
      // Clear the "just finished" marker after the click event has had a
      // chance to read dragState.moved and bail out.
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
          onResizeEnd={(_, params) => data.onResize && data.onResize(params.width, params.height)}
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
          onClick={(e) => handleOpeningClick(e, 'door', door.id)}
          onMouseDown={(e) => handleOpeningMouseDown(e, 'door', door)}
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
          onClick={(e) => handleOpeningClick(e, 'window', window.id)}
          onMouseDown={(e) => handleOpeningMouseDown(e, 'window', window)}
        >
          <div className="window-pane-divider" />
        </div>
      ))}

      {/* Invisible click areas for walls - only intercept clicks while
          actively placing a door/window, so they never block selecting
          or resizing the room the rest of the time */}
      {!locked && (
        <>
          <div className={`wall-click-area top ${data.cursorMode ? 'active-cursor nodrag' : ''}`} onClick={(e) => handleWallClick(e, 'top')} />
          <div className={`wall-click-area right ${data.cursorMode ? 'active-cursor nodrag' : ''}`} onClick={(e) => handleWallClick(e, 'right')} />
          <div className={`wall-click-area bottom ${data.cursorMode ? 'active-cursor nodrag' : ''}`} onClick={(e) => handleWallClick(e, 'bottom')} />
          <div className={`wall-click-area left ${data.cursorMode ? 'active-cursor nodrag' : ''}`} onClick={(e) => handleWallClick(e, 'left')} />
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
