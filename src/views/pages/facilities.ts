import { html, attrIf, type SafeHtml } from '../html.js';
import { format12h, formatEgyptPhone, allPhones, phonesForForm } from '../../domain/branchPhones.js';
import { callButtons } from '../components.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, consentField, csrfField, directionsHref, districtOptionGroups, cityOptions, placeName, placeForMaps, fieldError, icon, initials, input, passwordInput, select, errorSummary, searchTabs } from '../components.js';
import { pick, formatNumber, type MessageKey } from '../../i18n/index.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import { LAB_TESTS } from '../../domain/clinical.js';
import { facilityDocs, docField, MAX_FILES_PER_DOC, type FacilityDocKind } from '../../domain/documents.js';
import type { FacilityDoc, KeptFile } from '../../services/facilityDocuments.js';
import { MAX_FACILITY_PHOTOS, type FacilityPhoto } from '../../services/facilityPhotos.js';
import type { ReferenceData } from '../../services/reference.js';
import type { FieldErrors } from '../../services/accounts.js';
import {
  FACILITY_KINDS, offersTests, testGroupsFor, type BranchRow, type FacilityKind, type FacilitySearch, type OwnFacility, type PublicBranch, type PublicFacility,
  type ExtraTest,
} from '../../services/facilities.js';
import { money } from './public.js';

export const KIND_PATH: Record<FacilityKind, string> = { pharmacy: '/pharmacies', lab: '/labs', radiology: '/scan-centres' };
const kindLabel = (ctx: Ctx, k: FacilityKind) => ctx.t(`fac.kind.${k}` as MessageKey);
const testName = (ctx: Ctx, code: string) => {
  const t = LAB_TESTS.find((x) => x.code === code);
  return t ? (ctx.locale === 'ar' ? t.ar : t.en) : code;
};
const WEEKDAY: MessageKey[] = ['weekday.0', 'weekday.1', 'weekday.2', 'weekday.3', 'weekday.4', 'weekday.5', 'weekday.6'];

/** "Every day, 9:00 AM–2:00 AM (next day)" / "Open 24 hours". */
export function hoursText(ctx: Ctx, b: Pick<BranchRow, 'open_24h' | 'open_days' | 'opens' | 'closes'>): string {
  const days = b.open_days.length === 7 ? ctx.t('fac.everyDay') : b.open_days.map((d) => ctx.t(WEEKDAY[d]!)).join(ctx.locale === 'ar' ? '، ' : ', ');
  if (b.open_24h) return ctx.t('fac.hours24', { days });
  const nextDay = b.closes <= b.opens ? ` ${ctx.t('fac.nextDay')}` : '';
  const opens = format12h(b.opens, ctx.locale);
  const closes = `${format12h(b.closes, ctx.locale)}${nextDay}`;
  // Arabic times read right-to-left naturally; English ones are kept together left-to-right.
  return ctx.locale === 'ar' ? ctx.t('fac.hoursRange', { days, opens, closes }) : ctx.t('fac.hoursRange', { days, opens: `⁦${opens}`, closes: `${closes}⁩` });
}

const openChip = (ctx: Ctx, open: boolean) =>
  html`<span class="chip ${open ? 'status-confirmed' : 'status-cancelled'}">${ctx.t(open ? 'fac.openNow' : 'fac.closedNow')}</span>`;

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

export function facilityJoinPage(ctx: Ctx, o: { values?: Record<string, string>; errors?: FieldErrors; kept?: KeptFile[]; refused?: string[] }): SafeHtml {
  const v = o.values ?? {};
  const kind = v['kind'] ?? '';
  const body = html`<div class="container page narrow stack-lg">
    <div class="stack-sm">
      <h1>${ctx.t('facjoin.title')}</h1>
      <p class="muted">${ctx.t('facjoin.lead')}</p>
    </div>
    ${errorSummary(ctx, o.errors, { reenter: ['password'] })}
    <form class="panel stack-lg" method="post" action="${href(ctx, '/facilities/join')}" enctype="multipart/form-data" novalidate>
      ${csrfField(ctx)}
      <fieldset class="stack-sm">
        <legend class="label">${ctx.t('facjoin.kind')}</legend>
        ${fieldError(ctx, o.errors, 'kind')}
        <div class="segmented three">${FACILITY_KINDS.map(
          (k) => html`<label><input type="radio" name="kind" value="${k}"${attrIf(kind === k, 'checked')} required><span>${kindLabel(ctx, k)}</span></label>`,
        )}</div>
      </fieldset>
      <div class="form-grid">
        ${input(ctx, { name: 'name', label: ctx.t('facjoin.name'), value: v['name'], hint: ctx.t('facjoin.nameHint'), maxlength: 120, errors: o.errors, required: true })}
        ${input(ctx, { name: 'licenceNumber', label: ctx.t('facjoin.licenceNumber'), value: v['licenceNumber'], maxlength: 40, errors: o.errors, required: true })}
        ${input(ctx, { name: 'contactName', label: ctx.t('facjoin.contactName'), value: v['contactName'], autocomplete: 'name', maxlength: 120, errors: o.errors, required: true })}
        ${input(ctx, { name: 'phone', label: ctx.t('auth.phone'), type: 'tel', value: v['phone'], prefix: '+20', autocomplete: 'tel-national', inputmode: 'tel', hint: ctx.t('facjoin.phoneHint'), errors: o.errors, required: true })}
        ${input(ctx, { name: 'email', label: ctx.t('join.email'), type: 'email', value: v['email'], autocomplete: 'email', maxlength: 254, errors: o.errors, required: true })}
        ${passwordInput(ctx, { name: 'password', label: ctx.t('auth.password'), autocomplete: 'new-password', hint: ctx.t('auth.passwordHint'), errors: o.errors, required: true })}
        ${facilityDocFields(ctx, facilityDocs('radiology'), { kept: o.kept, refused: o.refused, onlyFor: { radiation_licence: 'radiology' }, signup: true })}
      </div>
      ${consentField(ctx, o.errors)}
      <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('facjoin.submit')}</button>
      <p class="hint center">${ctx.t('facjoin.afterSubmit')}</p>
    </form>
  </div>`;
  return layout(ctx, { title: `${ctx.t('facjoin.title')} — ${ctx.t('brand')}`, body, noindex: false });
}

const PREVIEWABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/**
 * Upload boxes for labs, pharmacies and scan centres: several photos per document, any phone photo
 * or PDF, nothing required. Files already uploaded on an earlier try are listed (and sent back) so
 * they never have to be chosen again.
 */
export function facilityDocFields(
  ctx: Ctx,
  specs: readonly { kind: FacilityDocKind; required: boolean }[],
  o: { kept?: KeptFile[]; refused?: string[]; onlyFor?: Partial<Record<FacilityDocKind, string>>; signup?: boolean; have?: Map<FacilityDocKind, number> } = {},
): SafeHtml {
  return html`<fieldset class="stack docs-fieldset span-all">
    <legend>${ctx.t('docs.title')}</legend>
    <p class="hint">${ctx.t(o.signup ? 'fdocs.signupLead' : 'fdocs.lead')}</p>
    ${o.refused?.length ? alert('warning', html`${ctx.t('fdocs.refused')} <bdi>${o.refused.join('، ')}</bdi>`) : ''}
    <div class="docs-grid">${specs.map((d) => {
      const name = docField(d.kind);
      const id = `doc-${d.kind}`;
      const kept = (o.kept ?? []).filter((k) => k.kind === d.kind);
      const have = o.have?.get(d.kind) ?? 0;
      return html`<div class="field doc-field"${o.onlyFor?.[d.kind] ? html` data-only-kind="${o.onlyFor[d.kind]}"` : ''}>
        <label class="dropzone" for="${id}">
          ${icon.upload}
          <span class="stack-sm"><strong>${ctx.t(`docs.kind.${d.kind}` as MessageKey)}</strong>
            <span class="hint">${d.required ? html`<span class="req-tag">${ctx.t('fdocs.needed')}</span>` : ctx.t('docs.optional')} · ${ctx.t('fdocs.choose')}</span>
            ${have ? html`<span class="small ok-text">✓ ${ctx.t('fdocs.haveN', { n: formatNumber(have, ctx.locale) })}</span>` : ''}
            <span class="file-name small" data-file-name></span></span>
          <input id="${id}" name="${name}" type="file" multiple accept="image/*,.heic,.heif,application/pdf" data-shrink>
        </label>
        ${kept.length
          ? html`<ul class="kept-files">${kept.map((k) => html`<li><label class="check"><input type="checkbox" name="keep_doc" value="${k.token}" checked>
              <span>✓ <bdi>${k.name}</bdi> <span class="muted">(${ctx.t('fdocs.alreadyUploaded')})</span></span></label></li>`)}</ul>`
          : ''}
      </div>`;
    })}</div>
  </fieldset>`;
}

/** The facility's documents: what is still needed, what was uploaded, and adding more. */
export function facilityDocumentsPage(ctx: Ctx, f: OwnFacility, docs: FacilityDoc[], o: { notice?: { kind: 'success' | 'error'; key: MessageKey }; refused?: string[] } = {}): SafeHtml {
  const specs = facilityDocs(f.kind);
  const have = new Map<FacilityDocKind, number>();
  for (const d of docs) have.set(d.kind, (have.get(d.kind) ?? 0) + 1);
  const missing = specs.filter((s) => s.required && !have.get(s.kind));
  const locked = f.verification_status === 'approved' || f.verification_status === 'suspended';
  const content = html`<div class="stack-sm"><h1>${ctx.t('fdocs.title')}</h1><p class="muted">${ctx.t('fdocs.pageLead')}</p></div>
    ${f.verification_status === 'pending' && f.docs_request_note ? alert('warning', html`${ctx.t('fdocs.requestedBody')} <q dir="auto">${f.docs_request_note}</q>`, ctx.t('fdocs.requestedTitle')) : ''}
    ${missing.length && !locked
      ? html`<section class="panel stack-sm" data-testid="docs-missing"><h2 class="h3">${ctx.t('fdocs.stillNeeded')}</h2>
          <ul>${missing.map((m) => html`<li>${ctx.t(`docs.kind.${m.kind}` as MessageKey)}</li>`)}</ul></section>`
      : ''}
    <section class="panel stack">
      <h2>${ctx.t('fdocs.uploaded')} <span class="muted">(${formatNumber(docs.length, ctx.locale)})</span></h2>
      ${docs.length
        ? html`<ul class="doc-thumbs">${docs.map((d) => html`<li class="doc-thumb" data-testid="own-doc">
            <a href="${href(ctx, `/facility/documents/${d.id}`)}" target="_blank" rel="noopener">
              ${PREVIEWABLE.has(d.mime_type) ? html`<img src="${href(ctx, `/facility/documents/${d.id}`)}" alt="" loading="lazy">` : html`<span class="doc-icon">${d.mime_type === 'application/pdf' ? 'PDF' : 'HEIC'}</span>`}
            </a>
            <span class="small">${ctx.t(`docs.kind.${d.kind}` as MessageKey)}</span>
            ${locked ? '' : html`<form method="post" action="${href(ctx, `/facility/documents/${d.id}/delete`)}" class="inline-form">${csrfField(ctx)}
              <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('fdocs.remove')}</button></form>`}
          </li>`)}</ul>`
        : html`<p class="muted">${ctx.t('fdocs.none')}</p>`}
    </section>
    <form class="panel stack" method="post" action="${href(ctx, '/facility/documents')}" enctype="multipart/form-data">${csrfField(ctx)}
      ${facilityDocFields(ctx, specs, { refused: o.refused, have })}
      <div><button class="btn btn-primary" type="submit">${icon.upload}${ctx.t('fdocs.add')}</button></div>
      <p class="hint">${ctx.t('fdocs.limit', { n: formatNumber(MAX_FILES_PER_DOC, ctx.locale) })}</p>
    </form>`;
  return facilityShell(ctx, f, 'documents', content, o.notice);
}

/** Link to a place's photo (public once the place is approved). */
export const facilityPhotoHref = (ctx: Ctx, id: string): string => href(ctx, `/photos/facilities/${id}`);

/** The logo when there is one, otherwise initials. */
function facilityAvatar(ctx: Ctx, p: { name: string; logo: string | null }, cls = ''): SafeHtml {
  return p.logo
    ? html`<img class="avatar avatar-img ${cls}" src="${facilityPhotoHref(ctx, p.logo)}" alt="" loading="lazy">`
    : html`<div class="avatar ${cls}" aria-hidden="true">${initials(p.name)}</div>`;
}

/** Logo and photos of the place, shown on the Profile page. */
function facilityPhotosSection(ctx: Ctx, photos: FacilityPhoto[]): SafeHtml {
  const logo = photos.find((p) => p.kind === 'logo');
  const shots = photos.filter((p) => p.kind === 'photo');
  const thumb = (p: FacilityPhoto) => html`<li class="doc-thumb" data-testid="own-photo">
      <a href="${facilityPhotoHref(ctx, p.id)}" target="_blank" rel="noopener"><img src="${facilityPhotoHref(ctx, p.id)}" alt="" loading="lazy"></a>
      ${p.hidden ? html`<span class="small error-text">${ctx.t('fphoto.hiddenByTeam')}</span>` : ''}
      <form method="post" action="${href(ctx, `/facility/photos/${p.id}/delete`)}" class="inline-form">${csrfField(ctx)}
        <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('fdocs.remove')}</button></form>
    </li>`;
  const picker = (name: string, multiple: boolean, label: MessageKey) => html`<label class="doc-field">
      <input type="file" name="${name}" accept="image/*"${attrIf(multiple, 'multiple')} data-shrink="always" required>
      ${icon.upload}<span class="stack-sm"><strong>${ctx.t(label)}</strong><span class="small muted">${ctx.t('fdocs.choose')}</span><span class="small ok-text" data-file-name></span></span>
    </label>`;
  return html`<div class="stack-sm" id="photos"><h2>${ctx.t('fphoto.title')}</h2><p class="muted">${ctx.t('fphoto.lead')}</p></div>
    <section class="panel stack">
      <h3 class="h3">${ctx.t('fphoto.logo')}</h3>
      <p class="hint">${ctx.t('fphoto.logoHint')}</p>
      ${logo ? html`<ul class="doc-thumbs logo-thumb">${thumb(logo)}</ul>` : ''}
      <form class="stack-sm" method="post" action="${href(ctx, '/facility/photos?kind=logo')}" enctype="multipart/form-data">${csrfField(ctx)}
        ${picker('logo', false, logo ? 'fphoto.changeLogo' : 'fphoto.addLogo')}
        <div><button class="btn btn-primary" type="submit">${icon.upload}${ctx.t('fdocs.add')}</button></div>
      </form>
    </section>
    <section class="panel stack">
      <h3 class="h3">${ctx.t('fphoto.photos')} <span class="muted">(${formatNumber(shots.length, ctx.locale)}/${formatNumber(MAX_FACILITY_PHOTOS, ctx.locale)})</span></h2>
      <p class="hint">${ctx.t('fphoto.photosHint')}</p>
      ${shots.length ? html`<ul class="doc-thumbs">${shots.map(thumb)}</ul>` : html`<p class="muted">${ctx.t('fphoto.none')}</p>`}
      ${shots.length < MAX_FACILITY_PHOTOS
        ? html`<form class="stack-sm" method="post" action="${href(ctx, '/facility/photos?kind=photo')}" enctype="multipart/form-data">${csrfField(ctx)}
            ${picker('photos', true, 'fphoto.addPhotos')}
            <div><button class="btn btn-primary" type="submit">${icon.upload}${ctx.t('fdocs.add')}</button></div>
          </form>`
        : html`<p class="small muted">${ctx.t('fphoto.full', { n: formatNumber(MAX_FACILITY_PHOTOS, ctx.locale) })}</p>`}
    </section>
    <p class="hint">${ctx.t('fphoto.rules')}</p>`;
}

// ---------------------------------------------------------------------------
// The facility's dashboard
// ---------------------------------------------------------------------------

export type FacilitySection = 'profile' | 'branches' | 'prices' | 'requests' | 'prescriptions' | 'insights' | 'documents';

export function facilityShell(ctx: Ctx, f: OwnFacility, section: FacilitySection, content: SafeHtml, notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  const items: { key: FacilitySection; path: string; label: MessageKey }[] = [
    { key: 'profile', path: '/facility', label: 'facdash.nav.profile' },
    { key: 'branches', path: '/facility/branches', label: 'facdash.nav.branches' },
    ...(offersTests(f.kind)
      ? [
          { key: 'requests' as const, path: '/facility/requests', label: 'facdash.nav.requests' as const },
          { key: 'prices' as const, path: '/facility/prices', label: 'facdash.nav.prices' as const },
        ]
      : [{ key: 'prescriptions' as const, path: '/facility/prescriptions', label: 'rxsend.inbox' as const }]),
    { key: 'insights' as const, path: '/facility/insights', label: 'fins.title' as const },
    // Once approved, documents are only a record for our team, so the section is not shown.
    ...(f.verification_status === 'approved' ? [] : [{ key: 'documents' as const, path: '/facility/documents', label: 'fdocs.nav' as const }]),
  ];
  const status = f.verification_status;
  const docsLink = html` <a href="${href(ctx, '/facility/documents')}">${ctx.t('fdocs.open')}</a>`;
  const banner =
    status === 'pending' && f.docs_request_note
      ? alert('warning', html`${ctx.t('fdocs.requestedBody')} <q dir="auto">${f.docs_request_note}</q>${docsLink}`, ctx.t('fdocs.requestedTitle'))
      : status === 'pending' && !f.doc_count
        ? alert('info', html`${ctx.t('fdocs.noneYetBody')}${docsLink}`, ctx.t('dash.pendingTitle'))
      : status === 'pending'
      ? alert('info', ctx.t('facdash.pendingBody'), ctx.t('dash.pendingTitle'))
      : status === 'rejected'
        ? alert('error', ctx.t('dash.rejectedBody', { note: f.verification_note ?? '—' }), ctx.t('dash.rejectedTitle'))
        : status === 'suspended'
          ? alert('error', ctx.t('facdash.suspendedBody'), ctx.t('dash.suspendedTitle'))
          : html``;
  const body = html`<div class="dash">
    <nav class="dash-nav" aria-label="${ctx.t('dash.nav')}">
      <p class="dash-nav-title">${f.name}</p>
      <ul>${items.map((i) => html`<li><a href="${href(ctx, i.path)}"${attrIf(i.key === section, 'aria-current="page"')}>${ctx.t(i.label)}</a></li>`)}</ul>
      <a class="dash-public" href="${href(ctx, `${KIND_PATH[f.kind]}/${f.slug}`)}">${ctx.t(status === 'approved' ? 'dash.publicProfile' : 'facdash.preview')}${icon.arrow}</a>
    </nav>
    <div class="dash-content stack-lg">
      ${banner}
      ${notice ? alert(notice.kind, ctx.t(notice.key)) : ''}
      ${content}
    </div>
  </div>`;
  return layout(ctx, { title: `${f.name} — ${ctx.t('brand')}`, body, variant: 'app', noindex: true });
}

export function facilityProfilePage(
  ctx: Ctx,
  f: OwnFacility,
  o: { branches: number; branchList?: BranchRow[]; ref?: ReferenceData; photos?: FacilityPhoto[]; tests: number; values?: Record<string, string>; errors?: FieldErrors; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const addresses = o.branchList ?? [];
  const v = o.values ?? {
    name: f.name,
    description: f.description,
    phone: phonesForForm(f.phone_e164, f.extra_phones),
    whatsapp: f.whatsapp_e164 ? formatEgyptMobile(f.whatsapp_e164).replace(/\s/g, '') : '',
    homeService: f.home_service ? 'yes' : '',
  };
  const steps = [
    { done: !!f.description, label: 'facdash.stepProfile' as MessageKey, path: '/facility' },
    { done: o.branches > 0, label: 'facdash.stepBranch' as MessageKey, path: '/facility/branches' },
    ...(offersTests(f.kind) ? [{ done: o.tests > 0, label: 'facdash.stepPrices' as MessageKey, path: '/facility/prices' }] : []),
  ];
  const content = html`
    <div><h1>${ctx.t('facdash.title')}</h1><p class="muted">${kindLabel(ctx, f.kind)} · ${ctx.t('facjoin.licenceNumber')}: <span dir="ltr">${f.licence_number}</span></p></div>
    ${steps.some((s) => !s.done)
      ? html`<section class="panel stack-sm"><strong>${ctx.t('facdash.setupTitle')}</strong>
          <ol class="setup-steps">${steps.map((s) => html`<li class="${s.done ? 'done' : ''}">${s.done ? icon.check : ''}<a href="${href(ctx, s.path)}">${ctx.t(s.label)}</a></li>`)}</ol></section>`
      : ''}
    <form method="post" action="${href(ctx, '/facility')}" class="panel stack" novalidate>
      ${csrfField(ctx)}
      <div class="form-grid">
        ${input(ctx, { name: 'name', label: ctx.t('facjoin.name'), value: v['name'], maxlength: 120, errors: o.errors, required: true })}
        ${input(ctx, { name: 'phone', label: ctx.t('facdash.phone'), type: 'tel', value: v['phone'], inputmode: 'tel', hint: ctx.t('facdash.phoneHint'), maxlength: 240, errors: o.errors })}
        ${input(ctx, { name: 'whatsapp', label: ctx.t('facdash.whatsapp'), type: 'tel', value: v['whatsapp'], inputmode: 'tel', errors: o.errors })}
      </div>
      <div class="field">
        <label for="description">${ctx.t('facdash.description')}</label>
        <textarea id="description" name="description" rows="4" maxlength="1000" aria-describedby="description-hint">${v['description'] ?? ''}</textarea>
        <p class="hint" id="description-hint">${ctx.t(`facdash.descriptionHint.${f.kind}` as MessageKey)}</p>
        ${fieldError(ctx, o.errors, 'description')}
      </div>
      <label class="check"><input type="checkbox" name="homeService" value="yes"${attrIf(v['homeService'] === 'yes', 'checked')}><span>${ctx.t(`fac.homeService.${f.kind}` as MessageKey)}</span></label>
      <div><button class="btn btn-primary" type="submit">${ctx.t('common.save')}</button></div>
    </form>
    <section class="panel stack-sm" data-testid="profile-address">
      <h2 class="h3">${ctx.t('fac.addressTitle')}</h2>
      ${addresses.length
        ? html`<ul class="branch-list">${addresses.map((b) => {
            const dist = o.ref?.districtById.get(b.district_id);
            return html`<li class="stack-sm"><strong dir="auto">${b.name}</strong>
              <span dir="auto">${dist && o.ref ? placeName(ctx, dist) : ''} · ${b.address}</span>
              ${b.maps_url ? html`<a class="small" href="${b.maps_url}" target="_blank" rel="noopener noreferrer">${ctx.t('fac.mapsOpen')}</a>` : html`<span class="small muted">${ctx.t('fac.mapsMissing')}</span>`}</li>`;
          })}</ul>
          <div><a class="btn btn-outline btn-sm" href="${href(ctx, '/facility/branches')}">${ctx.t('fac.editAddress')}</a></div>`
        : html`<p class="muted">${ctx.t('fac.noAddress')}</p>
          <div><a class="btn btn-primary" href="${href(ctx, '/facility/branches')}">${ctx.t('fac.addAddress')}</a></div>`}
    </section>
    ${facilityPhotosSection(ctx, o.photos ?? [])}`;
  return facilityShell(ctx, f, 'profile', content, o.notice);
}

export function facilityBranchesPage(
  ctx: Ctx,
  f: OwnFacility,
  ref: ReferenceData,
  branches: BranchRow[],
  o: { values?: Record<string, string | string[]>; errors?: FieldErrors; editing?: string | null; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const districtOptions = districtOptionGroups(ctx, ref, 'id');
  const form = (b: BranchRow | null) => {
    const isTarget = (o.editing ?? null) === (b?.id ?? null);
    const v: Record<string, string | string[]> =
      isTarget && o.values
        ? o.values
        : b
          ? { name: b.name, district: String(b.district_id), address: b.address, mapsUrl: b.maps_url ?? '', phone: [b.phone_e164, ...b.extra_phones].filter((x): x is string => !!x).map((x) => '0' + x.slice(3)).join(' - '),
              open24h: b.open_24h ? 'yes' : '', days: b.open_days.map(String), opens: b.opens, closes: b.closes, active: b.is_active ? 'yes' : '' }
          : { days: ['0', '1', '2', '3', '4', '5', '6'], opens: '09:00', closes: '23:00', active: 'yes' };
    const errors = isTarget ? o.errors : undefined;
    const idPrefix = b ? `b${b.id.slice(0, 8)}-` : 'new-';
    const days = Array.isArray(v['days']) ? v['days'] : [];
    const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
    return html`<form method="post" action="${href(ctx, b ? `/facility/branches/${b.id}` : '/facility/branches')}" class="stack" novalidate>
      ${csrfField(ctx)}
      <div class="form-grid">
        ${input(ctx, { idPrefix, name: 'name', label: ctx.t('facdash.branchName'), value: str('name'), hint: ctx.t('facdash.branchNameHint'), maxlength: 120, errors, required: true })}
        <div class="stack-sm" data-city-pair>
          ${select(ctx, { idPrefix, name: 'city', label: ctx.t('search.city'), value: (() => { const d = ref.districtById.get(Number(str('district'))); return d ? (ref.governorateById.get(d.governorate_id)?.slug ?? '') : ''; })(), options: [{ value: '', label: '—' }, ...cityOptions(ctx, ref)] })}
          ${select(ctx, { idPrefix, name: 'district', label: ctx.t('clinics.district'), value: str('district'), options: [{ value: '', label: '—' }, ...districtOptions], errors, required: true })}
        </div>
        ${input(ctx, { idPrefix, name: 'address', label: ctx.t('clinics.address'), value: str('address'), hint: ctx.t('fac.addressHint'), maxlength: 300, errors, required: true })}
        ${input(ctx, { idPrefix, name: 'mapsUrl', label: ctx.t('fac.mapsLink'), type: 'url', value: str('mapsUrl'), hint: ctx.t('fac.mapsHint'), maxlength: 500, errors })}
        ${input(ctx, { idPrefix, name: 'phone', label: ctx.t('facdash.branchPhones'), type: 'tel', value: str('phone'), inputmode: 'tel', hint: ctx.t('facdash.branchPhonesHint'), maxlength: 120, errors })}
      </div>
      <fieldset class="stack-sm"><legend class="label">${ctx.t('facdash.openDays')}</legend>
        ${errors?.['days'] ? html`<p class="field-error">${ctx.t(errors['days'])}</p>` : ''}
        <div class="row-wrap">${[6, 0, 1, 2, 3, 4, 5].map(
          (d) => html`<label class="check day-check"><input type="checkbox" name="days" value="${d}"${attrIf(days.includes(String(d)), 'checked')}><span>${ctx.t(WEEKDAY[d]!)}</span></label>`,
        )}</div>
      </fieldset>
      <label class="check"><input type="checkbox" name="open24h" value="yes" data-open24h${attrIf(str('open24h') === 'yes', 'checked')}><span>${ctx.t('facdash.open24h')}</span></label>
      <p class="hint" data-hours-note>${ctx.t('facdash.open24hNote')}</p>
      <div class="form-grid" data-hours>
        ${input(ctx, { idPrefix, name: 'opens', label: ctx.t('facdash.opens'), type: 'time', value: str('opens'), errors })}
        ${input(ctx, { idPrefix, name: 'closes', label: ctx.t('facdash.closes'), type: 'time', value: str('closes'), hint: ctx.t('facdash.closesHint'), errors })}
      </div>
      <label class="check"><input type="checkbox" name="active" value="yes"${attrIf(str('active') === 'yes', 'checked')}><span>${ctx.t('facdash.branchActive')}</span></label>
      <div class="row-wrap"><button type="submit" class="btn btn-primary">${ctx.t(b ? 'facdash.saveBranch' : 'facdash.addBranch')}</button></div>
    </form>
    ${b
      ? html`<form method="post" action="${href(ctx, `/facility/branches/${b.id}/delete`)}">${csrfField(ctx)}
          <button type="submit" class="btn btn-ghost btn-sm danger">${ctx.t('facdash.deleteBranch')}</button></form>`
      : ''}`;
  };
  const content = html`
    <div><h1>${ctx.t('facdash.nav.branches')}</h1><p class="muted">${ctx.t('facdash.branchesLead')}</p></div>
    ${branches.map((b) => html`<section class="panel stack"><h2 class="h3">${b.name} <span class="muted small">· ${hoursText(ctx, b)}</span></h2>${form(b)}</section>`)}
    <section class="panel stack"><h2 class="h3">${ctx.t('facdash.addBranch')}</h2>${form(null)}</section>`;
  return facilityShell(ctx, f, 'branches', content, o.notice);
}

export function facilityPricesPage(
  ctx: Ctx,
  f: OwnFacility,
  prices: Map<string, number>,
  o: { values?: Record<string, string>; errors?: FieldErrors; notice?: { kind: 'success' | 'error'; key: MessageKey }; extras?: ExtraTest[] },
): SafeHtml {
  const groups = testGroupsFor(f.kind);
  const extras = o.extras ?? [];
  const v = o.values ?? {};
  const content = html`
    <div><h1>${ctx.t('facdash.nav.prices')}</h1><p class="muted">${ctx.t('facdash.pricesLead')}</p></div>
    ${errorSummary(ctx, o.errors)}
    <form method="post" action="${href(ctx, '/facility/prices')}" class="panel stack" novalidate>
      ${csrfField(ctx)}
      ${groups.map(
        (g) => html`<fieldset class="stack-sm price-group"><legend class="h3">${ctx.t(`lab.group.${g}` as MessageKey)}</legend>
          <div class="price-list">${LAB_TESTS.filter((t) => t.group === g).map((t) => {
            const name = `price_${t.code}`;
            const value = o.values ? (o.values[name] ?? '') : prices.has(t.code) ? String(prices.get(t.code)) : '';
            const err = o.errors?.[name];
            return html`<div class="price-row${err ? ' has-error' : ''}">
              <label for="${name}">${ctx.locale === 'ar' ? t.ar : t.en}</label>
              <span class="input-group small"><input id="${name}" name="${name}" inputmode="numeric" value="${value}" placeholder="—"${attrIf(!!err, 'aria-invalid="true"')}><span class="input-suffix">${ctx.t('fac.egp')}</span></span>
            </div>`;
          })}</div></fieldset>`,
      )}
      <p class="hint">${ctx.t('facdash.pricesHint')}</p>
      <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('common.save')}</button></div>
    </form>
    <section class="panel stack" id="extra">
      <div class="stack-sm"><h2 class="h3">${ctx.t('extra.title')}</h2><p class="muted">${ctx.t('extra.lead')}</p></div>
      ${extras.length
        ? html`<ul class="extra-list">${extras.map(
            (x) => html`<li class="extra-row">
              <form method="post" action="${href(ctx, `/facility/extra-tests/${x.id}`)}" class="extra-edit">${csrfField(ctx)}
                <strong dir="auto" class="extra-name">${x.name}</strong>
                <span class="input-group small"><label class="sr-only" for="xp-${x.id}">${ctx.t('extra.price')}</label>
                  <input type="text" id="xp-${x.id}" name="price" inputmode="numeric" value="${x.price_egp}" required><span class="input-suffix">${ctx.t('fac.egp')}</span></span>
                <label class="sr-only" for="xn-${x.id}">${ctx.t('extra.note')}</label>
                <input type="text" id="xn-${x.id}" name="note" maxlength="200" value="${x.note ?? ''}" placeholder="${ctx.t('extra.note')}" dir="auto">
                <button class="btn btn-outline btn-sm" type="submit">${ctx.t('extra.save')}</button>
              </form>
              <form method="post" action="${href(ctx, `/facility/extra-tests/${x.id}/delete`)}">${csrfField(ctx)}
                <button class="btn btn-ghost btn-sm danger" type="submit" data-confirm="${ctx.t('extra.deleteConfirm')}">${ctx.t('extra.delete')}</button></form>
            </li>`,
          )}</ul>`
        : html`<p class="muted small">${ctx.t('extra.none')}</p>`}
      <form method="post" action="${href(ctx, '/facility/extra-tests')}" class="stack-sm extra-add" novalidate>${csrfField(ctx)}
        <div class="form-grid">
          <div class="field${o.errors?.['extraName'] ? ' has-error' : ''}"><label for="extraName">${ctx.t('extra.name')}</label>
            <input type="text" id="extraName" name="extraName" maxlength="120" value="${v['extraName'] ?? ''}" placeholder="${ctx.t('extra.namePlaceholder')}" dir="auto" required>
            ${fieldError(ctx, o.errors, 'extraName')}</div>
          <div class="field${o.errors?.['extraPrice'] ? ' has-error' : ''}"><label for="extraPrice">${ctx.t('extra.price')}</label>
            <span class="input-group"><input type="text" id="extraPrice" name="extraPrice" inputmode="numeric" value="${v['extraPrice'] ?? ''}" required><span class="input-suffix">${ctx.t('fac.egp')}</span></span>
            ${fieldError(ctx, o.errors, 'extraPrice')}</div>
          <div class="field span-all"><label for="extraNote">${ctx.t('extra.note')} <span class="muted">(${ctx.t('common.optional')})</span></label>
            <input type="text" id="extraNote" name="extraNote" maxlength="200" value="${v['extraNote'] ?? ''}" placeholder="${ctx.t('extra.notePlaceholder')}" dir="auto"></div>
        </div>
        <div><button class="btn btn-primary" type="submit">${icon.plus}${ctx.t('extra.add')}</button></div>
      </form>
    </section>`;
  return facilityShell(ctx, f, 'prices', content, o.notice);
}

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

function contactButtons(ctx: Ctx, p: PublicFacility, branch: PublicBranch | undefined, ref: ReferenceData): SafeHtml {
  // The branch's own numbers, or the place's public numbers.
  const phones = branch?.phone_e164 ? allPhones(branch.phone_e164, branch.extra_phones) : p.phones;
  const dist = branch ? ref.districtById.get(branch.district_id) : undefined;
  return html`<div class="row-wrap">
    ${callButtons(ctx, phones, 'btn-primary')}
    ${p.whatsapp ? html`<a class="btn btn-outline" href="https://wa.me/${p.whatsapp.replace('+', '')}" target="_blank" rel="noopener noreferrer">${icon.chat}${ctx.t('fac.whatsapp')}</a>` : ''}
    ${branch ? html`<a class="btn btn-outline" href="${branch.maps_url ?? directionsHref(branch.address, placeForMaps(dist))}" target="_blank" rel="noopener noreferrer">${icon.directions}${ctx.t('doctor.directions')}</a>` : ''}
  </div>`;
}

export function facilityListPage(ctx: Ctx, ref: ReferenceData, s: FacilitySearch, results: PublicFacility[]): SafeHtml {
  const base = KIND_PATH[s.kind];
  const districtOptions = districtOptionGroups(ctx, ref, 'id');
  const testsAsked = s.tests.filter((c) => LAB_TESTS.some((t) => t.code === c));
  const body = html`<div class="container page stack-lg">
    <div class="stack-sm">
      ${searchTabs(ctx, s.kind)}
      <h1>${ctx.t(`fac.list.${s.kind}` as MessageKey)}</h1>
      <p class="muted">${ctx.t(`fac.listLead.${s.kind}` as MessageKey)}</p>
    </div>
    ${testsAsked.length
      ? alert('info', html`${ctx.t('fac.testsAsked', { n: formatNumber(testsAsked.length, ctx.locale) })} <strong>${testsAsked.map((c) => testName(ctx, c)).join('، ')}</strong>`)
      : ''}
    <form method="get" action="${href(ctx, base)}" class="panel filters-row" role="search">
      ${testsAsked.length ? html`<input type="hidden" name="tests" value="${testsAsked.join(',')}">` : ''}
      <div class="field"><label for="q">${ctx.t('fac.searchName')}</label><input id="q" type="search" name="q" value="${s.q}" maxlength="80"></div>
      <div data-city-pair>
        ${select(ctx, { name: 'city', label: ctx.t('search.city'), value: s.governorateId ? (ref.governorateById.get(s.governorateId)?.slug ?? '') : '', options: [{ value: '', label: ctx.t('search.anyCity') }, ...cityOptions(ctx, ref)] })}
        ${select(ctx, { name: 'district', label: ctx.t('clinics.district'), value: s.districtId ? String(s.districtId) : '', options: [{ value: '', label: ctx.t('search.anyDistrict') }, ...districtOptions] })}
      </div>
      <label class="check"><input type="checkbox" name="open" value="1"${attrIf(s.openNow, 'checked')}><span>${ctx.t('fac.openNow')}</span></label>
      <label class="check"><input type="checkbox" name="home" value="1"${attrIf(s.homeService, 'checked')}><span>${ctx.t(`fac.homeService.${s.kind}` as MessageKey)}</span></label>
      <button class="btn btn-primary" type="submit">${ctx.t('search.apply')}</button>
    </form>
    ${results.length
      ? html`<ul class="facility-list">${results.map((p) => {
          const branch = (s.districtId ? p.branches.find((b) => b.district_id === s.districtId) : undefined) ?? p.branches.find((b) => b.openNow) ?? p.branches[0];
          const dist = branch ? ref.districtById.get(branch.district_id) : undefined;
          return html`<li class="panel facility-card">
            <div class="facility-head">
              ${facilityAvatar(ctx, p)}
              <div class="stack-sm">
                <h2 class="h3"><a href="${href(ctx, `${base}/${p.slug}`, testsAsked.length ? { tests: testsAsked.join(',') } : undefined)}">${p.name}</a></h2>
                <span class="row-wrap tight">${openChip(ctx, p.openNow)}${p.homeService ? html`<span class="chip">${ctx.t(`fac.homeService.${p.kind}` as MessageKey)}</span>` : ''}
                  ${p.branches.length > 1 ? html`<span class="muted small">${ctx.t('fac.branchesCount', { n: formatNumber(p.branches.length, ctx.locale) })}</span>` : ''}</span>
                ${branch ? html`<span class="muted small" dir="auto">${dist ? placeName(ctx, dist) : ''} · ${branch.address}</span><span class="muted small">${hoursText(ctx, branch)}</span>` : ''}
              </div>
              ${p.total !== null ? html`<div class="facility-total"><span class="muted small">${ctx.t('fac.total')}</span><strong>${money(ctx, p.total)}</strong></div>` : ''}
            </div>
            ${contactButtons(ctx, p, branch, ref)}
          </li>`;
        })}</ul>`
      : html`<p class="empty">${ctx.t(testsAsked.length ? 'fac.noneForTests' : 'fac.none')}</p>`}
    <p class="hint center">${ctx.t('fac.ownerCta')} <a href="${href(ctx, '/facilities/join')}">${ctx.t('fac.ownerCtaLink')}</a></p>
  </div>`;
  return layout(ctx, { title: `${ctx.t(`fac.list.${s.kind}` as MessageKey)} — ${ctx.t('brand')}`, body, description: ctx.t(`fac.listLead.${s.kind}` as MessageKey) });
}

export function facilityPublicPage(ctx: Ctx, ref: ReferenceData, p: PublicFacility & { approved: boolean }, askedTests: string[]): SafeHtml {
  const asked = askedTests.filter((c) => p.tests.some((t) => t.code === c));
  const missing = askedTests.filter((c) => !p.tests.some((t) => t.code === c) && LAB_TESTS.some((t) => t.code === c));
  const body = html`<div class="container page narrow stack-lg">
    ${p.approved ? '' : alert('warning', ctx.t('facdash.previewBanner'))}
    <a class="back-link" href="${href(ctx, KIND_PATH[p.kind])}">${icon.chevronStart}${ctx.t(`fac.list.${p.kind}` as MessageKey)}</a>
    <section class="panel stack">
      <div class="facility-head">
        ${facilityAvatar(ctx, p, 'xl')}
        <div class="stack-sm">
          <h1>${p.name}</h1>
          <span class="row-wrap tight"><span class="chip">${kindLabel(ctx, p.kind)}</span>${openChip(ctx, p.openNow)}${p.homeService ? html`<span class="chip">${ctx.t(`fac.homeService.${p.kind}` as MessageKey)}</span>` : ''}
            <span class="chip status-confirmed">${icon.check}${ctx.t('fac.verified')}</span></span>
          ${p.branches[0] ? (() => { const d = ref.districtById.get(p.branches[0]!.district_id); return html`<span class="muted" dir="auto" data-testid="place-address">${icon.pin}${d ? placeName(ctx, d) : ''} · ${p.branches[0]!.address}</span>`; })() : ''}
        </div>
      </div>
      ${p.description ? html`<p class="prose" dir="auto">${p.description}</p>` : ''}
      ${p.photos.length
        ? html`<ul class="place-gallery" data-testid="place-photos">${p.photos.map((id) => html`<li><a href="${facilityPhotoHref(ctx, id)}" target="_blank" rel="noopener"><img src="${facilityPhotoHref(ctx, id)}" alt="${ctx.t('fphoto.altOf', { name: p.name })}" loading="lazy"></a></li>`)}</ul>`
        : ''}
      ${contactButtons(ctx, p, p.branches[0], ref)}
    </section>
    ${askedTests.length
      ? html`<section class="panel stack-sm"><h2 class="h3">${ctx.t('fac.yourTests')}</h2>
          <ul class="price-summary">${asked.map((c) => html`<li><span>${testName(ctx, c)}</span><strong>${money(ctx, p.tests.find((t) => t.code === c)!.price)}</strong></li>`)}
            <li class="total"><span>${ctx.t('fac.total')}</span><strong>${money(ctx, asked.reduce((sum, c) => sum + p.tests.find((t) => t.code === c)!.price, 0))}</strong></li></ul>
          ${missing.length ? html`<p class="muted small">${ctx.t('fac.notOffered')} ${missing.map((c) => testName(ctx, c)).join('، ')}</p>` : ''}
          <p class="hint">${ctx.t('fac.pricesNote')}</p></section>`
      : ''}
    <section class="panel stack"><h2 class="h3">${ctx.t('fac.branches')}</h2>
      <ul class="branch-list">${p.branches.map((b) => {
        const dist = ref.districtById.get(b.district_id);
        return html`<li class="stack-sm">
          <div class="row-between"><strong dir="auto">${b.name}</strong>${openChip(ctx, b.openNow)}</div>
          <span class="muted" dir="auto">${dist ? placeName(ctx, dist) : ''} · ${b.address}</span>
          <span class="small">${hoursText(ctx, b)}</span>
          <div class="row-wrap">
            ${[b.phone_e164, ...b.extra_phones].filter((x): x is string => !!x).map((x) => html`<a class="btn btn-outline btn-sm" href="tel:${x}" dir="ltr">${icon.phone}${formatEgyptPhone(x)}</a>`)}
            <a class="btn btn-outline btn-sm" href="${b.maps_url ?? directionsHref(b.address, placeForMaps(dist))}" target="_blank" rel="noopener noreferrer">${ctx.t('doctor.directions')}</a>
          </div>
        </li>`;
      })}</ul>
    </section>
    ${p.tests.length
      ? html`<section class="panel stack-sm"><h2 class="h3">${ctx.t('fac.priceList')}</h2>
          <ul class="price-summary">${LAB_TESTS.filter((t) => p.tests.some((x) => x.code === t.code)).map(
            (t) => html`<li><span>${ctx.locale === 'ar' ? t.ar : t.en}</span><strong>${money(ctx, p.tests.find((x) => x.code === t.code)!.price)}</strong></li>`,
          )}</ul><p class="hint">${ctx.t('fac.pricesNote')}</p></section>`
      : ''}
    ${p.extraTests.length
      ? html`<section class="panel stack-sm"><h2 class="h3">${p.tests.length ? ctx.t('extra.publicTitle') : ctx.t('fac.priceList')}</h2>
          <ul class="price-summary">${p.extraTests.map(
            (x) => html`<li><span><bdi>${x.name}</bdi>${x.note ? html`<br><span class="muted small" dir="auto">${x.note}</span>` : ''}</span><strong>${money(ctx, x.price_egp)}</strong></li>`,
          )}</ul></section>`
      : ''}
    <p class="hint">${ctx.t('fac.disclaimer')}</p>
  </div>`;
  return layout(ctx, { title: `${p.name} — ${ctx.t('brand')}`, body, noindex: !p.approved, description: p.description.slice(0, 160) || undefined });
}
