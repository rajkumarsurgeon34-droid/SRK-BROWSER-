// Tiny login for a small group of friends: names and passwords come from FRIENDS,
// the session is an HMAC-signed cookie (no database needed).
import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'srk_session';
const MAX_AGE_S = 30 * 24 * 3600;

const sign = data => crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkPassword(name, password) {
  const key = String(name || '').trim().toLowerCase();
  const want = config.friends.get(key);
  return want !== undefined && safeEqual(password, want) ? key : null;
}

export function setSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_S * 1000,
    secure: process.env.COOKIE_SECURE === '1',
  });
}

export function clearSession(res) { res.clearCookie(COOKIE); }

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function currentUser(req) {
  const c = readCookie(req);
  if (!c) return null;
  const [payload, mac] = c.split('.');
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // a friend removed from FRIENDS loses access at once
    return exp > Date.now() && config.friends.has(u) ? u : null;
  } catch { return null; }
}

export function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = u;
  next();
}
