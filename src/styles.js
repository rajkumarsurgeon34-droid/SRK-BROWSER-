// Reads the style list from the library: styles/<slug>/style.json.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let cache = null;

export function listStyles() {
  if (cache) return cache;
  const dir = path.join(config.lib, 'styles');
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return (cache = []); }
  for (const slug of names) {
    if (slug.startsWith('_')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, slug, 'style.json'), 'utf8'));
      const needsImages = Array.isArray(s.needs) && s.needs.includes('image-generation');
      out.push({
        slug: s.slug || slug,
        name: s.en, nameCn: s.cn,
        category: s.category_en, categoryCn: s.category_cn,
        line: s.line, uses: s.uses || [],
        demoDur: s.dur,
        // ✦ styles need an outside image generator; the server has none, so they are shown but disabled
        available: !needsImages,
        unavailableReason: needsImages ? 'Needs an image generator, which this server does not have' : null,
      });
    } catch { /* not a style folder */ }
  }
  out.sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''));
  return (cache = out);
}

export function getStyle(slug) {
  return listStyles().find(s => s.slug === slug) || null;
}
