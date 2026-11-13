import { decodeSetupCode, encodeSetupCode, validateSetupCode } from './setup-code';

const valid = {
  twitchChannel: ' MyChannel ',
  ablyChannel: 'overlay-approval',
  ablyKey: 'abc123.def456:s3cr3t-Ä',
  modName: ' Jörg ',
};

function decode(code: string): unknown {
  const bytes = Uint8Array.from(atob(code), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe('setup code', () => {
  it('encodes base64 JSON the userscript can decode', () => {
    const input = { ...valid, ablyKey: 'abc123.def456:s3cr3t' };
    expect(decode(encodeSetupCode(input))).toEqual({
      v: 1,
      twitchChannel: 'mychannel',
      ablyChannel: 'overlay-approval',
      ablyKey: 'abc123.def456:s3cr3t',
      name: 'Jörg',
    });
  });

  it('survives non-ASCII characters', () => {
    expect(decode(encodeSetupCode({ ...valid, ablyChannel: 'freigabe-ü' }))).toMatchObject({ ablyChannel: 'freigabe-ü' });
  });

  it('rejects invalid input', () => {
    expect(validateSetupCode({ ...valid, ablyKey: 'abc123.def456:s3cr3t' })).toBeNull();
    expect(validateSetupCode({ ...valid, twitchChannel: 'not valid' })).not.toBeNull();
    expect(validateSetupCode({ ...valid, ablyChannel: ' ' })).not.toBeNull();
    expect(validateSetupCode({ ...valid, ablyKey: 'just-a-key' })).not.toBeNull();
    expect(validateSetupCode({ ...valid, ablyKey: 'abc123.def456:s3cr3t', modName: ' ' })).not.toBeNull();
    expect(validateSetupCode({ ...valid, ablyKey: 'abc123.def456:s3cr3t', modName: 'Overlay' })).not.toBeNull();
  });

  it('decodes what it encodes, like the userscript', () => {
    const code = encodeSetupCode({ ...valid, ablyKey: 'abc123.def456:s3cr3t' });
    expect(decodeSetupCode(` ${code}
`)).toEqual({
      twitchChannel: 'mychannel',
      ablyChannel: 'overlay-approval',
      ablyKey: 'abc123.def456:s3cr3t',
      name: 'Jörg',
    });
  });

  it('rejects broken codes', () => {
    const encode = (value: unknown) => btoa(JSON.stringify(value));
    expect(() => decodeSetupCode('%%%')).toThrow('Not a valid setup code');
    expect(() => decodeSetupCode(encode({ v: 2 }))).toThrow('Unknown setup code version.');
    expect(() => decodeSetupCode(encode({ v: 1, twitchChannel: 'a', ablyChannel: 'c' }))).toThrow('"ablyKey"');
    expect(() =>
      decodeSetupCode(encode({ v: 1, twitchChannel: 'a b', ablyChannel: 'c', ablyKey: 'a.b:c' })),
    ).toThrow('Twitch channel is invalid.');
  });
});
