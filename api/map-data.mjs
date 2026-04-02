import { GET as getPredictions, fetchBusPositionsForRoutes, fetchStopLocations } from "./predictions.mjs";

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
    const predictionResponse = await getPredictions();
    const predictionData = await predictionResponse.json();
    const routeIds = Array.from(
      new Set(
        (predictionData.stops || [])
          .flatMap((stop) => stop.predictions || [])
          .map((prediction) => prediction.routeId)
          .filter(Boolean)
      )
    );

    const [stops, vehicles] = await Promise.all([
      fetchStopLocations(apiKey),
      fetchBusPositionsForRoutes(routeIds, apiKey)
    ]);

    return json({
      updatedAt: new Date().toISOString(),
      stops,
      vehicles
    });
  } catch (error) {
    return json(
      {
        error: "Failed to fetch WMATA map data",
        details: error.message
      },
      502
    );
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
