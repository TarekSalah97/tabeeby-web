/**
 * Minimal PostgreSQL client (wire protocol v3) with a connection pool.
 *
 * WHY THIS EXISTS: the build environment could not install the `pg` package.
 * This client implements only what the app needs — parameterised queries over
 * the extended protocol (no string interpolation, so no SQL injection), simple
 * multi-statement queries for migrations, TLS, and SCRAM-SHA-256 / MD5 auth.
 * It exposes the same shape as `pg.Pool` (`query`, `connect`/`release`), so it
 * can be replaced by `pg` by changing src/db/db.ts only.
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import fs from 'node:fs';

export interface QueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number;
  command: string;
}

export class PgError extends Error {
  readonly code: string;
  readonly constraint: string | undefined;
  readonly detail: string | undefined;
  constructor(fields: Record<string, string>) {
    super(fields['M'] ?? 'PostgreSQL error');
    this.name = 'PgError';
    this.code = fields['C'] ?? 'XX000';
    this.constraint = fields['n'];
    this.detail = fields['D'];
  }
}

export interface PgOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: 'disable' | 'require' | 'no-verify';
  sslCaFile?: string | undefined;
  connectTimeoutMs?: number;
}

export function parseConnectionString(url: string): Omit<PgOptions, 'ssl'> & { sslmode: string | null } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // The URL holds the password: report the problem without the value.
    throw new Error('DATABASE_URL is not a valid postgresql:// connection string');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must start with postgres://');
  }
  return {
    host: decodeURIComponent(u.hostname) || 'localhost',
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || decodeURIComponent(u.username),
    sslmode: u.searchParams.get('sslmode'),
  };
}

// ---------------------------------------------------------------------------
// Value encoding / decoding
// ---------------------------------------------------------------------------

const OID = {
  bool: 16,
  int8: 20,
  int2: 21,
  int4: 23,
  json: 114,
  float4: 700,
  float8: 701,
  boolArray: 1000,
  int2Array: 1005,
  int4Array: 1007,
  textArray: 1009,
  varcharArray: 1015,
  int8Array: 1016,
  timestamp: 1114,
  timestamptz: 1184,
  jsonb: 3802,
  uuidArray: 2951,
} as const;

function parseArrayLiteral(text: string): (string | null)[] {
  // Handles one-dimensional arrays like {a,"b c",NULL}
  if (text === '{}') return [];
  const inner = text.slice(1, -1);
  const out: (string | null)[] = [];
  let i = 0;
  while (i <= inner.length) {
    if (inner[i] === '"') {
      let value = '';
      i++;
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === '\\') i++;
        value += inner[i];
        i++;
      }
      out.push(value);
      i += 2; // closing quote + comma
    } else {
      let end = inner.indexOf(',', i);
      if (end === -1) end = inner.length;
      const raw = inner.slice(i, end);
      out.push(raw === 'NULL' ? null : raw);
      i = end + 1;
    }
  }
  return out;
}

function decodeValue(typeOid: number, text: string): unknown {
  switch (typeOid) {
    case OID.bool:
      return text === 't';
    case OID.int2:
    case OID.int4:
    case OID.float4:
    case OID.float8:
      return Number(text);
    case OID.int8: {
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : text;
    }
    case OID.json:
    case OID.jsonb:
      return JSON.parse(text);
    case OID.timestamptz:
      return new Date(text);
    case OID.timestamp:
      return new Date(text.replace(' ', 'T') + 'Z');
    case OID.int2Array:
    case OID.int4Array:
    case OID.int8Array:
      return parseArrayLiteral(text).map((v) => (v === null ? null : Number(v)));
    case OID.boolArray:
      return parseArrayLiteral(text).map((v) => (v === null ? null : v === 't'));
    case OID.textArray:
    case OID.varcharArray:
    case OID.uuidArray:
      return parseArrayLiteral(text);
    default:
      return text; // text, varchar, uuid, date, time, numeric, citext …
  }
}

function encodeArrayElement(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function encodeParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (Array.isArray(v)) return '{' + v.map(encodeArrayElement).join(',') + '}';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Message writer
// ---------------------------------------------------------------------------

class Writer {
  private chunks: Buffer[] = [];
  private size = 0;
  int8(n: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(n);
    return this.push(b);
  }
  int16(n: number): this {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n);
    return this.push(b);
  }
  int32(n: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    return this.push(b);
  }
  cstring(s: string): this {
    return this.push(Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]));
  }
  bytes(b: Buffer): this {
    return this.push(b);
  }
  private push(b: Buffer): this {
    this.chunks.push(b);
    this.size += b.length;
    return this;
  }
  /** Frame as a typed message: type byte + int32 length (incl. itself) + body. */
  message(type: string): Buffer {
    const header = Buffer.alloc(5);
    header.write(type, 0, 'ascii');
    header.writeInt32BE(this.size + 4, 1);
    return Buffer.concat([header, ...this.chunks]);
  }
  /** Untyped message (startup / SSLRequest): int32 length + body. */
  untyped(): Buffer {
    const header = Buffer.alloc(4);
    header.writeInt32BE(this.size + 4);
    return Buffer.concat([header, ...this.chunks]);
  }
}

interface BackendMessage {
  type: string;
  body: Buffer;
}

function readCString(buf: Buffer, offset: number): [string, number] {
  const end = buf.indexOf(0, offset);
  return [buf.toString('utf8', offset, end), end + 1];
}

function parseErrorFields(body: Buffer): Record<string, string> {
  const fields: Record<string, string> = {};
  let off = 0;
  while (off < body.length && body[off] !== 0) {
    const code = String.fromCharCode(body[off]!);
    const [value, next] = readCString(body, off + 1);
    fields[code] = value;
    off = next;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

interface Field {
  name: string;
  typeOid: number;
}

type Pending = {
  resolve: (r: QueryResult) => void;
  reject: (e: unknown) => void;
  fields: Field[];
  rows: Record<string, unknown>[];
  command: string;
  error: PgError | null;
};

export class PgConnection {
  private socket!: net.Socket | tls.TLSSocket;
  private buffer: Buffer = Buffer.alloc(0);
  private waiter: ((m: BackendMessage) => void) | null = null;
  /** During startup/auth, messages are queued and pulled with next(). */
  private authMode = true;
  private inbox: BackendMessage[] = [];
  private pending: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private fatal: Error | null = null;
  broken = false;

  constructor(private readonly opts: PgOptions) {}

  async connect(): Promise<void> {
    const timeout = this.opts.connectTimeoutMs ?? 10_000;
    let socket: net.Socket | tls.TLSSocket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: this.opts.host, port: this.opts.port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error('database connect timeout'));
      }, timeout);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    if (this.opts.ssl !== 'disable') {
      socket.write(new Writer().int32(80877103).untyped());
      const answer = await new Promise<string>((resolve, reject) => {
        socket.once('data', (d: Buffer) => resolve(String.fromCharCode(d[0]!)));
        socket.once('error', reject);
      });
      if (answer !== 'S') throw new Error('database server refused TLS');
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const t = tls.connect({
          socket: socket as net.Socket,
          servername: net.isIP(this.opts.host) ? undefined : this.opts.host,
          rejectUnauthorized: this.opts.ssl === 'require',
          ca: this.opts.sslCaFile ? fs.readFileSync(this.opts.sslCaFile) : undefined,
        });
        t.once('secureConnect', () => resolve(t));
        t.once('error', reject);
      });
    }

    this.socket = socket;
    socket.setNoDelay(true);
    socket.on('data', (d: Buffer) => this.onData(d));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('database connection closed')));

    socket.write(
      new Writer()
        .int32(196608)
        .cstring('user')
        .cstring(this.opts.user)
        .cstring('database')
        .cstring(this.opts.database)
        .cstring('client_encoding')
        .cstring('UTF8')
        .cstring('application_name')
        .cstring('tabeeby')
        .int8(0)
        .untyped(),
    );
    await this.authenticate();
  }

  private fail(err: Error): void {
    if (this.broken) return;
    this.broken = true;
    this.fatal = err;
    const p = this.pending;
    this.pending = null;
    p?.reject(err);
    const w = this.waiter;
    this.waiter = null;
    if (w) w({ type: '!', body: Buffer.alloc(0) });
  }

  private onData(data: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) break;
      const msg: BackendMessage = {
        type: String.fromCharCode(this.buffer[0]!),
        body: this.buffer.subarray(5, length + 1),
      };
      this.buffer = this.buffer.subarray(length + 1);
      this.dispatch(msg);
    }
  }

  private dispatch(msg: BackendMessage): void {
    if (this.authMode) {
      this.inbox.push(msg);
      const w = this.waiter;
      if (w) {
        this.waiter = null;
        w(this.inbox.shift()!);
      }
      return;
    }
    const p = this.pending;
    if (!p) return; // ParameterStatus / Notice outside a query
    switch (msg.type) {
      case 'T': {
        const count = msg.body.readInt16BE(0);
        let off = 2;
        const fields: Field[] = [];
        for (let i = 0; i < count; i++) {
          const [name, next] = readCString(msg.body, off);
          off = next;
          const typeOid = msg.body.readInt32BE(off + 6);
          off += 18;
          fields.push({ name, typeOid });
        }
        p.fields = fields;
        break;
      }
      case 'D': {
        const count = msg.body.readInt16BE(0);
        let off = 2;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) {
          const len = msg.body.readInt32BE(off);
          off += 4;
          const field = p.fields[i]!;
          if (len === -1) {
            row[field.name] = null;
          } else {
            row[field.name] = decodeValue(field.typeOid, msg.body.toString('utf8', off, off + len));
            off += len;
          }
        }
        p.rows.push(row);
        break;
      }
      case 'C':
        p.command = readCString(msg.body, 0)[0];
        break;
      case 'E':
        p.error = new PgError(parseErrorFields(msg.body));
        break;
      case 'Z': {
        this.pending = null;
        if (p.error) p.reject(p.error);
        else {
          const parts = p.command.split(' ');
          const last = Number(parts[parts.length - 1]);
          p.resolve({ rows: p.rows, rowCount: Number.isFinite(last) ? last : p.rows.length, command: parts[0] ?? '' });
        }
        break;
      }
      default:
        break; // '1' ParseComplete, '2' BindComplete, 'n' NoData, 'N' Notice, 'S', 'I'
    }
  }

  private next(): Promise<BackendMessage> {
    return new Promise((resolve, reject) => {
      if (this.fatal) return reject(this.fatal);
      const queued = this.inbox.shift();
      if (queued) return resolve(queued);
      this.waiter = (m) => (m.type === '!' ? reject(this.fatal) : resolve(m));
    });
  }

  private async authenticate(): Promise<void> {
    for (;;) {
      const msg = await this.next();
      if (msg.type === 'E') throw new PgError(parseErrorFields(msg.body));
      if (msg.type === 'Z') {
        this.authMode = false;
        return;
      }
      if (msg.type !== 'R') continue; // ParameterStatus, BackendKeyData, Notice
      const kind = msg.body.readInt32BE(0);
      if (kind === 0) continue; // AuthenticationOk
      if (kind === 3) {
        this.socket.write(new Writer().cstring(this.opts.password).message('p'));
      } else if (kind === 5) {
        const salt = msg.body.subarray(4, 8);
        const inner = crypto.createHash('md5').update(this.opts.password + this.opts.user).digest('hex');
        const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
        this.socket.write(new Writer().cstring('md5' + outer).message('p'));
      } else if (kind === 10) {
        await this.scram(msg.body.subarray(4));
      } else {
        throw new Error(`unsupported database auth method ${kind}`);
      }
    }
  }

  private async scram(mechanismsBody: Buffer): Promise<void> {
    if (!mechanismsBody.toString('utf8').split('\0').includes('SCRAM-SHA-256')) {
      throw new Error('server does not offer SCRAM-SHA-256');
    }
    const clientNonce = crypto.randomBytes(18).toString('base64');
    const clientFirstBare = `n=*,r=${clientNonce}`;
    const clientFirst = Buffer.from('n,,' + clientFirstBare, 'utf8');
    this.socket.write(new Writer().cstring('SCRAM-SHA-256').int32(clientFirst.length).bytes(clientFirst).message('p'));

    const cont = await this.next();
    if (cont.type === 'E') throw new PgError(parseErrorFields(cont.body));
    const serverFirst = cont.body.subarray(4).toString('utf8');
    const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
    const nonce = attrs['r'] ?? '';
    const salt = Buffer.from(attrs['s'] ?? '', 'base64');
    const iterations = Number(attrs['i']);
    if (!nonce.startsWith(clientNonce) || !iterations) throw new Error('invalid SCRAM server-first message');

    const salted = crypto.pbkdf2Sync(this.opts.password.normalize('NFKC'), salt, iterations, 32, 'sha256');
    const hmac = (key: Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest();
    const clientKey = hmac(salted, 'Client Key');
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    const clientFinalNoProof = `c=biws,r=${nonce}`;
    const authMessage = `${clientFirstBare},${serverFirst},${clientFinalNoProof}`;
    const clientSignature = hmac(storedKey, authMessage);
    const proof = Buffer.alloc(clientKey.length);
    for (let i = 0; i < clientKey.length; i++) proof[i] = clientKey[i]! ^ clientSignature[i]!;
    this.socket.write(new Writer().bytes(Buffer.from(`${clientFinalNoProof},p=${proof.toString('base64')}`)).message('p'));

    const final = await this.next();
    if (final.type === 'E') throw new PgError(parseErrorFields(final.body));
    const serverFinal = final.body.subarray(4).toString('utf8');
    const expected = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
    if (serverFinal !== `v=${expected}`) throw new Error('database server signature mismatch');
  }

  /** Parameterised query via the extended protocol. */
  query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<R>> {
    const run = () =>
      new Promise<QueryResult>((resolve, reject) => {
        if (this.fatal) return reject(this.fatal);
        this.pending = { resolve, reject, fields: [], rows: [], command: '', error: null };
        const bind = new Writer().cstring('').cstring('').int16(0).int16(params.length);
        for (const p of params) {
          const enc = encodeParam(p);
          if (enc === null) bind.int32(-1);
          else {
            const b = Buffer.from(enc, 'utf8');
            bind.int32(b.length).bytes(b);
          }
        }
        bind.int16(0);
        this.socket.write(
          Buffer.concat([
            new Writer().cstring('').cstring(text).int16(0).message('P'),
            bind.message('B'),
            new Writer().int8('P'.charCodeAt(0)).cstring('').message('D'),
            new Writer().cstring('').int32(0).message('E'),
            new Writer().message('S'),
          ]),
        );
      });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result as Promise<QueryResult<R>>;
  }

  /** Simple query protocol: allows multiple statements, no parameters. Migrations only. */
  simpleQuery(text: string): Promise<QueryResult> {
    const run = () =>
      new Promise<QueryResult>((resolve, reject) => {
        if (this.fatal) return reject(this.fatal);
        this.pending = { resolve, reject, fields: [], rows: [], command: '', error: null };
        this.socket.write(new Writer().cstring(text).message('Q'));
      });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  async end(): Promise<void> {
    if (this.broken) return;
    this.broken = true;
    try {
      this.socket.end(new Writer().message('X'));
    } catch {
      /* already closed */
    }
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

export interface PoolClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  simpleQuery(text: string): Promise<QueryResult>;
  release(destroy?: boolean): void;
}

export class PgPool {
  private idle: PgConnection[] = [];
  private total = 0;
  private waiters: ((c: PgConnection) => void)[] = [];
  private closed = false;

  constructor(
    private readonly opts: PgOptions,
    private readonly max: number,
  ) {}

  static fromUrl(url: string, ssl: PgOptions['ssl'], max: number, sslCaFile?: string): PgPool {
    const parsed = parseConnectionString(url);
    let mode = ssl;
    if (parsed.sslmode === 'require' || parsed.sslmode === 'verify-full') mode = 'require';
    if (parsed.sslmode === 'no-verify') mode = 'no-verify';
    const { sslmode: _ignored, ...rest } = parsed;
    return new PgPool({ ...rest, ssl: mode, sslCaFile }, max);
  }

  private async acquire(): Promise<PgConnection> {
    if (this.closed) throw new Error('pool is closed');
    while (this.idle.length) {
      const c = this.idle.pop()!;
      if (!c.broken) return c;
      this.total--;
    }
    if (this.total < this.max) {
      this.total++;
      const c = new PgConnection(this.opts);
      try {
        await c.connect();
        return c;
      } catch (e) {
        this.total--;
        throw e;
      }
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private giveBack(c: PgConnection, destroy: boolean): void {
    if (destroy || c.broken || this.closed) {
      void c.end();
      this.total--;
      const w = this.waiters.shift();
      if (w) this.acquire().then(w, () => undefined);
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c);
    else this.idle.push(c);
  }

  async connect(): Promise<PoolClient> {
    const c = await this.acquire();
    let released = false;
    return {
      query: (t, p) => c.query(t, p),
      simpleQuery: (t) => c.simpleQuery(t),
      release: (destroy = false) => {
        if (released) return;
        released = true;
        this.giveBack(c, destroy);
      },
    };
  }

  async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<R>> {
    const client = await this.connect();
    try {
      return await client.query<R>(text, params);
    } catch (e) {
      client.release(!(e instanceof PgError));
      throw e;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    this.closed = true;
    await Promise.all(this.idle.map((c) => c.end()));
    this.idle = [];
  }
}
