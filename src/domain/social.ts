/*
 * The doctor's social media links. Whatever is typed (a full link, "@name" or just "name") becomes a
 * clean https link to the real site, so a profile can never link somewhere else.
 */

export type SocialKind = 'facebook' | 'instagram' | 'tiktok';
export const SOCIAL_KINDS: readonly SocialKind[] = ['facebook', 'instagram', 'tiktok'];

const HOSTS: Record<SocialKind, RegExp> = {
  facebook: /^((www|m|web|mbasic)\.)?(facebook|fb)\.com$/,
  instagram: /^(www\.)?instagram\.com$/,
  tiktok: /^((www|m|vm)\.)?tiktok\.com$/,
};

const NAME: Record<SocialKind, RegExp> = {
  facebook: /^[A-Za-z0-9.\-]{2,80}$/,
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
};

/** Facebook pages that are not a person or page name. */
const FB_RESERVED = new Set(['login', 'share', 'sharer', 'sharer.php', 'dialog', 'groups', 'events', 'watch', 'hashtag', 'plugins', 'l.php']);

/** '' → null (remove); a valid link → the clean https link; anything else → 'invalid'. */
export function normalizeSocial(kind: SocialKind, raw: string): string | null | 'invalid' {
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 300) return 'invalid';
  // Just a name / @name.
  const bare = s.replace(/^@/, '');
  if (!/[/:]/.test(s) && NAME[kind].test(bare)) return build(kind, bare);
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return 'invalid';
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return 'invalid';
  const host = u.hostname.toLowerCase();
  if (!HOSTS[kind].test(host)) return 'invalid';
  const parts = u.pathname.split('/').filter(Boolean);
  if (kind === 'facebook') {
    if (parts[0] === 'profile.php') {
      const id = u.searchParams.get('id') ?? '';
      return /^\d{5,20}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : 'invalid';
    }
    // facebook.com/people/Name/123… and facebook.com/name
    if (parts[0] === 'people' && parts.length >= 3 && /^\d{5,20}$/.test(parts[2]!) && NAME.facebook.test(parts[1]!)) {
      return `https://www.facebook.com/people/${parts[1]}/${parts[2]}`;
    }
    const name = parts[0] ?? '';
    return NAME.facebook.test(name) && !FB_RESERVED.has(name.toLowerCase()) ? build(kind, name) : 'invalid';
  }
  if (kind === 'tiktok' && host === 'vm.tiktok.com') {
    return parts.length === 1 && /^[A-Za-z0-9]{5,20}$/.test(parts[0]!) ? `https://vm.tiktok.com/${parts[0]}/` : 'invalid';
  }
  const name = (parts[0] ?? '').replace(/^@/, '');
  if (kind === 'tiktok' && !(parts[0] ?? '').startsWith('@')) return 'invalid';
  return NAME[kind].test(name) ? build(kind, name) : 'invalid';
}

function build(kind: SocialKind, name: string): string {
  switch (kind) {
    case 'facebook':
      return `https://www.facebook.com/${name}`;
    case 'instagram':
      return `https://www.instagram.com/${name}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${name}`;
  }
}
