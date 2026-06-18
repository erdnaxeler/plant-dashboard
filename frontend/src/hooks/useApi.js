import axios from 'axios';

// Get auth token from session storage
const getAuthHeaders = () => {
  const token = sessionStorage.getItem('dashToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// API instance with auth
const api = axios.create({
  baseURL: '/api/app',
});

api.interceptors.request.use(config => {
  config.headers = { ...config.headers, ...getAuthHeaders() };
  return config;
});

export const MapObjectsAPI = {
  getAll: () => api.get('/map-objects').then(res => res.data),
  get: (id) => api.get(`/map-objects/${id}`).then(res => res.data),
  create: (type, name, x, y) => api.post('/map-objects', { type, name, x, y }).then(res => res.data),
  update: (id, data) => api.put(`/map-objects/${id}`, data).then(res => res.data),
  delete: (id) => api.delete(`/map-objects/${id}`).then(res => res.data),
};

export const ConnectionsAPI = {
  getAll: () => api.get('/connections').then(res => res.data),
  create: (fromObjectId, toObjectId) => 
    api.post('/connections', { from_object_id: fromObjectId, to_object_id: toObjectId }).then(res => res.data),
  delete: (id) => api.delete(`/connections/${id}`).then(res => res.data),
};

export const ClustersAPI = {
  getAll: () => api.get('/clusters').then(res => res.data),
  get: (publicId) => api.get(`/clusters/${publicId}`).then(res => res.data),
  calibrate: (publicId, potSize, catalogPlantIds) => 
    api.put(`/clusters/${publicId}/calibrate`, { pot_size: potSize, catalog_plant_ids: catalogPlantIds }).then(res => res.data),
  rename: (publicId, name) => 
    api.put(`/clusters/${publicId}/rename`, { name }).then(res => res.data),
  getPairingCode: (publicId) => 
    api.post(`/clusters/${publicId}/pairing-code`).then(res => res.data),
  unpair: (publicId) => 
    api.post(`/clusters/${publicId}/unpair`).then(res => res.data),
  startWatering: (publicId) => 
    api.post(`/clusters/${publicId}/start-watering`).then(res => res.data),
  pauseWatering: (publicId) => 
    api.post(`/clusters/${publicId}/pause-watering`).then(res => res.data),
  setVolume: (publicId, mlVolumePct) => 
    api.put(`/clusters/${publicId}/volume`, { ml_volume_pct: mlVolumePct }).then(res => res.data),
};

export const CatalogPlantsAPI = {
  getAll: () => api.get('/catalog-plants').then(res => res.data),
};
