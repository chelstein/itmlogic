// Build / commit signature.  Resolved at module load.
//
// Resolution order:
//   1. process.env.GIT_COMMIT_SHA       (set by CI / Docker build args)
//   2. .git/HEAD reading                (local dev)
//   3. 'uncommitted'                    (fallback)
//
// engine_signature is recorded on every exhibit so a saved JSON can be
// audited later: same engine version + same curve dataset hash + same
// git hash MUST produce the same numbers.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE_MODULE  = 'genoa-engine';
export const ENGINE_VERSION = '2.0.0';

let _hash = process.env.GIT_COMMIT_SHA || null;
if (!_hash){
  try {
    let dir = __dirname;
    for (let i = 0; i < 10; i++){
      const head = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(head)){
        const ref = fs.readFileSync(head, 'utf8').trim();
        if (ref.startsWith('ref: ')){
          const refPath = path.join(dir, '.git', ref.slice(5).trim());
          if (fs.existsSync(refPath)) _hash = fs.readFileSync(refPath, 'utf8').trim();
        } else {
          _hash = ref;
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { _hash = null; }
}
if (!_hash) _hash = 'uncommitted';

export const ENGINE_SIGNATURE = Object.freeze({
  module:  ENGINE_MODULE,
  version: ENGINE_VERSION,
  hash:    _hash,
  node:    process.versions?.node || 'unknown'
});
