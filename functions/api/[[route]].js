/**
 * Cloudflare Pages Functions Catch-All Router (`functions/api/[[route]].js`)
 * Forwards all `/api/*` requests to `backend/worker.js` using Pages bindings (`context.env.DB`, `context.env.FILES`, `context.env.ADMIN_PASSWORD`).
 */

const worker = require("../../backend/worker.js");

export async function onRequest(context) {
  return worker.handleApiRequest(context.request, context.env);
}
