// The Android shell talks to a hosted server; the web build stays same-origin.
import { afterEach, describe, expect, it } from 'vitest';
import { apiBase, apiUrl, isRemoteApi } from '@/game/online/api-base';

const original = process.env.NEXT_PUBLIC_API_BASE;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
  else process.env.NEXT_PUBLIC_API_BASE = original;
});

describe('multiplayer API base', () => {
  it('stays relative on the web (no base configured)', () => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    expect(apiBase()).toBe('');
    expect(apiUrl()).toBe('/api/multiplayer');
    expect(isRemoteApi()).toBe(false);
  });

  it('points at the hosted server inside the Android app', () => {
    process.env.NEXT_PUBLIC_API_BASE = 'https://dz-rami.example.com';
    expect(apiUrl()).toBe('https://dz-rami.example.com/api/multiplayer');
    expect(apiUrl('/api/health')).toBe('https://dz-rami.example.com/api/health');
    expect(isRemoteApi()).toBe(true);
  });

  it('tolerates a trailing slash, spaces and a missing path', () => {
    process.env.NEXT_PUBLIC_API_BASE = '  https://dz-rami.example.com//  ';
    expect(apiBase()).toBe('https://dz-rami.example.com');
    expect(apiUrl()).toBe('https://dz-rami.example.com/api/multiplayer');
    expect(apiUrl('api/multiplayer')).toBe('https://dz-rami.example.com/api/multiplayer');
  });

  it('keeps an empty value as "same origin"', () => {
    process.env.NEXT_PUBLIC_API_BASE = '   ';
    expect(apiBase()).toBe('');
    expect(isRemoteApi()).toBe(false);
  });
});
