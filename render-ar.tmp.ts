import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/*
 * Renders the two advert videos from captured screens.
 *   npx tsx render-video.tmp.ts patient|doctor stills|full
 */
const which = process.argv[2] as 'patient' | 'doctor';
const mode = process.argv[3] as 'stills' | 'full';
const FPS = 30;
const VID = '/tmp/vid';

type Box = { x: number; y: number; w: number; h: number };
const metaP = JSON.parse(fs.readFileSync(`${VID}/p/meta.json`, 'utf8'));
const metaD = JSON.parse(fs.readFileSync(`${VID}/d/meta.json`, 'utf8'));
const bp = (name: string, k: string): Box => metaP[name].boxes[k];
const bd = (name: string, k: string): Box => metaD[name].boxes[k];
const p = (name: string) => ({ img: `p/${name}.jpg`, tabbar: metaP[name].tabbar ? `p/${name}.tabbar.jpg` : undefined });
const d = (name: string, path: string) => ({ img: `d/${name}.jpg`, path });
/** Phone: 1260 px of screen ≈ 819 page px visible; keep the bottom menu (~70) clear. */
const PH_VIEW = 1300 / (680 / 390);
const centerP = (b: Box, name: string) => Math.max(0, Math.min(metaP[name].height - PH_VIEW, b.y - (PH_VIEW - 70 - b.h) / 2));
const centerD = (b: Box, name: string) => Math.max(0, Math.min(metaD[name].height - 900, b.y - (900 - b.h) / 2));

const patient = {
  W: 1080, H: 1920, mode: 'phone', TR: 0.5,
  scenes: [
    { type: 'title', dur: 3.4, title: 'دكتورك الصح… في دقيقة', sub: 'احجز، تابع دورك، وملفك الصحي كله في مكان واحد' },
    { type: 'screen', dur: 5.6, step: 1, kicker: 'ابحث', ...p('01-home'), title: 'ابحث عن دكتورك', sub: 'بالتخصص أو المنطقة أو اسم الدكتور — في كل محافظات مصر',
      scroll: [[0.6, 0], [2.2, centerP(bp('01-home', 'search'), '01-home')]], highlights: [{ t0: 2.4, t1: 5.6, box: bp('01-home', 'search') }] },
    { type: 'screen', dur: 5.0, step: 2, kicker: 'مش عارف تروح لمين؟', ...p('02-symptoms'), title: 'قول لنا حاسس بإيه', sub: 'اكتب الأعراض، وطبيبي يقترح عليك التخصص المناسب',
      scroll: [[0, 0], [1.4, 120]], highlights: [{ t0: 1.6, t1: 5.0, box: bp('02-symptoms', 'form') }] },
    { type: 'screen', dur: 5.6, step: 3, kicker: 'قارن', ...p('03-search'), title: 'قارن واختار بثقة', sub: 'سعر الكشف، تقييمات المرضى، وأقرب ميعاد متاح — قدامك',
      scroll: [[0.4, 0], [1.8, centerP(bp('03-search', 'card'), '03-search')]], highlights: [{ t0: 2.0, t1: 4.4, box: bp('03-search', 'card') }],
      taps: [{ t: 4.5, x: bp('03-search', 'slot').x + 75, y: bp('03-search', 'slot').y + 22 }] },
    { type: 'screen', dur: 6.6, step: 4, kicker: 'اعرف دكتورك', ...p('04-profile'), title: 'كل حاجة عن الدكتور', sub: 'خبرته وعياداته ومواعيده وتقييمات المرضى',
      scroll: [[0.6, 0], [2.4, bp('04-profile', 'reviews').y - 60], [4.4, centerP(bp('04-profile', 'slot'), '04-profile')]],
      taps: [{ t: 5.3, x: bp('04-profile', 'slot').x + 75, y: bp('04-profile', 'slot').y + 22 }] },
    { type: 'screen', dur: 6.0, step: 5, kicker: 'احجز', ...p('05-book'), title: 'احجز في ثواني', sub: 'ادفع كاش أو بالبطاقة في العيادة أو إنستاباي — والحجز مجاني',
      scroll: [[0.6, 0], [2.2, centerP(bp('05-book', 'pay'), '05-book')]], highlights: [{ t0: 2.5, t1: 6.0, box: bp('05-book', 'pay') }] },
    { type: 'screen', dur: 6.4, step: 6, kicker: 'وقت الانتظار المباشر', ...p('06-booked'), title: 'تابع دورك لحظة بلحظة', sub: 'اعرف كام مريض قبلك ووقت الانتظار — من غير ما تستنى في العيادة',
      scroll: [[0, 0], [1.6, 120]], highlights: [{ t0: 0.6, t1: 2.2, box: bp('06-booked', 'notice') }, { t0: 2.4, t1: 6.4, box: { x: 16, y: 350, w: 358, h: 437 } }] },
    { type: 'screen', dur: 5.4, step: 7, kicker: 'ملفي الصحي', ...p('09-record'), title: 'ملفك الصحي معاك دايماً', sub: 'الروشتات والتحاليل والأشعة من كل أطبائك في مكان واحد',
      scroll: [[0.6, 0], [3.4, 520]], highlights: [] },
    { type: 'screen', dur: 6.4, step: 8, kicker: 'التحاليل والأشعة', ...p('10-lab'), title: 'نتيجتك توصلك… ودكتورك يراجعها', sub: 'ابعت الطلب للمعمل وتابع كل خطوة لحد ما الطبيب يكتب رأيه',
      scroll: [[0.4, 0], [1.8, centerP(bp('10-lab', 'tracker'), '10-lab')], [3.6, centerP(bp('10-lab', 'tracker'), '10-lab')], [4.4, centerP(bp('10-lab', 'review'), '10-lab')]],
      highlights: [{ t0: 1.9, t1: 3.6, box: bp('10-lab', 'tracker') }, { t0: 4.5, t1: 6.4, box: bp('10-lab', 'review') }] },
    { type: 'screen', dur: 5.4, step: 9, kicker: 'تذكير الأدوية', ...p('11-medicines'), title: 'ماتنساش جرعة', sub: 'تذكير بمواعيد الدوا على موبايلك، وعلّم على كل جرعة أخدتها',
      scroll: [[0, 0], [3.4, 0], [4.6, 380]], highlights: [{ t0: 1.0, t1: 3.4, box: bp('11-medicines', 'today') }] },
    { type: 'outro', dur: 4.8, title: 'احجز دكتورك دلوقتي', sub: 'مجاناً للمرضى · في كل محافظات مصر', url: 'tabeeby-web.onrender.com', note: '* الأسماء والبيانات في الفيديو للتوضيح فقط' },
  ],
};

const doctor = {
  W: 1920, H: 1080, mode: 'laptop', TR: 0.5,
  scenes: [
    { type: 'title', dur: 3.6, title: 'عيادتك كلها في شاشة واحدة', sub: 'نظام متكامل للأطباء في مصر',
      pills: ['المواعيد', 'ملفات المرضى', 'الروشتات', 'التحاليل والأشعة', 'الإيرادات', 'السكرتارية'] },
    { type: 'screen', dur: 7.0, step: 1, kicker: 'لوحة التحكم', ...d('01-today', '/dashboard'), title: 'يومك قدامك', sub: 'كل مواعيد النهارده: مين وصل، مين في الكشف، والمحصّل لحظة بلحظة.',
      bullets: ['تسجيل الحضور بضغطة', 'المريض يتابع دوره من موبايله', 'إيصال ومتابعة لكل زيارة'],
      scroll: [[0, 0], [3.6, 0], [5.2, 380]], highlights: [{ t0: 1.0, t1: 3.4, box: bd('01-today', 'kpis') }] },
    { type: 'screen', dur: 6.0, step: 2, kicker: 'حجز سريع', ...d('02-book', '/dashboard/book'), title: 'حجز أو كشف فوري في ثواني', sub: 'سجّل المريض بالكتابة أو بالصوت، ويوصله تأكيد على موبايله.',
      scroll: [[0.6, 0], [2.0, centerD(bd('02-book', 'form'), '02-book')]], highlights: [{ t0: 2.3, t1: 6.0, box: bd('02-book', 'form') }] },
    { type: 'screen', dur: 6.0, step: 3, kicker: 'ملف المريض', ...d('03-file', '/dashboard/patients'), title: 'ملف كامل لكل مريض', sub: 'التاريخ المرضي والحساسية والأدوية وكل الزيارات السابقة في صفحة واحدة.',
      scroll: [[1.2, 0], [4.2, 380]] },
    { type: 'screen', dur: 7.0, step: 4, kicker: 'الكشف', ...d('04-visit', '/dashboard/visits/new'), title: 'الكشف والروشتة والتحاليل', sub: 'اكتب الكشف، واطلب التحاليل بمجموعات جاهزة بضغطة واحدة.',
      bullets: ['كتابة بالصوت عربي وإنجليزي', 'صور للحالة من الموبايل', 'مجموعات تحاليل جاهزة'],
      scroll: [[0.6, 0], [3.0, 1400], [4.6, centerD(bd('04-visit', 'sets'), '04-visit')]], highlights: [{ t0: 4.8, t1: 7.0, box: bd('04-visit', 'sets') }] },
    { type: 'screen', dur: 5.2, step: 5, kicker: 'الروشتة', ...d('05-rx-print', '/dashboard/prescriptions'), title: 'روشتة احترافية باسمك', sub: 'جاهزة للطباعة، والمريض يلاقيها في ملفه على الموبايل ويضبط منها تذكير الدوا.',
      scroll: [[0, 0], [5.2, 120]] },
    { type: 'screen', dur: 6.4, step: 6, kicker: 'النتائج', ...d('06-results', '/dashboard/results'), title: 'النتايج بتوصلك تلقائي', sub: 'أول ما المعمل أو مركز الأشعة يخلص، تراجعها وتكتب رأيك للمريض وتطلب متابعة.',
      scroll: [[0, 0], [3.6, 0], [5.4, 360]], highlights: [{ t0: 0.9, t1: 3.6, box: bd('06-results', 'first') }] },
    { type: 'screen', dur: 5.4, step: 7, kicker: 'الإحصائيات', ...d('07-insights', '/dashboard/insights'), title: 'اعرف عيادتك بالأرقام', sub: 'المرضى والزيارات وأكتر الأيام زحمة — عشان تخطط صح.',
      scroll: [[0.8, 0], [4.4, 380]] },
    { type: 'screen', dur: 5.2, step: 8, kicker: 'الإيرادات', ...d('08-income', '/dashboard/income'), title: 'حساباتك منظمة', sub: 'كل المدفوعات كاش وبطاقة وإنستاباي، وتقارير تنزّلها في أي وقت.',
      scroll: [[0.8, 0], [4.4, 300]] },
    { type: 'screen', dur: 5.2, step: 9, kicker: 'مواعيد العمل', ...d('09-hours', '/dashboard/hours'), title: 'مواعيدك بإيدك', sub: 'حدد أيام وساعات كل عيادة، والحجز بيتظبط لوحده من غير تعارض.',
      scroll: [[0.8, 0], [4.4, 520]] },
    { type: 'screen', dur: 5.2, step: 10, kicker: 'الفريق', ...d('10-team', '/dashboard/team'), title: 'حساب للسكرتارية', sub: 'السكرتيرة تشتغل من موبايلها بصلاحيات انت اللي بتحددها.',
      scroll: [[0.8, 0], [4.2, 200]] },
    { type: 'screen', dur: 6.0, step: 11, kicker: 'صفحتك العامة', ...d('12-public', '/doctors/dr-ahmed-hassan'), title: 'صفحتك بتجيبلك مرضى جدد', sub: 'ملف موثّق بعضوية النقابة، تقييمات المرضى، وروابط صفحاتك على السوشيال ميديا.',
      scroll: [[0, 0], [3.6, 0], [5.2, 900]], highlights: [{ t0: 1.0, t1: 3.6, box: bd('12-public', 'social') }] },
    { type: 'outro', dur: 5.0, title: 'انضم لطبيبي', sub: 'التسجيل مجاني · ابدأ في دقايق', url: 'tabeeby-web.onrender.com/for-doctors', note: '* الأسماء والبيانات في الفيديو للتوضيح فقط' },
  ],
};

const spec = which === 'patient' ? patient : doctor;
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
const outSuffix = process.env.OUT_SUFFIX ?? '';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--allow-file-access-from-files'] });
const page = await (await b.newContext({ viewport: { width: spec.W, height: spec.H }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`file://${VID}/compose.html`);
const total = (await page.evaluate(`setup(${JSON.stringify(spec)})`)) as number;
const starts = (await page.evaluate('S.scenes.map(s => s.start)')) as number[];
console.log('total seconds', total.toFixed(2), 'scenes', starts.length);
const outDir = `${VID}/out-${which}${outSuffix}`;
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
