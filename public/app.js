const board = document.getElementById("board");
const mapRoot = document.getElementById("bus-map");
const statusPill = document.getElementById("status-pill");
const refreshButton = document.getElementById("refresh-button");
const stopTemplate = document.getElementById("stop-template");

const REFRESH_INTERVAL_MS = 30000;
let map;
let stopMarkers = [];
let vehicleMarkers = [];

refreshButton.addEventListener("click", () => {
  loadPredictions();
});

loadPredictions();
setInterval(loadPredictions, REFRESH_INTERVAL_MS);

async function loadPredictions() {
  statusPill.textContent = "Refreshing live data...";
  refreshButton.disabled = true;

  try {
    const [predictionResponse, mapResponse] = await Promise.all([
      fetch("/api/predictions"),
      fetch("/api/map-data")
    ]);
    const [predictionData, mapData] = await Promise.all([predictionResponse.json(), mapResponse.json()]);

    if (!predictionResponse.ok) {
      throw new Error(predictionData.error || "Prediction request failed");
    }

    renderStops(predictionData.stops || []);
    statusPill.textContent = `Updated ${formatTimestamp(predictionData.updatedAt)}`;

    if (mapResponse.ok) {
      renderMap(mapData.stops || [], mapData.vehicles || []);
    } else if (mapRoot) {
      mapRoot.innerHTML =
        '<div class="empty-state">Live map unavailable. Make sure WMATA Bus Route and Stop Methods is enabled for this API key.</div>';
    }
  } catch (error) {
    board.innerHTML = `<div class="empty-state">Unable to load WMATA data. ${escapeHtml(error.message)}</div>`;
    if (mapRoot) {
      mapRoot.innerHTML = '<div class="empty-state">Map unavailable right now.</div>';
    }
    statusPill.textContent = "Live data unavailable";
  } finally {
    refreshButton.disabled = false;
  }
}

function renderStops(stops) {
  board.innerHTML = "";

  for (const stop of stops) {
    const fragment = stopTemplate.content.cloneNode(true);
    fragment.querySelector(".stop-label").textContent = "Bus Stop";
    fragment.querySelector(".stop-name").textContent = stop.name;
    fragment.querySelector(".stop-id").textContent = `Stop ${stop.id}`;

    const predictionList = fragment.querySelector(".prediction-list");

    if (!stop.predictions.length) {
      predictionList.innerHTML =
        '<div class="empty-state">No active arrival predictions right now.</div>';
    } else {
      for (const prediction of stop.predictions.slice(0, 4)) {
        predictionList.appendChild(buildPrediction(prediction));
      }
    }

    board.appendChild(fragment);
  }
}

function buildPrediction(prediction) {
  const card = document.createElement("div");
  card.className = "prediction";

  const route = escapeHtml(prediction.routeId || "Route");
  const headsign = escapeHtml(prediction.tripHeadSign || prediction.directionText || "");
  const vehicleId = escapeHtml(prediction.vehicleId || "");
  const minutes = formatMinutes(prediction.minutes);

  card.innerHTML = `
    <div>
      <p class="prediction-route">${route}</p>
      <p class="prediction-meta">${headsign}${vehicleId ? ` • Bus ${vehicleId}` : ""}</p>
    </div>
    <div class="prediction-minutes">
      <span class="minutes-value">${minutes.value}</span>
      <span class="minutes-label">${minutes.label}</span>
    </div>
  `;

  return card;
}

function renderMap(stops, vehicles) {
  if (!mapRoot || typeof L === "undefined") {
    return;
  }

  const validStops = stops.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon));

  if (!validStops.length) {
    mapRoot.innerHTML = '<div class="empty-state">Stop locations unavailable.</div>';
    return;
  }

  if (!map) {
    map = L.map(mapRoot, {
      scrollWheelZoom: false
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
  }

  clearMarkers(stopMarkers);
  clearMarkers(vehicleMarkers);

  stopMarkers = validStops.map((stop) => {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: 10,
      color: "#132a13",
      weight: 2,
      fillColor: "#fffaf0",
      fillOpacity: 1
    }).addTo(map);

    marker.bindPopup(
      `<strong>${escapeHtml(stop.stopName || stop.name)}</strong><br />Stop ${escapeHtml(stop.id)}`
    );

    return marker;
  });

  const visibleVehicles = vehicles.filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon));

  vehicleMarkers = visibleVehicles.map((vehicle) => {
    const marker = L.circleMarker([vehicle.lat, vehicle.lon], {
      radius: 8,
      color: "#c84c09",
      weight: 2,
      fillColor: "#ffd3b8",
      fillOpacity: 0.95
    }).addTo(map);

    marker.bindPopup(buildVehiclePopup(vehicle));
    return marker;
  });

  const bounds = L.latLngBounds(validStops.map((stop) => [stop.lat, stop.lon]));

  visibleVehicles.forEach((vehicle) => {
    bounds.extend([vehicle.lat, vehicle.lon]);
  });

  map.fitBounds(bounds.pad(0.22));
}

function buildVehiclePopup(vehicle) {
  const lines = [
    `<strong>Route ${escapeHtml(vehicle.routeId || "")}</strong>`,
    vehicle.tripHeadsign ? escapeHtml(vehicle.tripHeadsign) : escapeHtml(vehicle.directionText || ""),
    vehicle.vehicleId ? `Bus ${escapeHtml(vehicle.vehicleId)}` : "",
    vehicle.deviation === null || vehicle.deviation === undefined
      ? ""
      : `${escapeHtml(String(vehicle.deviation))} min off schedule`
  ].filter(Boolean);

  return lines.join("<br />");
}

function clearMarkers(markers) {
  markers.forEach((marker) => marker.remove());
}

function formatMinutes(value) {
  const text = String(value || "").trim().toLowerCase();

  if (!text) {
    return { value: "--", label: "Unknown" };
  }

  if (text === "arr" || text === "brd") {
    return { value: "Now", label: "Approaching" };
  }

  return { value: escapeHtml(String(value)), label: "Minutes" };
}

function formatTimestamp(value) {
  if (!value) {
    return "just now";
  }

  const date = new Date(value);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
