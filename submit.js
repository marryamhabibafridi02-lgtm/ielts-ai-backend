// api/test/[testId]/submit.js
import FormDataNode from "form-data";

const TESTS = global.TESTS ||= {};
const SUBMISSIONS = global.SUBMISSIONS ||= {};

async function callOpenAIChat(messages) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.0, max_tokens: 900 })
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const { testId } = req.query;
    const test = TESTS[testId];
    if (!test) return res.status(404).json({ error: "test not found" });

    if (req.method === "POST" && req.headers["content-type"] && req.headers["content-type"].startsWith("multipart/form-data")) {
      return res.status(400).json({ error: "Multipart uploads not supported in demo. Send transcript or use base64 + separate upload." });
    }

    const body = req.body || {};
    const answers = body.answers || [];
    if (test.type === "writing") {
      const essay = (answers[0] && answers[0].answerText) || "";
      const writingSystem = `You are an experienced IELTS writing examiner. Given the prompt and the essay, return ONLY valid JSON:
{"estimated_overall_band": 0.0, "band_by_criteria": {"task":0.0,"cohesion":0.0,"lexical":0.0,"grammar":0.0}, "short_feedback":"", "strengths":[], "weaknesses":[], "recommended_actionable_tips":[], "confidence":0.0 }`;

      const userContent = `Prompt:\n${test.questions && test.questions[0] && test.questions[0].prompt}\n\nEssay:\n${essay}`;
      const evalResp = await callOpenAIChat([{ role: "system", content: writingSystem }, { role: "user", content: userContent }]);
      let parsed;
      try { parsed = JSON.parse(evalResp); } catch { parsed = { raw: evalResp }; }
      const jobId = (Math.random()+Date.now()).toString(36);
      SUBMISSIONS[jobId] = { jobId, testId, type: 'writing', answers, result: parsed, createdAt: new Date().toISOString() };
      return res.json({ ok: true, jobId, result: SUBMISSIONS[jobId].result });
    }

    return res.status(400).json({ error: "Unsupported submission type" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
