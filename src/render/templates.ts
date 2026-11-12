import type { BadgeIndex } from '../badges/badges';
import { buildFragments, fragmentsToNodes, type EmoteRegistry } from '../emotes/registry';
import type { Author, OverlayEvent } from '../events/types';
import type { Messages } from '../i18n';

export interface RenderContext {
  emotes: EmoteRegistry;
  badges: BadgeIndex;
  t: Messages;
}

function line(...classes: string[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = ['line', ...classes].join(' ');
  return el;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.append(document.createTextNode(text));
  return el;
}

function badgeNodes(author: Author, badges: BadgeIndex): HTMLSpanElement {
  const host = document.createElement('span');
  host.className = 'badges';

  for (const badge of author.badges) {
    const url = badges.get(badge.setId, badge.version);
    if (!url) continue;
    const img = document.createElement('img');
    img.className = 'badge';
    img.src = url;
    img.alt = badge.setId;
    host.append(img);
  }

  return host;
}

function body(text: string): HTMLSpanElement {
  return span('body', text);
}

export function renderEvent(event: OverlayEvent, ctx: RenderContext): HTMLElement | null {
  const { t } = ctx;
  switch (event.type) {
    case 'chat': {
      const classes = ['line--chat'];
      if (event.action) classes.push('line--action');
      if (event.bits > 0) classes.push('line--bits');
      const el = line(...classes);

      el.append(badgeNodes(event.author, ctx.badges));
      const user = span('user', event.author.displayName);
      if (event.author.color) user.style.color = event.author.color;
      el.append(user, document.createTextNode(event.action ? ' ' : ': '));

      if (event.bits > 0) el.append(span('bits', t.bits(event.bits)));

      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.append(fragmentsToNodes(buildFragments(event.text, event.twitchEmotes, ctx.emotes)));
      el.append(msg);
      return el;
    }

    case 'raid': {
      const el = line('line--raid');
      el.append(body(t.raid(event.from, event.viewers)));
      return el;
    }

    case 'sub': {
      const el = line('line--sub');
      el.append(body(t.sub(event.user, event.tier)));
      if (event.text) el.append(body(` — ${event.text}`));
      return el;
    }

    case 'resub': {
      const el = line('line--resub');
      el.append(body(t.resub(event.user, event.months, event.streak)));
      if (event.text) el.append(body(` — ${event.text}`));
      return el;
    }

    case 'giftsub': {
      const el = line('line--giftsub');
      el.append(body(t.giftsub(event.gifter, event.recipient, event.tier)));
      return el;
    }

    case 'subbomb': {
      const el = line('line--subbomb');
      el.append(body(t.subbomb(event.gifter, event.count)));
      return el;
    }

    case 'announcement': {
      const el = line('line--announcement');
      el.append(body(`${event.user}: ${event.text}`));
      return el;
    }

    case 'redemption': {
      const el = line('line--redemption');
      el.append(body(t.redemption(event.user, event.reward, event.cost)));
      if (event.input) el.append(body(` — ${event.input}`));
      return el;
    }

    case 'follow': {
      const el = line('line--follow');
      el.append(body(t.follow(event.user)));
      return el;
    }

    case 'hypetrain': {
      const el = line('line--hypetrain');
      el.append(body(t.hypetrain(event.phase, event.level)));
      return el;
    }

    case 'moderation': {
      const el = line('line--moderation', `line--${event.action}`);
      const text =
        event.action === 'timeout'
          ? t.timeout(event.user, event.moderator, event.seconds ?? 0)
          : t[event.action](event.user, event.moderator);
      el.append(body(text));
      if (event.reason) el.append(body(` — ${event.reason}`));
      return el;
    }

    case 'notice': {
      const el = line('line--notice');
      el.append(body(event.text));
      return el;
    }

    case 'delete':
    case 'clear':
      return null;
  }
}
