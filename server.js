/**
 * Minimal IELTS AI backend (demo, free-tests friendly).
 * - Generates tests with an LLM
 * - Returns tests
 * - Accepts submissions (writing JSON or speaking audio)
 * - Uses OpenAI Chat completions and audio transcription (whisper-1)
 *
 * IMPORTANT: This is a demo in-memory server. For production use DB + S3 + auth + rate-limits.
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const SITE_BASE = process.env.SITE_BASE || '';

if (!OPENAI_KEY) console.warn('Warning: OPENAI_API_KEY is not set. Set it in env for production.');

app.use(cors({ origin: ALLOW_ORIGIN, credentials: true }));
app.use(express.json({ limit: '3mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// In-memory stores for demo
const ORDERS = {};
const TESTS = {};
const SUBMISSIONS = {}; // jobId -> result

// Helper: call OpenAI Chat Completions
async function callOpenAIChat(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.0,
      max_tokens: 900
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI chat error: ${res.status} ${text}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

// Simple test generator (writing & speaking minimal)
async function generateTest(type = 'writing', level = 'ielts-6', numTasks = 1) {
  const id = uuidv4();
  if (type === 'writing') {
    const sys = `You are an expert IELTS writer. Create ${numTasks} Writing Task 2 prompts suitable for level ${level}. Return ONLY valid JSON like:
{"test_id":"${id}","type":"writing","level":"${level}","questions":[{"id":"q1","title":"Task 2","prompt":"..."}]}`;
    try {
      const ai = await callOpenAIChat([{ role: 'system', content: sys }, { role: 'user', content: 'Return JSON only.' }]);
      const parsed = JSON.parse(ai);
      return parsed;
    } catch (e) {
      // fallback minimal prompt
      return { test_id: id, type: 'writing', level, questions: [{ id: 'q1', title: 'Task 2', prompt: 'Write an essay (250+ words) on: The benefits of online education.' }] };
    }
  }

  if (type === 'speaking') {
    // quick sample speaking test
    return {
      test_id: id,
      type: 'speaking',
      level,
      parts: [
        { part: 1, items: [{ id: 'p1q1', q: 'What is your full name?' }, { id: 'p1q2', q: 'Where are you from?' }] },
        { part: 2, cue: 'Describe a memorable trip you had.', prep_time: 60, speak_time: 120 },
        { part: 3, items: [{ id: 'p3q1', q: 'Why do people travel?' }] }
      ]
    };
  }

  // default stub
  return { test_id: id, type, level, questions: [] };
}

/* ----------------- ROUTES ----------------- */

/* Order a test (generate) */
app.post('/api/order-test', async (req, res) => {
  try {
    const { testType, level, numTasks } = req.body || {};
    if (!testType) return res.status(400).json({ error: 'testType required' });

    const orderId = uuidv4();
    const test = await generateTest(testType, level || 'ielts-6', numTasks || 1);
    const testId = test.test_id || uuidv4();
    TESTS[testId] = test;
    const testUrl = `${SITE_BASE || ''}/?testId=${encodeURIComponent(testId)}`;

    const order = { orderId, testId, test, status: 'ready', createdAt: new Date().toISOString(), type: testType, level: level || 'ielts-6', testUrl };
    ORDERS[orderId] = order;

    return res.json({ ok: true, orderId, testId, testUrl });
  } catch (err) {
    console.error('order-test error', err);
    return res.status(500).json({ error: err.message });
  }
});

/* List my tests (demo: returns all orders). In production, filter by user. */
app.get('/api/my-tests', (req, res) => {
  const list = Object.values(ORDERS).map(o => ({
    orderId: o.orderId,
    testId: o.testId,
    type: o.type,
    level: o.level,
    status: o.status,
    createdAt: o.createdAt,
    testUrl: `${SITE_BASE || ''}/?testId=${encodeURIComponent(o.testId)}`
  }));
  res.json({ ok: true, tests: list });
});

/* Fetch generated test */
app.get('/api/test/:testId', (req, res) => {
  const t = TESTS[req.params.testId];
  if (!t) return res.status(404).json({ error: 'test not found' });
  return res.json({ ok: true, test: t });
});

/* Submit answers (supports JSON writing submissions or multipart speaking audio) */
app.post('/api/test/:testId/submit', upload.single('audio'), async (req, res) => {
  try {
    const tid = req.params.testId;
    const test = TESTS[tid];
    if (!test) return res.status(404).json({ error: 'test not found' });

    // speaking: multipart with audio
    if (req.file) {
      // transcribe with OpenAI whisper
      const form = new FormData();
      form.append('file', req.file.buffer, { filename: 'upload.wav' });
      form.append('model', 'whisper-1');

      const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: form
      });
      if (!tr.ok) {
        const text = await tr.text();
        throw new Error('Transcription failed: ' + text);
      }
      const trj = await tr.json();
      const transcript = trj.text || '';

      // grading prompt for speaking
      const speakingSystem = `You are an experienced IELTS speaking examiner. Given the transcript, return ONLY valid JSON:
{"estimated_overall_band": float, "band_by_criteria":{"fluency":float,"lexical":float,"grammar":float,"pronunciation":float}, "short_feedback":"...", "strengths":[...], "weaknesses":[...], "recommended_actionable_tips":[...], "confidence": float }`;

      const evalResp = await callOpenAIChat([{ role: 'system', content: speakingSystem }, { role: 'user', content: `Transcript:\n\n${transcript}` }]);
      let parsed;
      try { parsed = JSON.parse(evalResp); } catch (e) { parsed = { raw: evalResp }; }
      const jobId = uuidv4();
      SUBMISSIONS[jobId] = { jobId, testId: tid, type: 'speaking', transcript, result: parsed, createdAt: new Date().toISOString() };
      // mark any order with this testId as graded
      Object.values(ORDERS).forEach(o => { if (o.testId === tid) o.status = 'graded'; });
      return res.json({ ok: true, jobId, result: SUBMISSIONS[jobId].result });
    }

    // else expect JSON { answers: [{ questionId, answerText }, ...] }
    const body = req.body || {};
    const answers = body.answers || [];
    if (test.type === 'writing') {
      const essay = (answers[0] && answers[0].answerText) || '';
      const writingSystem = `You are an experienced IELTS writing examiner. Given the prompt and the essay, return ONLY valid JSON:
{"estimated_overall_band": float, "band_by_criteria": {"task": float, "cohesion": float, "lexical": float, "grammar": float}, "short_feedback":"...", "strengths":[...], "weaknesses":[...], "recommended_actionable_tips":[...], "confidence": float }`;

      const userContent = `Prompt:\n${test.questions && test.questions[0] && test.questions[0].prompt}\n\nEssay:\n${essay}`;
      const evalResp = await callOpenAIChat([{ role: 'system', content: writingSystem }, { role: 'user', content: userContent }]);
      let parsed;
      try { parsed = JSON.parse(evalResp); } catch (e) { parsed = { raw: evalResp }; }
      const jobId = uuidv4();
      SUBMISSIONS[jobId] = { jobId, testId: tid, type: 'writing', answers, result: parsed, createdAt: new Date().toISOString() };
      Object.values(ORDERS).forEach(o => { if (o.testId === tid) o.status = 'graded'; });
      return res.json({ ok: true, jobId, result: SUBMISSIONS[jobId].result });
    }

    return res.status(400).json({ error: 'Unsupported submission type' });
  } catch (err) {
    console.error('submit error', err);
    return res.status(500).json({ error: err.message });
  }
});

/* Job status */
app.get('/api/job/:jobId', (req, res) => {
  const job = SUBMISSIONS[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'job not found' });
  return res.json({ ok: true, job });
});

/* Health */
app.get('/api/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

app.listen(PORT, () => console.log(`IELTS AI backend running on port ${PORT}`));
