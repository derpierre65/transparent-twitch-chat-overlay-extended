import { encodeSetupCode, validateSetupCode } from './setup-code';

const form = document.querySelector<HTMLFormElement>('#setup')!;
const output = document.querySelector<HTMLTextAreaElement>('#code')!;
const message = document.querySelector<HTMLElement>('#message')!;
const copy = document.querySelector<HTMLButtonElement>('#copy')!;

function field(name: string): string {
  return (form.elements.namedItem(name) as HTMLInputElement).value;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = {
    twitchChannel: field('twitchChannel'),
    ablyChannel: field('ablyChannel'),
    ablyKey: field('ablyKey'),
    modName: field('modName'),
  };
  const error = validateSetupCode(input);
  message.textContent = error ?? '';
  output.value = error ? '' : encodeSetupCode(input);
  copy.disabled = !!error;
});

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.value);
  message.textContent = 'Copied.';
});
