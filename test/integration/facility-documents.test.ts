import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, Client, createAdmin, login, testPhone, type Harness } from '../helpers.js';
import { deliverPending } from '../../src/services/outbox.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const PDF = () => new Blob([Buffer.from('%PDF-1.4 licence')], { type: 'application/pdf' });
const JPG = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])], { type: 'image/jpeg' });
const WEBP = () => new Blob([Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)])], { type: 'image/webp' });
// An iPhone photo: an ISO media file whose brand is "heic". Browsers often send it with no type.
const HEIC = () => new Blob([Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic')])], { type: '' });
const HTML = () => new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/jpeg' });

function form(phone: string, extra: Record<string, string> = {}, files: Array<[string, Blob, string]> = []) {
  const f = new FormData();
  const fields: Record<string, string> = {
    kind: 'lab', name: 'Delta Lab', licenceNumber: 'MOH-777', contactName: 'Mona Adel',
    phone: '0' + phone.slice(3), email: `l${crypto.randomBytes(3).toString('hex')}@example.com`, password: 'Delta-lab-pass-2026', consent: 'yes', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [field, blob, name] of files) f.append(field, blob, name);
  return f;
}

async function facilityOf(phone: string) {
  return (await h.db.query<{ user_id: string }>('select f.user_id from facilities f join users u on u.id = f.user_id where u.phone_e164 = $1', [phone])).rows[0]!;
}
async function docCount(userId: string) {
  return Number((await h.db.query<{ n: string }>('select count(*) n from facility_documents where facility_id = $1', [userId])).rows[0]!.n);
}

test('a lab can sign up with no documents and is told what to upload', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  const ok = await c.postMultipart('/en/facilities/join', form(phone));
  assert.equal(ok.status, 303, ok.body.slice(0, 400));
  const dash = await c.get(ok.location!);
  assert.match(dash.body, /Upload photos of your licence/);
  const page = await c.get('/en/facility/documents');
  assert.equal(page.status, 200);
  assert.match(page.body, /Still needed for approval/);
  assert.match(page.body, /Nothing uploaded yet/);
});

test('a file that is not a photo or PDF is skipped but sign-up still succeeds; any phone photo type is kept', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  const ok = await c.postMultipart('/en/facilities/join', form(phone, {}, [
    ['licence', HEIC(), 'IMG_0001.HEIC'],
    ['licence', JPG(), 'back.jpg'],
    ['doc_manager_national_id', WEBP(), 'id.webp'],
    ['doc_other', HTML(), 'page.jpg'],
  ]));
  assert.equal(ok.status, 303, ok.body.slice(0, 400));
  assert.equal(ok.location, '/en/facility?ok=facilityJoinedRefused');
  const f = await facilityOf(phone);
  const rows = (await h.db.query<{ kind: string; mime_type: string }>('select kind, mime_type from facility_documents where facility_id = $1 order by mime_type', [f.user_id])).rows;
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.mime_type}`).sort(), ['licence:image/heic', 'licence:image/jpeg', 'manager_national_id:image/webp']);
});

test('a mistake elsewhere in the form keeps the chosen photos so they are not chosen again', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  const bad = await c.postMultipart('/en/facilities/join', form(phone, { password: 'short' }, [['licence', JPG(), 'licence.jpg'], ['doc_manager_syndicate_card', PDF(), 'card.pdf']]));
  assert.equal(bad.status, 422);
  assert.match(bad.body, /already uploaded/);
  assert.doesNotMatch(bad.body, /choose your file again/i);
  const tokens = [...bad.body.matchAll(/name="keep_doc" value="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(tokens.length, 2);

  // A forged or someone else's token is ignored.
  const fixed = form(phone);
  for (const tk of tokens) fixed.append('keep_doc', tk);
  fixed.append('keep_doc', tokens[0]!.replace(/:.*/, ':' + 'a'.repeat(32)));
  const ok = await c.postMultipart('/en/facilities/join', fixed);
  assert.equal(ok.status, 303, ok.body.slice(0, 400));
  const f = await facilityOf(phone);
  assert.equal(await docCount(f.user_id), 2);
  assert.equal(Number((await h.db.query<{ n: string }>('select count(*) n from pending_uploads where storage_key in (select storage_key from facility_documents where facility_id = $1)', [f.user_id])).rows[0]!.n), 0);
});

test('a facility adds and removes its own documents; others cannot see them; approval locks removal', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  assert.equal((await c.postMultipart('/en/facilities/join', form(phone))).status, 303);
  const f = await facilityOf(phone);

  const empty = new FormData();
  empty.append('kind', 'licence');
  const none = await c.postMultipart('/en/facility/documents', empty);
  assert.match(none.body + (none.location ?? ''), /noneValid|Choose at least one|err/);

  const up = new FormData();
  up.append('licence', JPG(), 'a.jpg');
  up.append('licence', PDF(), 'b.pdf');
  const added = await c.postMultipart('/en/facility/documents', up);
  assert.equal(added.status, 303, added.body.slice(0, 300));
  assert.equal(await docCount(f.user_id), 2);
  const page = await c.get('/en/facility/documents');
  const ids = [...new Set([...page.body.matchAll(/\/en\/facility\/documents\/([0-9a-f-]{36})"/g)].map((m) => m[1]!))];
  assert.ok(ids.length >= 2);
  assert.equal((await c.get(`/en/facility/documents/${ids[0]}`)).status, 200);

  // Another facility can neither open nor remove it.
  const other = testPhone();
  const o = new Client(h.baseUrl);
  await o.get('/en/facilities/join');
  assert.equal((await o.postMultipart('/en/facilities/join', form(other))).status, 303);
  assert.equal((await o.get(`/en/facility/documents/${ids[0]}`)).status, 404);
  await o.post(`/en/facility/documents/${ids[0]}/delete`, {});
  assert.equal(await docCount(f.user_id), 2);
  // A patient-less visitor cannot either.
  assert.notEqual((await new Client(h.baseUrl).get(`/en/facility/documents/${ids[0]}`)).status, 200);

  assert.equal((await c.post(`/en/facility/documents/${ids[0]}/delete`, {})).status, 303);
  assert.equal(await docCount(f.user_id), 1);

  await h.db.query("update facilities set verification_status = 'approved', verified_at = now() where user_id = $1", [f.user_id]);
  const locked = await c.post(`/en/facility/documents/${ids[1]}/delete`, {});
  assert.equal(locked.status, 303, locked.body.slice(0, 300));
  assert.match(locked.location ?? '', /fdocs\.err\.locked/);
  assert.equal(await docCount(f.user_id), 1);
});

test('the admin asks for more documents; the facility sees the note, gets an SMS, and the admin sees new uploads', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  assert.equal((await c.postMultipart('/en/facilities/join', form(phone, {}, [['licence', JPG(), 'blurry.jpg']]))).status, 303);
  const f = await facilityOf(phone);

  const admin = await createAdmin(h.db);
  const ac = new Client(h.baseUrl);
  await login(ac, admin.phone, admin.password);
  const detail = await ac.get(`/en/admin/facilities/${f.user_id}`);
  assert.match(detail.body, /<img src="\/en\/admin\/facility-documents\//);
  assert.match(detail.body, /Not uploaded yet:/);
  assert.match(detail.body, /Ask for more documents/);

  assert.match((await ac.post(`/en/admin/facilities/${f.user_id}/request_docs`, { note: '' })).location!, /error=admin\.noteRequired/);
  const asked = await ac.post(`/en/admin/facilities/${f.user_id}/request_docs`, { note: 'The licence photo is blurry, please take it again in daylight.' });
  assert.equal(asked.status, 303);
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.ok(h.sms.sent.some((m) => m.to === phone && /one more document/.test(m.body)));

  const dash = await c.get('/en/facility');
  assert.match(dash.body, /asked for more documents/);
  assert.match(dash.body, /blurry, please take it again/);
  let list = await ac.get('/en/admin/facilities');
  assert.match(list.body, /Waiting for documents/);

  const up = new FormData();
  up.append('licence', JPG(), 'clear.jpg');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await c.postMultipart('/en/facility/documents', up)).status, 303);
  list = await ac.get('/en/admin/facilities');
  assert.match(list.body, /New documents uploaded/);

  assert.equal((await ac.post(`/en/admin/facilities/${f.user_id}/approve`, {})).status, 303);
  const after = (await h.db.query<{ docs_request_note: string | null }>('select docs_request_note from facilities where user_id = $1', [f.user_id])).rows[0]!;
  assert.equal(after.docs_request_note, null);
});

test('a short licence number (one or two digits) is accepted', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  const ok = await c.postMultipart('/en/facilities/join', form(phone, { licenceNumber: '7' }));
  assert.equal(ok.status, 303, ok.body.slice(0, 400));
  const row = (await h.db.query<{ licence_number: string }>('select licence_number from facilities f join users u on u.id = f.user_id where u.phone_e164 = $1', [phone])).rows[0]!;
  assert.equal(row.licence_number, '7');
});
