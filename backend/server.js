// Minimal reminder backend: schedules Twilio SMS / voice calls.
//
// NOTE: jobs are held in memory with setTimeout, so they are lost if the
// server restarts. For production, store them in a database and use a job
// queue (e.g. BullMQ, Agenda) or Twilio's own Message Scheduling.
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const twilio = require('twilio');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  PORT = 3000,
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error('Missing Twilio env vars. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const app = express();
app.use(express.json());

const jobs = new Map(); // id -> timeout handle
const MAX_DELAY_MS = 2 ** 31 - 1; // setTimeout limit (~24.8 days)

async function deliver({ phoneNumber, message, type }) {
  if (type === 'sms') {
    await client.messages.create({ to: phoneNumber, from: TWILIO_PHONE_NUMBER, body: message });
  } else {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, message);
    twiml.pause({ length: 1 });
    twiml.say({ voice: 'alice' }, message);
    await client.calls.create({ to: phoneNumber, from: TWILIO_PHONE_NUMBER, twiml: twiml.toString() });
  }
}

app.post('/api/send-reminder', (req, res) => {
  const { phoneNumber, message, type, sendAt } = req.body || {};

  if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber || '')) {
    return res.status(400).json({ error: 'phoneNumber must be in E.164 format, e.g. +14155550123' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  if (type !== 'sms' && type !== 'call') {
    return res.status(400).json({ error: "type must be 'sms' or 'call'" });
  }

  const when = sendAt ? new Date(sendAt) : new Date();
  if (Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: 'sendAt must be an ISO date string' });
  }
  const delay = Math.max(0, when.getTime() - Date.now());
  if (delay > MAX_DELAY_MS) {
    return res.status(400).json({ error: 'sendAt is too far in the future' });
  }

  const id = crypto.randomUUID();
  const handle = setTimeout(async () => {
    jobs.delete(id);
    try {
      await deliver({ phoneNumber, message: message.slice(0, 500), type });
      console.log(`[${id}] ${type} sent to ${phoneNumber}`);
    } catch (err) {
      console.error(`[${id}] Failed to send ${type}:`, err.message);
    }
  }, delay);
  jobs.set(id, handle);

  console.log(`[${id}] ${type} scheduled for ${when.toISOString()}`);
  res.status(201).json({ id, scheduledFor: when.toISOString() });
});

app.delete('/api/send-reminder/:id', (req, res) => {
  const handle = jobs.get(req.params.id);
  if (!handle) return res.status(404).json({ error: 'Not found' });
  clearTimeout(handle);
  jobs.delete(req.params.id);
  res.status(204).end();
});

app.get('/health', (_req, res) => res.json({ ok: true, pending: jobs.size }));

app.listen(PORT, () => console.log(`Reminder backend listening on :${PORT}`));
