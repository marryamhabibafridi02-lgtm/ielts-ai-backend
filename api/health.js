// api/health.js
export default function handler(req, res) {
  return res.json({ ok: true, now: new Date().toISOString() });
}
