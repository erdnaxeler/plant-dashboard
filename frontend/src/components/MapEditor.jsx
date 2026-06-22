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
import BlockNode from './nodes/BlockNode';
import Toolbar from './Toolbar';
import LeftPanel from './LeftPanel';
import PropertiesPanel from './PropertiesPanel';
import { MapObjectsAPI, ConnectionsAPI, ClustersAPI, CatalogPlantsAPI } from '../hooks/useApi';
import './MapEditor.css';

const nodeTypes = {
  plant: PlantNode,
  waterer: WatererNode,
  room: RoomNode,
  garden: BlockNode,
  terrace: BlockNode,
  furniture: BlockNode,
};

// Types that participate in apartment-level snapping and wall merging.
// Furniture is deliberately not in this set — it's decoration, not
// architecture, and shouldn't snap or merge walls.
const STRUCTURAL_TYPES = new Set(['room', 'garden', 'terrace']);

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
    const otherRooms = nodes.filter((n) => STRUCTURAL_TYPES.has(n.type) && n.id !== roomId);

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
      if (allowResize) {
        // Resize case: keep left edge fixed, shrink/grow width to land right edge flush
        finalWidth = bestRight.newRight - x;
      } else {
        // Drag case: shift the whole room so right edge lands flush
        finalX = bestRight.newRight - width;
      }
      snappedX = true;
    }

    if (bestTop && (!bestBottom || bestTop.dist <= bestBottom.dist)) {
      if (allowResize) finalHeight += y - bestTop.newY;
      finalY = bestTop.newY;
      snappedY = true;
    } else if (bestBottom) {
      if (allowResize) {
        finalHeight = bestBottom.newBottom - y;
      } else {
        finalY = bestBottom.newBottom - height;
      }
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
    const otherRooms = nodes.filter((n) => STRUCTURAL_TYPES.has(n.type) && n.id !== roomId);
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
      const parseMetadata = (raw) => {
        if (!raw) return {};
        try {
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
          return {};
        }
      };

      const flowNodes = mapObjects.map(obj => {
        const metadata = parseMetadata(obj.metadata);
        return buildNodeFromMapObject(obj, metadata);
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

  // Live during drag: apply snap on every mousemove so the room visibly
  // "catches" against a neighbor as you slide it. Writes go to BOTH the
  // RF internal store (so the current render reflects the snap without
  // racing RF's own position updates) AND our React state (so the next
  // render's nodes prop doesn't sync the unsnapped value back into the
  // store and undo our correction).
  const onNodeDrag = useCallback((event, node) => {
    if (!STRUCTURAL_TYPES.has(node.type) || !reactFlowInstance) return;
    const snapped = getRoomSnapPosition(node, node.position.x, node.position.y);
    if (snapped.x !== node.position.x || snapped.y !== node.position.y) {
      const update = (nds) => nds.map((n) =>
        n.id === node.id ? { ...n, position: snapped } : n
      );
      reactFlowInstance.setNodes(update);
      setNodes(update);
    }
  }, [getRoomSnapPosition, reactFlowInstance, setNodes]);

  // Drag finished — apply one final snap pass (in case the live snap was
  // overwritten by React Flow's internal tracking on the last frame),
  // then persist to backend. Note: we write the correction via
  // reactFlowInstance.setNodes (which targets RF's internal Zustand store
  // directly) rather than useNodesState's setNodes. The latter lives in
  // a separate React state that's synced to the store via onNodesChange
  // — but during drag-end, RF's own updateNodePositions also writes a
  // raw-mouse position into the store via the same path, racing our
  // correction. Writing directly into the store avoids the race entirely
  // since both writes target the same backing value.
  const onNodeDragStop = useCallback(async (event, node) => {
    try {
      let finalX = node.position.x;
      let finalY = node.position.y;

      if (STRUCTURAL_TYPES.has(node.type) && reactFlowInstance) {
        const snapped = getRoomSnapPosition(node, node.position.x, node.position.y);
        finalX = snapped.x;
        finalY = snapped.y;
        if (finalX !== node.position.x || finalY !== node.position.y) {
          const update = (nds) => nds.map((n) =>
            n.id === node.id ? { ...n, position: { x: finalX, y: finalY } } : n
          );
          reactFlowInstance.setNodes(update);
          setNodes(update);
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
  }, [getRoomSnapPosition, reactFlowInstance, setNodes]);

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

  // Build a React Flow node from a backend MapObject, with the right
  // shape for each type. Shared by loadMapData, handleAddNode, and onDrop
  // so they can't drift apart.
  const buildNodeFromMapObject = useCallback((obj, overrides = {}) => {
    const base = {
      id: `node-${obj.id}`,
      type: obj.type,
      position: { x: obj.map_x ?? 0, y: obj.map_y ?? 0 },
    };

    if (obj.type === 'room') {
      return {
        ...base,
        style: { width: overrides.width ?? 400, height: overrides.height ?? 300 },
        zIndex: -1,
        data: {
          label: obj.name,
          objectId: obj.id,
          doors: overrides.doors ?? [],
          windows: overrides.windows ?? [],
        },
      };
    }

    if (obj.type === 'garden' || obj.type === 'terrace' || obj.type === 'furniture') {
      const defaultDims = obj.type === 'furniture' ? { width: 120, height: 80 } : { width: 400, height: 300 };
      return {
        ...base,
        style: { width: overrides.width ?? defaultDims.width, height: overrides.height ?? defaultDims.height },
        zIndex: obj.type === 'furniture' ? 0 : -1,
        data: {
          label: obj.name,
          objectId: obj.id,
          blockType: obj.type,
          rotation: overrides.rotation ?? 0,
        },
      };
    }

    // plant, waterer
    return {
      ...base,
      data: {
        label: obj.name,
        objectId: obj.id,
        clusterId: obj.cluster_id,
      },
    };
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
        garden: 'Garden',
        terrace: 'Terrace',
        furniture: 'Furniture',
      };
      const name = `${typeNames[type] || 'Object'} ${nodeIdCounter}`;
      const mapObject = await MapObjectsAPI.create(type, name, position.x, position.y);
      const newNode = buildNodeFromMapObject(mapObject);
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
          garden: 'Garden',
          terrace: 'Terrace',
          furniture: 'Furniture',
        };
        const name = `${typeNames[type] || 'Object'} ${nodeIdCounter}`;
        const mapObject = await MapObjectsAPI.create(type, name, position.x, position.y);
        const newNode = buildNodeFromMapObject(mapObject);

        setNodes((nds) => nds.concat(newNode));
        nodeIdCounter++;
        showToast(`${typeNames[type] || 'Object'} added`);
      } catch (error) {
        console.error('Failed to create object:', error);
        showToast('Failed to create object', true);
      }
    },
    [reactFlowInstance, setNodes, buildNodeFromMapObject]
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

  // Save garden/terrace/furniture metadata to backend (width/height/rotation).
  const saveBlockMetadata = async (objectId, style, rotation) => {
    try {
      const metadata = {
        width: style?.width,
        height: style?.height,
        rotation: rotation || 0,
      };
      await MapObjectsAPI.update(objectId, { metadata: JSON.stringify(metadata) });
    } catch (error) {
      console.error('Failed to save block metadata:', error);
      showToast('Failed to save changes', true);
    }
  };

  // Resize handler for garden/terrace blocks — same shape as room resize,
  // including edge-snap, since these participate in structural snapping.
  // Furniture doesn't use this (no resize for furniture).
  const handleBlockResize = useCallback(async (nodeId, x, y, width, height, direction) => {
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
      if (node.id === nodeId && STRUCTURAL_TYPES.has(node.type)) {
        const updatedNode = {
          ...node,
          position: { x: snapped.x, y: snapped.y },
          style: { ...node.style, width: snapped.width, height: snapped.height },
        };
        saveBlockMetadata(node.data.objectId, updatedNode.style, node.data.rotation);
        return updatedNode;
      }
      return node;
    }));

    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      try {
        await MapObjectsAPI.update(node.data.objectId, { x: snapped.x, y: snapped.y });
      } catch (error) {
        console.error('Failed to update block position after resize:', error);
      }
    }
  }, [snapRoomBoxToTouch, setNodes, nodes]);

  // Rotate handler for furniture — cycles 0 → 90 → 180 → 270 → 0.
  const handleBlockRotate = useCallback((nodeId, newRotation) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === nodeId && node.type === 'furniture') {
        const updatedNode = { ...node, data: { ...node.data, rotation: newRotation } };
        saveBlockMetadata(node.data.objectId, node.style, newRotation);
        return updatedNode;
      }
      return node;
    }));
  }, [setNodes]);

  // Furniture resize: no snap, no merge — just persist the new dimensions
  // and position. Used in place of handleBlockResize for furniture since
  // furniture isn't part of the structural snap system.
  const handleFurnitureResize = useCallback(async (nodeId, x, y, width, height) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === nodeId && node.type === 'furniture') {
        const updatedNode = {
          ...node,
          position: { x, y },
          style: { ...node.style, width, height },
        };
        saveBlockMetadata(node.data.objectId, updatedNode.style, node.data.rotation);
        return updatedNode;
      }
      return node;
    }));

    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      try {
        await MapObjectsAPI.update(node.data.objectId, { x, y });
      } catch (error) {
        console.error('Failed to update furniture position after resize:', error);
      }
    }
  }, [setNodes, nodes]);

  // Inject mode-aware callbacks/flags into each node's data right before
  // render. This is the one place that decides what's interactive —
  // Given one room and the full list of rooms, determine which of its
  // four edges are currently flush against another room's opposite edge.
  // Returns true for an edge IF this room should drop its border there —
  // that is, only the room with the *higher* id (lexicographically) drops
  // its border on a touching pair. The other room keeps its border, so
  // the visible wall is exactly one room's edge: continuous, same
  // thickness as any unmerged wall, no double line and no ghost gap.
  // Re-evaluated every render — drag either room even slightly and the
  // condition flips back to false on both rooms, restoring both borders.
  const TOUCH_TOLERANCE = 2; // px

  const getTouchingEdges = useCallback((room, allRooms) => {
    const width = room.width || room.style?.width || 400;
    const height = room.height || room.style?.height || 300;
    const left = room.position.x;
    const right = left + width;
    const top = room.position.y;
    const bottom = top + height;

    const dropBorder = { top: false, right: false, bottom: false, left: false };

    for (const other of allRooms) {
      if (other.id === room.id) continue;

      // Deterministic tie-breaker: only the room with the higher id drops
      // its border. Both rooms compute this from the same data so they
      // always agree on which one renders the shared wall.
      const thisDropsBorder = room.id > other.id;
      if (!thisDropsBorder) continue;

      const oWidth = other.width || other.style?.width || 400;
      const oHeight = other.height || other.style?.height || 300;
      const oLeft = other.position.x;
      const oRight = oLeft + oWidth;
      const oTop = other.position.y;
      const oBottom = oTop + oHeight;

      // Only drop a wall when the neighbour covers this edge *entirely*.
      // A CSS border is all-or-nothing — dropping it for a neighbour that
      // only overlaps part of the edge erases the non-shared portion too,
      // leaving an open gap (e.g. a room flush against a shorter terrace).
      // Requiring full span means a merge never produces a gap; partial
      // adjacency just keeps both walls (a harmless double line).
      const spansVertical = oTop <= top + TOUCH_TOLERANCE && oBottom >= bottom - TOUCH_TOLERANCE;
      const spansHorizontal = oLeft <= left + TOUCH_TOLERANCE && oRight >= right - TOUCH_TOLERANCE;

      if (spansVertical) {
        if (Math.abs(left - oRight) < TOUCH_TOLERANCE) dropBorder.left = true;
        if (Math.abs(right - oLeft) < TOUCH_TOLERANCE) dropBorder.right = true;
      }
      if (spansHorizontal) {
        if (Math.abs(top - oBottom) < TOUCH_TOLERANCE) dropBorder.top = true;
        if (Math.abs(bottom - oTop) < TOUCH_TOLERANCE) dropBorder.bottom = true;
      }
    }

    return dropBorder;
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
          touchingEdges: getTouchingEdges(node, nodes.filter((n) => STRUCTURAL_TYPES.has(n.type))),
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

    if (node.type === 'garden' || node.type === 'terrace') {
      // Structural blocks: snap + wall-merge with rooms and each other,
      // resizable, no doors/windows/rotation.
      return {
        ...node,
        draggable: isApartmentMode,
        selectable: isApartmentMode,
        data: {
          ...node.data,
          locked: !isApartmentMode,
          touchingEdges: getTouchingEdges(node, nodes.filter((n) => STRUCTURAL_TYPES.has(n.type))),
          onResize: isApartmentMode
            ? (x, y, width, height, direction) => handleBlockResize(node.id, x, y, width, height, direction)
            : undefined,
        },
      };
    }

    if (node.type === 'furniture') {
      // Decoration: freely placed inside rooms, no snap, no merge, 90°
      // rotation via the in-node button. Visible in both modes since
      // furniture is part of the apartment layout people set once.
      return {
        ...node,
        draggable: isApartmentMode,
        selectable: isApartmentMode,
        data: {
          ...node.data,
          locked: !isApartmentMode,
          onRotate: isApartmentMode
            ? (newRotation) => handleBlockRotate(node.id, newRotation)
            : undefined,
          onResize: isApartmentMode
            ? (x, y, width, height) => handleFurnitureResize(node.id, x, y, width, height)
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
          onNodeDrag={isApartmentMode ? onNodeDrag : undefined}
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
          // In apartment mode, don't let a selected node jump to the top of
          // the stack — otherwise selecting a room lifts it (zIndex -1) above
          // the furniture sitting inside it (zIndex 0). Keeping this off
          // preserves the room-below-furniture order while selected.
          elevateNodesOnSelect={!isApartmentMode}
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
