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
import RoomLayer from './RoomLayer';
import Toolbar from './Toolbar';
import LeftPanel from './LeftPanel';
import PropertiesPanel from './PropertiesPanel';
import { MapObjectsAPI, ConnectionsAPI, ClustersAPI, CatalogPlantsAPI } from '../hooks/useApi';
import './MapEditor.css';

const nodeTypes = {
  plant: PlantNode,
  waterer: WatererNode,
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
  const [rooms, setRooms] = useState([]); // Rooms as background layer
  const [roomsLocked, setRoomsLocked] = useState(false); // Lock/unlock rooms

  useEffect(() => {
    loadMapData();
  }, []);

  const loadMapData = async () => {
    try {
      const [mapObjects, connections, clustersData] = await Promise.all([
        MapObjectsAPI.getAll(),
        ConnectionsAPI.getAll(),
        ClustersAPI.getAll(),
      ]);

      // Separate rooms and regular nodes
      const roomObjects = [];
      const nodeObjects = [];
      
      mapObjects.forEach(obj => {
        if (obj.type === 'room') {
          roomObjects.push(obj);
        } else {
          nodeObjects.push(obj);
        }
      });

      // Convert room objects to room layer format
      const roomsData = roomObjects.map(obj => {
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
          id: obj.id,
          name: obj.name,
          x: obj.map_x || 0,
          y: obj.map_y || 0,
          width,
          height,
          doors,
          windows,
        };
      });

      // Convert plant/waterer objects to React Flow nodes
      const flowNodes = nodeObjects.map(obj => ({
        id: `node-${obj.id}`,
        type: obj.type,
        position: { x: obj.map_x || 0, y: obj.map_y || 0 },
        data: { 
          label: obj.name,
          objectId: obj.id,
          clusterId: obj.cluster_id,
        },
      }));

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
      setRooms(roomsData);
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

      if (type === 'room') {
        // Add to rooms layer
        const newRoom = {
          id: mapObject.id,
          name: mapObject.name,
          x: mapObject.map_x,
          y: mapObject.map_y,
          width: 400,
          height: 300,
          doors: [],
          windows: [],
        };
        setRooms((prevRooms) => [...prevRooms, newRoom]);
      } else {
        // Add to ReactFlow nodes
        const newNode = {
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
      }

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

        const newNode = {
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
        saveRoomMetadata(node.data.objectId, updatedNode.data);
        
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
        saveRoomMetadata(node.data.objectId, updatedNode.data);
        
        return updatedNode;
      }
      return node;
    }));
    
    setSelectedOpening(null);
    showToast(`${selectedOpening.type === 'door' ? 'Door' : 'Window'} removed`);
  }, [selectedOpening, setNodes]);

  // Save room metadata to backend
  const saveRoomMetadata = async (objectId, data) => {
    try {
      const metadata = {
        doors: data.doors || [],
        windows: data.windows || [],
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

  // Lock/unlock rooms toggle
  const handleToggleRoomsLock = useCallback(() => {
    setRoomsLocked(prev => !prev);
    showToast(roomsLocked ? 'Rooms unlocked' : 'Rooms locked');
  }, [roomsLocked]);

  return (
    <div className="map-editor">
      <Toolbar 
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitView={handleFitView}
        roomsLocked={roomsLocked}
        onToggleRoomsLock={handleToggleRoomsLock}
      />
      <LeftPanel 
        onAddNode={handleAddNode}
        cursorMode={cursorMode}
        onCursorModeToggle={handleCursorModeToggle}
      />
      <PropertiesPanel 
        selectedNode={selectedNode}
        connectedPlants={getConnectedPlants()}
        onDelete={handleDeleteNode}
        cluster={getNodeCluster()}
        onClusterUpdate={handleClusterUpdate}
      />
      
      <div className="canvas-container" ref={reactFlowWrapper}>
        <RoomLayer rooms={rooms} isLocked={roomsLocked} />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onSelectionChange={onSelectionChange}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
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
          <MiniMap 
            nodeColor={(node) => {
              return node.type === 'plant' ? '#4ec9b0' : '#569cd6';
            }}
          />
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
