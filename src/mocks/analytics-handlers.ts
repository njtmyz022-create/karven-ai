import { http, HttpResponse } from "msw";

// Mock builds must not bake a vendor analytics destination into the customer
// bundle. Match the ingestion path independently of the configured host; the
// Karven product build keeps telemetry disabled unless explicitly configured.
export const ANALYTICS_HANDLERS = [
  http.post("*/e", async () => HttpResponse.json(null, { status: 200 })),
];
