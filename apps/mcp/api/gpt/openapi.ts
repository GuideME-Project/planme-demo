import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGptsOpenApiRequest } from "../../src/gpts-actions-api.js";

/**
 * Vercel Serverless Function entrypoint for the GPTs Actions OpenAPI schema.
 */
export default function handler(request: IncomingMessage, response: ServerResponse): void {
  // GPT Builder imports this URL before calling the generated REST actions.
  handleGptsOpenApiRequest(request, response);
}
