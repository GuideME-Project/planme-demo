export function isAuthorizedPlanmeInternalRequest(request: Request) {
  const configuredToken = process.env.PLANME_INTERNAL_API_TOKEN?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const providedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  return Boolean(
    configuredToken &&
      providedToken &&
      constantTimeTextEqual(configuredToken, providedToken),
  );
}

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
