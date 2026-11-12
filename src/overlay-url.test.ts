import { parseConfig } from './config';
import { buildOverlayUrl, DEFAULT_OVERLAY_URL, type OverlayUrlInput } from './overlay-url';

const empty: OverlayUrlInput = {
  baseUrl: DEFAULT_OVERLAY_URL,
  language: 'en',
  fade: '',
  maxLines: '',
  demo: false,
  ablyKey: '',
  ablyChannel: '',
  trustUrl: '',
  trustSecret: '',
};

function url(input: Partial<OverlayUrlInput>): string {
  const result = buildOverlayUrl({ ...empty, ...input });
  if ('error' in result) throw new Error(result.error);
  return result.url;
}

function error(input: Partial<OverlayUrlInput>): string | undefined {
  const result = buildOverlayUrl({ ...empty, ...input });
  return 'error' in result ? result.error : undefined;
}

describe('buildOverlayUrl', () => {
  it('leaves defaults out', () => {
    expect(url({})).toBe(DEFAULT_OVERLAY_URL);
  });

  it('round-trips through parseConfig', () => {
    const built = new URL(
      url({
        language: 'de',
        fade: '30',
        maxLines: '20',
        demo: true,
        ablyKey: 'app.key:se&cret=',
        ablyChannel: 'overlay-approval',
        trustUrl: 'https://trust.example.workers.dev/',
        trustSecret: 'a+b/c',
      }),
    );
    expect(parseConfig(built.search)).toEqual({
      language: 'de',
      fade: 30,
      maxLines: 20,
      demo: true,
      approval: {
        ablyKey: 'app.key:se&cret=',
        ablyChannel: 'overlay-approval',
        trust: { url: 'https://trust.example.workers.dev', secret: 'a+b/c' },
      },
    });
  });

  it('replaces query and hash of the base URL', () => {
    expect(url({ baseUrl: 'http://localhost:5173/?fade=1#x', maxLines: '5' })).toBe('http://localhost:5173/?maxLines=5');
  });

  it('rejects invalid input', () => {
    expect(error({ baseUrl: 'extended-twitch-overlay.pages.dev' })).toBeDefined();
    expect(error({ fade: '-1' })).toBeDefined();
    expect(error({ fade: 'abc' })).toBeDefined();
    expect(error({ maxLines: '0' })).toBeDefined();
    expect(error({ maxLines: '2.5' })).toBeDefined();
    expect(error({ ablyKey: 'app.key:secret' })).toBeDefined();
    expect(error({ ablyKey: 'a.b:c', ablyChannel: 'x', trustUrl: 'https://w.dev' })).toBeDefined();
    expect(error({ trustUrl: 'https://w.dev', trustSecret: 's' })).toBeDefined();
    expect(error({ ablyKey: 'a.b:c', ablyChannel: 'x', trustUrl: 'ftp://w.dev', trustSecret: 's' })).toBeDefined();
  });
});
