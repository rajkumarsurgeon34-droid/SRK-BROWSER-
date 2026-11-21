// Film jobs: stored as JSON files, run one (or CONCURRENCY) at a time, with a live log.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { runAgent } from './agent.js';
import { runMock } from './mock.js';

const JOBS = () => path.join(config.dataDir, 'jobs');
const FILMS = () => path.join(config.dataDir, 'films');
export const bus = new EventEmitter();
bus.setMaxListeners(0);

const queue = [];
const running = new Map();   // id -> AbortController

export function filmDir(id) { return path.join(FILMS(), id); }
export function projectDir(id) { return path.join(filmDir(id), 'film'); }
const jobFile = id => path.join(JOBS(), `${id}.json`);
const logFile = id => path.join(filmDir(id), 'log.jsonl');

export function init() {
  fs.mkdirSync(JOBS(), { recursive: true });
  fs.mkdirSync(FILMS(), { recursive: true });
  // after a restart: queued jobs go back in the queue, interrupted ones are marked failed
  for (const j of listJobs()) {
    if (j.status === 'queued') queue.push(j.id);
    if (j.status === 'running') update(j.id, { status: 'failed', error: 'The server restarted while this film was being made', finishedAt: Date.now() });
  }
  pump();
}

export function getJob(id) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(jobFile(id), 'utf8')); } catch { return null; }
}

export function listJobs() {
  let names = [];
  try { names = fs.readdirSync(JOBS()); } catch { return []; }
  return names.filter(n => n.endsWith('.json'))
    .map(n => getJob(n.slice(0, -5))).filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function save(job) {
  const tmp = jobFile(job.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, jobFile(job.id));
}

function update(id, patch) {
  const job = { ...getJob(id), ...patch };
  save(job);
  bus.emit(`job:${id}`, { type: 'status', job: publicJob(job) });
  return job;
}

export function publicJob(j) {
  const { brief, ...rest } = j;
  return { ...rest, brief, queuePosition: j.status === 'queued' ? queue.indexOf(j.id) + 1 : null };
}

export function filmsToday(user) {
  const since = Date.now() - 24 * 3600 * 1000;
  return listJobs().filter(j => j.user === user && j.createdAt > since && j.status !== 'cancelled').length;
}

export function createJob(user, brief) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, user, brief, status: 'queued', createdAt: Date.now(), costUsd: null, files: [] };
  fs.mkdirSync(projectDir(id), { recursive: true });
  save(job);
  queue.push(id);
  pump();
  return job;
}

export function cancelJob(id) {
  const job = getJob(id);
  if (!job) return null;
  if (job.status === 'queued') {
    const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1);
    return update(id, { status: 'cancelled', finishedAt: Date.now() });
  }
  if (job.status === 'running') { running.get(id)?.abort(); return getJob(id); }
  return job;
}

export function readLog(id) {
  try {
    return fs.readFileSync(logFile(id), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

function logger(id) {
  return (kind, text) => {
    const entry = { t: Date.now(), kind, text: String(text).slice(0, 4000) };
    fs.appendFileSync(logFile(id), JSON.stringify(entry) + '\n');
    bus.emit(`job:${id}`, { type: 'log', entry });
  };
}

function pump() {
  while (running.size < config.concurrency && queue.length) {
    const id = queue.shift();
    run(id);
  }
  // tell waiting jobs their new place in the queue
  queue.forEach((qid, i) => bus.emit(`job:${qid}`, { type: 'queue', position: i + 1 }));
}

async function run(id) {
  const ac = new AbortController();
  running.set(id, ac);
  const log = logger(id);
  const job = update(id, { status: 'running', startedAt: Date.now() });
  try {
    const runner = config.mock ? runMock : runAgent;
    const result = await runner({ job, project: projectDir(id), log, signal: ac.signal });
    const files = deliverables(id);
    if (!files.some(f => f.kind === 'film')) throw new Error(result?.error || 'The agent finished but no film (.mp4) was found');
    update(id, { status: 'done', finishedAt: Date.now(), costUsd: result?.costUsd ?? null, summary: result?.summary || null, files });
    log('done', 'Film ready');
  } catch (e) {
    const cancelled = ac.signal.aborted;
    log('error', cancelled ? 'Cancelled' : e.message);
    update(id, {
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? null : e.message,
      costUsd: e.costUsd ?? null,
      finishedAt: Date.now(),
      files: deliverables(id),
    });
  } finally {
    running.delete(id);
    pump();
  }
}

// What the friend can download: the film, poster, subtitles, treatment and credits.
export function deliverables(id) {
  const root = projectDir(id);
  const out = [];
  const consider = (abs) => {
    const rel = path.relative(root, abs);
    const name = path.basename(abs);
    const ext = path.extname(name).toLowerCase();
    if (rel.split(path.sep).some(p => p.startsWith('.') || p === 'node_modules' || p === 'stills')) return;
    let kind = null;
    if (ext === '.mp4' && !/^(video|out)$/i.test(path.basename(name, ext)) && !rel.startsWith('out' + path.sep)) kind = 'film';
    else if (name === 'poster.jpg') kind = 'poster';
    else if (ext === '.srt') kind = 'subtitles';
    else if (name === 'TREATMENT.md') kind = 'treatment';
    else if (name === 'CREDITS') kind = 'credits';
    if (kind) out.push({ kind, path: rel.split(path.sep).join('/'), size: fs.statSync(abs).size });
  };
  // deliverables sit at the top of the project folder (DIRECTOR.md §11); look one level down as a fallback
  for (const d of [root, ...safeDirs(root)]) for (const n of safeList(d)) {
    const abs = path.join(d, n);
    if (fs.statSync(abs).isFile()) consider(abs);
  }
  // prefer top-level films; drop intermediate renders if a final one exists
  const films = out.filter(f => f.kind === 'film');
  if (films.length > 1) {
    const top = films.filter(f => !f.path.includes('/'));
    if (top.length) return out.filter(f => f.kind !== 'film' || top.includes(f));
  }
  return out;
}

const safeList = d => { try { return fs.readdirSync(d); } catch { return []; } };
const safeDirs = d => safeList(d).map(n => path.join(d, n)).filter(p => { try { return fs.statSync(p).isDirectory() && !path.basename(p).startsWith('.') && path.basename(p) !== 'node_modules'; } catch { return false; } });
