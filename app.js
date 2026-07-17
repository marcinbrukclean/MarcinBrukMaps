const mapViewport = document.getElementById('mapViewport');
const markerLayer = document.getElementById('markerLayer');
const statusEl = document.getElementById('status');
const locateBtn = document.getElementById('locateBtn');
const addMarkerBtn = document.getElementById('addMarkerBtn');
const resetViewBtn = document.getElementById('resetViewBtn');

const STORAGE_KEY = 'marcinbrukmaps-markers';
let markers = loadMarkers();
let isDragging = false;
let dragStart = null;
let offset = { x: 0, y: 0 };

function loadMarkers() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveMarkers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
}

function renderMarkers() {
  markerLayer.innerHTML = '';
  markers.forEach((marker, index) => {
    const pin = document.createElement('button');
    pin.className = 'marker';
    pin.style.left = `${marker.x}%`;
    pin.style.top = `${marker.y}%`;
    pin.setAttribute('aria-label', `Marker ${index + 1}`);
    pin.addEventListener('click', () => {
      markers = markers.filter((item) => item !== marker);
      saveMarkers();
      renderMarkers();
      updateStatus('Removed a saved marker.');
    });
    markerLayer.appendChild(pin);
  });
}

function updateStatus(message) {
  statusEl.textContent = message;
}

function addMarkerAt(x, y) {
  markers.push({ x, y });
  saveMarkers();
  renderMarkers();
  updateStatus('Saved a new offline marker.');
}

function resetView() {
  markers = [];
  saveMarkers();
  renderMarkers();
  updateStatus('Map markers cleared.');
}

mapViewport.addEventListener('pointerdown', (event) => {
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
});

window.addEventListener('pointermove', (event) => {
  if (!isDragging) return;
  if (!dragStart) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  dragStart = { x: event.clientX, y: event.clientY };
  offset.x += dx;
  offset.y += dy;
  mapViewport.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
});

window.addEventListener('pointerup', () => {
  isDragging = false;
  dragStart = null;
});

mapViewport.addEventListener('click', (event) => {
  if (isDragging) return;
  const rect = mapViewport.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  addMarkerAt(Math.max(5, Math.min(95, x)), Math.max(5, Math.min(95, y)));
});

addMarkerBtn.addEventListener('click', () => {
  const rect = mapViewport.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  addMarkerAt(((cx / rect.width) * 100), ((cy / rect.height) * 100));
});

resetViewBtn.addEventListener('click', resetView);

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    updateStatus('Geolocation is not supported on this device.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const x = ((coords.longitude + 180) / 360) * 100;
      const y = (1 - (coords.latitude + 90) / 180) * 100;
      addMarkerAt(Math.max(5, Math.min(95, x)), Math.max(5, Math.min(95, y)));
      updateStatus(`Located at ${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}.`);
    },
    () => {
      updateStatus('Could not access your location right now.');
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
});

renderMarkers();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      updateStatus('Offline cache could not be enabled.');
    });
  });
}
