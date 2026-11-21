import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField } from '../components.js';
import { pick, type MessageKey } from '../../i18n/index.js';
import type { SymptomResult } from '../../services/symptomChecker.js';
import { DESCRIPTION_MAX } from '../../services/symptomChecker.js';

export interface SymptomFormValues {
  description: string;
  ageGroup: string;
  sex: string;
  consent: boolean;
}

function resultPanel(ctx: Ctx, r: SymptomResult): SafeHtml {
  if (r.notHealth) return alert('info', ctx.t('sc.notHealth'));
  const name = (s: SymptomResult['suggestions'][number]) => pick(ctx.locale, s.specialty) + (s.subspecialty ? ` — ${pick(ctx.locale, s.subspecialty)}` : '');
  return html`<section class="stack sc-result" aria-labelledby="sc-result-title" tabindex="-1" id="result">
    <h2 id="sc-result-title">${ctx.t('sc.resultTitle')}</h2>
    ${r.emergency
      ? html`<div class="alert alert-error sc-emergency" role="alert"><strong class="alert-title">${ctx.t('sc.emergencyTitle')}</strong>
          <div>${ctx.t('sc.emergencyBody')}</div><div><a class="btn btn-primary" href="tel:123">${ctx.t('sc.call123')}</a></div></div>`
      : r.urgency === 'soon' ? alert('warning', ctx.t('sc.soon')) : ''}
    ${r.suggestions.length
      ? html`<ol class="sc-list">${r.suggestions.map(
          (s, i) => html`<li class="sc-card${i === 0 ? ' best' : ''}">
            ${i === 0 ? html`<span class="pill small">${ctx.t('sc.bestMatch')}</span>` : html`<span class="muted label">${ctx.t('sc.alsoConsider')}</span>`}
            <h3>${name(s)}</h3>
            ${s.reason ? html`<p dir="auto">${s.reason}</p>` : ''}
            <div><a class="btn ${i === 0 ? 'btn-primary' : 'btn-outline'}" href="${href(ctx, '/search', { specialty: s.specialty.slug, sub: s.subspecialty?.slug })}">${ctx.t('sc.findDoctors', { specialty: name(s) })}</a></div>
          </li>`,
        )}</ol>`
      : ''}
    ${r.advice ? html`<p class="lead-sm" dir="auto">${r.advice}</p>` : ''}
    ${r.source === 'keywords' ? html`<p class="hint">${ctx.t(ctx.deps.ai ? 'sc.keywordsNote' : 'sc.guideNote')}</p>` : ''}
    <p class="disclaimer">${ctx.t('sc.disclaimer')}</p>
  </section>`;
}

export function symptomCheckerPage(ctx: Ctx, o: { values?: SymptomFormValues; result?: SymptomResult; error?: { key: MessageKey; field?: string } }): SafeHtml {
  const v = o.values ?? { description: '', ageGroup: '', sex: '', consent: false };
  const err = o.error;
  const radio = (name: string, value: string, label: MessageKey, current: string) =>
    html`<label class="sc-choice"><input type="radio" name="${name}" value="${value}"${attrIf(current === value, 'checked')}><span>${ctx.t(label)}</span></label>`;
  const body = html`<div class="container page narrow stack-lg">
    <div class="stack-sm">
      <span class="pill">${ctx.t(ctx.deps.ai ? 'sc.badge' : 'sc.badgeGuide')}</span>
      <h1>${ctx.t('sc.title')}</h1>
      <p class="lead">${ctx.t(ctx.deps.ai ? 'sc.lead' : 'sc.leadGuide')}</p>
    </div>
    ${o.result ? resultPanel(ctx, o.result) : ''}
    <form method="post" action="${href(ctx, '/symptom-checker')}" class="panel stack" novalidate>
      ${csrfField(ctx)}
      ${err && !err.field ? alert('error', ctx.t(err.key)) : ''}
      <div class="field${err?.field === 'description' ? ' has-error' : ''}">
        <label for="description">${ctx.t(o.result ? 'sc.describeAgain' : 'sc.describe')}</label>
        <textarea id="description" name="description" rows="5" maxlength="${DESCRIPTION_MAX}" required placeholder="${ctx.t('sc.placeholder')}"
          aria-describedby="description-hint${err?.field === 'description' ? ' description-error' : ''}"${attrIf(err?.field === 'description', 'aria-invalid="true"')}>${v.description}</textarea>
        <p class="hint" id="description-hint">${ctx.t('sc.describeHint')}</p>
        ${err?.field === 'description' ? html`<p class="field-error" id="description-error">${ctx.t(err.key)}</p>` : ''}
      </div>
      <fieldset class="stack-sm"><legend class="label">${ctx.t('sc.ageGroup')} <span class="muted">(${ctx.t('common.optional')})</span></legend>
        <div class="segmented three">${radio('ageGroup', 'child', 'sc.age.child', v.ageGroup)}${radio('ageGroup', 'adult', 'sc.age.adult', v.ageGroup)}${radio('ageGroup', 'senior', 'sc.age.senior', v.ageGroup)}</div>
      </fieldset>
      <fieldset class="stack-sm"><legend class="label">${ctx.t('sc.sex')} <span class="muted">(${ctx.t('common.optional')})</span></legend>
        <div class="segmented">${radio('sex', 'female', 'records.sex.female', v.sex)}${radio('sex', 'male', 'records.sex.male', v.sex)}</div>
      </fieldset>
      ${ctx.deps.ai
        ? html`<div class="field${err?.field === 'consent' ? ' has-error' : ''}">
            <label class="check"><input type="checkbox" name="consent" value="yes" required${attrIf(v.consent, 'checked')}><span>${ctx.t('sc.consent')}</span></label>
            ${err?.field === 'consent' ? html`<p class="field-error">${ctx.t(err.key)}</p>` : ''}
          </div>`
        : html`<p class="hint">${ctx.t('sc.guidePrivacy')}</p>`}
      <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('sc.submit')}</button></div>
      <p class="hint">${ctx.t('sc.emergencyNote')}</p>
    </form>
  </div>`;
  return layout(ctx, { title: `${ctx.t('sc.title')} — ${ctx.t('brand')}`, description: ctx.t('sc.lead'), body });
}
