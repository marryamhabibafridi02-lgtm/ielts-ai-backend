// api/job/[jobId].js
const SUBMISSIONS = global.SUBMISSIONS ||= {};
export default function handler(req, res) {
  const { jobId } = req.query;
  const job = SUBMISSIONS[jobId];
  if (!job) return res.status(404).json({ error: "job not found" });
  return res.json({ ok: true, job });
}
