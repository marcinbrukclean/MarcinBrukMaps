const STORAGE_KEY = 'marcinbrukmaps-saved-buildings';
const ROUTES_STORAGE_KEY = 'marcinbrukmaps-routes';
const MIN_ZOOM_TO_LOAD = 16;
const DEBOUNCE_MS = 1200;

const statusEl = document.getElementById('status');
const locateBtn = document.getElementById('locateBtn');
const locateBtnBottom = document.getElementById('locateBtnBottom');
const startRouteBtn = document.getElementById('startRouteBtn');
const stopRouteBtn = document.getElementById('stopRouteBtn');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const savedCountEl = document.getElementById('savedCount');
const routeDistanceEl = document.getElementById('routeDistance');
const sheet = document.getElementById('sheet');
const closeSheetBtn = document.getElementById('closeSheet');
const statusSelect = document.getElementById('statusSelect');
const potentialSelect = document.getElementById('potentialSelect');
const serviceTypeSelect = document.getElementById('serviceTypeSelect');
const notesInput = document.getElementById('notes');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');

let map = null;
let buildingsLayer = null;
let routeLayerGroup = null;
let savedBuildings = loadSavedBuildings();
let savedRoutes = loadSavedRoutes();
let activeFeature = null;
let pendingRequest = null;
let requestTimer = null;
let positionMarker = null;
let accuracyCircle = null;
let currentRoutePoints = [];
let currentRoutePolyline = null;
let currentRouteStartedAt = null;
let currentRouteDistance = 0;
let routeWatchId = null;
const buildingLayers = {};

function loadSavedBuildings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSavedBuildings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBuildings));
  updateSavedCount();
}

function loadSavedRoutes() {
  try {
    return JSON.parse(localStorage.getItem(ROUTES_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveSavedRoutes() {
  localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(savedRoutes));
}

function updateSavedCount() {
  savedCountEl.textContent = Object.keys(savedBuildings).length;
}

function updateRouteDistanceText() {
  routeDistanceEl.textContent = (currentRouteDistance / 1000).toFixed(2);
}

function drawSavedRoute(route) {
  if (!Array.isArray(route.points) || route.points.length < 2) {
    return;
  }

  const latlngs = route.points.map((point) => [point.lat, point.lng]);
  L.polyline(latlngs, {
    color: '#3b82f6',
    weight: 3,
    opacity: 0.55
  }).addTo(routeLayerGroup);
}

function drawSavedRoutes() {
  if (!routeLayerGroup) {
    return;
  }

  routeLayerGroup.clearLayers();
  savedRoutes.forEach(drawSavedRoute);
}

function haversineDistance(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const earthRadius = 6371000;
  const c = 2 * Math.atan2(Math.sqrt(sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng), Math.sqrt(1 - (sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng)));
  return earthRadius * c;
}

function handleRoutePosition(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const timestamp = position.timestamp || Date.now();
  const point = {
    lat: latitude,
    lng: longitude,
    accuracy,
    timestamp
  };

  if (accuracy > 80) {
    setStatus('Słaby sygnał GPS - punkt pominięty.', true);
    return;
  }

  if (currentRoutePoints.length > 0) {
    const lastPoint = currentRoutePoints[currentRoutePoints.length - 1];
    const timeDelta = (timestamp - lastPoint.timestamp) / 1000;
    const distance = haversineDistance(lastPoint, point);

    if (timeDelta < 10 && distance > 150) {
      setStatus('Słaby sygnał GPS - punkt pominięty.', true);
      return;
    }

    currentRouteDistance += distance;
  }

  currentRoutePoints.push(point);

  if (!currentRoutePolyline) {
    currentRoutePolyline = L.polyline([], {
      color: '#60a5fa',
      weight: 5,
      opacity: 0.85
    }).addTo(map);
  }

  currentRoutePolyline.addLatLng([latitude, longitude]);
  updateRouteDistanceText();

  if (currentRoutePoints.length === 1) {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 17), { animate: true });
  }
}

function startRouteTracking() {
  if (!navigator.geolocation) {
    setStatus('GPS niedostępny.', true);
    return;
  }

  if (routeWatchId !== null) {
    return;
  }

  currentRoutePoints = [];
  currentRouteDistance = 0;
  currentRouteStartedAt = new Date().toISOString();

  if (currentRoutePolyline) {
    map.removeLayer(currentRoutePolyline);
    currentRoutePolyline = null;
  }

  updateRouteDistanceText();
  startRouteBtn.disabled = true;
  stopRouteBtn.disabled = false;

  routeWatchId = navigator.geolocation.watchPosition(
    handleRoutePosition,
    (error) => {
      console.error(error);
      setStatus('GPS niedostępny.', true);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000
    }
  );

  setStatus('Rozpoczęto zapis trasy.');
}

function stopRouteTracking() {
  if (routeWatchId === null) {
    return;
  }

  navigator.geolocation.clearWatch(routeWatchId);
  routeWatchId = null;

  const endedAt = new Date().toISOString();

  if (currentRoutePoints.length > 0) {
    const route = {
      id: `route-${Date.now()}`,
      startedAt: currentRouteStartedAt,
      endedAt,
      distanceMeters: Math.round(currentRouteDistance),
      points: currentRoutePoints
    };

    savedRoutes.push(route);
    saveSavedRoutes();
    drawSavedRoute(route);
  }

  if (currentRoutePolyline) {
    map.removeLayer(currentRoutePolyline);
    currentRoutePolyline = null;
  }

  currentRoutePoints = [];
  currentRouteStartedAt = null;
  currentRouteDistance = 0;
  startRouteBtn.disabled = false;
  stopRouteBtn.disabled = true;
  updateRouteDistanceText();
  setStatus('Zakończono trasę.');
}

function clearSavedRouteLayers() {
  if (routeLayerGroup) {
    routeLayerGroup.clearLayers();
  }
}

function exportSavedBuildings() {
  const payload = {
    app: 'MarcinBrukMaps',
    version: 1,
    exportedAt: new Date().toISOString(),
    savedBuildings,
    savedRoutes
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const filename = `marcinbrukmaps-backup-${timestamp}.json`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  setStatus('Wyeksportowano kopię danych.');
}

function importSavedBuildings() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data?.app !== 'MarcinBrukMaps' || typeof data.savedBuildings !== 'object' || data.savedBuildings === null) {
        throw new Error('invalid');
      }

      if (!confirm('Import danych zastąpi bieżące zapisane dane. Kontynuować?')) {
        return;
      }

      savedBuildings = data.savedBuildings;
      savedRoutes = Array.isArray(data.savedRoutes) ? data.savedRoutes : [];
      saveSavedBuildings();
      saveSavedRoutes();
      clearBuildings();
      renderSavedManualPoints();
      drawSavedRoutes();
      setStatus('Dane zostały zaimportowane.');
    } catch {
      setStatus('Nieprawidłowy plik kopii danych.', true);
    }
  });

  fileInput.click();
}

function getStatusColor(status) {
  switch (status) {
    case 'Potential client':
      return 'rgba(249, 115, 22, 0.75)';
    case 'Flyer delivered':
      return 'rgba(59, 130, 246, 0.75)';
    case 'Not interested':
      return 'rgba(239, 68, 68, 0.75)';
    case 'Customer':
      return 'rgba(34, 197, 94, 0.75)';
    case 'Come back later':
      return 'rgba(168, 85, 247, 0.75)';
    default:
      return 'rgba(59, 130, 246, 0.4)';
  }
}

function styleFeature(feature) {
  const id = String(feature.properties.id);
  const saved = savedBuildings[id];
  const color = saved ? getStatusColor(saved.status) : getStatusColor();
  return {
    color,
    fillColor: color,
    fillOpacity: 0.2,
    weight: 2,
    opacity: 0.85,
    dashArray: saved ? null : '4,5'
  };
}

function featureToGeoJSON(element) {
  if (element.type !== 'way' || !element.geometry || element.geometry.length < 3) {
    return null;
  }

  const coordinates = element.geometry.map((point) => [point.lon, point.lat]);
  const closed = coordinates[0][0] === coordinates[coordinates.length - 1][0] && coordinates[0][1] === coordinates[coordinates.length - 1][1];
  if (!closed) {
    coordinates.push(coordinates[0]);
  }

  return {
    type: 'Feature',
    properties: {
      id: element.id,
      tags: element.tags || {}
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates]
    }
  };
}

function getFeatureCenter(feature) {
  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    return [lat, lng];
  }

  const ring = feature.geometry.coordinates[0];
  const total = ring.reduce(
    (acc, coord) => {
      acc.lat += coord[1];
      acc.lng += coord[0];
      return acc;
    },
    { lat: 0, lng: 0 }
  );
  const count = ring.length;
  return [total.lat / count, total.lng / count];
}

function createBuildingLayer(feature) {
  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    const color = getStatusColor(savedBuildings[String(feature.properties.id)]?.status);
    const label = feature.properties.manual ? 'Punkt ręczny' : `Punkt ${feature.properties.id}`;
    const marker = L.circleMarker([lat, lng], {
      radius: 10,
      color,
      fillColor: color,
      fillOpacity: 0.6,
      weight: 2
    }).addTo(buildingsLayer);
    marker.on('click', () => openSheet(feature));
    marker.bindTooltip(label, { direction: 'top', sticky: true });
    buildingLayers[String(feature.properties.id)] = marker;
    return;
  }

  const layer = L.geoJSON(feature, {
    style: () => styleFeature(feature),
    onEachFeature: (feat, layer) => {
      layer.on('click', () => openSheet(feature));
      layer.bindTooltip(`Budynek ${feature.properties.id}`, { direction: 'top', sticky: true });
    }
  });
  buildingLayers[String(feature.properties.id)] = layer;
  layer.addTo(buildingsLayer);
}

function updateFeatureLayerStyle(feature) {
  const id = String(feature.properties.id);
  const layer = buildingLayers[id];
  if (!layer) {
    return;
  }
  layer.eachLayer((child) => {
    if (child.setStyle) {
      child.setStyle(styleFeature(feature));
    }
  });
}

function openSheet(feature) {
  activeFeature = feature;
  const id = String(feature.properties.id);
  const saved = savedBuildings[id] || { status: 'Potential client', notes: '' };
  statusSelect.value = saved.status;
  potentialSelect.value = saved.potential || 'A';
  serviceTypeSelect.value = saved.serviceType || 'Kostka brukowa';
  notesInput.value = saved.notes || '';
  document.body.classList.add('sheet-open');
  sheet.classList.remove('hidden');
  if (map) {
    setTimeout(() => map.invalidateSize(), 120);
  }
}

function closeSheet() {
  sheet.classList.add('hidden');
  activeFeature = null;
  document.body.classList.remove('sheet-open');
  if (map) {
    setTimeout(() => map.invalidateSize(), 120);
  }
}

function resetActiveBuilding() {
  if (!activeFeature) {
    return;
  }
  const id = String(activeFeature.properties.id);
  delete savedBuildings[id];
  saveSavedBuildings();
  updateFeatureLayerStyle(activeFeature);
  setStatus('Dane budynku zostały zresetowane.');
  closeSheet();
}

function saveActiveBuilding() {
  if (!activeFeature) {
    return;
  }
  const id = String(activeFeature.properties.id);
  const center = getFeatureCenter(activeFeature);
  savedBuildings[id] = {
    id,
    center,
    status: statusSelect.value,
    potential: potentialSelect.value,
    serviceType: serviceTypeSelect.value,
    notes: notesInput.value.trim(),
    updatedAt: new Date().toISOString(),
    manual: Boolean(activeFeature.properties.manual)
  };
  saveSavedBuildings();
  updateFeatureLayerStyle(activeFeature);
  setStatus('Zapisano dane budynku lokalnie.');
  closeSheet();
}

function clearBuildings() {
  buildingsLayer.clearLayers();
  Object.keys(buildingLayers).forEach((key) => delete buildingLayers[key]);
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function osmElementToGeoJSON(element) {
  if (!element.geometry || element.geometry.length < 3) {
    return null;
  }

  const coordinates = element.geometry.map((point) => [point.lon, point.lat]);
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push(first);
  }

  return {
    type: 'Feature',
    properties: {
      id: element.id,
      tags: element.tags || {},
      osmType: element.type
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates]
    }
  };
}

async function fetchOverpassData(query) {
  let lastError = null;

  for (let index = 0; index < OVERPASS_ENDPOINTS.length; index += 1) {
    const endpoint = OVERPASS_ENDPOINTS[index];
    setStatus(`Próba ${index + 1}/${OVERPASS_ENDPOINTS.length}...`);

    if (pendingRequest) {
      pendingRequest.abort();
    }

    pendingRequest = new AbortController();
    const timeoutId = setTimeout(() => pendingRequest.abort(), 12000);

    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        signal: pendingRequest.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      pendingRequest = null;
      return json;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        lastError = new Error(`Timeout after 12s at ${endpoint}`);
      } else {
        lastError = new Error(`${error.message} at ${endpoint}`);
      }
      console.error(`Overpass endpoint error [${endpoint}]:`, lastError);
    }
  }

  throw lastError;
}

function createManualFallbackFeature(lat, lng) {
  const id = `manual-${Date.now()}`;
  return {
    type: 'Feature',
    properties: {
      id,
      manual: true
    },
    geometry: {
      type: 'Point',
      coordinates: [lng, lat]
    }
  };
}

function renderSavedManualPoints() {
  Object.values(savedBuildings)
    .filter((item) => item.manual)
    .forEach((item) => {
      const feature = {
        type: 'Feature',
        properties: {
          id: item.id,
          manual: true
        },
        geometry: {
          type: 'Point',
          coordinates: [item.center[1], item.center[0]]
        }
      };
      createBuildingLayer(feature);
    });
}

async function loadBuildings() {
  if (map.getZoom() < MIN_ZOOM_TO_LOAD) {
    setStatus('Powiększ mapę do poziomu 16+, aby pobrać budynki.', true);
    return;
  }

  const center = map.getCenter();
  const query = `[out:json][timeout:10];way(around:60,${center.lat},${center.lng})["building"];out geom;`;

  setStatus('Spróbuj pobrać obrysy w promieniu 80 m...');
  clearBuildings();
  renderSavedManualPoints();

  try {
    const data = await fetchOverpassData(query);
    const features = (data.elements || [])
      .map(osmElementToGeoJSON)
      .filter(Boolean);

    if (!features.length) {
      setStatus('Nie znaleziono budynków w tym obszarze. Spróbuj przybliżyć mapę.', true);
      return;
    }

    features.forEach(createBuildingLayer);
    setStatus(`Pobrano ${features.length} budynków.`);
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    console.error(error);
    setStatus('Nie udało się pobrać obrysów. Możesz dalej oznaczać posesje ręcznie.', true);
  }
}

function scheduleBuildingLoad(immediate = false) {
  if (requestTimer) {
    clearTimeout(requestTimer);
  }

  if (immediate) {
    loadBuildings();
    return;
  }

  requestTimer = setTimeout(() => {
    loadBuildings();
  }, DEBOUNCE_MS);
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus('Geolokalizacja nie jest obsługiwana na tym urządzeniu.', true);
    return;
  }

  setStatus('Sprawdzam lokalizację...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      const latlng = [latitude, longitude];

      if (positionMarker) {
        positionMarker.setLatLng(latlng);
      } else {
        positionMarker = L.circleMarker(latlng, {
          radius: 10,
          color: '#22c55e',
          fillColor: '#86efac',
          fillOpacity: 0.9,
          weight: 2
        }).addTo(map);
      }

      if (accuracy && !Number.isNaN(accuracy)) {
        if (accuracyCircle) {
          accuracyCircle.setLatLng(latlng).setRadius(accuracy);
        } else {
          accuracyCircle = L.circle(latlng, {
            radius: accuracy,
            color: 'rgba(34, 197, 94, 0.35)',
            fillColor: 'rgba(34, 197, 94, 0.12)',
            weight: 1
          }).addTo(map);
        }
      }

      map.setView(latlng, Math.max(map.getZoom(), 17), { animate: true });
      setStatus(`Twoja lokalizacja: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.`);
    },
    (error) => {
      console.error(error);
      setStatus('Nie udało się pobrać lokalizacji. Sprawdź ustawienia GPS.', true);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

function initMap() {
  if (!window.L) {
    showMapError('Ładowanie Leaflet nie powiodło się. Sprawdź połączenie i odśwież stronę.');
    return;
  }

  map = L.map('map', { zoomControl: true }).setView([50.3217, 19.1949], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  routeLayerGroup = L.layerGroup().addTo(map);
  buildingsLayer = L.layerGroup().addTo(map);
  map.invalidateSize();

  map.on('moveend', () => scheduleBuildingLoad());
  map.on('zoomend', () => scheduleBuildingLoad());
  map.on('click', (event) => {
    const feature = createManualFallbackFeature(event.latlng.lat, event.latlng.lng);
    createBuildingLayer(feature);
    openSheet(feature);
    setStatus('Dodano ręczny punkt budynku. Wypełnij status i notatki.');
  });

  setStatus('Znajdź obszar na mapie, a następnie powiększ do poziomu 16+, żeby pobrać budynki.');
}

function registerControls() {
  locateBtn.addEventListener('click', locateUser);
  if (locateBtnBottom) {
    locateBtnBottom.addEventListener('click', locateUser);
  }
  refreshBtn.addEventListener('click', () => scheduleBuildingLoad(true));
  startRouteBtn.addEventListener('click', startRouteTracking);
  stopRouteBtn.addEventListener('click', stopRouteTracking);
  exportBtn.addEventListener('click', exportSavedBuildings);
  importBtn.addEventListener('click', importSavedBuildings);
  closeSheetBtn.addEventListener('click', closeSheet);
  saveBtn.addEventListener('click', saveActiveBuilding);
  deleteBtn.addEventListener('click', resetActiveBuilding);
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) {
      closeSheet();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.classList.contains('hidden')) {
      closeSheet();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  registerControls();
  updateSavedCount();
  drawSavedRoutes();
  updateRouteDistanceText();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
