import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';

import PlantNode from './nodes/PlantNode';
import WatererNode from './nodes/WatererNode';
import RoomNode from './nodes/RoomNode';
import Toolbar from './Toolbar';
import LeftPanel from './LeftPanel';
import PropertiesPanel from './PropertiesPanel';
import { MapObjectsAPI, ConnectionsAPI, ClustersAPI, CatalogPlantsAPI } from '../hooks/useApi';
import './MapEditor.css';

const nodeTypes = {
  plant: PlantNode,
  waterer: WatererNode,
  room: RoomNode,
};

let nodeIdCounter = 1;

export default function MapEditor() {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [toasts, setToasts] = useState([]);
  // Describes the door/window placement-or-edit popup, or null if closed.
  // mode: 'create' (clicked empty wall) | 'edit' (right-clicked existing opening)
  const [openingPopup, setOpeningPopup] = useState(null);
  // { mode, nodeId, wall, offset, screenX, screenY, existingId?, existingType? }
  // mode: 'apartment' -> rooms are live/editable, plant+waterer nodes hidden
  //       'plants'    -> rooms are inert background, plant+waterer nodes live
  const [mode, setMode] = useState('plants');
  const isApartmentMode = mode === 'apartment';

  useEffect(() => {
    loadMapData();
  }, []);

  // --- Room snapping -------------------------------------------------
  // While dragging OR resizing a room, if one of its edges comes within
  // SNAP_THRESHOLD of another room's edge (and they overlap along the
  // perpendicular axis, so they'd actually share a wall rather than just
  // be diagonally close), snap that edge flush against the other room's
  // edge. Visual-only: each room stays its own independent rectangle,
  // they just end up touching with no gap instead of overlapping or
  // leaving a sliver of space.
  const SNAP_THRESHOLD = 16; // px, in flow coordinates — generous on purpose; snapping should be an ambient assist, not something you have to line up precisely to trigger

  // Given a candidate box {x, y, width, height} for one room, return a
  // snapped version of just the edges that moved (controlled via which*
  // flags), snapping each independently against every other room's
  // touching edge. allowResize controls whether a snap is permitted to
  // change width/height (true during resize) or must only move x/y
  // (false during a plain drag, where size must never change).
  const snapRoomBoxToTouch = useCallback((roomId, box, { snapLeft, snapRight, snapTop, snapBottom, allowResize }) => {
    const otherRooms = nodes.filter((n) => n.type === 'room' && n.id !== roomId);

    const { x, y, width, height } = box;
    const dLeft = x;
    const dRight = x + width;
    const dTop = y;
    const dBottom = y + height;

    // Collect every candidate snap across ALL neighbors first, instead of
    // applying the first one found — array order must never decide which
    // neighbor "wins" an axis. We then pick the single closest candidate
    // per axis (left/right share the X axis, top/bottom share Y), so
    // whichever neighbor is actually nearest is the one that fires,
    // regardless of where it sits in the nodes array.
    let bestLeft = null;   // { newX, dist }
    let bestRight = null;  // { newRight, dist }
    let bestTop = null;
    let bestBottom = null;

    for (const room of otherRooms) {
      const rWidth = room.width || room.style?.width || 400;
      const rHeight = room.height || room.style?.height || 300;
      const rLeft = room.position.x;
      const rRight = rLeft + rWidth;
      const rTop = room.position.y;
      const rBottom = rTop + rHeight;

      const verticalOverlap = dTop < rBottom && dBottom > rTop;
      const horizontalOverlap = dLeft < rRight && dRight > rLeft;

      if (snapLeft && verticalOverlap) {
        const dist = Math.abs(dLeft - rRight);
        if (dist < SNAP_THRESHOLD && (!bestLeft || dist < bestLeft.dist)) {
          bestLeft = { newX: rRight, dist };
        }
      }
      if (snapRight && verticalOverlap) {
        const dist = Math.abs(dRight - rLeft);
        if (dist < SNAP_THRESHOLD && (!bestRight || dist < bestRight.dist)) {
          bestRight = { newRight: rLeft, dist };
        }
      }
      if (snapTop && horizontalOverlap) {
        const dist = Math.abs(dTop - rBottom);
        if (dist < SNAP_THRESHOLD && (!bestTop || dist < bestTop.dist)) {
          bestTop = { newY: rBottom, dist };
        }
      }
      if (snapBottom && horizontalOverlap) {
        const dist = Math.abs(dBottom - rTop);
        if (dist < SNAP_THRESHOLD && (!bestBottom || dist < bestBottom.dist)) {
          bestBottom = { newBottom: rTop, dist };
        }
      }
    }

    let finalX = x, finalY = y, finalWidth = width, finalHeight = height;
    let snappedX = false, snappedY = false;

    // X axis: left and right can't both fire (a room can't snap on two
    // opposite edges to two different neighbors at once without resizing
    // unrealistically) — prefer whichever is closer.
    if (bestLeft && (!bestRight || bestLeft.dist <= bestRight.dist)) {
      if (allowResize) finalWidth += x - bestLeft.newX;
      finalX = bestLeft.newX;
      snappedX = true;
    } else if (bestRight) {
      if (allowResize) finalWidth = bestRight.newRight - x;
      snappedX = true;
    }

    if (bestTop && (!bestBottom || bestTop.dist <= bestBottom.dist)) {
      if (allowResize) finalHeight += y - bestTop.newY;
      finalY = bestTop.newY;
      snappedY = true;
    } else if (bestBottom) {
      if (allowResize) finalHeight = bestBottom.newBottom - y;
      snappedY = true;
    }

    return { x: finalX, y: finalY, width: finalWidth, height: finalHeight, snappedX, snappedY };
  }, [nodes]);

  // Second pass: alignment snap. While sliding a room past a neighbor
  // (not necessarily touching it), snap edges into level alignment —
  // e.g. the room's top edge catches when it lines up with a neighbor's
  // top edge, even though the rooms aren't adjacent. Only fills in axes
  // that the touch-snap pass above didn't already resolve, so the two
  // don't fight each other.
  const snapRoomBoxToAlign = useCallback((roomId, box, { skipX, skipY }) => {
    const otherRooms = nodes.filter((n) => n.type === 'room' && n.id !== roomId);
    let { x, y, width, height } = box;

    if (!skipX) {
      let bestX = null; // { value, dist }
      for (const room of otherRooms) {
        const rWidth = room.width || room.style?.width || 400;
        const rLeft = room.position.x;
        const rRight = rLeft + rWidth;

        const leftDist = Math.abs(x - rLeft);
        if (leftDist < SNAP_THRESHOLD && (!bestX || leftDist < bestX.dist)) {
          bestX = { value: rLeft, dist: leftDist };
        }
        const rightDist = Math.abs((x + width) - rRight);
        if (rightDist < SNAP_THRESHOLD && (!bestX || rightDist < bestX.dist)) {
          bestX = { value: rRight - width, dist: rightDist };
        }
      }
      if (bestX) x = bestX.value;
    }

    if (!skipY) {
      let bestY = null;
      for (const room of otherRooms) {
        const rHeight = room.height || room.style?.height || 300;
        const rTop = room.position.y;
        const rBottom = rTop + rHeight;

        const topDist = Math.abs(y - rTop);
        if (topDist < SNAP_THRESHOLD && (!bestY || topDist < bestY.dist)) {
          bestY = { value: rTop, dist: topDist };
        }
        const bottomDist = Math.abs((y + height) - rBottom);
        if (bottomDist < SNAP_THRESHOLD && (!bestY || bottomDist < bestY.dist)) {
          bestY = { value: rBottom - height, dist: bottomDist };
        }
      }
      if (bestY) y = bestY.value;
    }

    return { x, y, width, height };
  }, [nodes]);

  // Plain-drag convenience wrapper: only the position moves, size is fixed.
  // Runs touch-snap first (catches edges flush against a neighbor), then
  // alignment-snap on whichever axis touch-snap didn't already resolve
  // (catches edges lining up with a neighbor while sliding past it).
  const getRoomSnapPosition = useCallback((draggedNode, proposedX, proposedY) => {
    const width = draggedNode.width || draggedNode.style?.width || 400;
    const height = draggedNode.height || draggedNode.style?.height || 300;

    const touchSnapped = snapRoomBoxToTouch(
      draggedNode.id,
      { x: proposedX, y: proposedY, width, height },
      { snapLeft: true, snapRight: true, snapTop: true, snapBottom: true, allowResize: false }
    );

    const aligned = snapRoomBoxToAlign(
      draggedNode.id,
      { x: touchSnapped.x, y: touchSnapped.y, width, height },
      { skipX: touchSnapped.snappedX, skipY: touchSnapped.snappedY }
    );

    return { x: aligned.x, y: aligned.y };
  }, [snapRoomBoxToTouch, snapRoomBoxToAlign]);


  const loadMapData = async () => {
    try {
      const [mapObjects, connections, clustersData] = await Promise.all([
        MapObjectsAPI.getAll(),
        ConnectionsAPI.getAll(),
        ClustersAPI.getAll(),
      ]);

      // Convert all objects (rooms, plants, waterers) into one unified
      // React Flow nodes array. Rooms carry their door/window/size data
      // in `data`; mode-driven interactivity (locked/draggable/etc.) is
      // applied separately in the `nodes` effect below, not here, so we
      // don't have to re-fetch on every mode switch.
      const flowNodes = mapObjects.map(obj => {
        if (obj.type === 'room') {
          let doors = [];
          let windows = [];
          let width = 400;
          let height = 300;

          if (obj.metadata) {
            try {
              const metadata = typeof obj.metadata === 'string' ? JSON.parse(obj.metadata) : obj.metadata;
              doors = metadata.doors || [];
              windows = metadata.windows || [];
              width = metadata.width || 400;
              height = metadata.height || 300;
            } catch (e) {
              // Use defaults
            }
          }

          return {
            id: `node-${obj.id}`,
            type: 'room',
            position: { x: obj.map_x || 0, y: obj.map_y || 0 },
            style: { width, height },
            zIndex: -1, // always render beneath plant/waterer nodes
            data: {
              label: obj.name,
              objectId: obj.id,
              doors,
              windows,
            },
          };
        }

        return {
          id: `node-${obj.id}`,
          type: obj.type,
          position: { x: obj.map_x || 0, y: obj.map_y || 0 },
          data: {
            label: obj.name,
            objectId: obj.id,
            clusterId: obj.cluster_id,
          },
        };
      });

      // Convert Connections to React Flow edges
      const flowEdges = connections.map(conn => ({
        id: `edge-${conn.id}`,
        source: `node-${conn.from_object_id}`,
        target: `node-${conn.to_object_id}`,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
        data: { connectionId: conn.id },
      }));

      setNodes(flowNodes);
      setEdges(flowEdges);
      setClusters(clustersData);

      // Update node ID counter
      if (mapObjects.length > 0) {
        nodeIdCounter = Math.max(...mapObjects.map(obj => obj.id)) + 1;
      }
    } catch (error) {
      console.error('Failed to load map data:', error);
      showToast('Failed to load map data', true);
    }
  };

  const showToast = (message, isError = false) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, isError }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const onConnect = useCallback(async (params) => {
    try {
      // Get source and target object IDs
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);

      if (!sourceNode || !targetNode) return;

      const fromObjectId = sourceNode.data.objectId;
      const toObjectId = targetNode.data.objectId;

      // Create connection in backend
      const connection = await ConnectionsAPI.create(fromObjectId, toObjectId);

      // Add edge to flow
      const newEdge = {
        id: `edge-${connection.id}`,
        source: params.source,
        target: params.target,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
        data: { connectionId: connection.id },
      };

      setEdges((eds) => addEdge(newEdge, eds));
      
      // Reload clusters to reflect new cluster formation
      const clustersData = await ClustersAPI.getAll();
      setClusters(clustersData);
      
      showToast('Connection created');
    } catch (error) {
      console.error('Failed to create connection:', error);
      showToast(error.response?.data?.error || 'Failed to create connection', true);
    }
  }, [nodes]);

  // Snapping is applied only at drag-END, not live during the drag. React
  // Flow tracks drag position internally via its own mutable ref
  // (dragItems.current) that's updated every mousemove BEFORE our
  // onNodeDrag callback runs — so a live correction we apply via setNodes
  // gets silently overwritten by React Flow's own tracking on the very
  // next frame, since that ref has no idea we corrected anything. This
  // produced exactly the inconsistent/"sometimes snaps" behavior we saw:
  // it only stuck if you happened to release the mouse before another
  // mousemove could stomp it. Snapping once at drag-end avoids the fight
  // entirely — same approach already used for room resizing.
  const onNodeDragStop = useCallback(async (event, node) => {
    try {
      let finalX = node.position.x;
      let finalY = node.position.y;

      if (node.type === 'room') {
        const snapped = getRoomSnapPosition(node, node.position.x, node.position.y);
        finalX = snapped.x;
        finalY = snapped.y;
        if (finalX !== node.position.x || finalY !== node.position.y) {
          setNodes((nds) => nds.map((n) =>
            n.id === node.id ? { ...n, position: { x: finalX, y: finalY } } : n
          ));
        }
      }

      const objectId = node.data.objectId;
      await MapObjectsAPI.update(objectId, {
        x: finalX,
        y: finalY,
      });
    } catch (error) {
      console.error('Failed to update position:', error);
      showToast('Failed to update position', true);
    }
  }, [getRoomSnapPosition, setNodes]);

  // Fired instead of onNodeDragStop when a multi-node selection (made via
  // Shift+drag box-select) is dragged together — persist every node's
  // final position in parallel.
  const onSelectionDragStop = useCallback(async (event, draggedNodes) => {
    try {
      await Promise.all(
        draggedNodes.map((node) =>
          MapObjectsAPI.update(node.data.objectId, {
            x: node.position.x,
            y: node.position.y,
          })
        )
      );
    } catch (error) {
      console.error('Failed to update positions:', error);
      showToast('Failed to save positions', true);
    }
  }, []);

  const onNodesDelete = useCallback(async (deletedNodes) => {
    try {
      for (const node of deletedNodes) {
        const objectId = node.data.objectId;
        await MapObjectsAPI.delete(objectId);
      }
      showToast('Object deleted');
      
      // Reload clusters
      const clustersData = await ClustersAPI.getAll();
      setClusters(clustersData);
    } catch (error) {
      console.error('Failed to delete node:', error);
      showToast('Failed to delete object', true);
    }
  }, []);

  const onEdgesDelete = useCallback(async (deletedEdges) => {
    try {
      for (const edge of deletedEdges) {
        const connectionId = edge.data?.connectionId;
        if (connectionId) {
          await ConnectionsAPI.delete(connectionId);
        }
      }
      showToast('Connection deleted');
      
      // Reload clusters
      const clustersData = await ClustersAPI.getAll();
      setClusters(clustersData);
    } catch (error) {
      console.error('Failed to delete edge:', error);
      showToast('Failed to delete connection', true);
    }
  }, []);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    if (selectedNodes.length > 0) {
      setSelectedNode(selectedNodes[0]);
    } else {
      setSelectedNode(null);
    }
  }, []);

  const handleAddNode = useCallback(async (type) => {
    if (!reactFlowInstance) return;

    const position = reactFlowInstance.project({
      x: window.innerWidth / 2 - 120,
      y: window.innerHeight / 2 - 24,
    });

    try {
      const typeNames = {
        plant: 'Plant',
        waterer: 'Waterer',
        room: 'Room',
      };
      const name = `${typeNames[type] || 'Object'} ${nodeIdCounter}`;
      const mapObject = await MapObjectsAPI.create(type, name, position.x, position.y);

      const newNode = type === 'room'
        ? {
            id: `node-${mapObject.id}`,
            type: 'room',
            position: { x: mapObject.map_x, y: mapObject.map_y },
            style: { width: 400, height: 300 },
            zIndex: -1,
            data: {
              label: mapObject.name,
              objectId: mapObject.id,
              doors: [],
              windows: [],
            },
          }
        : {
            id: `node-${mapObject.id}`,
            type: type,
            position: { x: mapObject.map_x, y: mapObject.map_y },
            data: {
              label: mapObject.name,
              objectId: mapObject.id,
              clusterId: mapObject.cluster_id,
            },
          };
      setNodes((nds) => nds.concat(newNode));

      nodeIdCounter++;
      showToast(`${typeNames[type] || 'Object'} added`);
    } catch (error) {
      console.error('Failed to create object:', error);
      showToast('Failed to create object', true);
    }
  }, [reactFlowInstance, setNodes]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    async (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type || !reactFlowInstance) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      try {
        const typeNames = {
          plant: 'Plant',
          waterer: 'Waterer',
          room: 'Room',
          door: 'Door',
          window: 'Window',
        };
        const name = `${typeNames[type] || 'Object'} ${nodeIdCounter}`;
        const mapObject = await MapObjectsAPI.create(type, name, position.x, position.y);

        const newNode = type === 'room'
          ? {
              id: `node-${mapObject.id}`,
              type: 'room',
              position: { x: mapObject.map_x, y: mapObject.map_y },
              style: { width: 400, height: 300 },
              zIndex: -1,
              data: {
                label: mapObject.name,
                objectId: mapObject.id,
                doors: [],
                windows: [],
              },
            }
          : {
              id: `node-${mapObject.id}`,
              type: type,
              position: { x: mapObject.map_x, y: mapObject.map_y },
              data: {
                label: mapObject.name,
                objectId: mapObject.id,
                clusterId: mapObject.cluster_id,
              },
            };

        setNodes((nds) => nds.concat(newNode));
        nodeIdCounter++;
        showToast(`${typeNames[type] || 'Object'} added`);
      } catch (error) {
        console.error('Failed to create object:', error);
        showToast('Failed to create object', true);
      }
    },
    [reactFlowInstance, setNodes]
  );

  const handleDeleteNode = useCallback(async () => {
    if (!selectedNode) return;

    try {
      const objectId = selectedNode.data.objectId;
      await MapObjectsAPI.delete(objectId);
      
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
      setSelectedNode(null);
      showToast('Object deleted');
      
      // Reload clusters
      const clustersData = await ClustersAPI.getAll();
      setClusters(clustersData);
    } catch (error) {
      console.error('Failed to delete node:', error);
      showToast('Failed to delete object', true);
    }
  }, [selectedNode, setNodes]);

  const handleClusterUpdate = useCallback(async () => {
    try {
      const clustersData = await ClustersAPI.getAll();
      setClusters(clustersData);
      
      // Reload map data to get updated cluster associations and node labels
      await loadMapData();
    } catch (error) {
      console.error('Failed to reload clusters:', error);
      showToast('Failed to reload clusters', true);
    }
  }, []);

  const getNodeCluster = useCallback(() => {
    if (!selectedNode) return null;
    const clusterId = selectedNode.data.clusterId;
    return clusters.find(c => c.id === clusterId);
  }, [selectedNode, clusters]);

  const getConnectedPlants = useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'waterer') return [];
    
    // Find all edges connected to this waterer
    const connectedEdges = edges.filter(edge => 
      edge.source === selectedNode.id || edge.target === selectedNode.id
    );
    
    // Get plant node IDs from those edges
    const plantNodeIds = connectedEdges.map(edge => 
      edge.source === selectedNode.id ? edge.target : edge.source
    );
    
    // Get the actual plant nodes
    const plantNodes = nodes.filter(node => 
      plantNodeIds.includes(node.id) && node.type === 'plant'
    );
    
    // Return as plain objects with useful info
    return plantNodes.map(node => ({
      id: node.data.objectId,
      name: node.data.label,
      nodeId: node.id
    }));
  }, [selectedNode, edges, nodes]);

  const handleZoomIn = () => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomOut();
    }
  };

  const handleFitView = () => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.2 });
    }
  };

  // --- Door/window placement & editing --------------------------------
  // Clicking an empty spot on a wall, or right-clicking an existing
  // door/window, opens a small popup (rendered by MapEditor, positioned
  // at the click) offering Door / Window / (Delete, if editing). This
  // replaces the old "activate a tool, then click a thin invisible
  // strip" model — RoomNode just reports where on which wall something
  // happened; MapEditor owns the popup and all the offset math, done in
  // flow coordinates via reactFlowInstance so it stays correct at any
  // zoom level.

  // Called by RoomNode when an empty wall spot is clicked.
  const handleWallClick = useCallback((nodeId, wall, offset, screenX, screenY) => {
    setOpeningPopup({ mode: 'create', nodeId, wall, offset, screenX, screenY });
  }, []);

  // Called by RoomNode when an existing door/window is right-clicked.
  const handleOpeningContextMenu = useCallback((nodeId, type, opening, screenX, screenY) => {
    setOpeningPopup({
      mode: 'edit',
      nodeId,
      wall: opening.wall,
      offset: opening.offset,
      screenX,
      screenY,
      existingId: opening.id,
      existingType: type,
    });
  }, []);

  const closeOpeningPopup = useCallback(() => setOpeningPopup(null), []);

  // Add a new door/window, or convert an existing one to the other type,
  // at the wall/offset stored in openingPopup.
  const handleChooseOpeningType = useCallback((type) => {
    if (!openingPopup) return;
    const { nodeId, wall, offset, existingId, existingType } = openingPopup;

    setNodes((nds) => nds.map((node) => {
      if (node.id !== nodeId || node.type !== 'room') return node;

      let doors = node.data.doors || [];
      let windows = node.data.windows || [];

      // If editing an existing opening, remove it first (whether we're
      // converting it to a different type or re-saving the same type).
      if (existingId) {
        if (existingType === 'door') doors = doors.filter((o) => o.id !== existingId);
        else windows = windows.filter((o) => o.id !== existingId);
      }

      const newOpening = { id: `${type}-${Date.now()}`, wall, offset };
      if (type === 'door') doors = [...doors, newOpening];
      else windows = [...windows, newOpening];

      const updatedNode = { ...node, data: { ...node.data, doors, windows } };
      saveRoomMetadata(node.data.objectId, updatedNode.data, node.style);
      return updatedNode;
    }));

    showToast(existingId ? `Changed to ${type}` : `${type === 'door' ? 'Door' : 'Window'} added`);
    setOpeningPopup(null);
  }, [openingPopup, setNodes]);

  // Delete the opening currently shown in the edit popup.
  const handleDeleteOpeningFromPopup = useCallback(() => {
    if (!openingPopup?.existingId) return;
    const { nodeId, existingId, existingType } = openingPopup;

    setNodes((nds) => nds.map((node) => {
      if (node.id !== nodeId || node.type !== 'room') return node;
      const openingKey = existingType === 'door' ? 'doors' : 'windows';
      const updatedOpenings = (node.data[openingKey] || []).filter((o) => o.id !== existingId);
      const updatedNode = { ...node, data: { ...node.data, [openingKey]: updatedOpenings } };
      saveRoomMetadata(node.data.objectId, updatedNode.data, node.style);
      return updatedNode;
    }));

    showToast(`${existingType === 'door' ? 'Door' : 'Window'} removed`);
    setOpeningPopup(null);
  }, [openingPopup, setNodes]);

  // Persist a door/window's new offset after dragging it along its wall
  const handleOpeningMove = useCallback((nodeId, type, openingId, newOffset) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === nodeId && node.type === 'room') {
        const openingKey = type === 'door' ? 'doors' : 'windows';
        const openings = node.data[openingKey] || [];
        const updatedOpenings = openings.map((o) =>
          o.id === openingId ? { ...o, offset: newOffset } : o
        );

        const updatedNode = {
          ...node,
          data: {
            ...node.data,
            [openingKey]: updatedOpenings,
          },
        };

        saveRoomMetadata(node.data.objectId, updatedNode.data, node.style);
        return updatedNode;
      }
      return node;
    }));
  }, [setNodes]);

  // Save room metadata to backend
  const saveRoomMetadata = async (objectId, data, style) => {
    try {
      const metadata = {
        doors: data.doors || [],
        windows: data.windows || [],
        width: style?.width,
        height: style?.height,
      };
      await MapObjectsAPI.update(objectId, { metadata: JSON.stringify(metadata) });
    } catch (error) {
      console.error('Failed to save room metadata:', error);
      showToast('Failed to save changes', true);
    }
  };

  // Switch between apartment-editing mode and plants mode
  const handleSetMode = useCallback((newMode) => {
    setMode(newMode);
    if (newMode === 'plants') {
      // Leaving apartment editing: close any open door/window popup
      setOpeningPopup(null);
    }
    showToast(newMode === 'apartment' ? 'Editing apartment layout' : 'Apartment locked');
  }, []);

  // Persist a room resize (called from RoomNode's NodeResizer onResizeEnd).
  // Snaps the edge(s) that moved against any neighboring room before saving.
  const handleRoomResize = useCallback(async (nodeId, x, y, width, height, direction) => {
    const dir = direction || [0, 0];
    const snapped = snapRoomBoxToTouch(
      nodeId,
      { x, y, width, height },
      {
        snapLeft: dir[0] === -1,
        snapRight: dir[0] === 1,
        snapTop: dir[1] === -1,
        snapBottom: dir[1] === 1,
        allowResize: true,
      }
    );

    setNodes((nds) => nds.map((node) => {
      if (node.id === nodeId && node.type === 'room') {
        const updatedNode = {
          ...node,
          position: { x: snapped.x, y: snapped.y },
          style: { ...node.style, width: snapped.width, height: snapped.height },
        };
        saveRoomMetadata(node.data.objectId, node.data, updatedNode.style);
        return updatedNode;
      }
      return node;
    }));

    // Position isn't part of metadata — it's map_x/map_y on the object itself
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      try {
        await MapObjectsAPI.update(node.data.objectId, { x: snapped.x, y: snapped.y });
      } catch (error) {
        console.error('Failed to update room position after resize:', error);
      }
    }
  }, [snapRoomBoxToTouch, setNodes, nodes]);

  // Inject mode-aware callbacks/flags into each node's data right before
  // render. This is the one place that decides what's interactive —
  // Given one room and the full list of rooms, determine which of its
  // four edges are currently flush against another room's opposite edge
  // (within a tight tolerance — tighter than SNAP_THRESHOLD, since this
  // is "are they touching right now" not "should they snap together").
  // Used purely for rendering: a touching edge gets no border, so two
  // adjacent rooms read as one continuous wall instead of a double line.
  // Recomputed fresh every render from current positions, so the instant
  // you drag either room even slightly, the condition goes false and
  // both edges get their borders back — "detaching" needs no explicit
  // unlink step, it's just the natural result of no longer being flush.
  const TOUCH_TOLERANCE = 2; // px — much tighter than SNAP_THRESHOLD; this is "touching", not "should snap toward touching"

  const getTouchingEdges = useCallback((room, allRooms) => {
    const width = room.width || room.style?.width || 400;
    const height = room.height || room.style?.height || 300;
    const left = room.position.x;
    const right = left + width;
    const top = room.position.y;
    const bottom = top + height;

    const touching = { top: false, right: false, bottom: false, left: false };

    for (const other of allRooms) {
      if (other.id === room.id) continue;
      const oWidth = other.width || other.style?.width || 400;
      const oHeight = other.height || other.style?.height || 300;
      const oLeft = other.position.x;
      const oRight = oLeft + oWidth;
      const oTop = other.position.y;
      const oBottom = oTop + oHeight;

      const verticalOverlap = top < oBottom && bottom > oTop;
      const horizontalOverlap = left < oRight && right > oLeft;

      if (verticalOverlap) {
        if (Math.abs(left - oRight) < TOUCH_TOLERANCE) touching.left = true;
        if (Math.abs(right - oLeft) < TOUCH_TOLERANCE) touching.right = true;
      }
      if (horizontalOverlap) {
        if (Math.abs(top - oBottom) < TOUCH_TOLERANCE) touching.top = true;
        if (Math.abs(bottom - oTop) < TOUCH_TOLERANCE) touching.bottom = true;
      }
    }

    return touching;
  }, []);

  // RoomNode and the plant/waterer nodes themselves stay dumb.
  const displayNodes = nodes.map((node) => {
    if (node.type === 'room') {
      return {
        ...node,
        draggable: isApartmentMode,
        selectable: isApartmentMode,
        data: {
          ...node.data,
          locked: !isApartmentMode,
          touchingEdges: getTouchingEdges(node, nodes.filter((n) => n.type === 'room')),
          onWallClick: isApartmentMode
            ? (wall, offset, screenX, screenY) => handleWallClick(node.id, wall, offset, screenX, screenY)
            : undefined,
          onOpeningContextMenu: isApartmentMode
            ? (type, opening, screenX, screenY) => handleOpeningContextMenu(node.id, type, opening, screenX, screenY)
            : undefined,
          onOpeningMove: isApartmentMode
            ? (type, id, newOffset) => handleOpeningMove(node.id, type, id, newOffset)
            : undefined,
          onResize: isApartmentMode
            ? (x, y, width, height, direction) => handleRoomResize(node.id, x, y, width, height, direction)
            : undefined,
        },
      };
    }
    // Plant/waterer nodes: hidden entirely while editing the apartment,
    // so the apartment tab really does show "only apartment stuff".
    return {
      ...node,
      hidden: isApartmentMode,
    };
  });

  return (
    <div className="map-editor">
      <Toolbar 
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitView={handleFitView}
        mode={mode}
        onSetMode={handleSetMode}
      />
      <LeftPanel 
        onAddNode={handleAddNode}
        apartmentMode={isApartmentMode}
      />
      {!isApartmentMode && (
        <PropertiesPanel 
          selectedNode={selectedNode}
          connectedPlants={getConnectedPlants()}
          onDelete={handleDeleteNode}
          cluster={getNodeCluster()}
          onClusterUpdate={handleClusterUpdate}
        />
      )}
      
      <div className="canvas-container" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={displayNodes}
          edges={isApartmentMode ? [] : edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={isApartmentMode ? undefined : onConnect}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStop={onSelectionDragStop}
          onNodesDelete={isApartmentMode ? undefined : onNodesDelete}
          onEdgesDelete={isApartmentMode ? undefined : onEdgesDelete}
          onSelectionChange={onSelectionChange}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onPaneClick={closeOpeningPopup}
          nodeTypes={nodeTypes}
          nodesConnectable={!isApartmentMode}
          fitView
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: true,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
          }}
        >
          <Controls />
          {!isApartmentMode && (
            <MiniMap 
              nodeColor={(node) => {
                if (node.type === 'plant') return '#4ec9b0';
                if (node.type === 'waterer') return '#569cd6';
                return '#444';
              }}
            />
          )}
          <Background variant="dots" gap={20} size={1} />
        </ReactFlow>

        {openingPopup && (
          <>
            {/* Invisible backdrop so clicking anywhere outside the popup closes it */}
            <div className="opening-popup-backdrop" onClick={closeOpeningPopup} />
            <div
              className="opening-popup"
              style={{ left: openingPopup.screenX, top: openingPopup.screenY }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="opening-popup-btn door"
                disabled={openingPopup.existingType === 'door'}
                onClick={() => handleChooseOpeningType('door')}
              >
                Door
              </button>
              <button
                className="opening-popup-btn window"
                disabled={openingPopup.existingType === 'window'}
                onClick={() => handleChooseOpeningType('window')}
              >
                Window
              </button>
              {openingPopup.existingId && (
                <button
                  className="opening-popup-btn delete"
                  onClick={handleDeleteOpeningFromPopup}
                >
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.isError ? 'error' : ''}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
