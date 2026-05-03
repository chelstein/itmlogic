// PDF exporter — intentionally not implemented in this revision.
// The architecture is wired so the route GET /api/exhibits/:id/export/pdf
// will resolve as soon as a real renderer is dropped into this module.
//
// Implementation plan (do NOT silently substitute):
//   1. Use a deterministic renderer (e.g. headless chrome printing the
//      narrative HTML, or pdfkit with the TXT exporter rendered into
//      page templates).
//   2. Pin the renderer version into exhibit.method_versions.
//   3. Carry the same warnings + filing_readiness onto the cover page.
//   4. The PDF is an export, never a recomputation.

import { W } from '../../types/warnings.js';

export function exportPdf(_exhibit){
  const err = new Error('PDF export is not implemented yet. Use JSON / TXT / GeoJSON.');
  err.code = 'PDF_NOT_IMPLEMENTED';
  err.warning = W.make('FCC_METHOD_MISSING', 'PDF export route exists but renderer is not implemented in this revision.');
  err.http_status = 501;
  throw err;
}

export const PDF_CONTENT_TYPE = 'application/pdf';
