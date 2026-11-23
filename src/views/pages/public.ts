import { serviceName, type ClinicService } from '../../services/clinicServices.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { DESCRIPTION_MIN, DESCRIPTION_MAX } from '../../services/symptomChecker.js';
import { alert, csrfField, directionsHref, icon, initials, ratingBadge, select, starRow, yearsLabel, doctorAvatar, subMap } from '../components.js';
import { pick, formatShortDate, formatTime, formatNumber, formatFullDate, type MessageKey } from '../../i18n/index.js';
import type { ReferenceData } from '../../services/reference.js';
import type { DoctorCard, PublicProfile, SearchFilters } from '../../services/search.js';
import type { Slot } from '../../domain/availability.js';
import { todayIn, addDays, zonedToUtc } from '../../domain/time.js';
import type { PublicReview } from '../../services/reviews.js';
import type { RecentDoctor } from '../../services/patientHome.js';

const listSep = (ctx: Ctx) => (ctx.locale === 'ar' ? '، ' : ', ');
export const money = (ctx: Ctx, n: number) => ctx.t('common.egp', { amount: formatNumber(n, ctx.locale) });

function searchForm(ctx: Ctx, ref: ReferenceData, f: Partial<SearchFilters>, compact = false): SafeHtml {
  return html`<form class="search-form${compact ? ' compact' : ''}" method="get" action="${href(ctx, '/search')}" role="search">
    <label class="search-field wide">
      <span class="search-label">${ctx.t('search.whatLabel')}</span>
      <input type="search" name="q" value="${f.q ?? ''}" placeholder="${ctx.t('search.whatPlaceholder')}" maxlength="80">
    </label>
    <label class="search-field">
      <span class="search-label">${ctx.t('search.district')}</span>
      <select name="district">
        <option value="">${ctx.t('search.anyDistrict')}</option>
        ${ref.districts.map((d) => html`<option value="${d.slug}"${f.districtId === d.id ? html` selected` : ''}>${pick(ctx.locale, d)}</option>`)}
      </select>
    </label>
    ${ref.insurers.length
      ? html`<label class="search-field">
          <span class="search-label">${ctx.t('search.insurance')}</span>
          <select name="insurer"><option value="">${ctx.t('search.anyInsurance')}</option>
          ${ref.insurers.map((i) => html`<option value="${i.slug}"${f.insurerId === i.id ? html` selected` : ''}>${pick(ctx.locale, i)}</option>`)}</select>
        </label>`
      : ''}
    <button type="submit" class="btn btn-primary btn-search">${icon.search}${ctx.t('common.search')}</button>
  </form>`;
}

export interface PatientHome {
  recent: RecentDoctor[];
  next: { starts_at: Date; doctor_name: string; clinic_name: string } | null;
}

/** For a signed-in patient: their next visit and the doctors they can rebook in one tap. */
function patientQuickStart(ctx: Ctx, ref: ReferenceData, p: PatientHome | null): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const first = (ctx.user?.fullName ?? '').split(/\s+/)[0] ?? '';
  return html`<section class="container quick-start" aria-labelledby="qs-title">
    <div class="panel stack">
      <h2 id="qs-title">${p ? ctx.t('home.welcomeBack', { name: first }) : ctx.t('home.visitorTitle')}</h2>
      <div class="quick-grid">
        <a class="quick-tile primary" href="${href(ctx, '/search')}">${icon.search}<span>${ctx.t('home.qFind')}</span></a>
        <a class="quick-tile" href="${href(ctx, '/appointments')}">${icon.calendar}<span>${ctx.t('home.qAppointments')}</span></a>
        <a class="quick-tile" href="${href(ctx, '/health-record')}">${icon.record}<span>${ctx.t('home.qDocs')}</span></a>
        <a class="quick-tile" href="${href(ctx, '/symptom-checker')}">${icon.sparkle}<span>${ctx.t('home.qSymptoms')}</span></a>
      </div>
      ${p?.next
        ? html`<a class="next-visit" href="${href(ctx, '/appointments')}"><span class="label">${ctx.t('home.nextVisit')}</span>
            <strong>${formatShortDate(p.next.starts_at, ctx.locale, tz)} · ${formatTime(p.next.starts_at, ctx.locale, tz)}</strong>
            <span class="muted" dir="auto">${p.next.doctor_name} · ${p.next.clinic_name}</span></a>`
        : ''}
      ${p?.recent.length
        ? html`<div class="stack-sm"><span class="label">${ctx.t('home.yourDoctors')}</span>
            <ul class="rebook-list">${p.recent.map((r) => {
              const spec = ref.specialtyById.get(r.specialty_id);
              return html`<li><span class="stack-sm"><strong dir="auto">${r.doctor_name}</strong><span class="muted">${spec ? pick(ctx.locale, spec) : ''}</span></span>
                <a class="btn btn-primary" href="${href(ctx, `/doctors/${r.doctor_slug}`, { clinic: r.clinic_id })}#book-title">${icon.repeat}${ctx.t('appts.bookAgain')}</a></li>`;
            })}</ul></div>`
        : ''}
    </div>
  </section>`;
}

/**
 * "Don't know which doctor you need?" — the symptom guide as a search bar at the top of the home page.
 * It posts the description (never puts it in the address bar) to the symptom checker.
 */
function symptomBar(ctx: Ctx): SafeHtml {
  return html`<section class="symptom-top"><div class="container">
    <form method="post" action="${href(ctx, '/symptom-checker')}" class="symptom-bar" role="search" aria-label="${ctx.t('sc.barLabel')}">
      ${csrfField(ctx)}
      <span class="symptom-bar-icon" aria-hidden="true">✦</span>
      <label class="symptom-bar-field"><span class="symptom-bar-label">${ctx.t('sc.barLabel')}</span>
        <input name="description" required minlength="${DESCRIPTION_MIN}" maxlength="${DESCRIPTION_MAX}" autocomplete="off" placeholder="${ctx.t('sc.barPlaceholder')}"></label>
      <button class="btn btn-lg" type="submit">${ctx.t('sc.barButton')}</button>
    </form>
  </div></section>`;
}

export function homePage(ctx: Ctx, ref: ReferenceData, patient?: PatientHome): SafeHtml {
  const conditions = ref.conditions.slice(0, 6);
  const examples = ref.conditions.filter((c) => c.subspecialty_id !== null).slice(0, 4);
  const body = html`
  ${symptomBar(ctx)}
  ${patient ? patientQuickStart(ctx, ref, patient) : !ctx.user ? patientQuickStart(ctx, ref, null) : ''}
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <span class="pill">${ctx.t('home.badge')}</span>
        <h1>${ctx.t('home.h1')}</h1>
        <p class="lead">${ctx.t('home.lead')}</p>
        ${searchForm(ctx, ref, {})}
        <div class="chips-row">
          <span class="muted">${ctx.t('home.popular')}</span>
          ${conditions.map((c) => html`<a class="chip-link" href="${href(ctx, '/search', { q: ctx.locale === 'ar' ? c.term_ar : c.term_en })}">${ctx.locale === 'ar' ? c.term_ar : c.term_en}</a>`)}
        </div>
      </div>
    </div>
  </section>

  <section class="container section-tight" aria-labelledby="near-title">
    <h2 id="near-title" class="h3">${ctx.t('home.nearTitle')}</h2>
    <div class="near-grid">
      <a class="trust-item near-card" href="${href(ctx, '/pharmacies')}">${icon.pill}<div><strong>${ctx.t('fac.list.pharmacy')}</strong><p>${ctx.t('home.nearPharmacy')}</p></div></a>
      <a class="trust-item near-card" href="${href(ctx, '/labs')}">${icon.flask}<div><strong>${ctx.t('fac.list.lab')}</strong><p>${ctx.t('home.nearLab')}</p></div></a>
      <a class="trust-item near-card" href="${href(ctx, '/scan-centres')}">${icon.scan}<div><strong>${ctx.t('fac.list.radiology')}</strong><p>${ctx.t('home.nearScan')}</p></div></a>
    </div>
  </section>
  <section class="container trust-grid" aria-label="${ctx.t('brand')}">
    <div class="trust-item">${icon.shieldOutline}<div><strong>${ctx.t('home.trust1Title')}</strong><p>${ctx.t('home.trust1Body')}</p></div></div>
    <div class="trust-item">${icon.calendar}<div><strong>${ctx.t('home.trust2Title')}</strong><p>${ctx.t('home.trust2Body')}</p></div></div>
    <div class="trust-item">${icon.wallet}<div><strong>${ctx.t('home.trust3Title')}</strong><p>${ctx.t('home.trust3Body')}</p></div></div>
  </section>

  <section class="container section" id="specialties">
    <div class="section-head"><div><h2>${ctx.t('home.specialtiesTitle')}</h2><p class="lead-sm">${ctx.t('home.specialtiesLead')}</p></div></div>
    <div class="card-grid">
      ${ref.specialties.map(
        (s) => html`<a class="spec-card" href="${href(ctx, '/search', { specialty: s.slug })}">
          <span class="spec-name">${pick(ctx.locale, s)}</span>
          <span class="spec-subs">${s.subspecialties.slice(0, 4).map((x) => pick(ctx.locale, x)).join(' · ')}</span>
        </a>`,
      )}
    </div>
  </section>

  <section class="container section">
    <div class="panel split">
      <div class="stack">
        <span class="kicker accent">${ctx.t('home.conditionsKicker')}</span>
        <h2>${ctx.t('home.conditionsTitle')}</h2>
        <p class="lead-sm">${ctx.t('home.conditionsLead')}</p>
        <p class="disclaimer">${ctx.t('home.conditionsDisclaimer')}</p>
      </div>
      <div class="stack">
        ${examples.map((c) => {
          const spec = ref.specialtyById.get(c.specialty_id);
          const sub = c.subspecialty_id ? ref.subspecialtyById.get(c.subspecialty_id) : undefined;
          return html`<a class="mapping" href="${href(ctx, '/search', { q: ctx.locale === 'ar' ? c.term_ar : c.term_en })}">
            <strong>${ctx.locale === 'ar' ? `«${c.term_ar}»` : `“${c.term_en}”`}</strong>
            <span class="mapping-target">${icon.arrow}${spec ? pick(ctx.locale, spec) : ''}${sub ? html` › ${pick(ctx.locale, sub)}` : ''}</span>
          </a>`;
        })}
      </div>
    </div>
  </section>

  <section class="container section">
    <h2>${ctx.t('home.stepsTitle')}</h2>
    <ol class="steps">
      ${(['1', '2', '3'] as const).map(
        (n) => html`<li><span class="step-num">0${n}</span><strong>${ctx.t(`home.step${n}Title` as MessageKey)}</strong><p>${ctx.t(`home.step${n}Body` as MessageKey)}</p></li>`,
      )}
    </ol>
  </section>

  <section class="container section">
    <div class="section-head"><h2>${ctx.t('home.districtsTitle')}</h2><span class="muted">${ctx.t('home.comingNext')}</span></div>
    <div class="chips-row">
      ${ref.districts.map((d) => html`<a class="chip-link lg" href="${href(ctx, '/search', { district: d.slug })}">${icon.pin}${pick(ctx.locale, d)}</a>`)}
    </div>
  </section>

  <section class="container section">
    <div class="panel dark split">
      <div class="stack">
        <span class="kicker light">${ctx.t('home.doctorsKicker')}</span>
        <h2>${ctx.t('home.doctorsTitle')}</h2>
        <p class="lead-sm">${ctx.t('home.doctorsLead')}</p>
        <div class="row-wrap"><a class="btn btn-light btn-lg" href="${href(ctx, '/for-doctors')}">${ctx.t('home.doctorsCta')}</a></div>
      </div>
    </div>
  </section>`;
  return layout(ctx, { title: ctx.t('home.title'), description: ctx.t('home.description'), body });
}

function slotLabel(ctx: Ctx, s: Slot): string {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const today = todayIn(tz, ctx.deps.now());
  const day = s.date === today ? ctx.t('common.today') : s.date === addDays(today, 1) ? ctx.t('common.tomorrow') : formatShortDate(s.startsAt, ctx.locale, tz);
  return `${day} · ${formatTime(s.startsAt, ctx.locale, tz)}`;
}

export function bookHref(ctx: Ctx, slug: string, s: Slot): string {
  return href(ctx, '/book', { doctor: slug, clinic: s.clinicId, start: s.startsAt.toISOString() });
}

function doctorCard(ctx: Ctx, ref: ReferenceData, d: DoctorCard): SafeHtml {
  const spec = ref.specialtyById.get(d.specialtyId);
  const title = (ctx.locale === 'ar' ? d.titleAr : d.titleEn) || d.titleEn || d.titleAr || (spec ? pick(ctx.locale, spec) : '');
  const districts = [...new Set(d.clinics.map((c) => ref.districtById.get(c.districtId)).filter((x) => !!x).map((x) => pick(ctx.locale, x!)))];
  return html`<article class="doctor-card">
    <div class="doctor-main">
      ${doctorAvatar(ctx, d)}
      <div class="stack-sm">
        <h2 class="doctor-name"><a href="${href(ctx, `/doctors/${d.slug}`)}">${d.fullName}</a>
          <span class="verified" title="${ctx.t('search.verified')}">${icon.shield}<span class="sr-only">${ctx.t('search.verified')}</span></span></h2>
        <p class="muted">${title}</p>
        <div class="tags">${d.subspecialtyIds.slice(0, 3).map((id) => {
          const s = ref.subspecialtyById.get(id);
          return s ? html`<span class="tag">${pick(ctx.locale, s)}</span>` : '';
        })}</div>
        <p class="meta">${ratingBadge(ctx, d.rating, { compact: true })}${d.years > 0 ? html`<span>${ctx.t('search.experience', { n: formatNumber(d.years, ctx.locale) })}</span>` : ''}
          ${districts.length ? html`<span>${icon.pin}${districts.join(listSep(ctx))}</span>` : ''}</p>
      </div>
    </div>
    <div class="doctor-side">
      ${d.minFee !== null ? html`<div class="fee-row"><span class="muted">${ctx.t('search.feeLabel')}</span><strong>${money(ctx, d.minFee)}</strong></div>` : ''}
      ${d.nextSlots.length
        ? html`<span class="avail">${ctx.t('search.nextAvailable')}</span>
           <div class="slot-grid">${d.nextSlots.map((s) => html`<a class="slot" href="${bookHref(ctx, d.slug, s)}">${slotLabel(ctx, s)}</a>`)}</div>`
        : html`<span class="muted">${ctx.t('search.noSlots')}</span>`}
      <a class="btn btn-primary btn-block" href="${href(ctx, `/doctors/${d.slug}`)}">${ctx.t('search.viewProfile')}</a>
    </div>
  </article>`;
}

export function searchPage(ctx: Ctx, ref: ReferenceData, f: SearchFilters, result: { cards: DoctorCard[]; total: number; pages: number }): SafeHtml {
  const spec = f.specialtyId ? ref.specialtyById.get(f.specialtyId) : undefined;
  const district = f.districtId ? ref.districtById.get(f.districtId) : undefined;
  const heading = [spec ? pick(ctx.locale, spec) : f.q || ctx.t('search.title'), district ? pick(ctx.locale, district) : ''].filter(Boolean).join(' · ');
  const slugOf = (id: number | null, list: { id: number; slug: string }[]) => list.find((x) => x.id === id)?.slug;
  const subs = spec?.subspecialties ?? [];
  const pageLink = (p: number) =>
    href(ctx, '/search', {
      q: f.q,
      specialty: slugOf(f.specialtyId, ref.specialties),
      sub: slugOf(f.subspecialtyId, subs),
      district: slugOf(f.districtId, ref.districts),
      insurer: slugOf(f.insurerId, ref.insurers),
      page: p,
    });

  const active = [spec, f.subspecialtyId, district, f.insurerId].filter(Boolean).length;
  const body = html`
  <div class="subheader"><div class="container">${searchForm(ctx, ref, f, true)}</div></div>
  <div class="container page">
    <div class="results-head">
      <div><h1>${heading}</h1>
        <p class="muted">${result.total === 1 ? ctx.t('search.countOne') : ctx.t('search.count', { n: formatNumber(result.total, ctx.locale) })}</p></div>
    </div>
    <div class="results-layout">
      <aside class="filters" aria-label="${ctx.t('search.filters')}">
        <details class="filters-box" open data-close-on-phone>
        <summary class="filters-summary">${ctx.t('search.filtersToggle')}${active ? html` <span class="count-badge">${ctx.t('search.filtersActive', { n: formatNumber(active, ctx.locale) })}</span>` : ''}</summary>
        <form method="get" action="${href(ctx, '/search')}" class="stack">
          <input type="hidden" name="q" value="${f.q}">
          ${select(ctx, {
            name: 'specialty',
            label: ctx.t('search.specialty'),
            value: spec?.slug ?? '',
            options: [{ value: '', label: ctx.t('search.anySpecialty') }, ...ref.specialties.map((s) => ({ value: s.slug, label: pick(ctx.locale, s) }))],
          })}
          <div data-sub-for="specialty" data-sub-any="${ctx.t('search.anySubspecialty')}" data-sub-map="${subMap(ctx, ref, 'slug')}"${attrIf(!subs.length, 'hidden')}>
          ${select(ctx, {
            name: 'sub',
            label: ctx.t('search.subspecialty'),
            value: slugOf(f.subspecialtyId, subs) ?? '',
            options: [{ value: '', label: ctx.t('search.anySubspecialty') }, ...subs.map((s) => ({ value: s.slug, label: pick(ctx.locale, s) }))],
          })}
          </div>
          ${select(ctx, {
            name: 'district',
            label: ctx.t('search.district'),
            value: district?.slug ?? '',
            options: [{ value: '', label: ctx.t('search.anyDistrict') }, ...ref.districts.map((d) => ({ value: d.slug, label: pick(ctx.locale, d) }))],
          })}
          ${ref.insurers.length
            ? select(ctx, {
                name: 'insurer',
                label: ctx.t('search.insurance'),
                value: slugOf(f.insurerId, ref.insurers) ?? '',
                options: [{ value: '', label: ctx.t('search.anyInsurance') }, ...ref.insurers.map((i) => ({ value: i.slug, label: pick(ctx.locale, i) }))],
              })
            : ''}
          <button class="btn btn-primary btn-block" type="submit">${ctx.t('search.apply')}</button>
          <a class="btn btn-ghost btn-block" href="${href(ctx, '/search')}">${ctx.t('search.clear')}</a>
        </form>
        </details>
      </aside>
      <div class="results">
        ${result.cards.length
          ? result.cards.map((c) => doctorCard(ctx, ref, c))
          : html`<div class="empty"><h2>${ctx.t('search.noResultsTitle')}</h2><p>${ctx.t('search.noResultsBody')}</p></div>`}
        ${result.pages > 1
          ? html`<nav class="pagination" aria-label="Pagination">
              ${f.page > 1 ? html`<a class="btn btn-outline" href="${pageLink(f.page - 1)}">${icon.chevronStart}${ctx.t('common.previous')}</a>` : ''}
              <span>${ctx.t('common.pageOf', { page: formatNumber(f.page, ctx.locale), pages: formatNumber(result.pages, ctx.locale) })}</span>
              ${f.page < result.pages ? html`<a class="btn btn-outline" href="${pageLink(f.page + 1)}">${ctx.t('common.next')}${icon.chevronEnd}</a>` : ''}
            </nav>`
          : ''}
      </div>
    </div>
  </div>`;
  return layout(ctx, { title: `${heading} — ${ctx.t('brand')}`, description: ctx.t('home.description'), body });
}

export interface ProfileBooking {
  /** The chosen clinic's own services (besides consultation and follow-up). */
  services?: ClinicService[];
  clinicId: string;
  date: string;
  slots: Slot[];
  days: { date: string; first: Date }[];
  error?: MessageKey | undefined;
  notice?: MessageKey | undefined;
  /** Working days in the booking window with every slot taken (the waitlist is offered for these). */
  fullDays: string[];
  /** Of those, the days the signed-in patient is already waiting for. */
  waiting: string[];
  /** Too many cancellations by the doctor: online booking is paused (patients can still call). */
  paused?: boolean;
  /** "Message the doctor" for a signed-in patient who has booked with them (closed = outside messaging hours). */
  message?: 'hidden' | 'open' | 'closed';
}

function waitlistBlock(ctx: Ctx, d: PublicProfile, booking: ProfileBooking): SafeHtml {
  if (!booking.fullDays.length || ctx.user?.role === 'doctor' || ctx.user?.role === 'admin') return html``;
  const tz = ctx.deps.cfg.TIME_ZONE;
  const back = href(ctx, `/doctors/${d.slug}`, { clinic: booking.clinicId });
  return html`<div class="waitlist-box stack-sm">
    <span class="label">${icon.bell} ${ctx.t('waitlist.title')}</span>
    <p class="hint">${ctx.t('waitlist.lead')}</p>
    <ul class="waitlist-days">${booking.fullDays.slice(0, 6).map((day) => {
      const label = formatShortDate(zonedToUtc(day, '12:00', tz), ctx.locale, tz);
      if (booking.waiting.includes(day)) return html`<li><span>${label}</span><span class="chip status-confirmed">${icon.check}${ctx.t('waitlist.onIt')}</span></li>`;
      return html`<li><span>${label}</span>${ctx.user
        ? html`<form method="post" action="${href(ctx, '/waitlist')}" class="inline-form">${csrfField(ctx)}
            <input type="hidden" name="clinic" value="${booking.clinicId}"><input type="hidden" name="date" value="${day}">
            <button type="submit" class="btn btn-outline btn-sm">${ctx.t('waitlist.join')}</button></form>`
        : html`<a class="btn btn-outline btn-sm" href="${href(ctx, '/login', { next: back })}">${ctx.t('waitlist.join')}</a>`}</li>`;
    })}</ul>
  </div>`;
}

function reviewsSection(ctx: Ctx, d: PublicProfile, reviews: PublicReview[]): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  return html`<section class="panel stack" id="reviews">
    <div class="row-between"><h2>${ctx.t('reviews.title')}</h2>${ratingBadge(ctx, d.rating)}</div>
    <p class="hint">${ctx.t('reviews.verifiedNote')}</p>
    ${reviews.length
      ? html`<ul class="review-list">${reviews.map(
          (r) => html`<li class="review">
            <div class="row-between">${starRow(ctx, r.rating)}<span class="muted small">${formatFullDate(r.created_at, ctx.locale, tz)}</span></div>
            ${r.comment ? html`<p class="prose" dir="auto">${r.comment}</p>` : ''}
            <span class="muted small" dir="auto">${r.author} · ${ctx.t('reviews.verifiedVisit')}</span>
          </li>`,
        )}</ul>`
      : html`<p class="muted">${ctx.t('reviews.none')}</p>`}
  </section>`;
}

/** Big, thumb-reachable actions pinned to the bottom of the screen on phones. */
function stickyActions(ctx: Ctx, d: PublicProfile, clinicId: string, ref: ReferenceData): SafeHtml {
  const clinic = d.clinics.find((c) => c.id === clinicId) ?? d.clinics[0];
  if (!clinic) return html``;
  const dist = ref.districtById.get(clinic.districtId);
  return html`<nav class="sticky-actions" aria-label="${ctx.t('doctor.quickActions')}">
    <a class="btn btn-primary btn-lg" href="#book-title">${icon.calendar}${ctx.t('doctor.bookShort')}</a>
    ${clinic.phone ? html`<a class="btn btn-outline btn-lg" href="tel:${clinic.phone}">${icon.phone}${ctx.t('doctor.call')}</a>` : ''}
    <a class="btn btn-outline btn-lg" href="${directionsHref(clinic.address, dist ? dist.name_en : '')}" target="_blank" rel="noopener noreferrer">${icon.directions}${ctx.t('doctor.directions')}</a>
  </nav>`;
}

export function profilePage(ctx: Ctx, ref: ReferenceData, d: PublicProfile, booking: ProfileBooking, reviews: PublicReview[]): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const spec = ref.specialtyById.get(d.specialtyId);
  const title = (ctx.locale === 'ar' ? d.titleAr : d.titleEn) || d.titleEn || d.titleAr || (spec ? pick(ctx.locale, spec) : '');
  const clinic = d.clinics.find((c) => c.id === booking.clinicId);
  const daySlots = booking.slots.filter((s) => s.date === booking.date);
  const langName = (l: string) => ctx.t.dynamic(`lang.${l}`);

  const body = html`
  ${ctx.user?.id === d.id
    ? html`<div class="container owner-bar"><div class="alert alert-info row-between">
        <span>${ctx.t('doctor.ownerPreview')}</span>
        <span class="row-wrap tight"><a class="btn btn-primary btn-sm" href="${href(ctx, '/dashboard')}">${icon.chevronStart}${ctx.t('doctor.backToDashboard')}</a>
          <a class="btn btn-outline btn-sm" href="${href(ctx, '/dashboard/profile')}">${ctx.t('doctor.editProfile')}</a></span>
      </div></div>`
    : ''}
  <div class="container page profile-layout has-sticky">
    <div class="stack-lg profile-main">
      <section class="panel profile-head">
        ${doctorAvatar(ctx, d, 'xl')}
        <div class="stack-sm">
          <div class="row-wrap"><h1 dir="auto">${d.fullName}</h1><span class="badge-verified">${icon.shield}${ctx.t('doctor.verifiedBadge')}</span></div>
          <p class="lead-sm">${title}</p>
          ${d.rating ? html`<a class="rating-link" href="#reviews">${ratingBadge(ctx, d.rating)}</a>` : ''}
          <div class="tags">${d.subspecialtyIds.map((id) => {
            const s = ref.subspecialtyById.get(id);
            return s ? html`<span class="tag">${pick(ctx.locale, s)}</span>` : '';
          })}</div>
          <dl class="facts">
            <div><dt>${ctx.t('doctor.experience')}</dt><dd>${ctx.t('common.years', { n: formatNumber(d.years, ctx.locale) })}</dd></div>
            <div><dt>${ctx.t('doctor.languages')}</dt><dd>${d.languages.map(langName).join(listSep(ctx))}</dd></div>
            <div><dt>${ctx.t('doctor.graduated')}</dt><dd>${formatNumber(d.graduationYear, ctx.locale).replace(/[٬,]/g, '')}</dd></div>
          </dl>
        </div>
      </section>

      <section class="panel stack">
        <h2>${ctx.t('doctor.about')}</h2>
        <p class="prose" dir="auto">${d.bio || ctx.t('doctor.noBio')}</p>
        <h3>${ctx.t('doctor.insurance')}</h3>
        <div class="tags">${d.insurerIds.map((id) => {
          const i = ref.insurers.find((x) => x.id === id);
          return i ? html`<span class="tag outline">${pick(ctx.locale, i)}</span>` : '';
        })}<span class="tag outline">${ctx.t('doctor.selfPay')}</span></div>
      </section>

      <section class="panel stack">
        <h2>${ctx.t('doctor.clinics')}</h2>
        <div class="card-grid two">
          ${d.clinics.map((c) => {
            const dist = ref.districtById.get(c.districtId);
            const rules = d.rules.filter((r) => r.clinicId === c.id);
            return html`<div class="clinic-card">
              <strong dir="auto">${c.name}</strong>
              <span class="muted" dir="auto">${c.address}${dist ? html` · ${pick(ctx.locale, dist)}` : ''}</span>
              <span class="fee">${money(ctx, c.fee)}</span>
              <ul class="hours">${rules.map((r) => html`<li><span>${ctx.t.dynamic(`weekday.${r.weekday}`)}</span><span dir="ltr">${r.start}–${r.end}</span></li>`)}</ul>
              <div class="row-wrap">
                ${c.phone ? html`<a class="btn btn-outline btn-sm" href="tel:${c.phone}">${icon.phone}${ctx.t('doctor.call')}</a>` : ''}
                <a class="btn btn-outline btn-sm" href="${directionsHref(c.address, dist ? dist.name_en : '')}" target="_blank" rel="noopener noreferrer">${icon.directions}${ctx.t('doctor.directions')}</a>
              </div>
            </div>`;
          })}
        </div>
      </section>

      ${reviewsSection(ctx, d, reviews)}

      ${d.positions.length
        ? html`<section class="panel stack">
            <h2>${ctx.t('doctor.experienceSection')}</h2>
            <ol class="timeline">${d.positions.map(
              (p) => html`<li><span class="muted" dir="ltr">${yearsLabel(ctx, p)}</span><span dir="auto"><strong>${p.title}</strong><span class="muted">${p.workplace}</span></span></li>`,
            )}</ol>
          </section>`
        : ''}
    </div>

    <aside class="booking-panel" aria-labelledby="book-title">
      <h2 id="book-title" tabindex="-1">${ctx.t('doctor.book')}</h2>
      ${booking.error ? alert('error', ctx.t(booking.error)) : ''}
      ${booking.notice ? alert('success', ctx.t(booking.notice)) : ''}
      ${booking.paused ? alert('warning', ctx.t('booking.doctorPaused')) : ''}
      ${clinic ? html`<div class="fee-row"><span class="muted">${ctx.t('search.feeLabel')}</span><strong>${money(ctx, clinic.fee)}</strong></div>` : ''}
      ${clinic && clinic.followUpFee !== null && clinic.followUpFee < clinic.fee
        ? html`<div class="fee-row"><span class="muted">${ctx.t('doctor.followUpFee', { days: clinic.followUpDays })}</span><strong>${money(ctx, clinic.followUpFee)}</strong></div>`
        : ''}
      ${booking.services?.length
        ? html`<details class="svc-public"${booking.services.length <= 4 ? html` open` : ''}><summary>${ctx.t('svc.publicTitle', { n: booking.services.length })}</summary>
            ${booking.services.map((s) => html`<div class="fee-row"><span class="muted" dir="auto">${serviceName(s, ctx.locale)}</span><strong>${money(ctx, s.price_egp)}</strong></div>`)}
            <p class="small muted">${ctx.t('svc.publicHint')}</p></details>`
        : ''}
      ${booking.message && booking.message !== 'hidden'
        ? html`<a class="btn btn-outline btn-block" href="${href(ctx, `/messages/${d.slug}`)}">${icon.chat}${ctx.t(booking.message === 'open' ? 'msg.messageDoctor' : 'msg.messageDoctorClosed')}</a>`
        : ''}
      ${d.clinics.length > 1
        ? html`<div class="stack-sm"><span class="label">${ctx.t('doctor.chooseClinic')}</span>
            <div class="stack-sm">${d.clinics.map(
              (c) => html`<a class="choice${c.id === booking.clinicId ? ' selected' : ''}" aria-current="${c.id === booking.clinicId ? 'true' : 'false'}"
                href="${href(ctx, `/doctors/${d.slug}`, { clinic: c.id })}#book-title"><strong>${c.name}</strong><span class="muted">${c.address}</span></a>`,
            )}</div></div>`
        : ''}
      ${booking.days.length
        ? html`<div class="stack-sm"><span class="label">${ctx.t('doctor.chooseDay')}</span>
            <div class="day-strip">${booking.days.map(
              (day) => html`<a class="day${day.date === booking.date ? ' selected' : ''}" aria-current="${day.date === booking.date ? 'date' : 'false'}"
                href="${href(ctx, `/doctors/${d.slug}`, { clinic: booking.clinicId, date: day.date })}#book-title">${formatShortDate(day.first, ctx.locale, tz)}</a>`,
            )}</div></div>
          <div class="stack-sm"><span class="label">${ctx.t('doctor.chooseTime')}</span>
            <div class="slot-grid">${daySlots.map((s) => html`<a class="slot" href="${bookHref(ctx, d.slug, s)}">${formatTime(s.startsAt, ctx.locale, tz)}</a>`)}</div>
            <p class="hint">${ctx.t('doctor.slotHint')}</p></div>`
        : html`<p class="muted">${ctx.t('doctor.noTimes')}</p>`}
      ${waitlistBlock(ctx, d, booking)}
      <p class="hint center">${ctx.t('doctor.payAtClinic')}</p>
    </aside>
  </div>
  ${stickyActions(ctx, d, booking.clinicId, ref)}`;
  return layout(ctx, { title: `${d.fullName} — ${title} — ${ctx.t('brand')}`, description: `${d.fullName}: ${title}`, body });
}

/** "Contact us / Get help": the support numbers (call or WhatsApp) and answers to common questions. */
export function contactPage(ctx: Ctx): SafeHtml {
  const phones = ctx.deps.cfg.SUPPORT_PHONES;
  const faq: [MessageKey, MessageKey][] = [
    ['help.q.book', 'help.a.book'],
    ['help.q.cancel', 'help.a.cancel'],
    ['help.q.code', 'help.a.code'],
    ['help.q.results', 'help.a.results'],
    ['help.q.doctor', 'help.a.doctor'],
  ];
  return layout(ctx, {
    title: `${ctx.t('help.title')} — ${ctx.t('brand')}`,
    description: ctx.t('help.lead'),
    body: html`<div class="container page narrow stack-lg">
      <div><h1>${ctx.t('help.title')}</h1><p class="lead-sm">${ctx.t('help.lead')}</p></div>
      ${alert('warning', ctx.t('help.emergency'))}
      <section class="contact-grid" aria-label="${ctx.t('help.numbers')}">
        ${phones.map(
          (p) => html`<div class="contact-card">
            <span class="contact-icon" aria-hidden="true">${icon.phone}</span>
            <strong class="contact-number" dir="ltr">${formatEgyptMobile(p)}</strong>
            <div class="contact-actions">
              <a class="btn btn-primary" href="tel:${p}">${icon.phone}${ctx.t('help.call')}</a>
              <a class="btn btn-whatsapp" href="https://wa.me/${p.slice(1)}" target="_blank" rel="noopener">${ctx.t('help.whatsapp')}</a>
            </div>
          </div>`,
        )}
      </section>
      <p class="small muted">${ctx.t('help.noAdvice')}</p>
      <section class="stack-sm"><h2>${ctx.t('help.faqTitle')}</h2>
        ${faq.map(([q, a]) => html`<details class="faq"><summary>${ctx.t(q)}</summary><p>${ctx.t(a)}</p></details>`)}
      </section>
    </div>`,
  });
}

export function legalPage(ctx: Ctx, kind: 'privacy' | 'terms'): SafeHtml {
  const title = ctx.t(kind === 'privacy' ? 'legal.privacyTitle' : 'legal.termsTitle');
  return layout(ctx, { title: `${title} — ${ctx.t('brand')}`, body: html`<div class="container page narrow stack"><h1>${title}</h1><p class="lead-sm">${ctx.t('legal.placeholder')}</p></div>` });
}

export function errorPage(ctx: Ctx, status: number, messageKey: string): SafeHtml {
  return layout(ctx, {
    title: `${ctx.t('error.title')} — ${ctx.t('brand')}`,
    noindex: true,
    body: html`<div class="container page narrow stack center">
      <p class="error-code">${status}</p><h1>${ctx.t('error.title')}</h1><p class="lead-sm">${ctx.t.dynamic(messageKey)}</p>
      <a class="btn btn-primary" href="${href(ctx, '/')}">${ctx.t('error.home')}</a></div>`,
  });
}

/** Compute the per-day summary for the booking strip. */
export function groupDays(slots: Slot[]): { date: string; first: Date }[] {
  const days: { date: string; first: Date }[] = [];
  for (const s of slots) if (!days.find((d) => d.date === s.date)) days.push({ date: s.date, first: s.startsAt });
  return days;
}
