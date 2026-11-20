import { html, type SafeHtml } from './html.js';
import type { Ctx } from '../http/context.js';
import { href, alternateHref } from '../http/context.js';
import { csrfField, icon } from './components.js';

export interface PageOpts {
  title: string;
  description?: string;
  body: SafeHtml;
  /** 'site' = patient site, 'doctors' = dark doctor marketing header, 'app' = no marketing footer */
  variant?: 'site' | 'doctors' | 'app';
  noindex?: boolean;
}

function userMenu(ctx: Ctx): SafeHtml {
  const u = ctx.user;
  if (!u) {
    return html`<a class="btn btn-ghost" href="${href(ctx, '/login')}">${ctx.t('nav.signIn')}</a>
      <a class="btn btn-primary" href="${href(ctx, '/signup')}">${ctx.t('nav.signUp')}</a>`;
  }
  const home =
    u.role === 'doctor'
      ? html`<a class="btn btn-ghost" href="${href(ctx, '/dashboard')}">${ctx.t('nav.dashboard')}</a>`
      : u.role === 'admin'
        ? html`<a class="btn btn-ghost" href="${href(ctx, '/admin')}">${ctx.t('nav.admin')}</a>`
        : html`<a class="btn btn-ghost" href="${href(ctx, '/appointments')}">${ctx.t('nav.myAppointments')}</a>`;
  return html`${home}
    <form method="post" action="${href(ctx, '/logout')}" class="inline-form">${csrfField(ctx)}
      <button type="submit" class="btn btn-outline">${ctx.t('nav.signOut')}</button></form>`;
}

export function layout(ctx: Ctx, o: PageOpts): SafeHtml {
  const variant = o.variant ?? 'site';
  const dir = ctx.locale === 'ar' ? 'rtl' : 'ltr';
  const origin = ctx.deps.cfg.PUBLIC_ORIGIN;
  const p = ctx.path === '/' ? '' : ctx.path;
  return html`<html lang="${ctx.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
${o.description ? html`<meta name="description" content="${o.description}">` : ''}
${o.noindex || ctx.deps.cfg.DEMO_MODE ? html`<meta name="robots" content="noindex">` : ''}
<link rel="alternate" hreflang="ar" href="${origin}${p || '/'}">
<link rel="alternate" hreflang="en" href="${origin}/en${p}">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
${ctx.locale === 'ar' ? html`<link rel="preload" href="/static/fonts/cairo.woff" as="font" type="font/woff" crossorigin>` : ''}
<link rel="stylesheet" href="/static/styles.css">
<script src="/static/app.js" defer></script>
</head>
<body class="variant-${variant}">
<a class="skip-link" href="#main">${ctx.t('nav.skip')}</a>
${ctx.deps.cfg.DEMO_MODE ? html`<div class="demo-banner" role="note">${ctx.t('demo.banner')}</div>` : ''}
<header class="site-header${variant === 'doctors' ? ' dark' : ''}">
  <div class="container header-row">
    <a class="brand" href="${href(ctx, variant === 'doctors' ? '/for-doctors' : '/')}">
      ${icon.logo}<span class="brand-name">${ctx.t('brand')}</span>${variant === 'doctors' ? html`<span class="brand-kicker">${ctx.t('fd.kicker')}</span>` : ''}
    </a>
    <nav aria-label="${ctx.t('nav.main')}" class="main-nav">
      <a href="${href(ctx, '/search')}">${ctx.t('nav.findDoctor')}</a>
      ${ctx.deps.ai && ctx.user?.role !== 'doctor' && ctx.user?.role !== 'admin' ? html`<a href="${href(ctx, '/symptom-checker')}">${ctx.t('nav.symptomChecker')}</a>` : ''}
      <a href="${href(ctx, '/for-doctors')}">${ctx.t('nav.forDoctors')}</a>
    </nav>
    <div class="header-actions">
      <a class="btn btn-outline lang-switch" href="${alternateHref(ctx)}" hreflang="${ctx.locale === 'ar' ? 'en' : 'ar'}" lang="${ctx.locale === 'ar' ? 'en' : 'ar'}">${ctx.t('nav.language')}</a>
      ${userMenu(ctx)}
    </div>
  </div>
</header>
<main id="main" tabindex="-1">${o.body}</main>
<footer class="site-footer">
  <div class="container footer-row">
    <div class="footer-brand"><strong>${ctx.t('brand')}</strong><span>${ctx.t('footer.tagline')}</span></div>
    <p class="footer-emergency">${ctx.t('footer.emergency')}</p>
    <nav class="footer-links" aria-label="Legal">
      <a href="${href(ctx, '/privacy')}">${ctx.t('footer.privacy')}</a>
      <a href="${href(ctx, '/terms')}">${ctx.t('footer.terms')}</a>
      <span>${ctx.t('footer.rights', { year: ctx.deps.now().getUTCFullYear() })}</span>
    </nav>
  </div>
</footer>
</body>
</html>`;
}
