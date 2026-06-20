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
  const [cursorMode, setCursorMode] = useState(null); // null, 'door', or 'window'
  const [selectedOpening, setSelectedOpening] = useState(null); // {nodeId, type, id}
  // mode: 'apartment' -> rooms are live/editable, plant+waterer nodes hidden
  //       'plants'    -> rooms are inert background, plant+waterer nodes live
  const [mode, setMode] = useState('plants');
  const isApartmentMode = mode === 'apartment';

  useEffect(() => {
    loadMapData();
  }, []);

  // --- Room snapping -------------------------------------------------
  // While dragging a room, if one of its edges comes within SNAP_THRESHOLD
  // of another room's edge (and they overlap along the perpendicular axis,
  // so they'd actually share a wall rather than just be diagonally close),
  // snap that edge flush against the other room's edge. Visual-only: each
  // room stays its own independent rectangle, they just end up touching
  // with no gap instead of overlapping or leaving a sliver of space.
  const SNAP_THRESHOLD = 12; // px, in flow coordinates

  const getRoomSnapPosition = useCallback((draggedNode, proposedX, proposedY) => {
    const width = draggedNode.style?.width || draggedNode.width || 400;
    const height = draggedNode.style?.height || draggedNode.height || 300;

    const otherRooms = nodes.filter(
      (n) => n.type === 'room' && n.id !== draggedNode.id
    );

    let snappedX = proposedX;
    let snappedY = proposedY;
    let snappedHorizontally = false;
    let snappedVertically = false;

    const dLeft = proposedX;
    const dRight = proposedX + width;
    const dTop = proposedY;
    const dBottom = proposedY + height;

    for (const room of otherRooms) {
      const rWidth = room.style?.width || room.width || 400;
      const rHeight = room.style?.height || room.height || 300;
      const rLeft = room.position.x;
      const rRight = room.position.x + rWidth;
      const rTop = room.position.y;
      const rBottom = room.position.y + rHeight;

      // Vertical overlap check (needed for left/right wall snapping —
      // the rooms must overlap in Y for a shared vertical wall to make sense)
      const verticalOverlap = dTop < rBottom && dBottom > rTop;
      // Horizontal overlap check (needed for top/bottom wall snapping)
      const horizontalOverlap = dLeft < rRight && dRight > rLeft;

      if (!snappedHorizontally && verticalOverlap) {
        if (Math.abs(dRight - rLeft) < SNAP_THRESHOLD) {
          snappedX = rLeft - width; // dragged room's right edge -> room's left edge
          snappedHorizontally = true;
        } else if (Math.abs(dLeft - rRight) < SNAP_THRESHOLD) {
          snappedX = rRight; // dragged room's left edge -> room's right edge
          snappedHorizontally = true;
        }
      }

      if (!snappedVertically && horizontalOverlap) {
        if (Math.abs(dBottom - rTop) < SNAP_THRESHOLD) {
          snappedY = rTop - height; // dragged room's bottom edge -> room's top edge
          snappedVertically = true;
        } else if (Math.abs(dTop - rBottom) < SNAP_THRESHOLD) {
          snappedY = rBottom; // dragged room's top edge -> room's bottom edge
          snappedVertically = true;
        }
      }
    }

    return { x: snappedX, y: snappedY };
  }, [nodes]);

  // Fires continuously during a room drag — apply snapping live so the
  // room visibly "catches" against a neighbor before you release the mouse.
  const onNodeDrag = useCallback((event, node) => {
    if (node.type !== 'room') return;

    const snapped = getRoomSnapPosition(node, node.position.x, node.position.y);
    if (snapped.x !== node.position.x || snapped.y !== node.position.y) {
      setNodes((nds) => nds.map((n) =>
        n.id === node.id ? { ...n, position: snapped } : n
      ));
    }
  }, [getRoomSnapPosition, setNodes]);

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

  const onNodeDragStop = useCallback(async (event, node) => {
    try {
      const objectId = node.data.objectId;
      await MapObjectsAPI.update(objectId, {
        x: node.position.x,
        y: node.position.y,
      });
    } catch (error) {
      console.error('Failed to update position:', error);
      showToast('Failed to update position', true);
    }
  }, []);

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

  // Handle cursor mode toggle
  const handleCursorModeToggle = useCallback((mode) => {
    setCursorMode(prevMode => prevMode === mode ? null : mode);
  }, []);

  // Handle wall click to add door/window
  const handleWallClick = useCallback((nodeId, wall, offset) => {
    if (!cursorMode) return;
    
    setNodes((nds) => nds.map((node) => {
      if (node.id === nodeId && node.type === 'room') {
        const openings = node.data[cursorMode === 'door' ? 'doors' : 'windows'] || [];
        const newOpening = {
          id: `${cursorMode}-${Date.now()}`,
          wall,
          offset: Math.max(0, offset - 20), // Center the 40px opening
        };
        
        const updatedNode = {
          ...node,
          data: {
            ...node.data,
            [cursorMode === 'door' ? 'doors' : 'windows']: [...openings, newOpening],
          },
        };
        
        // Save to backend
        saveRoomMetadata(node.data.objectId, updatedNode.data, node.style);
        
        return updatedNode;
      }
      return node;
    }));
    
    showToast(`${cursorMode === 'door' ? 'Door' : 'Window'} added`);
  }, [cursorMode, setNodes]);

  // Handle opening click for selection/deletion
  const handleOpeningClick = useCallback((nodeId, type, openingId) => {
    setSelectedOpening({ nodeId, type, id: openingId });
  }, []);

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

  // Delete selected opening
  const handleDeleteOpening = useCallback(() => {
    if (!selectedOpening) return;
    
    setNodes((nds) => nds.map((node) => {
      if (node.id === selectedOpening.nodeId && node.type === 'room') {
        const openingKey = selectedOpening.type === 'door' ? 'doors' : 'windows';
        const openings = node.data[openingKey] || [];
        const updatedOpenings = openings.filter(o => o.id !== selectedOpening.id);
        
        const updatedNode = {
          ...node,
          data: {
            ...node.data,
            [openingKey]: updatedOpenings,
          },
        };
        
        // Save to backend
        saveRoomMetadata(node.data.objectId, updatedNode.data, node.style);
        
        return updatedNode;
      }
      return node;
    }));
    
    setSelectedOpening(null);
    showToast(`${selectedOpening.type === 'door' ? 'Door' : 'Window'} removed`);
  }, [selectedOpening, setNodes]);

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

  // Listen for delete key to remove selected opening
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' && selectedOpening) {
        handleDeleteOpening();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOpening, handleDeleteOpening]);

  // Switch between apartment-editing mode and plants mode
  const handleSetMode = useCallback((newMode) => {
    setMode(newMode);
    if (newMode === 'plants') {
      // Leaving apartment editing: drop any half-finished wall-tool state
      setCursorMode(null);
      setSelectedOpening(null);
    }
    showToast(newMode === 'apartment' ? 'Editing apartment layout' : 'Apartment locked');
  }, []);

  // Persist a room resize (called from RoomNode's NodeResizer onResizeEnd)
  const handleRoomResize = useCallback((nodeId, width, height) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === nodeId && node.type === 'room') {
        const updatedNode = {
          ...node,
          style: { ...node.style, width, height },
        };
        saveRoomMetadata(node.data.objectId, node.data, updatedNode.style);
        return updatedNode;
      }
      return node;
    }));
  }, [setNodes]);

  // Inject mode-aware callbacks/flags into each node's data right before
  // render. This is the one place that decides what's interactive —
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
          cursorMode: isApartmentMode ? cursorMode : null,
          onWallClick: isApartmentMode
            ? (wall, offset) => handleWallClick(node.id, wall, offset)
            : undefined,
          onOpeningClick: isApartmentMode
            ? (type, id) => handleOpeningClick(node.id, type, id)
            : undefined,
          onOpeningMove: isApartmentMode
            ? (type, id, newOffset) => handleOpeningMove(node.id, type, id, newOffset)
            : undefined,
          onResize: isApartmentMode
            ? (width, height) => handleRoomResize(node.id, width, height)
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
        cursorMode={cursorMode}
        onCursorModeToggle={handleCursorModeToggle}
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
