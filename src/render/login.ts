import type { Messages } from '../i18n';

export interface LoginView {
  showCode(code: { userCode: string; verificationUri: string }): void;
  setStatus(text: string): void;
  close(): void;
}

function text(tag: 'h1' | 'p', className: string, content = ''): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.append(document.createTextNode(content));
  return el;
}

export function createLoginView(
  parent: HTMLElement,
  t: Messages['login'],
  deps: {
    clipboard?: Pick<Clipboard, 'writeText'> | null;
    execCopy?: () => boolean;
    cancel?: { label: string; onClick: () => void };
    /** Label of a button that opens the link in a new tab; off by default. */
    openLabel?: string;
    openWindow?: (url: string) => void;
  } = {},
): LoginView {
  const clipboard = deps.clipboard === undefined ? (navigator.clipboard ?? null) : deps.clipboard;
  const execCopy = deps.execCopy ?? (() => document.execCommand('copy'));

  const box = document.createElement('div');
  box.className = 'login';

  const userCode = text('p', 'login__code');
  userCode.hidden = true;

  const url = document.createElement('input');
  url.className = 'login__url';
  url.readOnly = true;
  url.placeholder = t.linkPlaceholder;
  url.addEventListener('focus', () => url.select());
  url.addEventListener('click', () => url.select());

  const feedback = text('p', 'login__feedback');
  const status = text('p', 'login__status');

  const copy = document.createElement('button');
  copy.className = 'login__button';
  copy.type = 'button';
  copy.disabled = true;
  copy.append(document.createTextNode(t.copy));
  copy.addEventListener('click', () => {
    const say = (msg: string) => feedback.replaceChildren(document.createTextNode(msg));
    // WebView2 may refuse the Clipboard API; fall back to execCommand then.
    const fallback = () => {
      url.select();
      say(execCopy() ? t.copied : t.copyManually);
    };
    if (!clipboard) {
      fallback();
      return;
    }
    clipboard.writeText(url.value).then(() => say(t.copied), fallback);
  });

  const row = document.createElement('div');
  row.className = 'login__row';
  row.append(url, copy);

  let open: HTMLButtonElement | null = null;
  if (deps.openLabel) {
    const openWindow = deps.openWindow ?? ((link: string) => void window.open(link, '_blank', 'noopener,noreferrer'));
    open = document.createElement('button');
    open.className = 'login__button login__button--open';
    open.type = 'button';
    open.disabled = true;
    open.append(document.createTextNode(deps.openLabel));
    open.addEventListener('click', () => openWindow(url.value));
    row.append(open);
  }

  box.append(
    text('h1', 'login__title', t.title),
    text('p', 'login__text', t.intro),
    userCode,
    row,
    feedback,
    status,
  );
  if (deps.cancel) {
    const { label, onClick } = deps.cancel;
    const cancel = document.createElement('button');
    cancel.className = 'login__button login__button--secondary';
    cancel.type = 'button';
    cancel.append(document.createTextNode(label));
    cancel.addEventListener('click', () => onClick());
    box.append(cancel);
  }
  parent.append(box);

  return {
    showCode(code) {
      userCode.hidden = false;
      userCode.replaceChildren(document.createTextNode(code.userCode));
      url.value = code.verificationUri;
      copy.disabled = false;
      if (open) open.disabled = false;
      feedback.replaceChildren();
    },
    setStatus(message) {
      status.replaceChildren(document.createTextNode(message));
    },
    close() {
      box.remove();
    },
  };
}
