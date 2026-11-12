export type Language = 'en' | 'de';

export type TrustStorage = 'saved' | 'memory' | 'unloaded';

const MAX_LISTED_LOGINS = 20;

function listLogins(logins: string[], more: (count: number) => string): string {
  const shown = logins.slice(0, MAX_LISTED_LOGINS).join(', ');
  return logins.length > MAX_LISTED_LOGINS ? `${shown}, ${more(logins.length - MAX_LISTED_LOGINS)}` : shown;
}

export interface Messages {
  raid(from: string, viewers: number): string;
  sub(user: string, tier: string): string;
  resub(user: string, months: number, streak: number | null): string;
  giftsub(gifter: string, recipient: string, tier: string): string;
  subbomb(gifter: string, count: number): string;
  redemption(user: string, reward: string, cost: number): string;
  follow(user: string): string;
  hypetrain(phase: 'begin' | 'progress' | 'end', level: number): string;
  ban(user: string, moderator: string): string;
  timeout(user: string, moderator: string, seconds: number): string;
  unban(user: string, moderator: string): string;
  bits(count: number): string;
  connected(channel: string): string;
  /** `memory`: no worker configured, `unloaded`: the worker's list failed to load. */
  approvalActive(logins: string[], storage: TrustStorage): string;
  /** `by` is the mod name from the setup code, `null` if the mod has none. */
  approvalTrusted(login: string, by: string | null): string;
  approvalUntrusted(login: string, by: string | null): string;
  approvalApproved(login: string | null, by: string | null): string;
  login: {
    title: string;
    intro: string;
    linkPlaceholder: string;
    copy: string;
    copied: string;
    copyManually: string;
    requesting: string;
    waiting: string;
    renewed: string;
    unreachable: string;
    busy: string;
    missingClientId: string;
  };
}

const TIERS: Record<string, string> = {
  '1000': 'Tier 1',
  '2000': 'Tier 2',
  '3000': 'Tier 3',
  Prime: 'Prime',
};

const tier = (raw: string): string => TIERS[raw] ?? raw;

type Units = Record<'second' | 'minute' | 'hour' | 'day', [one: string, many: string]>;

/** Größte passende Einheit, gerundet: Twitch-Timeouts sind fast immer glatte Werte. */
function duration(seconds: number, units: Units): string {
  const steps: [keyof Units, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const [unit, size] = steps.find(([, s]) => seconds >= s) ?? ['second', 1];
  const count = Math.max(1, Math.round(seconds / size));
  return `${count} ${units[unit][count === 1 ? 0 : 1]}`;
}

const EN_UNITS: Units = {
  second: ['second', 'seconds'],
  minute: ['minute', 'minutes'],
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
};

const DE_UNITS: Units = {
  second: ['Sekunde', 'Sekunden'],
  minute: ['Minute', 'Minuten'],
  hour: ['Stunde', 'Stunden'],
  day: ['Tag', 'Tage'],
};

const en: Messages = {
  raid: (from, viewers) => `${from} is raiding with ${viewers} viewers`,
  sub: (user, t) => `${user} subscribed (${tier(t)})`,
  resub: (user, months, streak) =>
    `${user} has been subscribed for ${months} months${streak === null ? '' : `, ${streak} in a row`}`,
  giftsub: (gifter, recipient, t) => `${gifter} gifted ${recipient} a sub (${tier(t)})`,
  subbomb: (gifter, count) => `${gifter} is gifting ${count} subs`,
  redemption: (user, reward, cost) => `${user} redeemed "${reward}" (${cost})`,
  follow: (user) => `${user} is now following`,
  hypetrain: (phase, level) =>
    `Hype Train ${{ begin: 'started', progress: 'in progress', end: 'ended' }[phase]} — Level ${level}`,
  ban: (user, moderator) => `${user} was banned by ${moderator}`,
  timeout: (user, moderator, seconds) =>
    `${user} was timed out for ${duration(seconds, EN_UNITS)} by ${moderator}`,
  unban: (user, moderator) => `${user} was unbanned by ${moderator}`,
  bits: (count) => `${count} Bits `,
  connected: (channel) => `Connected to ${channel}`,
  approvalActive: (logins, storage) => {
    if (storage === 'unloaded') return 'Chat approval active — trusted users could not be loaded';
    const list = logins.length
      ? `${logins.length} trusted: ${listLogins(logins, (n) => `+${n} more`)}`
      : 'no trusted users yet';
    return `Chat approval active — ${list}${storage === 'memory' ? ' (not saved)' : ''}`;
  },
  approvalTrusted: (login, by) => `${login} trusted by ${by ?? 'a mod'}`,
  approvalUntrusted: (login, by) => `${login} untrusted by ${by ?? 'a mod'}`,
  approvalApproved: (login, by) => `${login ? `Message from ${login}` : 'Message'} approved by ${by ?? 'a mod'}`,
  login: {
    title: 'Connect with Twitch',
    intro: 'Open the link in your own browser and confirm there. The overlay signs in by itself afterwards.',
    linkPlaceholder: 'Requesting link …',
    copy: 'Copy link',
    copied: 'Copied.',
    copyManually: 'Please copy the link manually.',
    requesting: 'Requesting code from Twitch …',
    waiting: 'Waiting for confirmation …',
    renewed: 'Code expired, requested a new one. Please copy the link again.',
    unreachable: 'Twitch unreachable, retrying …',
    busy: 'Login is already running in another overlay window …',
    missingClientId: 'VITE_TWITCH_CLIENT_ID is missing from the build — login unavailable.',
  },
};

const de: Messages = {
  raid: (from, viewers) => `${from} raidet mit ${viewers} Zuschauern`,
  sub: (user, t) => `${user} hat abonniert (${tier(t)})`,
  resub: (user, months, streak) =>
    `${user} ist seit ${months} Monaten dabei${streak === null ? '' : `, ${streak} in Folge`}`,
  giftsub: (gifter, recipient, t) => `${gifter} schenkt ${recipient} ein Abo (${tier(t)})`,
  subbomb: (gifter, count) => `${gifter} verschenkt ${count} Abos`,
  redemption: (user, reward, cost) => `${user} löst „${reward}“ ein (${cost})`,
  follow: (user) => `${user} folgt jetzt`,
  hypetrain: (phase, level) =>
    `Hype Train ${{ begin: 'startet', progress: 'läuft', end: 'endet' }[phase]} — Level ${level}`,
  ban: (user, moderator) => `${user} wurde von ${moderator} gebannt`,
  timeout: (user, moderator, seconds) =>
    `${user} wurde von ${moderator} für ${duration(seconds, DE_UNITS)} getimeoutet`,
  unban: (user, moderator) => `${user} wurde von ${moderator} entbannt`,
  bits: (count) => `${count} Bits `,
  connected: (channel) => `Verbunden mit ${channel}`,
  approvalActive: (logins, storage) => {
    if (storage === 'unloaded') return 'Chat-Freigabe aktiv — vertrauenswürdige User konnten nicht geladen werden';
    const list = logins.length
      ? `${logins.length} vertrauenswürdig: ${listLogins(logins, (n) => `+${n} weitere`)}`
      : 'noch keine vertrauenswürdigen User';
    return `Chat-Freigabe aktiv — ${list}${storage === 'memory' ? ' (nicht gespeichert)' : ''}`;
  },
  approvalTrusted: (login, by) => `${login} von ${by ?? 'einem Mod'} als vertrauenswürdig markiert`,
  approvalUntrusted: (login, by) => `${login} von ${by ?? 'einem Mod'} nicht mehr vertraut`,
  approvalApproved: (login, by) => `${login ? `Nachricht von ${login}` : 'Nachricht'} von ${by ?? 'einem Mod'} freigegeben`,
  login: {
    title: 'Mit Twitch verbinden',
    intro: 'Link im eigenen Browser öffnen und dort bestätigen. Das Overlay meldet sich danach von selbst an.',
    linkPlaceholder: 'Link wird angefordert …',
    copy: 'Link kopieren',
    copied: 'Kopiert.',
    copyManually: 'Bitte den Link von Hand kopieren.',
    requesting: 'Fordere Code bei Twitch an …',
    waiting: 'Warte auf Bestätigung …',
    renewed: 'Code abgelaufen, neuer Code angefordert. Bitte den Link neu kopieren.',
    unreachable: 'Twitch nicht erreichbar, neuer Versuch läuft …',
    busy: 'Login läuft gerade in einem anderen Overlay-Fenster …',
    missingClientId: 'VITE_TWITCH_CLIENT_ID fehlt im Build — Login nicht möglich.',
  },
};

export const MESSAGES: Record<Language, Messages> = { en, de };

/** Unbekannte oder fehlende Werte fallen auf Englisch zurück. */
export function parseLanguage(raw: string | null): Language {
  return raw?.trim().toLowerCase() === 'de' ? 'de' : 'en';
}
