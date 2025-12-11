// api/test/[testId].js
const TESTS = global.TESTS ||= {};

export default function handler(req, res) {
  const { testId } = req.query;
  const t = TESTS[testId];
  if (!t) return res.status(404).json({ error: "test not found" });
  return res.json({ ok: true, test: t });
}
