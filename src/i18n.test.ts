import { describe, expect, it } from 'vitest';
import { MESSAGES, parseLanguage } from './i18n';

describe('parseLanguage', () => {
  it('defaults to english', () => {
    expect(parseLanguage(null)).toBe('en');
    expect(parseLanguage('')).toBe('en');
    expect(parseLanguage('fr')).toBe('en');
  });

  it('reads de and en case insensitive', () => {
    expect(parseLanguage('de')).toBe('de');
    expect(parseLanguage('DE')).toBe('de');
    expect(parseLanguage('En')).toBe('en');
  });
});

describe('MESSAGES', () => {
  it('announces chat approval with the trusted users', () => {
    expect(MESSAGES.en.approvalActive(['alice', 'bob'], 'saved')).toBe('Chat approval active — 2 trusted: alice, bob');
    expect(MESSAGES.en.approvalActive([], 'memory')).toBe('Chat approval active — no trusted users yet (not saved)');
    expect(MESSAGES.en.approvalActive([], 'unloaded')).toBe('Chat approval active — trusted users could not be loaded');
    expect(MESSAGES.de.approvalActive(['alice'], 'memory')).toBe('Chat-Freigabe aktiv — 1 vertrauenswürdig: alice (nicht gespeichert)');
  });

  it('names the mod behind an approval', () => {
    expect(MESSAGES.en.approvalTrusted('alice', 'Mod')).toBe('alice trusted by Mod');
    expect(MESSAGES.en.approvalUntrusted('alice', null)).toBe('alice untrusted by a mod');
    expect(MESSAGES.en.approvalApproved(null, 'Mod')).toBe('Message approved by Mod');
    expect(MESSAGES.de.approvalTrusted('alice', null)).toBe('alice von einem Mod als vertrauenswürdig markiert');
    expect(MESSAGES.de.approvalApproved('bob', 'Mod')).toBe('Nachricht von bob von Mod freigegeben');
    expect(MESSAGES.en.approvalHeld('bob')).toBe('bob wrote a message that awaits approval');
    expect(MESSAGES.de.approvalHeld('bob')).toBe('bob hat geschrieben, die Nachricht wartet auf Freigabe');
  });

  it('shortens a long list of trusted users', () => {
    const logins = Array.from({ length: 23 }, (_, i) => `u${i}`);
    expect(MESSAGES.en.approvalActive(logins, 'saved').endsWith(', u19, +3 more')).toBe(true);
    expect(MESSAGES.de.approvalActive(logins, 'saved').endsWith(', u19, +3 weitere')).toBe(true);
  });

  it('formats the same event in both languages', () => {
    expect(MESSAGES.en.resub('Regular', 42, 12)).toBe('Regular has been subscribed for 42 months, 12 in a row');
    expect(MESSAGES.de.resub('Stammgast', 42, 12)).toBe('Stammgast ist seit 42 Monaten dabei, 12 in Folge');
  });

  it('omits a missing streak', () => {
    expect(MESSAGES.en.resub('a', 3, null)).toBe('a has been subscribed for 3 months');
    expect(MESSAGES.de.resub('a', 3, null)).toBe('a ist seit 3 Monaten dabei');
  });

  it('formats ad breaks in exact seconds', () => {
    expect(MESSAGES.en.adbreak('begin', 90)).toBe('Ad break started — 90 seconds');
    expect(MESSAGES.de.adbreak('begin', 90)).toBe('Werbung läuft — 90 Sekunden');
    expect(MESSAGES.de.adbreak('end', 90)).toBe('Werbung ist vorbei');
  });

  it('formats moderation actions with a readable timeout duration', () => {
    expect(MESSAGES.en.ban('Troll', 'Mod')).toBe('Troll was banned by Mod');
    expect(MESSAGES.en.timeout('Troll', 'Mod', 600)).toBe('Troll was timed out for 10 minutes by Mod');
    expect(MESSAGES.en.timeout('Troll', 'Mod', 1)).toBe('Troll was timed out for 1 second by Mod');
    expect(MESSAGES.en.unban('Troll', 'Mod')).toBe('Troll was unbanned by Mod');
    expect(MESSAGES.de.ban('Troll', 'Mod')).toBe('Troll wurde von Mod gebannt');
    expect(MESSAGES.de.timeout('Troll', 'Mod', 86_400)).toBe('Troll wurde von Mod für 1 Tag getimeoutet');
    expect(MESSAGES.de.timeout('Troll', 'Mod', 7_200)).toBe('Troll wurde von Mod für 2 Stunden getimeoutet');
    expect(MESSAGES.de.unban('Troll', 'Mod')).toBe('Troll wurde von Mod entbannt');
  });

  it('maps tier ids to labels', () => {
    expect(MESSAGES.en.sub('a', '2000')).toBe('a subscribed (Tier 2)');
    expect(MESSAGES.de.giftsub('a', 'b', 'Prime')).toBe('a schenkt b ein Abo (Prime)');
  });
});
