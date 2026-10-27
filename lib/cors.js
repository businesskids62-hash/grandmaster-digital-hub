export function corsMiddleware(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

export function withCors(handler) {
  return async (req, res) => {
    if (corsMiddleware(req, res)) return;
    return handler(req, res);
  };
}

export default corsMiddleware;
export function getAllowedOrigins() {
  return ["*"];
}
