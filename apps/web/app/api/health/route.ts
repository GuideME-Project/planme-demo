/** ALB target group health check. It intentionally does not touch Redis or external APIs. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
