// api/order-test.js
import { v4 as uuidv4 } from "uuid";

const ORDERS = global.ORDERS ||= {};
const TESTS = global.TESTS ||= {};

async function callOpenAIChat(messages) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.0, max_tokens: 900 })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "";
}

async function generateTest(type="writing", level="ielts-6", numTasks=1) {
  const id = uuidv4();
  if (type === "writing") {
    const sys = `You are an expert IELTS writer. Create ${numTasks} Writing Task 2 prompt suitable for level ${level}. Return ONLY valid JSON like:
{"test_id":"${id}","type":"writing","level":"${level}","questions":[{"id":"q1","title":"Task 2","prompt":"..."}]}`;
    try {
      const ai = await callOpenAIChat([{role:"system", content: sys}, {role:"user", content:"Return JSON only."}]);
      const parsed = JSON.parse(ai);
      return parsed;
    } catch (e) {
      return { test_id: id, type: "writing", level, questions: [{ id: "q1", title: "Task 2", prompt: "Write an essay (250+ words) on: The benefits of online education." }] };
    }
  }
  if (type === "speaking") {
    return {
      test_id: id, type: "speaking", level,
      parts: [
        { part: 1, items: [{ id: 'p1q1', q: 'What is your full name?' }] },
        { part: 2, cue: 'Describe a memorable trip you had.', prep_time: 60, speak_time: 120 }
      ]
    };
  }
  return { test_id: id, type, level, questions: [] };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { testType, level, numTasks } = req.body || {};
    if (!testType) return res.status(400).json({ error: "testType required" });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "guest";
    global.RATE ||= {};
    global.RATE[ip] = global.RATE[ip] || [];
    const now = Date.now();
    global.RATE[ip] = global.RATE[ip].filter(t => now - t < 24*60*60*1000);
    if (global.RATE[ip].length >= 5) return res.status(429).json({ error: "Rate limit: max 5 free tests/day" });
    global.RATE[ip].push(now);

    const orderId = uuidv4();
    const test = await generateTest(testType, level || "ielts-6", numTasks || 1);
    const testId = test.test_id || uuidv4();
    TESTS[testId] = test;
    const siteBase = process.env.SITE_BASE || "";
    const testUrl = siteBase ? `${siteBase}/?testId=${encodeURIComponent(testId)}` : `/?testId=${encodeURIComponent(testId)}`;
    const order = { orderId, testId, test, status: "ready", createdAt: new Date().toISOString(), type: testType, level: level || "ielts-6", testUrl };
    ORDERS[orderId] = order;
    return res.json({ ok: true, orderId, testId, testUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
