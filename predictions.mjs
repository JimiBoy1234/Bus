const STOPS = [
  { id: "4000296", name: "Mount Vernon Bookstore" },
  { id: "4001060", name: "Rt1 to Potomac Yard" },
  { id: "4001061", name: "Rt1 to Braddock" }
];
let stopLocationCache = null;

export async function GET() {
  const apiKey = process.env.WMATA_API_KEY || "";

  if (!apiKey) {
    return json(
      {
        error: "Missing WMATA_API_KEY environment variable"
      },
      500
    );
  }

  try {
    const stops = await Promise.all(STOPS.map((stop) => fetchPredictionsForStop(stop, apiKey)));

    return json({
      updatedAt: new Date().toISOString(),
      stops
    });
  } catch (error) {
    return json(
      {
        error: "Failed to fetch WMATA data",
        details: error.message
      },
      502
    );
  }
}

async function fetchPredictionsForStop(stop, apiKey) {
  const endpoint = new URL("https://api.wmata.com/NextBusService.svc/json/jPredictions");
  endpoint.searchParams.set("StopID", stop.id);

  const response = await fetch(endpoint, {
    headers: {
      api_key: apiKey
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
      routeId: prediction.RouteID || "Route",
      directionText: prediction.DirectionText || "",
      directionNum: prediction.DirectionNum || "",
      tripId: prediction.TripID || "",
      minutes: prediction.Minutes || "",
      vehicleId: prediction.VehicleID || ""
    }))
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export async function fetchStopLocations(apiKey) {
  if (stopLocationCache) {
    return stopLocationCache;
  }

  const response = await fetch("https://api.wmata.com/Bus.svc/json/jStops", {
    headers: {
      api_key: apiKey
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

export async function fetchBusPositionsForRoutes(routeIds, apiKey) {
  const results = await Promise.all(routeIds.map((routeId) => fetchBusPositionsForRoute(routeId, apiKey)));
  const byVehicleId = new Map();

  for (const vehicle of results.flat()) {
    if (!vehicle.vehicleId || byVehicleId.has(vehicle.vehicleId)) {
      continue;
    }

    byVehicleId.set(vehicle.vehicleId, vehicle);
  }

  return Array.from(byVehicleId.values());
}

async function fetchBusPositionsForRoute(routeId, apiKey) {
  const endpoint = new URL("https://api.wmata.com/Bus.svc/json/jBusPositions");
  endpoint.searchParams.set("RouteID", routeId);

  const response = await fetch(endpoint, {
    headers: {
      api_key: apiKey
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
    lat: Number(bus.Lat),
    lon: Number(bus.Lon),
    deviation: bus.Deviation ?? null,
    updatedAt: bus.DateTime || ""
  }));
}
