const board = document.getElementById("board");
const statusPill = document.getElementById("status-pill");
const refreshButton = document.getElementById("refresh-button");
const stopTemplate = document.getElementById("stop-template");

const REFRESH_INTERVAL_MS = 30000;

refreshButton.addEventListener("click", () => {
  loadPredictions();
});

loadPredictions();
setInterval(loadPredictions, REFRESH_INTERVAL_MS);

async function loadPredictions() {
  statusPill.textContent = "Refreshing live data...";
  refreshButton.disabled = true;

  try {
    const response = await fetch("/api/predictions");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    renderStops(data.stops || []);
    statusPill.textContent = `Updated ${formatTimestamp(data.updatedAt)}`;
  } catch (error) {
    board.innerHTML = `<div class="empty-state">Unable to load WMATA data. ${escapeHtml(error.message)}</div>`;
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
