import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asset, STATE, STICKER, TAPE, BRAND } from './assets';

describe('asset()', () => {
  it('prefixes the public assets base', () => {
    expect(asset('stickers/star-01.png')).toBe('/assets/stickers/star-01.png');
  });
  it('tolerates a leading slash', () => {
    expect(asset('/states/vouch-sent.png')).toBe('/assets/states/vouch-sent.png');
  });
});

describe('asset registries', () => {
  it('every state illustration has a file + intrinsic size', () => {
    for (const meta of Object.values(STATE)) {
      expect(meta.file).toMatch(/^states\/.+\.png$/);
      expect(meta.w).toBeGreaterThan(0);
      expect(meta.h).toBeGreaterThan(0);
    }
  });
  it('stickers, tape, and brand entries are well-formed', () => {
    for (const meta of [...Object.values(STICKER), ...Object.values(TAPE), ...Object.values(BRAND)]) {
      expect(meta.file).toMatch(/\.png$/);
      expect(meta.w).toBeGreaterThan(0);
      expect(meta.h).toBeGreaterThan(0);
    }
  });
});

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = resolve(webRoot, 'public');

describe('service worker asset references', () => {
  const swPath = resolve(publicDir, 'sw.js');
  const source = readFileSync(swPath, 'utf-8');
  const assetPaths = Array.from(source.matchAll(/\/assets\/[\w./-]+/g)).map((m) => m[0]);

  it('references at least one asset', () => {
    expect(assetPaths.length).toBeGreaterThan(0);
  });

  it('every /assets/... path resolves to a real file', () => {
    for (const p of assetPaths) {
      const filePath = resolve(publicDir, p.replace(/^\//, ''));
      expect(existsSync(filePath), `${p} should exist under public/`).toBe(true);
    }
  });
});
