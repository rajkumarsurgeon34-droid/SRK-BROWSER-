// MOCK_AGENT=1: no Claude. Writes a 6-second test film page and renders it with the
// library's own tools, so the whole pipeline (Chromium, ffmpeg, downloads) can be checked for free.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { getStyle } from './styles.js';

function sh(cmd, args, { cwd, log, signal }) {
  return new Promise((resolve, reject) => {
    log('tool', `$ ${cmd} ${args.join(' ')}`.replaceAll(config.lib, '$LIB').replaceAll(config.dataDir, '$DATA'));
    const p = spawn(cmd, args, { cwd, signal, env: process.env });
    const onLine = d => String(d).split('\n').filter(l => l.trim()).forEach(l => log('debug', l.slice(0, 300)));
    p.stdout.on('data', onLine); p.stderr.on('data', onLine);
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

const page = (title, sub) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c"></canvas>
<script type="module">
import { ss, seg, mulberry } from '/core/lib.js';
const c = document.getElementById('c'), g = c.getContext('2d');
const W = c.width = innerWidth, H = c.height = innerHeight;
const TITLE = ${JSON.stringify(title)}, SUB = ${JSON.stringify(sub)};
window.DUR = 6;
window.render = t => {
  const r = mulberry(7);
  g.fillStyle = '#14121f'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    const x = r() * W, y = (r() * H + t * 40 * (0.3 + r())) % H, s = 1 + r() * 3;
    g.fillStyle = 'rgba(255,214,140,' + (0.25 + 0.5 * r()) + ')'; g.fillRect(x, y, s, s);
  }
  const a = ss(seg(t, 0.4, 1.6)) * (1 - ss(seg(t, 5.0, 5.8)));
  g.globalAlpha = a; g.fillStyle = '#ffe7c2'; g.textAlign = 'center';
  g.font = '700 ' + Math.round(H * 0.08) + 'px Georgia, serif'; g.fillText(TITLE, W / 2, H * 0.48);
  g.font = Math.round(H * 0.035) + 'px Georgia, serif'; g.fillStyle = '#c9b8ff'; g.fillText(SUB, W / 2, H * 0.58);
  g.globalAlpha = 1;
};
window.TEXTS = t => [{ id: 'title', text: TITLE, x0: 0, y0: 0, x1: W, y1: H }];
document.fonts.ready.then(() => { window.READY = true; });
</script>`;

export async function runMock({ job, project, log, signal }) {
  const style = getStyle(job.brief.style);
  log('step', 'Test mode: rendering a 6-second pipeline check (no Claude, no cost)');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'index.html'), page(job.brief.topic.slice(0, 60), `Test render · ${style?.name || job.brief.style}`));
  fs.writeFileSync(path.join(project, 'TREATMENT.md'), `# Test film\n\nMOCK_AGENT=1: this is a pipeline check, not a real film.\n\nTopic: ${job.brief.topic}\n`);
  fs.writeFileSync(path.join(project, 'CREDITS'), 'Pipeline test. Rendered with the SRK-Opuscar core tools (MIT).\n');
  const size = job.brief.aspect === '9:16' ? ['--size', '1080x1920'] : [];
  const opts = { cwd: config.lib, log, signal };
  log('step', 'Rendering frames in headless Chrome');
  await sh('node', ['core/render/video.mjs', project, '--fps', '24', '--workers', '2', ...size, '--out', path.join(project, 'out', 'video.mp4')], opts);
  log('step', 'Adding a quiet tone and muxing');
  const mix = path.join(project, 'out', 'mix.wav');
  await sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-af', 'volume=0.2,afade=t=in:d=1,afade=t=out:st=5:d=1', '-ar', '48000', '-ac', '2', mix], opts);
  await sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(project, 'out', 'video.mp4'), '-i', mix, '-c:v', 'copy', '-c:a', 'aac', '-shortest', path.join(project, 'test-film.mp4')], opts);
  await sh('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2.5', '-i', path.join(project, 'test-film.mp4'), '-frames:v', '1', path.join(project, 'poster.jpg')], opts);
  return { costUsd: 0, summary: 'A 6-second test render that checks Chromium, ffmpeg and the library tools are working.' };
}
