// Shared report utilities
import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeReport(outDir, filename, content) {
  ensureDir(outDir);
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// Rough token estimate: chars / 4
export function estimateTokens(str) {
  return Math.ceil((str || '').length / 4);
}
