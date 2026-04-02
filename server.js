const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const WMATA_API_KEY = process.env.WMATA_API_KEY || "";
const PUBLIC_DIR = path.join(__dirname, "public");

const STOPS = [
  { id: "4000296", name: "Mount Vernon Bookstore" },
  { id: "4001060", name: "Rt1 to Potomac Yard" },
  { id: "4001061", name: "Rt1 to Braddock" },
  { id: "4000258", name: "Slater's Lane to DC" }
];
const DASH_STOPS = [
  { id: "4001111", name: "Potomac Yard Glebe Rd" },
  { id: "4000469", name: "Braddock Road" }
];
let stopLocationCache = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/stops") {
    return sendJson(res, 200, { stops: STOPS });
  }

  if (url.pathname === "/api/predictions") {
    if (!WMATA_API_KEY) {
      return sendJson(res, 500, {
        error: "Missing WMATA_API_KEY in .env"
      });
    }

    try {
      const stopData = await Promise.all(STOPS.map(fetchPredictionsForStop));
      return sendJson(res, 200, {
        updatedAt: new Date().toISOString(),
        stops: stopData
      });
    } catch (error) {
      return sendJson(res, 502, {
        error: "Failed to fetch WMATA data",
        details: error.message
      });
    }
  }

  if (url.pathname === "/api/map-data") {
    if (!WMATA_API_KEY) {
      return sendJson(res, 500, {
        error: "Missing WMATA_API_KEY in .env"
      });
    }

    try {
      const predictions = await Promise.all(STOPS.map(fetchPredictionsForStop));
      const stopLocations = await fetchStopLocations();
      const routeIds = Array.from(
        new Set(
          predictions.flatMap((stop) => stop.predictions.map((prediction) => prediction.routeId)).filter(Boolean)
        )
      );
      const vehicles = await fetchBusPositionsForRoutes(routeIds);

      return sendJson(res, 200, {
        updatedAt: new Date().toISOString(),
        stops: stopLocations,
        vehicles
      });
    } catch (error) {
      return sendJson(res, 502, {
        error: "Failed to fetch WMATA map data",
        details: error.message
      });
    }
  }

  if (url.pathname === "/api/dash-predictions") {
    if (!WMATA_API_KEY) {
      return sendJson(res, 500, { error: "Missing WMATA_API_KEY in .env" });
    }

    try {
      const stopData = await Promise.all(DASH_STOPS.map(fetchPredictionsForStop));
      return sendJson(res, 200, {
        updatedAt: new Date().toISOString(),
        stops: stopData
      });
    } catch (error) {
      return sendJson(res, 502, {
        error: "Failed to fetch DASH data",
        details: error.message
      });
    }
  }

  return serveStaticFile(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`WMATA bus dashboard running at http://${HOST}:${PORT}`);
});

async function fetchPredictionsForStop(stop) {
  const endpoint = new URL("https://api.wmata.com/NextBusService.svc/json/jPredictions");
  endpoint.searchParams.set("StopID", stop.id);

  const response = await fetch(endpoint, {
    headers: {
      api_key: WMATA_API_KEY
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WMATA ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const predictions = Array.isArray(data.Predictions) ? data.Predictions : [];

  return {
    ...stop,
    stopName: data.StopName || stop.name,
    predictions: predictions.map((prediction) => ({
      routeId: prediction.RouteID || prediction.RouteId || "Route",
      directionText: prediction.DirectionText || "",
      directionNum: prediction.DirectionNum || "",
      tripId: prediction.TripID || "",
      tripHeadSign: prediction.TripHeadSign || "",
      minutes: prediction.Minutes || "",
      vehicleId: prediction.VehicleID || "",
      deviationText: prediction.DeviationText || ""
    }))
  };
}

async function fetchStopLocations() {
  if (stopLocationCache) {
    return stopLocationCache;
  }

  const response = await fetch("https://api.wmata.com/Bus.svc/json/jStops", {
    headers: {
      api_key: WMATA_API_KEY
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WMATA stops ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const allStops = Array.isArray(data.Stops) ? data.Stops : [];

  stopLocationCache = STOPS.map((stop) => {
    const match = allStops.find((item) => String(item.StopID) === stop.id);

    return {
      ...stop,
      stopName: match?.Name || stop.name,
      lat: Number(match?.Lat),
      lon: Number(match?.Lon)
    };
  });

  return stopLocationCache;
}

async function fetchBusPositionsForRoutes(routeIds) {
  const results = await Promise.all(routeIds.map((routeId) => fetchBusPositionsForRoute(routeId)));
  const byVehicleId = new Map();

  for (const vehicle of results.flat()) {
    if (!vehicle.vehicleId || byVehicleId.has(vehicle.vehicleId)) {
      continue;
    }

    byVehicleId.set(vehicle.vehicleId, vehicle);
  }

  return Array.from(byVehicleId.values());
}

async function fetchBusPositionsForRoute(routeId) {
  const endpoint = new URL("https://api.wmata.com/Bus.svc/json/jBusPositions");
  endpoint.searchParams.set("RouteID", routeId);

  const response = await fetch(endpoint, {
    headers: {
      api_key: WMATA_API_KEY
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WMATA positions ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const busPositions = Array.isArray(data.BusPositions) ? data.BusPositions : [];

  return busPositions.map((bus) => ({
    vehicleId: bus.VehicleID || "",
    routeId: bus.RouteID || routeId,
    tripId: bus.TripID || "",
    directionText: bus.DirectionText || "",
    tripHeadsign: bus.TripHeadsign || "",
    heading: Number(bus.Heading),
    lat: Number(bus.Lat),
    lon: Number(bus.Lon),
    deviation: bus.Deviation ?? null,
    updatedAt: bus.DateTime || ""
  }));
}

function serveStaticFile(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const fullPath = path.join(PUBLIC_DIR, path.normalize(safePath));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      return sendText(res, 404, "Not found");
    }

    res.writeHead(200, { "Content-Type": getContentType(fullPath) });
    res.end(content);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath);

  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
