import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { sendHtml } from '../http/respond.js';
import { notFound } from '../http/errors.js';
import { getReference } from '../services/reference.js';
import { checkSymptoms, type AgeGroup, type Sex } from '../services/symptomChecker.js';
import { symptomCheckerPage, type SymptomFormValues } from '../views/pages/symptomChecker.js';
import { formValue } from './helpers.js';

/** The page exists only when an AI provider is configured. */
function requireAi(ctx: Ctx): void {
  if (!ctx.deps.ai) throw notFound();
}

export function symptomCheckerRoutes(r: Router): void {
  r.get('/symptom-checker', async (ctx) => {
    requireAi(ctx);
    sendHtml(ctx, 200, symptomCheckerPage(ctx, {}));
  });

  r.post('/symptom-checker', async (ctx) => {
    requireAi(ctx);
    const values: SymptomFormValues = {
      description: formValue(ctx, 'description').slice(0, 2000),
      ageGroup: formValue(ctx, 'ageGroup'),
      sex: formValue(ctx, 'sex'),
      consent: formValue(ctx, 'consent') === 'yes',
    };
    const ageGroup = (['child', 'adult', 'senior'] as const).find((a) => a === values.ageGroup) ?? null;
    const sex = (['female', 'male'] as const).find((s) => s === values.sex) ?? null;
    const outcome = await checkSymptoms(
      ctx.deps,
      await getReference(ctx.deps.db),
      { description: values.description, ageGroup: ageGroup as AgeGroup | null, sex: sex as Sex | null, locale: ctx.locale },
      { consent: values.consent, ip: ctx.ip },
    );
    if ('error' in outcome) return sendHtml(ctx, outcome.error === 'sc.err.tooMany' ? 429 : 422, symptomCheckerPage(ctx, { values, error: { key: outcome.error, field: outcome.field } }));
    sendHtml(ctx, 200, symptomCheckerPage(ctx, { values, result: outcome.result }));
  });
}
