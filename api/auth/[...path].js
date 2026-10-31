import { handleAuthEndpoint } from "../../lib/vercel/endpoints.js";

// Catch-all adapter for /api/auth/* on Vercel. The account, session, login,
// signup, logout, password and delete-account endpoints share this one
// function so the deployment stays inside the plan's Serverless Function cap.
// Behaviour lives in lib/auth/routes.js.
export default async function handler(req, res) {
  return handleAuthEndpoint(req, res);
}
