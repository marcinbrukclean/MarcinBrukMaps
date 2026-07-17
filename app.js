const STORAGE_KEY = 'marcinbrukmaps-saved-buildings';
const MIN_ZOOM_TO_LOAD = 16;
const DEBOUNCE_MS = 1200;

const statusEl = document.getElementById('status');
const locateBtn = document.getElementById('locateBtn');
const locateBtnBottom = document.getElementById('locateBtnBottom');
const refreshBtn = document.getElementById('refreshBtn');
const savedCountEl = document.getElementById('savedCount');
const sheet = document.getElementById('sheet');
const closeSheetBtn = document.getElementById('closeSheet');
const statusSelect = document.getElementById('statusSelect');
const notesInput = document.getElementById('notes');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');

let map = null;
let buildingsLayer = null;
let savedBuildings = loadSavedBuildings();
let activeFeature = null;
let pendingRequest = null;
let requestTimer = null;
let positionMarker = null;
let accuracyCircle = null;
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

function updateSavedCount() {
  savedCountEl.textContent = Object.keys(savedBuildings).length;
}

function showMapError(message) {
  setStatus(message, true);
  statusEl.parentElement?.classList.add('warn');
}

function setStatus(message, isWarn = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('warn', Boolean(isWarn));
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
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
