import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n';
import { createLoginView } from './login';

const CODE = { userCode: 'ABCD1234', verificationUri: 'https://www.twitch.tv/activate?public=true&device-code=ABCD1234' };

let parent: HTMLElement;

beforeEach(() => {
  parent = document.createElement('div');
  document.body.replaceChildren(parent);
});

describe('createLoginView', () => {
  it('keeps the copy button disabled until a code arrives', () => {
    createLoginView(parent, MESSAGES.de.login, { clipboard: null });

    expect(parent.querySelector<HTMLButtonElement>('.login__button')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLElement>('.login__code')?.hidden).toBe(true);
  });

  it('shows code and link as text in a readonly field', () => {
    createLoginView(parent, MESSAGES.de.login, { clipboard: null }).showCode({ ...CODE, userCode: '<b>x</b>' });

    const field = parent.querySelector<HTMLInputElement>('.login__url');
    expect(field?.value).toBe(CODE.verificationUri);
    expect(field?.readOnly).toBe(true);
    expect(parent.querySelector('.login__code')?.textContent).toBe('<b>x</b>');
    expect(parent.querySelector('b')).toBeNull();
  });

  it('copies the link with the clipboard api', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };
    createLoginView(parent, MESSAGES.de.login, { clipboard }).showCode(CODE);

    parent.querySelector<HTMLButtonElement>('.login__button')?.click();

    expect(clipboard.writeText).toHaveBeenCalledWith(CODE.verificationUri);
    await vi.waitFor(() => expect(parent.querySelector('.login__feedback')?.textContent).toBe('Kopiert.'));
  });

  it('falls back to execCommand when the clipboard api fails', async () => {
    const clipboard = { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) };
    const execCopy = vi.fn(() => true);
    createLoginView(parent, MESSAGES.de.login, { clipboard, execCopy }).showCode(CODE);

    parent.querySelector<HTMLButtonElement>('.login__button')?.click();

    await vi.waitFor(() => expect(execCopy).toHaveBeenCalledOnce());
    expect(parent.querySelector('.login__feedback')?.textContent).toBe('Kopiert.');
  });

  it('asks for a manual copy when nothing works', () => {
    createLoginView(parent, MESSAGES.de.login, { clipboard: null, execCopy: () => false }).showCode(CODE);

    parent.querySelector<HTMLButtonElement>('.login__button')?.click();

    expect(parent.querySelector('.login__feedback')?.textContent).toBe('Bitte den Link von Hand kopieren.');
  });

  it('shows the status and removes itself on close', () => {
    const view = createLoginView(parent, MESSAGES.de.login, { clipboard: null });
    view.setStatus('Warte auf Bestätigung …');
    expect(parent.querySelector('.login__status')?.textContent).toBe('Warte auf Bestätigung …');

    view.close();
    expect(parent.querySelector('.login')).toBeNull();
  });

  it('has no open button unless asked for', () => {
    createLoginView(parent, MESSAGES.en.login, { clipboard: null });
    expect(parent.querySelector('.login__button--open')).toBeNull();
  });

  it('opens the link in a new tab once a code arrives', () => {
    const openWindow = vi.fn();
    const view = createLoginView(parent, MESSAGES.en.login, { clipboard: null, openLabel: 'Open', openWindow });
    const open = parent.querySelector<HTMLButtonElement>('.login__button--open')!;
    expect(open.disabled).toBe(true);

    view.showCode(CODE);
    open.click();

    expect(openWindow).toHaveBeenCalledWith(CODE.verificationUri);
  });
});
