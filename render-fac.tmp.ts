import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/*
 * Renders the two advert videos from captured screens.
 *   npx tsx render-video.tmp.ts patient|doctor stills|full
 */
const which = process.argv[2] as 'lab' | 'scan' | 'pharm';
const mode = process.argv[3] as 'stills' | 'full';
const FPS = 30;
const VID = '/tmp/vid';

type Box = { x: number; y: number; w: number; h: number };


const metaF = JSON.parse(fs.readFileSync(`${VID}/f/meta.json`, 'utf8'));
const bf = (name: string, k: string): Box => metaF[name].boxes[k];
const f = (name: string, path: string) => ({ img: `f/${name}.jpg`, path });
const centerF = (b: Box, name: string) => Math.max(0, Math.min(metaF[name].height - 900, b.y - (900 - b.h) / 2));
const NOTE = '* الأسماء والبيانات في الفيديو للتوضيح فقط';
const JOIN = 'tabeeby-web.onrender.com/facilities/join';

const lab = {
  W: 1920, H: 1080, mode: 'laptop', TR: 0.5,
  scenes: [
    { type: 'title', dur: 3.6, title: 'طلبات التحاليل توصلك جاهزة من الدكتور', sub: 'طبيبي للمعامل',
      pills: ['طلبات من الأطباء', 'سحب من المنزل', 'نتائج أونلاين', 'أسعار واضحة', 'إحصائيات'] },
    { type: 'screen', dur: 6.6, step: 1, kicker: 'الطلبات', ...f('lab-requests', '/facility/requests'), title: 'طلبات جاهزة من الدكتور', sub: 'المريض بيبعتلك طلب التحاليل زي ما الدكتور كتبه بالظبط — من غير خط صعب ولا لخبطة.',
      bullets: ['تأكيد الاستلام بضغطة', 'طلبات السحب من المنزل', 'كل الطلبات في قائمة واحدة'], scroll: [[0.8, 0], [5.0, 600]] },
    { type: 'screen', dur: 7.0, step: 2, kicker: 'من العينة للنتيجة', ...f('lab-detail', '/facility/requests'), title: 'ارفع النتيجة… توصل فوراً', sub: 'علّم إن العينة اتسحبت، وارفع النتيجة PDF أو صورة — توصل للمريض والدكتور في نفس اللحظة.',
      scroll: [[0.6, 0], [2.0, 260]], highlights: [{ t0: 2.2, t1: 4.3, box: bf('lab-detail', 'sample') }, { t0: 4.5, t1: 7.0, box: bf('lab-detail', 'upload') }] },
    { type: 'screen', dur: 6.0, step: 3, kicker: 'الأسعار', ...f('lab-prices', '/facility/prices'), title: 'أسعارك قدام المرضى', sub: 'سعر كل تحليل، وتحاليل إضافية تضيفها بنفسك — والمريض يشوف الإجمالي ويختارك.',
      scroll: [[0.8, 0], [3.0, centerF(bf('lab-prices', 'extra'), 'lab-prices')]], highlights: [{ t0: 3.2, t1: 6.0, box: bf('lab-prices', 'extra') }] },
    { type: 'screen', dur: 5.6, step: 4, kicker: 'مرضى جدد', ...f('lab-public', '/labs'), title: 'المرضى بيلاقوك', sub: 'معملك في البحث بالعنوان والمواعيد والسحب من المنزل، والتواصل بالتليفون أو واتساب.',
      scroll: [[0.8, 0], [4.2, 420]] },
    { type: 'screen', dur: 6.6, step: 5, kicker: 'الإحصائيات', ...f('lab-insights', '/facility/insights'), title: 'اعرف شغلك بالأرقام', sub: 'أكتر التحاليل طلباً، أوقات الذروة، وأكتر الدكاترة اللي بيحوّلوا لك مرضى.',
      scroll: [[0, 0], [1.8, centerF(bf('lab-insights', 'doctors'), 'lab-insights')], [4.6, centerF(bf('lab-insights', 'doctors'), 'lab-insights')], [6.2, 1100]],
      highlights: [{ t0: 2.0, t1: 4.6, box: bf('lab-insights', 'doctors') }] },
    { type: 'screen', dur: 5.2, step: 6, kicker: 'الفروع', ...f('lab-branches', '/facility/branches'), title: 'كل فروعك في مكان واحد', sub: 'ساعات العمل لكل فرع، ومفتوح ٢٤ ساعة، وخدمة السحب من المنزل.',
      scroll: [[0.8, 0], [4.4, 700]] },
    { type: 'outro', dur: 5.0, title: 'انضم لطبيبي', sub: 'سجّل معملك مجاناً', url: JOIN, note: NOTE },
  ],
};

const scan = {
  W: 1920, H: 1080, mode: 'laptop', TR: 0.5,
  scenes: [
    { type: 'title', dur: 3.6, title: 'طلبات الأشعة توصلك جاهزة من الدكتور', sub: 'طبيبي لمراكز الأشعة',
      pills: ['طلبات من الأطباء', 'تقارير أونلاين', 'أسعار واضحة', 'تحليل الكلى للصبغة', 'إحصائيات'] },
    { type: 'screen', dur: 6.4, step: 1, kicker: 'الطلبات', ...f('scan-requests', '/facility/requests'), title: 'كل طلبات الأشعة في مكان واحد', sub: 'المريض بيختار مركزك ويبعتلك طلب الدكتور مكتوب بوضوح، وانت تبعتله تعليمات التحضير.',
      bullets: ['تأكيد الاستلام بضغطة', 'تعليمات التحضير للمريض', 'كل الطلبات في قائمة واحدة'], scroll: [[0.8, 0], [5.0, 500]] },
    { type: 'screen', dur: 6.4, step: 2, kicker: 'التقارير', ...f('scan-detail', '/facility/requests'), title: 'ارفع التقرير… يوصل فوراً', sub: 'ارفع التقرير PDF أو صور، يوصل للمريض والدكتور فوراً — ولو الأشعة بصبغة، المريض يقدر يشاركك تحليل الكلى.',
      scroll: [[0.8, 0], [4.0, 240]] },
    { type: 'screen', dur: 5.6, step: 3, kicker: 'الأسعار', ...f('scan-prices', '/facility/prices'), title: 'أسعار واضحة لكل أشعة', sub: 'سعر كل نوع أشعة قدام المريض، وتقدر تضيف فحوصات جديدة بنفسك.',
      scroll: [[0.8, 0], [4.2, 380]] },
    { type: 'screen', dur: 5.4, step: 4, kicker: 'مرضى جدد', ...f('scan-public', '/scan-centres'), title: 'المرضى بيلاقوك', sub: 'مركزك في البحث بالعنوان والمواعيد والأسعار، والتواصل بالتليفون أو واتساب.',
      scroll: [[0.8, 0], [4.2, 360]] },
    { type: 'screen', dur: 6.4, step: 5, kicker: 'الإحصائيات', ...f('scan-insights', '/facility/insights'), title: 'اعرف مركزك بالأرقام', sub: 'أكتر أنواع الأشعة طلباً، الأشعة اللي بيطلبوها ومش في قايمتك، وأكتر الدكاترة تحويلاً.',
      scroll: [[0.8, 0], [5.2, 900]] },
    { type: 'screen', dur: 5.0, step: 6, kicker: 'الفروع', ...f('scan-branches', '/facility/branches'), title: 'كل فروعك في مكان واحد', sub: 'ساعات العمل لكل فرع، ومواعيد تناسب مرضاك.',
      scroll: [[0.8, 0], [4.2, 600]] },
    { type: 'outro', dur: 5.0, title: 'انضم لطبيبي', sub: 'سجّل مركز الأشعة مجاناً', url: JOIN, note: NOTE },
  ],
};

const pharm = {
  W: 1920, H: 1080, mode: 'laptop', TR: 0.5,
  scenes: [
    { type: 'title', dur: 3.6, title: 'الروشتة توصلك مكتوبة وواضحة', sub: 'طبيبي للصيدليات',
      pills: ['روشتات أونلاين', 'رد سريع بالسعر', 'توصيل للمنزل', 'إحصائيات المخزون'] },
    { type: 'screen', dur: 6.6, step: 1, kicker: 'الروشتات', ...f('pharm-inbox', '/facility/prescriptions'), title: 'روشتات توصلك أونلاين', sub: 'المريض بيبعتلك روشتة الدكتور مكتوبة بوضوح — من غير خط صعب ولا تخمين.',
      bullets: ['كل الطلبات في قائمة واحدة', 'طلبات التوصيل للمنزل', 'حالة كل طلب قدامك'], scroll: [[0.8, 0], [5.0, 560]] },
    { type: 'screen', dur: 6.6, step: 2, kicker: 'الرد', ...f('pharm-detail', '/facility/prescriptions'), title: 'رد على المريض بضغطة', sub: 'قوله الدوا جاهز، أو متاح جزء منه، أو خرج للتوصيل — ومعاه السعر الإجمالي.',
      scroll: [[0.6, 0], [2.0, centerF(bf('pharm-detail', 'reply'), 'pharm-detail')]], highlights: [{ t0: 2.2, t1: 6.6, box: bf('pharm-detail', 'reply') }] },
    { type: 'screen', dur: 5.6, step: 3, kicker: 'مرضى جدد', ...f('pharm-public', '/pharmacies'), title: 'المرضى بيلاقوك', sub: 'صيدليتك في البحث بالعنوان، ومفتوحة ٢٤ ساعة ولا لأ، والتوصيل.',
      scroll: [[0.8, 0], [4.4, 520]] },
    { type: 'screen', dur: 6.6, step: 4, kicker: 'الإحصائيات', ...f('pharm-insights', '/facility/insights'), title: 'اعرف إيه اللي ناقصك', sub: 'الأدوية اللي بتتطلب ومش عندك، ونسبة الروشتات اللي بتوفرها، ومتوسط قيمة الطلب.',
      scroll: [[0.8, 0], [5.6, 1000]] },
    { type: 'screen', dur: 5.0, step: 5, kicker: 'الفروع', ...f('pharm-branches', '/facility/branches'), title: 'كل فروعك في مكان واحد', sub: 'ساعات العمل، ومفتوح ٢٤ ساعة، والتوصيل لكل فرع.',
      scroll: [[0.8, 0], [4.2, 600]] },
    { type: 'outro', dur: 5.0, title: 'انضم لطبيبي', sub: 'سجّل صيدليتك مجاناً', url: JOIN, note: NOTE },
  ],
};

const spec = which === 'lab' ? lab : which === 'scan' ? scan : pharm;
if (process.env.DURS) {
  // New scene lengths (to fit a voice-over): scroll, highlight and tap times stretch with each scene.
  const durs = JSON.parse(process.env.DURS) as number[];
  spec.scenes.forEach((sc: any, i: number) => {
    if (!durs[i]) return;
    const f = durs[i] / sc.dur;
    sc.dur = durs[i];
    if (sc.scroll) sc.scroll = sc.scroll.map(([t, y]: [number, number]) => [t * f, y]);
    if (sc.highlights) sc.highlights = sc.highlights.map((h: any) => ({ ...h, t0: h.t0 * f, t1: h.t1 * f }));
    if (sc.taps) sc.taps = sc.taps.map((tp: any) => ({ ...tp, t: tp.t * f }));
  });
}
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--allow-file-access-from-files'] });
const page = await (await b.newContext({ viewport: { width: spec.W, height: spec.H }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`file://${VID}/compose.html`);
const total = (await page.evaluate(`setup(${JSON.stringify(spec)})`)) as number;
const starts = (await page.evaluate('S.scenes.map(s => s.start)')) as number[];
console.log('total seconds', total.toFixed(2), 'scenes', starts.length);
const outDir = `${VID}/out-${which}${process.env.OUT_SUFFIX ?? ''}`;
fs.mkdirSync(outDir, { recursive: true });

if (mode === 'stills') {
  const times = (process.argv[4] ?? '').split(',').filter(Boolean).map(Number);
  for (const t of times) {
    await page.evaluate(`renderAt(${t})`);
    await page.screenshot({ path: `${outDir}/still-${t}.jpg`, type: 'jpeg', quality: 85 });
  }
  console.log('stills', times.join(','));
} else {
  const lastFrame = Math.round(total * FPS);
  const bounds = [...starts.map((s) => Math.round(s * FPS)), lastFrame];
  const files: string[] = [];
  for (let k = 0; k < starts.length; k++) {
    const [f0, f1] = [bounds[k]!, bounds[k + 1]!];
    const tmp = `${outDir}/scene-${String(k).padStart(2, '0')}.part.mp4`;
    const fin = tmp.replace('.part.mp4', '.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-f', 'mp4', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise<number>((r) => ff.on('close', r));
    for (let f = f0; f < f1; f++) {
      await page.evaluate(`renderAt(${f / FPS})`);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg failed on scene ${k}`);
    fs.renameSync(tmp, fin);
    files.push(fin);
    console.log('scene', k, f1 - f0, 'frames');
  }
  fs.writeFileSync(`${outDir}/list.txt`, files.map((f) => `file '${f}'`).join('\n'));
}
await b.close();
