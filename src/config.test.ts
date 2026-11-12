import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

describe('parseConfig', () => {
  it('uses defaults for an empty query string', () => {
    expect(parseConfig('')).toEqual({ maxLines: 50, fade: 60, demo: false, language: 'en' });
  });

  it('reads the language', () => {
    expect(parseConfig('?language=de').language).toBe('de');
    expect(parseConfig('?language=EN').language).toBe('en');
    expect(parseConfig('?language=xx').language).toBe('en');
  });

  it('reads maxLines and fade as numbers', () => {
    const cfg = parseConfig('?maxLines=10&fade=7.5');
    expect(cfg.maxLines).toBe(10);
    expect(cfg.fade).toBe(7.5);
  });

  it('falls back to defaults for junk values', () => {
    const cfg = parseConfig('?maxLines=abc&fade=-3');
    expect(cfg.maxLines).toBe(50);
    expect(cfg.fade).toBe(60);
  });

  it('treats fade=0 as an explicit opt out', () => {
    expect(parseConfig('?fade=0').fade).toBe(0);
  });

  it('fades faster in demo mode', () => {
    expect(parseConfig('?demo=1').fade).toBe(5);
  });

  it('lets an explicit fade win over the demo default', () => {
    expect(parseConfig('?demo=1&fade=30').fade).toBe(30);
  });

  it('caps maxLines to keep the DOM bounded', () => {
    expect(parseConfig('?maxLines=100000').maxLines).toBe(500);
  });

  it('treats demo=1 as enabled', () => {
    expect(parseConfig('?demo=1').demo).toBe(true);
    expect(parseConfig('?demo=0').demo).toBe(false);
  });
});
