import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { displayYears } from '../../domain/experience.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, consentField, csrfField, fieldError, icon, input, passwordInput, select, errorSummary, subMap } from '../components.js';
import { pick, type MessageKey } from '../../i18n/index.js';
import type { ReferenceData } from '../../services/reference.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { PositionInput } from '../../services/doctors.js';

export function forDoctorsPage(ctx: Ctx): SafeHtml {
  const body = html`
  <section class="hero dark">
    <div class="container stack-lg hero-doctors">
      <span class="pill light">${ctx.t('fd.badge')}</span>
      <h1>${ctx.t('fd.h1')}</h1>
      <p class="lead">${ctx.t('fd.lead')}</p>
      <div class="row-wrap">
        <a class="btn btn-light btn-lg" href="${href(ctx, '/for-doctors/join')}">${ctx.t('fd.ctaJoin')}</a>
        <a class="btn btn-outline-light btn-lg" href="${href(ctx, '/login', { next: '/dashboard' })}">${ctx.t('fd.ctaSignIn')}</a>
      </div>
    </div>
  </section>
  <section class="container section card-grid four">
    ${(['1', '2', '3', '4'] as const).map(
      (n) => html`<div class="feature"><span class="step-num">0${n}</span><strong>${ctx.t(`fd.f${n}Title` as MessageKey)}</strong><p>${ctx.t(`fd.f${n}Body` as MessageKey)}</p></div>`,
    )}
  </section>`;
  return layout(ctx, { title: ctx.t('fd.title'), description: ctx.t('fd.description'), body, variant: 'doctors' });
}

export function joinPage(ctx: Ctx, ref: ReferenceData, o: { values?: Record<string, string | string[]>; positions?: PositionInput[]; errors?: FieldErrors }): SafeHtml {
  const v = o.values ?? {};
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  const positions = [...(o.positions ?? [])];
  while (positions.length < 3) positions.push({ title: '', workplace: '', start: '', end: '' });
  const maxMonth = ctx.deps.now().toISOString().slice(0, 7);

  const body = html`
  <section class="container page join-layout">
    <div class="stack join-intro">
      <h1>${ctx.t('join.title')}</h1>
      <p class="lead-sm">${ctx.t('join.lead')}</p>
      <ol class="numbered">
        <li>${ctx.t('join.step1')}</li><li>${ctx.t('join.step2')}</li><li>${ctx.t('join.step3')}</li>
      </ol>
    </div>
    <form class="panel stack-lg" method="post" action="${href(ctx, '/for-doctors/join')}" enctype="multipart/form-data" novalidate>
      ${csrfField(ctx)}
      ${errorSummary(ctx, o.errors, { reenter: ['password', 'file'] })}
      <fieldset class="form-grid">
        <legend>${ctx.t('join.account')}</legend>
        ${input(ctx, { name: 'fullName', label: ctx.t('auth.fullName'), value: str('fullName'), hint: ctx.t('join.fullNameHint'), autocomplete: 'name', maxlength: 120, errors: o.errors, required: true })}
        ${input(ctx, { name: 'email', label: ctx.t('join.email'), type: 'email', value: str('email'), autocomplete: 'email', errors: o.errors, required: true })}
        ${input(ctx, { name: 'phone', label: ctx.t('auth.phone'), type: 'tel', value: str('phone'), prefix: '+20', autocomplete: 'tel-national', inputmode: 'tel', hint: ctx.t('auth.phoneHint'), errors: o.errors, required: true })}
        ${passwordInput(ctx, { name: 'password', label: ctx.t('auth.password'), autocomplete: 'new-password', hint: ctx.t('auth.passwordHint'), errors: o.errors, required: true })}
      </fieldset>

      <fieldset class="form-grid">
        <legend>${ctx.t('join.credentials')}</legend>
        ${select(ctx, {
          name: 'kind',
          label: ctx.t('join.kind'),
          value: str('kind') || 'medical',
          options: [
            { value: 'medical', label: ctx.t('join.kindMedical') },
            { value: 'dental', label: ctx.t('join.kindDental') },
          ],
          errors: o.errors,
        })}
        ${input(ctx, { name: 'graduationYear', label: ctx.t('join.gradYear'), type: 'number', value: str('graduationYear'), inputmode: 'numeric', errors: o.errors, required: true })}
        ${select(ctx, {
          name: 'specialty',
          label: ctx.t('join.specialty'),
          value: str('specialty'),
          options: [{ value: '', label: '—' }, ...ref.specialties.map((s) => ({ value: String(s.id), label: pick(ctx.locale, s) }))],
          errors: o.errors,
          required: true,
        })}
        <div data-sub-for="specialty" data-sub-map="${subMap(ctx, ref, 'id')}">
        ${select(ctx, {
          name: 'subspecialties',
          label: ctx.t('join.subspecialties'),
          multiple: true,
          size: 6,
          value: Array.isArray(v['subspecialties']) ? (v['subspecialties'] as string[]) : [],
          // Without JavaScript every subspecialty is listed; the page script narrows it to the chosen specialty.
          options: ref.specialties
            .filter((s) => s.subspecialties.length)
            .map((s) => ({ group: pick(ctx.locale, s), options: s.subspecialties.map((x) => ({ value: String(x.id), label: pick(ctx.locale, x) })) })),
          hint: ctx.t('join.subspecialtiesHint'),
          errors: o.errors,
        })}
        </div>
        <div class="field span-all${o.errors?.['card'] ? ' has-error' : ''}">
          <span class="label" id="card-label">${ctx.t('join.card')}</span>
          <label class="dropzone" for="card">
            ${icon.upload}
            <span class="stack-sm"><strong>${ctx.t('join.card')}</strong><span class="hint" id="card-hint">${ctx.t('join.cardHint')}</span></span>
            <input id="card" name="card" type="file" accept="image/jpeg,image/png,application/pdf" required aria-describedby="card-hint" aria-labelledby="card-label">
          </label>
          ${fieldError(ctx, o.errors, 'card')}
        </div>
      </fieldset>

      <fieldset class="stack">
        <legend>${ctx.t('join.experience')}</legend>
        <p class="hint">${ctx.t('join.experienceHint')}</p>
        ${fieldError(ctx, o.errors, 'positions')}
        ${positions.map(
          (p, i) => html`<div class="position-row">
            <div class="field"><label for="pos-title-${i}">${ctx.t('join.position')}</label><input id="pos-title-${i}" name="posTitle" value="${p.title}" maxlength="120"></div>
            <div class="field"><label for="pos-place-${i}">${ctx.t('join.workplace')}</label><input id="pos-place-${i}" name="posWorkplace" value="${p.workplace}" maxlength="160"></div>
            <div class="field"><label for="pos-start-${i}">${ctx.t('join.from')}</label><input id="pos-start-${i}" name="posStart" type="text" inputmode="numeric" maxlength="7" value="${p.start.slice(0, 4)}" placeholder="${ctx.t('join.yearPlaceholder')}"></div>
            <div class="field"><label for="pos-end-${i}">${ctx.t('join.to')}</label><input id="pos-end-${i}" name="posEnd" type="text" inputmode="numeric" maxlength="7" value="${p.end ? displayYears({ start: p.start, end: p.end }, ctx.deps.now()).to ?? '' : ''}" placeholder="${ctx.t('join.yearPlaceholder')}" aria-describedby="pos-end-hint"></div>
          </div>`,
        )}
        <p class="hint" id="pos-end-hint">${ctx.t('join.toHint')}</p>
      </fieldset>

      ${consentField(ctx, o.errors, ctx.t('join.consent'))}
      <button type="submit" class="btn btn-primary btn-lg btn-block">${ctx.t('join.submit')}</button>
    </form>
  </section>`;
  return layout(ctx, { title: `${ctx.t('join.title')} — ${ctx.t('brand')}`, body, variant: 'doctors', noindex: true });
}
