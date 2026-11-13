import { parseLanguage } from './i18n';
import { buildOverlayUrl, DEFAULT_OVERLAY_URL } from './overlay-url';

const form = document.querySelector<HTMLFormElement>('#generator')!;
const output = document.querySelector<HTMLTextAreaElement>('#url')!;
const message = document.querySelector<HTMLElement>('#message')!;
const copy = document.querySelector<HTMLButtonElement>('#copy')!;

function field<T extends HTMLInputElement | HTMLSelectElement>(name: string): T {
  return form.elements.namedItem(name) as T;
}

const value = (name: string): string => field(name).value;

field('baseUrl').value = DEFAULT_OVERLAY_URL;

function update(): void {
  const result = buildOverlayUrl({
    baseUrl: value('baseUrl'),
    language: parseLanguage(value('language')),
    fade: value('fade'),
    maxLines: value('maxLines'),
    demo: field<HTMLInputElement>('demo').checked,
    ablyKey: value('ablyKey'),
    ablyChannel: value('ablyChannel'),
    trustUrl: value('trustUrl'),
    trustSecret: value('trustSecret'),
    heldNotice: field<HTMLInputElement>('heldNotice').checked,
  });
  const error = 'error' in result ? result.error : '';
  message.textContent = error;
  output.value = 'url' in result ? result.url : '';
  copy.disabled = !!error;
}

form.addEventListener('input', update);
form.addEventListener('submit', (event) => event.preventDefault());
copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.value);
  message.textContent = 'Copied.';
});

update();
