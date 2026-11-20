import type { Ctx } from './context.js';

export type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  pattern: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  private add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, pattern, segments: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string>; pattern: string } | 'method-not-allowed' | null {
    const parts = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i]!;
        const part = parts[i]!;
        if (seg.startsWith(':')) {
          try {
            params[seg.slice(1)] = decodeURIComponent(part);
          } catch {
            ok = false;
            break;
          }
        } else if (seg !== part) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { handler: route.handler, params, pattern: route.pattern };
      }
    }
    return pathMatched ? 'method-not-allowed' : null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined | null): v is string => !!v && UUID_RE.test(v);
