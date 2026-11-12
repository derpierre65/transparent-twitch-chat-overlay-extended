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

  box.append(
    text('h1', 'login__title', t.title),
    text('p', 'login__text', t.intro),
    userCode,
    row,
    feedback,
    status,
  );
  parent.append(box);

  return {
    showCode(code) {
      userCode.hidden = false;
      userCode.replaceChildren(document.createTextNode(code.userCode));
      url.value = code.verificationUri;
      copy.disabled = false;
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
