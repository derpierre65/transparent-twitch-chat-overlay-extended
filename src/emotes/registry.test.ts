import { describe, expect, it } from 'vitest';
import { buildFragments, createRegistry, fragmentsToNodes, type Emote } from './registry';

const emote = (code: string, url: string, zeroWidth = false): Emote => ({ code, url, zeroWidth });

const registry = createRegistry([
  [emote('catJAM', 'https://7tv/catjam.webp')],
  [emote('catJAM', 'https://bttv/catjam.png'), emote('monkaS', 'https://bttv/monkas.png')],
]);

describe('createRegistry', () => {
  it('lets the first source win', () => {
    expect(registry.get('catJAM')?.url).toBe('https://7tv/catjam.webp');
  });

  it('is case sensitive like twitch emote codes', () => {
    expect(registry.get('catjam')).toBeUndefined();
  });
});

describe('buildFragments', () => {
  it('returns plain text untouched', () => {
    expect(buildFragments('hello world', [], registry)).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('replaces twitch emotes by their code point range', () => {
    const fragments = buildFragments('hi Kappa there', [{ id: '25', start: 3, end: 7 }], registry);

    expect(fragments).toEqual([
      { kind: 'text', text: 'hi ' },
      {
        kind: 'emote',
        code: 'Kappa',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
        zeroWidth: false,
      },
      { kind: 'text', text: ' there' },
    ]);
  });

  it('keeps twitch ranges correct after astral characters', () => {
    const fragments = buildFragments('😀 Kappa', [{ id: '25', start: 2, end: 6 }], registry);

    expect(fragments[1]).toMatchObject({ kind: 'emote', code: 'Kappa' });
  });

  it('replaces third party emotes on whole word boundaries only', () => {
    const fragments = buildFragments('yo catJAM catJAMx', [], registry);

    expect(fragments).toEqual([
      { kind: 'text', text: 'yo ' },
      { kind: 'emote', code: 'catJAM', url: 'https://7tv/catjam.webp', zeroWidth: false },
      { kind: 'text', text: ' catJAMx' },
    ]);
  });

  it('does not scan inside twitch emote output', () => {
    const fragments = buildFragments('catJAM', [{ id: '9', start: 0, end: 5 }], registry);

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({ kind: 'emote', url: expect.stringContaining('/9/') });
  });
});

describe('fragmentsToNodes', () => {
  it('renders user text as a text node, never as markup', () => {
    const nodes = fragmentsToNodes(buildFragments('<img src=x onerror=alert(1)>', [], registry));
    const host = document.createElement('span');
    host.append(nodes);

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('renders emotes as img with the code as alt text', () => {
    const nodes = fragmentsToNodes(buildFragments('catJAM', [], registry));
    const host = document.createElement('span');
    host.append(nodes);
    const img = host.querySelector('img');

    expect(img?.getAttribute('src')).toBe('https://7tv/catjam.webp');
    expect(img?.getAttribute('alt')).toBe('catJAM');
    expect(img?.className).toBe('emote');
  });
});
