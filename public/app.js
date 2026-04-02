const board = document.getElementById("board");
const bestRouteValue = document.getElementById("best-route-value");
const statusPill = document.getElementById("status-pill");
const refreshButton = document.getElementById("refresh-button");
const stopTemplate = document.getElementById("stop-template");

const REFRESH_INTERVAL_MS = 30000;
const MAP_RADIUS_MILES = 2;
const MOBILE_MEDIA = window.matchMedia("(max-width: 640px)");
let latestMapData = { stops: [], vehicles: [] };
let selectedStopId = null;
let openInlineMap = null;

refreshButton.addEventListener("click", () => {
  loadPredictions();
});

loadPredictions();
setInterval(loadPredictions, REFRESH_INTERVAL_MS);
MOBILE_MEDIA.addEventListener("change", () => {
  loadPredictions();
});

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
      latestMapData = {
        stops: mapData.stops || [],
        vehicles: mapData.vehicles || []
      };

      if (selectedStopId && openInlineMap) {
        const currentCard = Array.from(board.querySelectorAll(".stop-card")).find((card) =>
          card.querySelector(".stop-id")?.textContent?.includes(selectedStopId)
        );
        const currentWrap = currentCard?.querySelector(".inline-map-wrap");
        const currentRoot = currentCard?.querySelector(".inline-map");

        if (currentWrap && currentRoot) {
          renderMapForStop(selectedStopId, currentWrap, currentRoot);
        }
      }
    }
  } catch (error) {
    board.innerHTML = `<div class="empty-state">Unable to load WMATA data. ${escapeHtml(error.message)}</div>`;
    if (bestRouteValue) {
      bestRouteValue.textContent = "Live data unavailable";
    }
    statusPill.textContent = "Live data unavailable";
  } finally {
    refreshButton.disabled = false;
  }
}

function renderStops(stops) {
  board.innerHTML = "";
  const soonest = getSoonestPrediction(stops);
  updateBestRoute(soonest, stops);

  for (const stop of stops) {
    const fragment = stopTemplate.content.cloneNode(true);
    const stopCat = fragment.querySelector(".stop-cat");
    const inlineMapCat = fragment.querySelector(".inline-map-cat");
    fragment.querySelector(".stop-label").textContent = "Bus Stop";
    fragment.querySelector(".stop-name").textContent = stop.name;
    const stopNote = fragment.querySelector(".stop-note");
    const noteText = getStopNote(stop.id);
    stopNote.textContent = noteText;
    stopNote.hidden = !noteText;
    fragment.querySelector(".stop-id").textContent = `Stop ${stop.id}`;
    const card = fragment.querySelector(".stop-card");
    const mapButton = fragment.querySelector(".map-link");
    const inlineMapWrap = fragment.querySelector(".inline-map-wrap");
    const inlineMapRoot = fragment.querySelector(".inline-map");
    applyCatVariant(stopCat, stop.id);
    applyCatVariant(inlineMapCat, stop.id);

    const predictionList = fragment.querySelector(".prediction-list");

    if (!stop.predictions.length) {
      predictionList.innerHTML =
        '<div class="empty-state">No active arrival predictions right now.</div>';
    } else {
      stop.predictions.slice(0, getVisiblePredictionCount()).forEach((prediction, index) => {
        const predictionCard = buildPrediction(stop.id, prediction);
        if (soonest && stop.id === soonest.stopId && index === soonest.predictionIndex) {
          predictionCard.classList.add("is-soonest");
        }
        predictionList.appendChild(predictionCard);
      });
    }

    mapButton.addEventListener("click", () => {
      selectedStopId = stop.id;
      renderMapForStop(stop.id, inlineMapWrap, inlineMapRoot);
    });

    board.appendChild(fragment);
  }
}

function buildPrediction(stopId, prediction) {
  const card = document.createElement("div");
  card.className = "prediction";

  const route = escapeHtml(prediction.routeId || "Route");
  const headsign = escapeHtml(prediction.tripHeadSign || prediction.directionText || "");
  const vehicleId = escapeHtml(prediction.vehicleId || "");
  const minutes = formatMinutes(prediction.minutes);

  card.innerHTML = `
    <div>
      <p class="prediction-route">${route}${headsign ? ` • ${headsign}` : ""}</p>
      <p class="prediction-meta">${vehicleId ? `Bus ${vehicleId}` : ""}</p>
      ${buildWalkWarningForStop(stopId, prediction.minutes)}
    </div>
    <div class="prediction-minutes">
      <span class="minutes-value">${minutes.value}</span>
      <span class="minutes-label">${minutes.label}</span>
    </div>
  `;

  return card;
}

function renderMapForStop(stopId, inlineMapWrap, inlineMapRoot) {
  const stop = latestMapData.stops.find((item) => item.id === stopId);

  if (!stop || !inlineMapWrap || !inlineMapRoot) {
    return;
  }

  const predictionCard = Array.from(board.querySelectorAll(".stop-card")).find((card) =>
    card.querySelector(".stop-id")?.textContent?.includes(stopId)
  );
  const routeIds = predictionCard
    ? Array.from(predictionCard.querySelectorAll(".prediction-route")).map((item) => item.textContent.trim())
    : [];

  if (openInlineMap && openInlineMap.wrap !== inlineMapWrap) {
    if (openInlineMap.wrap?.isConnected) {
      openInlineMap.wrap.classList.add("is-hidden");
    }
    if (openInlineMap.instance && typeof openInlineMap.instance.remove === "function") {
      openInlineMap.instance.remove();
    }
  }

  if (openInlineMap && openInlineMap.wrap === inlineMapWrap && !inlineMapWrap.classList.contains("is-hidden")) {
    inlineMapWrap.classList.add("is-hidden");
    if (openInlineMap.instance && typeof openInlineMap.instance.remove === "function") {
      openInlineMap.instance.remove();
    }
    openInlineMap = null;
    return;
  }

  inlineMapWrap.classList.remove("is-hidden");
  renderInlineMap(
    inlineMapRoot,
    latestMapData.stops,
    latestMapData.vehicles.filter((vehicle) => routeIds.includes(String(vehicle.routeId || "").trim())),
    stop
  );
}

function renderInlineMap(mapRoot, stops, vehicles, focusStop) {
  if (!mapRoot || typeof L === "undefined") {
    return;
  }

  const validStops = stops.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon));

  if (!validStops.length) {
    mapRoot.innerHTML = '<div class="empty-state">Stop locations unavailable.</div>';
    return;
  }

  mapRoot.innerHTML = "";
  const map = L.map(mapRoot, {
    scrollWheelZoom: false,
    zoomControl: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const stopMarkers = validStops.map((stop) => {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: stop.id === focusStop.id ? 12 : 7,
      color: stop.id === focusStop.id ? "#22723a" : "#3d2a22",
      weight: 2,
      fillColor: stop.id === focusStop.id ? "#d3f0d8" : "#fffdf9",
      fillOpacity: 1
    }).addTo(map);

    marker.bindPopup(
      `<strong>${escapeHtml(stop.stopName || stop.name)}</strong><br />Stop ${escapeHtml(stop.id)}`
    );

    return marker;
  });

  const visibleVehicles = vehicles.filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon));
  const nearbyVehicles = visibleVehicles.filter((vehicle) =>
    distanceInMiles(focusStop.lat, focusStop.lon, vehicle.lat, vehicle.lon) <= MAP_RADIUS_MILES
  );

  const vehicleMarkers = nearbyVehicles.map((vehicle) => {
    const marker = L.marker([vehicle.lat, vehicle.lon], {
      icon: createBusIcon(vehicle)
    }).addTo(map);

    marker.bindPopup(buildVehiclePopup(vehicle));
    return marker;
  });

  if (!vehicleMarkers.length) {
    map.setView([focusStop.lat, focusStop.lon], 15);
  } else {
    const bounds = L.latLngBounds([[focusStop.lat, focusStop.lon]]);
    nearbyVehicles.forEach((vehicle) => {
      bounds.extend([vehicle.lat, vehicle.lon]);
    });

    map.fitBounds(bounds.pad(0.12), { maxZoom: 15 });
  }

  window.setTimeout(() => {
    map.invalidateSize();
  }, 0);

  openInlineMap = {
    wrap: inlineMapRoot.closest(".inline-map-wrap"),
    instance: map
  };
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

function getSoonestPrediction(stops) {
  let soonest = null;

  for (const stop of stops) {
    if (isExcludedFromWalkLogic(stop.id)) {
      continue;
    }

    stop.predictions.slice(0, getVisiblePredictionCount()).forEach((prediction, index) => {
      const minutes = normalizeMinutes(prediction.minutes);

      if (minutes === null || minutes < 6) {
        return;
      }

      if (!soonest || minutes < soonest.minutes) {
        soonest = {
          stopId: stop.id,
          predictionIndex: index,
          minutes
        };
      }
    });
  }

  return soonest;
}

function buildWalkWarning(minutesValue) {
  return buildWalkWarningForStop(null, minutesValue);
}

function buildWalkWarningForStop(stopId, minutesValue) {
  if (stopId && isExcludedFromWalkLogic(stopId)) {
    return "";
  }

  const minutes = normalizeMinutes(minutesValue);

  if (minutes === null || minutes >= 6) {
    return "";
  }

  return '<p class="prediction-warning">* Not enough time to walk there.</p>';
}

function isExcludedFromWalkLogic(stopId) {
  return stopId === "4000258";
}

function getVisiblePredictionCount() {
  return MOBILE_MEDIA.matches ? 2 : 4;
}

function updateBestRoute(soonest, stops) {
  if (!bestRouteValue) {
    return;
  }

  if (!soonest) {
    bestRouteValue.textContent = "No walkable arrivals right now";
    return;
  }

  const stop = stops.find((item) => item.id === soonest.stopId);
  const prediction = stop?.predictions?.[soonest.predictionIndex];

  if (!stop || !prediction) {
    bestRouteValue.textContent = "No walkable arrivals right now";
    return;
  }

  const minutes = formatMinutes(prediction.minutes).value;
  const route = prediction.routeId || "Route";
  bestRouteValue.textContent = `${stop.name} • ${route} • ${minutes} min`;
}

function applyCatVariant(element, stopId) {
  if (!element) {
    return;
  }

  element.classList.remove("cat-sticker-sleep", "cat-sticker-wave", "cat-sticker-loaf");

  if (stopId === "4000296") {
    element.classList.add("cat-sticker-sleep");
    return;
  }

  if (stopId === "4001060") {
    element.classList.add("cat-sticker-wave");
    return;
  }

  element.classList.add("cat-sticker-loaf");
}

function normalizeMinutes(value) {
  const text = String(value || "").trim().toLowerCase();

  if (!text) {
    return null;
  }

  if (text === "arr" || text === "brd") {
    return 0;
  }

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getStopNote(stopId) {
  if (stopId === "4000296") {
    return "(going to braddock)";
  }

  return "";
}

function createBusIcon(vehicle) {
  const rotation = Number.isFinite(vehicle.heading) ? vehicle.heading : 0;
  const routeLabel = escapeHtml(String(vehicle.routeId || "").slice(0, 4) || "BUS");

  return L.divIcon({
    className: "",
    html: `
      <div class="bus-icon" style="transform: rotate(${rotation}deg); transform-origin: 50% 50%;">
        <svg viewBox="0 0 52 52" aria-hidden="true">
          <g transform="translate(26 26)">
            <path
              d="M 0 -27 L 8 -17 H 4 V -9 H -4 V -17 H -8 Z"
              fill="#d26a4f"
            />
            <path
              d="M 0 -22 L 5 -14 H -5 Z"
              fill="#3d2a22"
            />
            <path
              d="M 0 -16 C 9 -16 16 -10 16 0 V 10 C 16 16 11 20 5 20 H -5 C -11 20 -16 16 -16 10 V 0 C -16 -10 -9 -16 0 -16 Z"
              fill="#ffe8cb"
              stroke="#3d2a22"
              stroke-width="2"
            />
            <path
              d="M -11 0 C -11 -7 -6 -11 0 -11 C 6 -11 11 -7 11 0 V 6 H -11 Z"
              fill="#ffd8c8"
            />
            <path
              d="M -10 -13 L -4 -20 L -1 -12 Z"
              fill="#ffe8cb"
              stroke="#3d2a22"
              stroke-width="2"
              stroke-linejoin="round"
            />
            <path
              d="M 10 -13 L 4 -20 L 1 -12 Z"
              fill="#ffe8cb"
              stroke="#3d2a22"
              stroke-width="2"
              stroke-linejoin="round"
            />
            <circle cx="-5.5" cy="-1" r="2" fill="#3d2a22" />
            <circle cx="5.5" cy="-1" r="2" fill="#3d2a22" />
            <path d="M -2 5 C 0 7 2 7 4 5" fill="none" stroke="#f4a8a1" stroke-width="2.5" stroke-linecap="round" />
            <circle cx="-9" cy="16" r="3.2" fill="#3d2a22" />
            <circle cx="9" cy="16" r="3.2" fill="#3d2a22" />
            <text
              x="0"
              y="12"
              text-anchor="middle"
              fill="#3d2a22"
              class="bus-icon-label"
              transform="rotate(${rotation * -1})"
            >${routeLabel}</text>
          </g>
        </svg>
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -18]
  });
}

function distanceInMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
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
