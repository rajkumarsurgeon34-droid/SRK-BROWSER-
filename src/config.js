// All settings come from environment variables (see .env.example).
import path from 'node:path';
import os from 'node:os';

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(env.PORT, 3000),
  // Where jobs, logs and finished films are kept. Mount a volume here in Docker.
  dataDir: path.resolve(env.DATA_DIR || './data'),
  // The SRK-Opuscar library (cloned and installed by the Dockerfile).
  lib: path.resolve(env.SRK_OPUSCAR_HOME || path.join(os.homedir(), 'srk-opuscar')),
  // Friends who may log in: "name:password,name2:password2".
  friends: parseFriends(env.FRIENDS || ''),
  sessionSecret: env.SESSION_SECRET || '',
  // Claude settings for the film agent.
  model: env.CLAUDE_MODEL || 'claude-opus-5-5',
  maxBudgetUsd: num(env.MAX_BUDGET_USD, 15),   // hard stop per film
  maxTurns: num(env.MAX_TURNS, 400),
  // Fair use.
  filmsPerDay: num(env.FILMS_PER_DAY, 2),      // per friend; 0 = no limit
  concurrency: num(env.CONCURRENCY, 1),        // films rendered at the same time
  // MOCK_AGENT=1 skips Claude and renders a tiny test film: checks the render pipeline at no API cost.
  mock: env.MOCK_AGENT === '1',
};

function parseFriends(s) {
  const out = new Map();
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1));
  }
  return out;
}

export function checkConfig() {
  const problems = [];
  if (!config.friends.size) problems.push('FRIENDS is empty: set it to "name:password,..." so people can log in');
  if (config.sessionSecret.length < 16) problems.push('SESSION_SECRET must be at least 16 random characters');
  if (!config.mock && !env.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is not set (or run with MOCK_AGENT=1 to test without Claude)');
  return problems;
}
