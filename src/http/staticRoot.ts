import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The public/ folder: src/http/ when run with tsx, dist/src/http/ when compiled. */
export const staticRoot =
  [path.resolve(here, '../../public'), path.resolve(here, '../../../public')].find((p) => fs.existsSync(p)) ?? path.resolve('public');
