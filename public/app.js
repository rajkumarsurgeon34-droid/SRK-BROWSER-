// SRK Film Studio front end: login, new film form, film list, live progress.
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
let me = null;
let styles = [];
let stream = null;

const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw Object.assign(new Error(data?.error || `Error ${r.status}`), { status: r.status });
  return data;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mount = id => { app.replaceChildren($(id).content.cloneNode(true)); };
const ago = t => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};
const STATUS = { queued: 'Waiting', running: 'Making…', done: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
const fileUrl = (id, p, dl) => `/api/films/${id}/files/${p.split('/').map(encodeURIComponent).join('/')}${dl ? '?download=1' : ''}`;

async function route() {
  if (stream) { stream.close(); stream = null; }
  me = await api('/api/me');
  renderWho();
  if (!me.user) return showLogin();
  const m = location.hash.match(/^#\/film\/([a-f0-9]{16})$/);
  if (m) return showFilm(m[1]);
  return showHome();
}

function renderWho() {
  const who = $('#who');
  if (!me?.user) { who.textContent = ''; return; }
  who.innerHTML = `<span>${esc(me.user)}</span> <button class="link" id="logout">Log out</button>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.hash = '#/'; route(); };
}

function showLogin() {
  mount('#tpl-login');
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ name: f.get('name'), password: f.get('password') }) });
      route();
    } catch (err) { $('#login-error').textContent = err.message; }
  };
}

async function showHome() {
  mount('#tpl-home');
  const left = me.filmsPerDay ? Math.max(0, me.filmsPerDay - me.filmsToday) : '∞';
  $('#quota').textContent = `${left} film${left === 1 ? '' : 's'} left today`;
  $('#cost-note').textContent = me.mock
    ? 'Test mode is on: this makes a 6-second pipeline check, not a real film.'
    : `A film takes about 20–90 minutes and is capped at $${me.maxBudgetUsd} of Claude usage. You can close this page; it keeps going.`;

  if (!styles.length) styles = await api('/api/styles');
  renderStyles('');
  $('#style-search').oninput = e => renderStyles(e.target.value);

  const form = $('#new-film');
  form.onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(form);
    if (!f.get('style')) { $('#new-error').textContent = 'Pick a style first.'; return; }
    $('#submit').disabled = true; $('#new-error').textContent = '';
    try {
      const job = await api('/api/films', { method: 'POST', body: JSON.stringify({
        topic: f.get('topic'), style: f.get('style'), language: f.get('language'),
        duration: Number(f.get('duration')), aspect: f.get('aspect'),
        narration: f.get('narration') === 'on', notes: f.get('notes'),
      }) });
      location.hash = `#/film/${job.id}`;
    } catch (err) { $('#new-error').textContent = err.message; $('#submit').disabled = false; }
  };
  loadFilms();
}

function renderStyles(q) {
  const box = $('#styles'); if (!box) return;
  const picked = $('input[name=style]').value;
  const needle = q.trim().toLowerCase();
  const list = styles.filter(s => !needle || [s.name, s.nameCn, s.category, s.slug, s.line, ...(s.uses || [])].join(' ').toLowerCase().includes(needle));
  let html = '', cat = null;
  for (const s of list) {
    if (s.category !== cat) { cat = s.category; html += `<div class="cat">${esc(cat)}</div>`; }
    html += `<button type="button" class="style" role="option" data-slug="${esc(s.slug)}" aria-selected="${s.slug === picked}"
      ${s.available ? '' : `disabled title="${esc(s.unavailableReason)}"`}>
      <b>${esc(s.name)}</b><span>${esc(s.available ? (s.uses || []).slice(0, 2).join(' · ') : 'Not available here')}</span></button>`;
  }
  box.innerHTML = html || '<p class="muted">No style matches.</p>';
  box.querySelectorAll('.style').forEach(b => b.onclick = () => pickStyle(b.dataset.slug));
}

function pickStyle(slug) {
  const s = styles.find(x => x.slug === slug);
  $('input[name=style]').value = slug;
  $('#style-picked').innerHTML = `<strong>${esc(s.name)}</strong>: ${esc(s.line || '')} <a href="https://lemomo-ai.github.io/lemo-opuscar/" target="_blank" rel="noopener">See demos</a>`;
  document.querySelectorAll('.style').forEach(b => b.setAttribute('aria-selected', String(b.dataset.slug === slug)));
}

async function loadFilms() {
  const films = await api('/api/films');
  const box = $('#films'); if (!box) return;
  if (!films.length) return;
  box.innerHTML = films.map(f => {
    const poster = f.files?.find(x => x.kind === 'poster');
    return `<a class="film" href="#/film/${f.id}">
      ${poster ? `<img src="${fileUrl(f.id, poster.path)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="m"><div class="t">${esc(f.brief.topic)}</div>
        <div class="muted small">${esc(f.brief.styleName)} · by ${esc(f.user)} · ${ago(f.createdAt)}</div></div>
      <span class="pill ${f.status}">${STATUS[f.status] || f.status}</span></a>`;
  }).join('');
  if (films.some(f => f.status === 'running' || f.status === 'queued')) setTimeout(() => { if ($('#films')) loadFilms(); }, 15000);
}

async function showFilm(id) {
  mount('#tpl-film');
  let job;
  try { job = await api(`/api/films/${id}`); } catch (e) { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const log = job.log || [];
  paintFilm(job);
  log.forEach(addLog);
  $('#f-verbose').onchange = e => { $('#f-log').hidden = !e.target.checked; };
  $('#f-cancel').onclick = async () => {
    if (!confirm('Cancel this film? Claude usage so far is still charged.')) return;
    paintFilm(await api(`/api/films/${id}/cancel`, { method: 'POST' }));
  };
  if (job.status === 'queued' || job.status === 'running') {
    stream = new EventSource(`/api/films/${id}/events`);
    stream.onmessage = m => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'log') addLog(ev.entry);
      if (ev.type === 'status') paintFilm(ev.job);
      if (ev.type === 'queue') $('#f-status').textContent = `Waiting (#${ev.position} in line)`;
    };
  }
}

function paintFilm(job) {
  $('#f-title').textContent = job.brief.styleName;
  $('#f-topic').textContent = `${job.brief.topic} · by ${job.user} · ${ago(job.createdAt)}`;
  const st = $('#f-status');
  st.className = `pill ${job.status}`;
  st.textContent = job.status === 'queued' && job.queuePosition ? `Waiting (#${job.queuePosition} in line)` : (STATUS[job.status] || job.status);
  if (job.costUsd != null) st.textContent += ` · $${job.costUsd.toFixed(2)}`;
  $('#f-cancel').hidden = !(job.user === me.user && (job.status === 'queued' || job.status === 'running'));
  $('#f-error').textContent = job.error || '';
  $('#f-summary').textContent = job.summary || '';
  const order = ['film', 'poster', 'subtitles', 'treatment', 'credits'];
  const files = [...(job.files || [])].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const film = files.find(f => f.kind === 'film'), poster = files.find(f => f.kind === 'poster');
  if (film && !$('#f-player video')) {
    $('#f-player').innerHTML = `<video controls preload="metadata" ${poster ? `poster="${fileUrl(job.id, poster.path)}"` : ''} src="${fileUrl(job.id, film.path)}"></video>`;
  }
  const label = { film: '⬇ Film (.mp4)', poster: 'Poster', subtitles: 'Subtitles', treatment: 'Treatment', credits: 'Credits' };
  $('#f-files').innerHTML = files.map(f => `<a href="${fileUrl(job.id, f.path, true)}">${label[f.kind] || f.path}${f.kind === 'subtitles' ? ` (${esc(f.path)})` : ''}</a>`).join('');
}

function addLog(e) {
  if (e.kind === 'step' || e.kind === 'done' || e.kind === 'error') {
    const steps = $('#f-steps');
    steps.querySelectorAll('li.cur').forEach(li => li.classList.remove('cur'));
    const li = document.createElement('li');
    li.className = e.kind === 'step' ? 'cur' : '';
    li.innerHTML = `${esc(e.text)} <span class="muted small">${new Date(e.t).toLocaleTimeString()}</span>`;
    if (e.kind === 'error') li.style.color = 'var(--bad)';
    steps.append(li);
  }
  const pre = $('#f-log');
  const near = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  pre.textContent += `[${new Date(e.t).toLocaleTimeString()}] ${e.kind === 'tool' ? '' : e.kind + ': '}${e.text}\n`;
  if (near) pre.scrollTop = pre.scrollHeight;
}

window.addEventListener('hashchange', route);
route().catch(e => { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
