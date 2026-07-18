const STORAGE_KEY = 'marcinbrukmaps-saved-buildings';
const ROUTES_STORAGE_KEY = 'marcinbrukmaps-routes';
const BACKUP_STORAGE_KEY = 'marcinbrukmaps-saved-buildings-lite';
const MIN_ZOOM_TO_LOAD = 16;
const DEBOUNCE_MS = 1200;
const MAX_PHOTO_DATA_LENGTH = 180000;

const statusEl = document.getElementById('status');
const locateBtn = document.getElementById('locateBtn');
const locateBtnBottom = document.getElementById('locateBtnBottom');
const startRouteBtn = document.getElementById('startRouteBtn');
const stopRouteBtn = document.getElementById('stopRouteBtn');
const addPropertyBtn = document.getElementById('addPropertyBtn');
const moreBtn = document.getElementById('moreBtn');
const morePanel = document.getElementById('morePanel');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const savedListBtn = document.getElementById('savedListBtn');
const savedListSheet = document.getElementById('savedListSheet');
const savedListContent = document.getElementById('savedListContent');
const closeSavedListBtn = document.getElementById('closeSavedList');
const savedCountEl = document.getElementById('savedCount');
const routeDistanceEl = document.getElementById('routeDistance');
const routeStateEl = document.getElementById('routeState');
const sheet = document.getElementById('sheet');
const closeSheetBtn = document.getElementById('closeSheet');
const statusSelect = document.getElementById('statusSelect');
const potentialSelect = document.getElementById('potentialSelect');
const serviceTypeSelect = document.getElementById('serviceTypeSelect');
const notesInput = document.getElementById('notes');
const streetInput = document.getElementById('streetInput');
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const removePhotoBtn = document.getElementById('removePhotoBtn');
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
let activePhotoData = '';
const buildingLayers = {};

function createLiteSavedBuildings(source) {
  const lite = {};
  Object.entries(source || {}).forEach(([id, item]) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    lite[id] = { ...item };
    if (lite[id].photoData) {
      lite[id].hasPhoto = true;
    }
    delete lite[id].photoData;
  });
  return lite;
}

function sanitizeSavedBuildings(source, dropAllPhotos = false) {
  const cleaned = {};
  let changed = false;

  Object.entries(source || {}).forEach(([id, item]) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const copy = { ...item };
    const photoTooHeavy = typeof copy.photoData === 'string' && copy.photoData.length > MAX_PHOTO_DATA_LENGTH;

    if (dropAllPhotos || photoTooHeavy) {
      delete copy.photoData;
      copy.hasPhoto = true;
      changed = true;
    }

    cleaned[id] = copy;
  });

  return { cleaned, changed };
}

function loadSavedBuildings() {
  const params = new URLSearchParams(window.location.search);
  const rescuePhotos = params.has('fixPhotos') || params.has('resetPhotos');

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object' && Object.keys(saved).length) {
      const result = sanitizeSavedBuildings(saved, rescuePhotos);

      if (result.changed) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(result.cleaned));
          localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(createLiteSavedBuildings(result.cleaned)));
        } catch (error) {
          console.warn('Nie udało się zapisać oczyszczonych danych:', error);
        }

        setTimeout(() => {
          setStatus('Usunięto zbyt ciężkie stare zdjęcia. Posesje zostały zachowane.', true);
        }, 700);
      }

      return result.cleaned;
    }
  } catch (error) {
    console.warn('Główny zapis jest uszkodzony, próbuję backup:', error);
  }

  try {
    const backup = JSON.parse(localStorage.getItem(BACKUP_STORAGE_KEY) || '{}');
    if (backup && typeof backup === 'object') {
      return backup;
    }
  } catch (error) {
    console.warn('Backup też niedostępny:', error);
  }

  return {};
}

function saveSavedBuildings() {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(createLiteSavedBuildings(savedBuildings)));
  } catch (error) {
    console.warn('Nie udało się zapisać lekkiego backupu:', error);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBuildings));
  } catch (error) {
    console.error(error);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setStatus('Dane posesji zapisane bez zdjęć. Zdjęcie było zbyt ciężkie dla pamięci telefonu.', true);
    updateSavedCount();
    if (savedListSheet && !savedListSheet.classList.contains('hidden')) {
      renderSavedList();
    }
    return true;
  }

  updateSavedCount();
  if (savedListSheet && !savedListSheet.classList.contains('hidden')) {
    renderSavedList();
  }
  return true;
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


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function getPotentialLabel(potential) {
  switch (potential) {
    case 'A':
      return 'A - bardzo dobry';
    case 'B':
      return 'B - średni';
    case 'C':
      return 'C - słaby';
    default:
      return 'Nie ustawiono';
  }
}

function getPotentialClass(potential) {
  switch (potential) {
    case 'A':
      return 'potential-a';
    case 'B':
      return 'potential-b';
    case 'C':
      return 'potential-c';
    default:
      return 'potential-empty';
  }
}

function formatSavedDate(value) {
  if (!value) {
    return 'brak daty';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'brak daty';
  }

  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getSavedBuildingItems() {
  return Object.values(savedBuildings)
    .filter((item) => item && Array.isArray(item.center) && item.center.length === 2)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function savedBuildingToFeature(item) {
  return {
    type: 'Feature',
    properties: {
      id: item.id,
      manual: Boolean(item.manual)
    },
    geometry: {
      type: 'Point',
      coordinates: [item.center[1], item.center[0]]
    }
  };
}


function renderPhotoPreview() {
  if (!photoPreview || !removePhotoBtn) {
    return;
  }

  if (activePhotoData) {
    photoPreview.src = activePhotoData;
    photoPreview.classList.remove('hidden');
    removePhotoBtn.classList.remove('hidden');
  } else {
    photoPreview.removeAttribute('src');
    photoPreview.classList.add('hidden');
    removePhotoBtn.classList.add('hidden');
  }
}

function compressPhotoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      resolve('');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nie udało się odczytać zdjęcia.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Nie udało się przygotować zdjęcia.'));
      image.onload = () => {
        const maxSize = 520;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', 0.52));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function buildStreetNameFromReverseData(data) {
  const address = data?.address || {};
  const street = address.road || address.pedestrian || address.footway || address.path || address.cycleway;
  const number = address.house_number;

  if (street && number) {
    return `${street} ${number}`;
  }

  if (street) {
    return street;
  }

  if (address.neighbourhood) {
    return address.neighbourhood;
  }

  if (typeof data?.display_name === 'string') {
    return data.display_name.split(',').slice(0, 2).join(',').trim();
  }

  return '';
}

async function reverseGeocodeStreet(center) {
  if (!Array.isArray(center) || center.length !== 2 || !navigator.onLine) {
    return '';
  }

  try {
    const [lat, lng] = center;
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return '';
    }

    const data = await response.json();
    return buildStreetNameFromReverseData(data);
  } catch (error) {
    console.warn('Nie udało się pobrać ulicy:', error);
    return '';
  }
}


function renderSavedList() {
  if (!savedListContent) {
    return;
  }

  const items = getSavedBuildingItems();

  if (!items.length) {
    savedListContent.innerHTML = '<div class="saved-list-empty">Nie masz jeszcze zapisanych posesji.</div>';
    return;
  }

  savedListContent.innerHTML = items.map((item, index) => {
    const id = escapeHtml(item.id);
    const potential = escapeHtml(getPotentialLabel(item.potential));
    const service = escapeHtml(item.serviceType || 'Usługa nie wybrana');
    const street = escapeHtml(item.streetName || item.addressHint || 'Ulica nieznana');
    const notes = item.notes ? `<p class="saved-card-notes">${escapeHtml(item.notes)}</p>` : '';
    const photo = typeof item.photoData === 'string' && item.photoData.length <= MAX_PHOTO_DATA_LENGTH
      ? `<img class="saved-card-photo" src="${item.photoData}" alt="Zdjęcie posesji" />`
      : item.hasPhoto
        ? '<div class="saved-card-photo-missing">Zdjęcie usunięte, aby odciążyć pamięć telefonu</div>'
        : '';
    const date = escapeHtml(formatSavedDate(item.updatedAt));
    const potentialClass = getPotentialClass(item.potential);

    return `
      <article class="saved-card" data-saved-card="${id}">
        ${photo}
        <div class="saved-card-top">
          <span class="saved-number">${index + 1}</span>
          <span class="potential-badge ${potentialClass}">${potential}</span>
        </div>
        <div class="saved-card-main">
          <strong>${service}</strong>
          <span>${street}</span>
          <span>Aktualizacja: ${date}</span>
        </div>
        ${notes}
        <div class="saved-card-actions">
          <button type="button" class="saved-card-action" data-show-building="${id}">Pokaż</button>
          <button type="button" class="saved-card-action secondary-action" data-edit-building="${id}">Edytuj</button>
        </div>
      </article>
    `;
  }).join('');
}

function openSavedList() {
  renderSavedList();

  if (morePanel) {
    morePanel.classList.add('hidden');
  }

  if (moreBtn) {
    moreBtn.setAttribute('aria-expanded', 'false');
  }

  if (savedListSheet) {
    savedListSheet.classList.remove('hidden');
    savedListSheet.setAttribute('aria-hidden', 'false');
  }
}

function closeSavedList() {
  if (savedListSheet) {
    savedListSheet.classList.add('hidden');
    savedListSheet.setAttribute('aria-hidden', 'true');
  }
}

function focusSavedBuilding(id, shouldEdit = false) {
  const item = savedBuildings[id];

  if (!item || !Array.isArray(item.center)) {
    setStatus('Nie znaleziono tej posesji.', true);
    return;
  }

  closeSavedList();

  if (map) {
    map.setView(item.center, Math.max(map.getZoom(), 18), { animate: true });
  }

  const layer = buildingLayers[id];
  if (layer && typeof layer.openTooltip === 'function') {
    layer.openTooltip();
    setTimeout(() => {
      if (typeof layer.closeTooltip === 'function') {
        layer.closeTooltip();
      }
    }, 1800);
  }

  setStatus('Pokazuję posesję z listy.');

  if (shouldEdit) {
    setTimeout(() => {
      openSheet(savedBuildingToFeature(item));
    }, 180);
  }
}


function updateSavedCount() {
  savedCountEl.textContent = Object.keys(savedBuildings).length;
}

function updateRouteDistanceText() {
  routeDistanceEl.textContent = (currentRouteDistance / 1000).toFixed(2);
}

function updateRouteRecordingUi(isRecording) {
  document.body.classList.toggle('route-recording', Boolean(isRecording));

  if (routeStateEl) {
    routeStateEl.hidden = !isRecording;
    routeStateEl.textContent = isRecording ? '● Trasa aktywna - GPS zapisuje przejazd' : '';
  }

  if (startRouteBtn) {
    startRouteBtn.textContent = isRecording ? 'Stop trasy' : 'Start trasy';
    startRouteBtn.classList.toggle('is-recording', Boolean(isRecording));
  }

  if (stopRouteBtn) {
    stopRouteBtn.textContent = isRecording ? 'Zatrzymaj trasę' : 'Stop trasy';
  }
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
  startRouteBtn.disabled = false;
  if (stopRouteBtn) {
    stopRouteBtn.disabled = false;
  }
  updateRouteRecordingUi(true);

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

  setStatus('Trasa aktywna - GPS zapisuje przejazd.');
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
  if (stopRouteBtn) {
    stopRouteBtn.disabled = true;
  }
  updateRouteRecordingUi(false);
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

function getPotentialColor(potential) {
  switch (potential) {
    case 'A':
      return '#22c55e';
    case 'B':
      return '#facc15';
    case 'C':
      return '#f97316';
    default:
      return '#38bdf8';
  }
}

function styleFeature(feature) {
  const id = String(feature.properties.id);
  const saved = savedBuildings[id];
  const color = saved ? getPotentialColor(saved.potential) : getPotentialColor();
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
    const color = getPotentialColor(savedBuildings[String(feature.properties.id)]?.potential);
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

  const style = styleFeature(feature);

  if (typeof layer.setStyle === 'function') {
    try {
      layer.setStyle(style);
      return;
    } catch (error) {
      console.warn('Nie udało się ustawić stylu warstwy bezpośrednio:', error);
    }
  }

  if (typeof layer.eachLayer === 'function') {
    layer.eachLayer((child) => {
      if (typeof child.setStyle === 'function') {
        child.setStyle(style);
      }
    });
  }
}

function openSheet(feature) {
  activeFeature = feature;
  const id = String(feature.properties.id);
  const saved = savedBuildings[id] || { status: 'Potential client', notes: '' };

  if (potentialSelect) {
    potentialSelect.value = saved.potential || 'A';
  }
  if (serviceTypeSelect) {
    serviceTypeSelect.value = saved.serviceType || 'Kostka brukowa';
  }
  if (streetInput) {
    streetInput.value = saved.streetName || saved.addressHint || '';
  }
  activePhotoData = saved.photoData || '';
  renderPhotoPreview();

  if (photoInput) {
    photoInput.value = '';
  }

  if (notesInput) {
    notesInput.value = saved.notes || '';
  }
  if (document.body) {
    document.body.classList.add('sheet-open');
  }
  if (sheet) {
    sheet.classList.remove('hidden');
  }
  if (map) {
    setTimeout(() => map.invalidateSize(), 120);
  }
}

function closeSheet() {
  if (sheet) {
    sheet.classList.add('hidden');
  }
  activeFeature = null;
  if (document.body) {
    document.body.classList.remove('sheet-open');
  }
  if (map) {
    setTimeout(() => map.invalidateSize(), 120);
  }
}

function resetActiveBuilding() {
  if (!activeFeature) {
    closeSheet();
    return;
  }
  const id = String(activeFeature.properties.id);
  delete savedBuildings[id];
  saveSavedBuildings();
  try {
    updateFeatureLayerStyle(activeFeature);
  } catch (error) {
    console.warn('Błąd odświeżania stylu warstwy przy usuwaniu:', error);
  }
  setStatus('Dane budynku zostały zresetowane.');
  closeSheet();
}

async function saveActiveBuilding() {
  if (!activeFeature) {
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
  }

  const id = String(activeFeature.properties.id);
  const center = getFeatureCenter(activeFeature);
  const previous = savedBuildings[id] || {};
  let streetName = streetInput?.value.trim() || '';

  if (!streetName) {
    setStatus('Zapisuję posesję i sprawdzam ulicę...');
    streetName = await reverseGeocodeStreet(center);
  }

  savedBuildings[id] = {
    id,
    center,
    status: 'Potential client',
    potential: potentialSelect?.value || 'A',
    serviceType: serviceTypeSelect?.value || 'Kostka brukowa',
    streetName,
    addressHint: streetName,
    photoData: activePhotoData || '',
    notes: notesInput?.value.trim() || '',
    updatedAt: new Date().toISOString(),
    createdAt: previous.createdAt || new Date().toISOString(),
    manual: Boolean(activeFeature.properties.manual)
  };

  const savedOk = saveSavedBuildings();

  if (saveBtn) {
    saveBtn.disabled = false;
  }

  if (!savedOk) {
    return;
  }

  try {
    updateFeatureLayerStyle(activeFeature);
  } catch (error) {
    console.warn('Błąd odświeżania stylu warstwy przy zapisie:', error);
  }
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


function addManualPropertyAt(latlng) {
  const feature = createManualFallbackFeature(latlng.lat, latlng.lng);
  createBuildingLayer(feature);
  openSheet(feature);
  setStatus('Dodano posesję. Wypełnij dane i zapisz.');
}

function getBestPropertyLocation() {
  if (currentRoutePoints.length > 0) {
    const lastPoint = currentRoutePoints[currentRoutePoints.length - 1];
    return { lat: lastPoint.lat, lng: lastPoint.lng };
  }

  if (positionMarker && typeof positionMarker.getLatLng === 'function') {
    return positionMarker.getLatLng();
  }

  return map.getCenter();
}

function addPropertyFromButton() {
  if (!map) {
    return;
  }

  addManualPropertyAt(getBestPropertyLocation());
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

  // Automatyczne pobieranie obrysów OSM jest na razie wyłączone.
  // Ręczne oznaczanie posesji działa stabilniej w terenie.
  map.on('click', (event) => {
    addManualPropertyAt(event.latlng);
  });

  setStatus('Kliknij mapę albo użyj przycisku Dodaj posesję.');
}

function registerControls() {
  locateBtn.addEventListener('click', locateUser);
  if (locateBtnBottom) {
    locateBtnBottom.addEventListener('click', locateUser);
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => scheduleBuildingLoad(true));
  }
  startRouteBtn.addEventListener('click', () => {
    if (routeWatchId !== null) {
      stopRouteTracking();
    } else {
      startRouteTracking();
    }
  });
  if (stopRouteBtn) {
    stopRouteBtn.addEventListener('click', stopRouteTracking);
  }
  if (addPropertyBtn) {
    addPropertyBtn.addEventListener('click', addPropertyFromButton);
  }
  if (moreBtn && morePanel) {
    moreBtn.addEventListener('click', () => {
      const isHidden = morePanel.classList.toggle('hidden');
      moreBtn.setAttribute('aria-expanded', String(!isHidden));
    });
  }
  if (savedListBtn) {
    savedListBtn.addEventListener('click', openSavedList);
  }
  if (closeSavedListBtn) {
    closeSavedListBtn.addEventListener('click', closeSavedList);
  }
  if (savedListSheet) {
    savedListSheet.addEventListener('click', (event) => {
      const showButton = event.target.closest('[data-show-building]');
      const editButton = event.target.closest('[data-edit-building]');

      if (showButton) {
        focusSavedBuilding(showButton.dataset.showBuilding, false);
      }

      if (editButton) {
        focusSavedBuilding(editButton.dataset.editBuilding, true);
      }
    });
  }
  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];

      if (!file) {
        return;
      }

      try {
        setStatus('Przygotowuję zdjęcie...');
        activePhotoData = await compressPhotoFile(file);
        renderPhotoPreview();
        setStatus('Zdjęcie dodane. Naciśnij Zapisz, aby zapisać posesję.');
      } catch (error) {
        console.error(error);
        setStatus('Nie udało się dodać zdjęcia.', true);
      }
    });
  }

  if (removePhotoBtn) {
    removePhotoBtn.addEventListener('click', () => {
      activePhotoData = '';
      if (photoInput) {
        photoInput.value = '';
      }
      renderPhotoPreview();
      setStatus('Zdjęcie usunięte z formularza. Naciśnij Zapisz, aby zapisać zmianę.');
    });
  }

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
    if (event.key === 'Escape' && savedListSheet && !savedListSheet.classList.contains('hidden')) {
      closeSavedList();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  registerControls();
  updateSavedCount();
  renderSavedManualPoints();
  renderSavedList();
  drawSavedRoutes();
  updateRouteDistanceText();
  updateRouteRecordingUi(false);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
