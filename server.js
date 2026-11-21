// SRK Film Studio: a private web app where friends pick an SRK-Opuscar style,
// type a topic, and a Claude agent directs and renders the film on this server.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, checkConfig } from './src/config.js';
import { checkPassword, setSession, clearSession, currentUser, requireUser } from './src/auth.js';
import { listStyles, getStyle } from './src/styles.js';
import * as jobs from './src/jobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const problems = checkConfig();
if (problems.length) {
  console.error('Cannot start:\n - ' + problems.join('\n - '));
  process.exit(1);
}
if (!fs.existsSync(path.join(config.lib, 'AGENTS.md'))) {
  console.error(`The SRK-Opuscar library was not found at ${config.lib}. Set SRK_OPUSCAR_HOME.`);
  process.exit(1);
}

jobs.init();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(here, 'public')));

// --- login (simple per-IP throttle against password guessing) ---
const attempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip, now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (a.length >= 10) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  const user = checkPassword(req.body?.name, req.body?.password);
  if (!user) { a.push(now); attempts.set(ip, a); return res.status(401).json({ error: 'Wrong name or password' }); }
  attempts.delete(ip);
  setSession(res, user);
  res.json({ user });
});
app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ user: null });
  res.json({
    user,
    filmsToday: jobs.filmsToday(user),
    filmsPerDay: config.filmsPerDay,
    maxBudgetUsd: config.maxBudgetUsd,
    model: config.model,
    mock: config.mock,
  });
});

app.get('/api/styles', requireUser, (req, res) => res.json(listStyles()));

// --- films ---
app.get('/api/films', requireUser, (req, res) => {
  res.json(jobs.listJobs().map(jobs.publicJob));   // friends can see each other's films
});

app.post('/api/films', requireUser, (req, res) => {
  const b = req.body || {};
  const style = getStyle(String(b.style || ''));
  const topic = String(b.topic || '').trim();
  if (!style) return res.status(400).json({ error: 'Pick a style' });
  if (!style.available) return res.status(400).json({ error: `${style.name}: ${style.unavailableReason}` });
  if (topic.length < 10) return res.status(400).json({ error: 'Describe the topic in at least a sentence' });
  if (config.filmsPerDay > 0 && jobs.filmsToday(req.user) >= config.filmsPerDay) {
    return res.status(429).json({ error: `You have used your ${config.filmsPerDay} films for today. Try again tomorrow.` });
  }
  const brief = {
    style: style.slug,
    styleName: style.name,
    topic: topic.slice(0, 2000),
    language: ['en', 'zh', 'ta', 'hi', 'es', 'fr'].includes(b.language) ? b.language : 'en',
    duration: Math.min(120, Math.max(15, Number(b.duration) || 45)),
    narration: Boolean(b.narration),
    aspect: b.aspect === '9:16' ? '9:16' : '16:9',
    notes: String(b.notes || '').slice(0, 2000),
  };
  const job = jobs.createJob(req.user, brief);
  res.status(201).json(jobs.publicJob(job));
});

app.get('/api/films/:id', requireUser, (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ ...jobs.publicJob(job), log: jobs.readLog(job.id).slice(-400) });
});

app.post('/api/films/:id/cancel', requireUser, (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (job.user !== req.user) return res.status(403).json({ error: 'Only the person who started this film can cancel it' });
  res.json(jobs.publicJob(jobs.cancelJob(job.id)));
});

// live progress (Server-Sent Events)
app.get('/api/films/:id/events', requireUser, (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  const key = `job:${job.id}`;
  jobs.bus.on(key, send);
  req.on('close', () => { clearInterval(ping); jobs.bus.off(key, send); });
});

// downloads: only files listed as deliverables
app.get('/api/films/:id/files/*file', requireUser, (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).end();
  const rel = [].concat(req.params.file).join('/');
  const allowed = jobs.deliverables(job.id).find(f => f.path === rel);
  if (!allowed) return res.status(404).end();
  const abs = path.join(jobs.projectDir(job.id), rel);
  if (req.query.download) res.attachment(path.basename(abs));
  res.sendFile(abs);
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`SRK Film Studio on http://localhost:${config.port}  (${config.mock ? 'TEST MODE: no Claude' : `model ${config.model}`}, ${listStyles().length} styles, library ${config.lib})`);
});
