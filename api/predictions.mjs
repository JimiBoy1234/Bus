const STOPS = [
  { id: "4000296", name: "Mount Vernon Bookstore" },
  { id: "4001060", name: "Rt1 to Potomac Yard" },
  { id: "4001061", name: "Rt1 to Braddock" }
];

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
