import type { IncomingMessage } from 'node:http';
import { badRequest, payloadTooLarge } from './errors.js';

export type FormFields = Record<string, string[]>;

export interface UploadedFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > limit) throw payloadTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw payloadTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function parseUrlEncoded(body: Buffer): FormFields {
  const fields: FormFields = {};
  for (const [k, v] of new URLSearchParams(body.toString('utf8'))) {
    (fields[k] ??= []).push(v);
  }
  return fields;
}

const MAX_PARTS = 60;

/**
 * Parses multipart/form-data that has already been read into memory (the
 * caller enforces the size limit). Only what the app needs: text fields and
 * files, no nested multipart.
 */
export function parseMultipart(body: Buffer, contentType: string): { fields: FormFields; files: UploadedFile[] } {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundaryValue = match?.[1] ?? match?.[2];
  if (!boundaryValue || boundaryValue.length > 70) throw badRequest();
  const boundary = Buffer.from('--' + boundaryValue);
  const fields: FormFields = {};
  const files: UploadedFile[] = [];

  let pos = body.indexOf(boundary);
  if (pos !== 0) throw badRequest();
  let parts = 0;
  for (;;) {
    pos += boundary.length;
    if (body.subarray(pos, pos + 2).toString() === '--') break; // final boundary
    if (body.subarray(pos, pos + 2).toString() !== '\r\n') throw badRequest();
    pos += 2;
    if (++parts > MAX_PARTS) throw badRequest();
    const headerEnd = body.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) throw badRequest();
    const headers = body.subarray(pos, headerEnd).toString('utf8').split('\r\n');
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headerEnd + 4);
    if (next === -1) throw badRequest();
    const content = body.subarray(headerEnd + 4, next);

    let name = '';
    let filename: string | null = null;
    let partType = 'text/plain';
    for (const h of headers) {
      const [rawKey, ...rest] = h.split(':');
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'content-disposition') {
        name = /\bname="([^"]*)"/i.exec(value)?.[1] ?? '';
        const fn = /\bfilename="([^"]*)"/i.exec(value);
        if (fn) filename = fn[1] ?? '';
      } else if (key === 'content-type') {
        partType = value.toLowerCase();
      }
    }
    if (!name) throw badRequest();
    if (filename !== null) {
      if (content.length > 0) {
        files.push({ field: name, filename: filename.replace(/[^\w.\- ]/g, '_').slice(0, 120), contentType: partType, data: Buffer.from(content) });
      }
    } else {
      (fields[name] ??= []).push(content.toString('utf8'));
    }
    pos = next + 2;
  }
  return { fields, files };
}

export function field(fields: FormFields, name: string): string {
  return (fields[name]?.[0] ?? '').trim();
}

export function fieldAll(fields: FormFields, name: string): string[] {
  return (fields[name] ?? []).map((v) => v.trim()).filter(Boolean);
}
