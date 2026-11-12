import { describe, expect, it } from 'vitest';

describe('setup', () => {
  it('runs vitest with a dom', () => {
    document.body.innerHTML = '<div id="x"></div>';
    expect(document.getElementById('x')).not.toBeNull();
  });
});
