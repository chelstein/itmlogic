// PDF renderer for the engineering report — pdfkit-based, Letter size,
// 0.75" margins, Times-Roman 10.5pt body, Times-Bold 12pt section
// headers.  Output target: 4–7 pages for a typical exhibit, matching
// the visual density of a Hatfield-Dawson FCC filing.
//
// LAYOUT
//   Page 1     — cover (logo, title, station info card)
//   Page 2     — table of contents (auto-generated from bufferedPages)
//   Page 3+    — sections in continuous flow.  Each section starts with
//                a subtle amber rule + heading; the body flows under it.
//                addPage() only runs when remaining vertical space drops
//                below a threshold (avoid orphan headings) — never per
//                section.
//   Every page after the cover carries a header (station call · facility
//   ID · "FCC Propagation Studio") and a footer (compliance line · page
//   number) drawn in a final pass via bufferedPageRange.

import PDFDocument from 'pdfkit';

const PT_PER_INCH   = 72;
const MARGIN        = 0.75 * PT_PER_INCH;     // 54pt
const HEADER_AREA   = 30;                     // pt reserved at top for page header
const FOOTER_AREA   = 30;                     // pt reserved at bottom for page footer
const MIN_BLOCK     = 90;                     // min remaining height before a heading (orphan guard)
const RULE_GAP      = 4;                      // gap between section rule and heading
const SECTION_GAP   = 14;                     // vertical gap between sections

const BODY_FONT     = 'Times-Roman';
const BOLD_FONT     = 'Times-Bold';
const ITALIC_FONT   = 'Times-Italic';
const MONO_FONT     = 'Courier';
const BODY_SIZE     = 10.5;
const HEADING_SIZE  = 12;
const TITLE_SIZE    = 24;
const SUBTITLE_SIZE = 13;
const FOOTER_SIZE   = 8.5;

// Brand colors (matched to the workbench palette).
const AMBER     = '#c4745a';
const AMBER_HI  = '#f3c86d';
const TEAL_DARK = '#1c2e3a';
const TEXT_DIM  = '#666666';

const FOOTER_TEXT = 'Genoa FCC Propagation Studio';

// PDFKit's built-in Times-Roman / Helvetica / Courier fonts use WinAnsi
// encoding, which does NOT include arrow / dash / quote glyphs above
// U+007E.  When upstream section builders emit "→", "↔", smart quotes,
// etc., pdfkit silently substitutes garbage glyphs (we have seen
// "→" render as "!'" in filed exhibits — unacceptable for a
// customer-facing FCC document).  This fold maps the small set of
// Unicode chars that section builders actually emit down to ASCII
// equivalents the PDF font can render.  The plain-text export keeps
// the original Unicode (UTF-8 in .txt survives fine).
const PDF_UNICODE_FOLD = {
  '→': '->',    // → right arrow
  '←': '<-',    // ← left arrow
  '↔': '<->',   // ↔ left-right arrow
  '–': '-',     // – en dash
  '—': '--',    // — em dash
  '‘': "'",     // ‘
  '’': "'",     // ’
  '“': '"',     // “
  '”': '"',     // ”
  '…': '...',   // …
  // Greek letters that the section builders sometimes emit.  PDFKit's
  // base-14 Times-Roman uses WinAnsi encoding which has NO Greek
  // glyphs above U+007E; without these mappings the rendered output
  // is garbage AND the surrounding ASCII gets mangled because the
  // missing-glyph substitution shifts the content-stream byte
  // positions.  Add new letters here as section builders adopt them.
  'Δ': 'delta', // Δ (U+0394) — "max |Δ|" in parity outputs
  'δ': 'delta', // δ (U+03B4)
  'σ': 'sigma', // σ (U+03C3) — ground conductivity (when it leaks past the AM-only inputs)
  'π': 'pi',    // π (U+03C0)
  'μ': 'u',     // μ (U+03BC) — micro, e.g. µV/m
  'Ω': 'ohm',   // Ω (U+03A9)
  'λ': 'lambda',// λ (U+03BB) — wavelength
  'θ': 'theta', // θ (U+03B8) — angle
  'φ': 'phi',   // φ (U+03C6) — phase
  'ε': 'epsilon', // ε (U+03B5) — permittivity (NEC EPR)
  'Σ': 'Sigma',   // Σ (U+03A3) — RSS sum
  'α': 'alpha',   // α (U+03B1)
  'β': 'beta',    // β (U+03B2)
  'γ': 'gamma',   // γ (U+03B3)
  'ω': 'omega',   // ω (U+03C9) — angular frequency
  // Latin subscript letters (U+1D62…U+1D6A) — used for εᵣ, σᵧ, etc.
  // PDFKit base-14 fonts have no glyph and silently shift bytes when
  // encountered; adding them here keeps the content stream aligned.
  'ᵢ': '_i', 'ᵣ': '_r', 'ᵤ': '_u', 'ᵥ': '_v',
  'ₐ': '_a', 'ₑ': '_e', 'ₒ': '_o', 'ₓ': '_x',
  // Common technical glyphs that have crept into section builders.
  '²': '^2',  '³': '^3',  '⁻¹': '^-1', '½': '1/2',
  '·': '.',   // U+00B7 middle dot (we render KV separators with dots elsewhere)
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '±': '+/-',
  '⋅': '.',
  '°': ' deg',
  'µ': 'u',   // U+00B5 micro sign (distinct from Greek μ U+03BC)
  '∞': 'inf'
};
function pdfSafeText(s){
  if (typeof s !== 'string') return s;
  return s.replace(
    /[→←↔–—‘’“”…ΔδσπμΩλθφεΣαβγωᵢᵣᵤᵥₐₑₒₓ²³½·≤≥≠≈±⋅°µ∞]/g,
    (ch) => PDF_UNICODE_FOLD[ch] || ch
  );
}

export async function renderEngineeringReportPdf(doc){
  if (!doc || !Array.isArray(doc.sections)){
    throw new Error('renderEngineeringReportPdf: invalid document model');
  }
  const meta = doc.meta || {};
  const pdf = new PDFDocument({
    size:        'LETTER',
    margins:     { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title:    meta.title || 'Engineering Statement',
      Author:   meta.generated_by || FOOTER_TEXT,
      Subject:  meta.station ? pdfSafeText(`FCC propagation study — ${meta.station}`) : 'FCC propagation study',
      Keywords: 'FCC, propagation, broadcast engineering, Genoa'
    }
  });
  // Route every text write through the Unicode-to-WinAnsi fold so the
  // base-14 PDF fonts never receive glyphs they cannot render.
  const _origText = pdf.text.bind(pdf);
  pdf.text = function patchedText(text, ...rest){
    return _origText(pdfSafeText(text), ...rest);
  };
  const chunks = [];
  pdf.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    pdf.on('end',   () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const tocEntries = [];
  const sections = doc.sections;

  if (sections[0]?.type === 'cover'){
    renderCover(pdf, sections[0], meta);
  }
  pdf.addPage();
  const tocPageIdx = pdf.bufferedPageRange().count - 1;
  pdf.addPage();

  for (let i = 0; i < sections.length; i++){
    const s = sections[i];
    if (s.type === 'cover') continue;
    if (i > 1) maybeBreak(pdf);
    if (s.heading){
      tocEntries.push({
        heading:        s.heading,
        exhibit_number: s.exhibit_number || null,
        pageIdx:        pdf.bufferedPageRange().count - 1
      });
    }
    renderSectionInFlow(pdf, s, meta);
  }

  pdf.switchToPage(tocPageIdx);
  renderToc(pdf, tocEntries);

  const range = pdf.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++){
    pdf.switchToPage(p);
    if (p > 0){
      drawPageHeader(pdf, meta);
    }
    drawPageFooter(pdf, meta, p, range.count);
  }

  pdf.end();
  return done;
}

function renderCover(pdf, s, meta){
  const w = pdf.page.width;
  const h = pdf.page.height;
  const cx = w / 2;

  const markY = MARGIN + 60;
  drawSailMark(pdf, cx, markY, 56);

  pdf.font(BOLD_FONT).fontSize(TITLE_SIZE).fillColor('black')
     .text((s.heading || 'ENGINEERING STATEMENT').toUpperCase(), MARGIN, markY + 90, {
        width: w - 2 * MARGIN, align: 'center'
     });
  pdf.moveDown(0.2);
  pdf.font(ITALIC_FONT).fontSize(SUBTITLE_SIZE).fillColor(TEXT_DIM)
     .text(meta?.subtitle || 'FCC Propagation Study', { align: 'center' });

  let y = pdf.y + 20;
  pdf.strokeColor(AMBER).lineWidth(1.5).moveTo(MARGIN + 100, y).lineTo(w - MARGIN - 100, y).stroke();
  y += 3;
  pdf.strokeColor(AMBER_HI).lineWidth(0.5).moveTo(MARGIN + 140, y).lineTo(w - MARGIN - 140, y).stroke();

  pdf.fillColor('black');
  const cardTop = h * 0.42;
  pdf.font(BOLD_FONT).fontSize(20).fillColor(TEAL_DARK)
     .text(meta?.station || '', MARGIN, cardTop, { width: w - 2 * MARGIN, align: 'center' });

  if (meta?.community){
    pdf.font(BODY_FONT).fontSize(11).fillColor(TEXT_DIM)
       .text(meta.community, { align: 'center' });
  }

  pdf.moveDown(1.2);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  renderKv(pdf, s.rows, { center: true, labelMin: 180, narrow: true });

  pdf.font(ITALIC_FONT).fontSize(10).fillColor(TEXT_DIM)
     .text(meta?.generated_by || FOOTER_TEXT, MARGIN, h - MARGIN - 40,
           { width: w - 2 * MARGIN, align: 'center' });
  pdf.font(BODY_FONT).fontSize(9)
     .text(`Generated ${meta?.generated_at || new Date().toISOString()}`,
           { align: 'center' });
}

function drawSailMark(pdf, cx, cy, size){
  const r = size / 2;
  pdf.save();
  pdf.circle(cx, cy, r).fillAndStroke(TEAL_DARK, AMBER);
  pdf.lineWidth(1.6).strokeColor('#f4eee0')
     .moveTo(cx - r * 0.32, cy - r * 0.83).lineTo(cx - r * 0.32, cy + r * 0.83).stroke();
  pdf.lineWidth(1.2).strokeColor('#6fd3ff')
     .moveTo(cx - r * 0.32, cy - r * 0.83).lineTo(cx - r * 0.32, cy - r * 0.55).stroke();
  pdf.lineWidth(1.1).strokeColor(TEAL_DARK)
     .moveTo(cx - r * 0.32, cy - r * 0.78)
     .bezierCurveTo(cx + r * 0.40, cy - r * 0.45,
                    cx + r * 0.78, cy + r * 0.13,
                    cx + r * 0.56, cy + r * 0.69)
     .lineTo(cx - r * 0.32, cy + r * 0.69)
     .closePath()
     .fillAndStroke(AMBER_HI, TEAL_DARK);
  pdf.restore();
  pdf.fillColor('black').strokeColor('black').lineWidth(1);
}

function renderToc(pdf, entries){
  const w = pdf.page.width;
  pdf.fillColor('black');
  pdf.font(BOLD_FONT).fontSize(16)
     .text('CONTENTS', MARGIN, MARGIN + HEADER_AREA, { width: w - 2 * MARGIN });
  let y = pdf.y + 4;
  pdf.strokeColor(AMBER).lineWidth(0.8).moveTo(MARGIN, y).lineTo(w - MARGIN, y).stroke();
  pdf.y = y + 10;

  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  for (const e of entries){
    const startY = pdf.y;
    const label = e.exhibit_number
      ? `Exhibit ${e.exhibit_number}.  ${e.heading}`
      : e.heading;
    pdf.font(e.exhibit_number ? BOLD_FONT : BODY_FONT)
       .text(label, MARGIN + 4, startY, {
         width: w - 2 * MARGIN - 60, continued: false, lineBreak: false
       });
    pdf.font(BOLD_FONT).text(String(e.pageIdx + 1), MARGIN, startY, {
      width: w - 2 * MARGIN - 4, align: 'right', lineBreak: false
    });
    pdf.y = startY + 16;
  }
}

function maybeBreak(pdf){
  pdf.y = Math.max(pdf.y, MARGIN);
  const remaining = pdf.page.height - MARGIN - FOOTER_AREA - pdf.y;
  if (remaining < MIN_BLOCK){
    pdf.addPage();
  } else {
    pdf.y += SECTION_GAP;
  }
}

function renderSectionInFlow(pdf, s, meta){
  const w = pdf.page.width;
  if (s.heading){
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    const headingText = s.exhibit_number
      ? `EXHIBIT ${s.exhibit_number} — ${s.heading.toUpperCase()}`
      : s.heading.toUpperCase();
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(headingText, MARGIN, pdf.y, {
         width: w - 2 * MARGIN, characterSpacing: 0.4
       });
    pdf.fillColor('black').moveDown(0.4);
  }
  switch (s.type){
    case 'kv':
      renderKv(pdf, s.rows);
      break;
    case 'paragraphs':
      renderParagraphs(pdf, s.paragraphs);
      break;
    case 'paragraphs-with-kv':
      renderParagraphs(pdf, s.paragraphs);
      pdf.moveDown(0.5);
      renderKv(pdf, s.rows);
      break;
    case 'table':
      if (s.preface){ renderParagraphs(pdf, [s.preface]); pdf.moveDown(0.5); }
      renderTable(pdf, s.table);
      break;
    case 'table-with-summary':
      if (s.preface){ renderParagraphs(pdf, [s.preface]); pdf.moveDown(0.5); }
      renderTable(pdf, s.table);
      if (s.summary){ pdf.moveDown(0.5); renderParagraphs(pdf, [s.summary]); }
      if (s.alternate){ pdf.moveDown(0.5); renderParagraphs(pdf, [s.alternate]); }
      break;
    case 'verdict':
      renderVerdict(pdf, s.verdict);
      break;
    case 'considerations':
      if (s.preface){ renderParagraphs(pdf, [s.preface]); pdf.moveDown(0.5); }
      if (Array.isArray(s.kvRows) && s.kvRows.length){
        renderKv(pdf, s.kvRows);
        pdf.moveDown(0.5);
      }
      if (s.summary){ renderParagraphs(pdf, [s.summary]); pdf.moveDown(0.5); }
      if (s.table) renderTable(pdf, s.table);
      break;
    case 'conclusion':
      renderConclusion(pdf, s);
      break;
    case 'certification':
      renderCertification(pdf, s);
      break;
    case 'image':
      renderImage(pdf, s);
      break;
    case 'polar-chart':
      renderPolarChart(pdf, s);
      break;
    case 'scatter-chart':
      renderScatterChart(pdf, s);
      break;
    case 'polygon-overlay':
      renderPolygonOverlay(pdf, s);
      break;
    default:
      if (Array.isArray(s.rows)) renderKv(pdf, s.rows);
      else if (Array.isArray(s.paragraphs)) renderParagraphs(pdf, s.paragraphs);
      else if (s.table) renderTable(pdf, s.table);
      break;
  }
}

function drawPageHeader(pdf, meta){
  const w = pdf.page.width;
  const y = MARGIN - 20;
  const m = pdf.page.margins;
  const saved = { top: m.top, bottom: m.bottom };
  m.top = 0; m.bottom = 0;
  pdf.save();
  pdf.font(BODY_FONT).fontSize(FOOTER_SIZE).fillColor(TEXT_DIM);
  const left  = `${meta?.station || ''}${meta?.facility_id ? '  ·  Facility ' + meta.facility_id : ''}`;
  const right = meta?.subtitle || 'FCC Propagation Study';
  pdf.text(left,  MARGIN, y, { width: (w - 2 * MARGIN) / 2, align: 'left',  lineBreak: false });
  pdf.text(right, MARGIN, y, { width:  w - 2 * MARGIN,      align: 'right', lineBreak: false });
  pdf.strokeColor(AMBER).lineWidth(0.4)
     .moveTo(MARGIN, y + 12).lineTo(w - MARGIN, y + 12).stroke();
  pdf.fillColor('black').strokeColor('black').lineWidth(1);
  pdf.restore();
  m.top = saved.top; m.bottom = saved.bottom;
}

function drawPageFooter(pdf, meta, pageNum, totalPages){
  const w = pdf.page.width;
  const h = pdf.page.height;
  const y = h - MARGIN + 14;
  const m = pdf.page.margins;
  const saved = { top: m.top, bottom: m.bottom };
  m.top = 0; m.bottom = 0;
  pdf.save();
  pdf.font(BODY_FONT).fontSize(FOOTER_SIZE).fillColor(TEXT_DIM);
  pdf.text(meta?.footer || FOOTER_TEXT, MARGIN, y,
           { width: w - 2 * MARGIN, align: 'left', lineBreak: false });
  pdf.text(`Page ${pageNum + 1} of ${totalPages}`, MARGIN, y,
           { width: w - 2 * MARGIN, align: 'right', lineBreak: false });
  pdf.fillColor('black').strokeColor('black');
  pdf.restore();
  m.top = saved.top; m.bottom = saved.bottom;
}

function renderKv(pdf, rows, opts = {}){
  if (!Array.isArray(rows)) return;
  const items = rows.filter(Boolean).map(r => Array.isArray(r) ? r : [r.label || r.key || '', r.value || '']);
  if (!items.length) return;
  const w   = pdf.page.width - 2 * MARGIN;
  const lw  = Math.min(opts.narrow ? 200 : 240,
                       Math.max(opts.labelMin || 60,
                                Math.max(...items.map(([k]) => textWidth(pdf, String(k), BOLD_FONT, BODY_SIZE))) + 12));
  pdf.fontSize(BODY_SIZE);
  for (const [k, v] of items){
    if (pageBottomReached(pdf)) pdf.addPage();
    const startY = pdf.y;
    pdf.font(BOLD_FONT).fillColor('black')
       .text(String(k), MARGIN, startY, { width: lw, continued: false });
    const keyEndY = pdf.y;
    pdf.font(BODY_FONT)
       .text(String(v == null ? '' : v), MARGIN + lw, startY, { width: w - lw });
    pdf.y = Math.max(keyEndY, pdf.y) + 1;
  }
}

function renderParagraphs(pdf, paragraphs){
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  const w = pdf.page.width - 2 * MARGIN;
  for (const p of (paragraphs || [])){
    if (pageBottomReached(pdf)) pdf.addPage();
    pdf.text(String(p), MARGIN, pdf.y, { width: w, align: 'left' });
    pdf.moveDown(0.5);
  }
}

function renderTable(pdf, table){
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return;
  const w = pdf.page.width - 2 * MARGIN;
  const cols = table.columns;
  const widths = cols.map(c => Math.max(40, Math.floor(w * (Number(c.width) || (1 / cols.length)))));

  drawTableHeader(pdf, cols, widths);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE - 0.5);
  for (const r of table.rows){
    if (pdf.y > pdf.page.height - MARGIN - FOOTER_AREA - 30){
      pdf.addPage();
      drawTableHeader(pdf, cols, widths);
      pdf.font(BODY_FONT).fontSize(BODY_SIZE - 0.5);
    }
    let rx = MARGIN;
    const ry = pdf.y;
    let maxBottom = ry;
    for (let i = 0; i < cols.length; i++){
      pdf.text(formatCell(r[cols[i].key]), rx + 2, ry, {
        width: widths[i] - 4, align: cols[i].align || 'left'
      });
      maxBottom = Math.max(maxBottom, pdf.y);
      pdf.y = ry;
      rx += widths[i];
    }
    pdf.y = maxBottom + 1.5;
  }
  pdf.fontSize(BODY_SIZE);
}

function drawTableHeader(pdf, cols, widths){
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE - 1).fillColor(TEAL_DARK);
  let x = MARGIN;
  const y = pdf.y;
  // Track the bottom of the tallest (multi-line-wrapped) header cell so
  // the underline rule and first data row clear ALL header lines.  Each
  // column write resets pdf.y back to the top of the header band, so a
  // wrapped-to-2-lines label like "D/U Req (dB)" would otherwise be
  // followed by data overlapping the second header line.  Mirrors the
  // maxBottom pattern in the row loop below.
  let maxBottom = y;
  for (let i = 0; i < cols.length; i++){
    pdf.text(cols[i].label || cols[i].key, x + 2, y, {
      width: widths[i] - 4, align: cols[i].align || 'left'
    });
    maxBottom = Math.max(maxBottom, pdf.y);
    pdf.y = y;
    x += widths[i];
  }
  const ruleY = maxBottom + 2;
  pdf.moveTo(MARGIN, ruleY).lineTo(MARGIN + widths.reduce((a, b) => a + b, 0), ruleY)
     .strokeColor(AMBER).lineWidth(0.5).stroke();
  pdf.strokeColor('black').fillColor('black');
  pdf.y = ruleY + 3;
}

function renderVerdict(pdf, v){
  if (!v) return;
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor('black')
     .text(`Status: ${v.status || '—'}    Confidence: ${v.confidence || '—'}`);
  pdf.moveDown(0.4);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE);
  for (const c of (v.components || [])){
    if (pageBottomReached(pdf)) pdf.addPage();
    pdf.font(BOLD_FONT).text(`• ${c.name}: ${c.status}`, { continued: false });
    if (c.detail){
      pdf.font(BODY_FONT).text(c.detail, { indent: 14 });
    }
  }
  if (v.interpretation){
    pdf.moveDown(0.4);
    pdf.font(BODY_FONT).text(v.interpretation, { align: 'left' });
  }
  if (Array.isArray(v.limitations) && v.limitations.length){
    pdf.moveDown(0.4);
    pdf.font(BOLD_FONT).text('Limitations:');
    pdf.font(BODY_FONT);
    for (const l of v.limitations) pdf.text(`• ${l}`, { indent: 14 });
  }
}

function renderConclusion(pdf, s){
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor(TEAL_DARK)
     .text(`Conclusion: ${(s.status || '').toString().toUpperCase()}`);
  pdf.fillColor('black').moveDown(0.4);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).text(s.narrative || '', { align: 'left' });
  if (Array.isArray(s.findings) && s.findings.length){
    pdf.moveDown(0.4);
    pdf.font(BOLD_FONT).text('Findings:');
    pdf.font(BODY_FONT);
    for (const f of s.findings){
      pdf.text(`• [${f.severity}] ${f.code}: ${f.message}`, { indent: 14 });
    }
  }
}

function renderCertification(pdf, s){
  if (s.sealed === true){
    if (s.statement){
      pdf.font(ITALIC_FONT).fontSize(BODY_SIZE).fillColor('black')
         .text(s.statement, { align: 'left' });
      pdf.moveDown(0.7);
    }
    renderKv(pdf, s.fields);
    if (s.footer){
      pdf.moveDown(0.7);
      pdf.font(BODY_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
         .text(s.footer, { align: 'left' });
      pdf.fillColor('black');
    }
  } else {
    if (s.boilerplate){
      pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black')
         .text(s.boilerplate, { align: 'left' });
      pdf.moveDown(0.7);
    }
    renderKv(pdf, s.fields);
  }
}

function pageBottomReached(pdf){
  return pdf.y > pdf.page.height - MARGIN - FOOTER_AREA - 12;
}

// Render an image section.  `image_buffer` is a Node Buffer; pdfkit
// accepts it directly via pdf.image().  We force the image onto its
// own page so the contour map gets a clean print frame, and reserve
// ~80pt at the bottom for the caption + footer.
function renderImage(pdf, s){
  const buf = s.image_buffer;
  if (!buf || !Buffer.isBuffer(buf)){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(image buffer missing)', { align: 'left' });
    return;
  }
  pdf.addPage();
  if (s.heading){
    const w = pdf.page.width;
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    const headingText = s.exhibit_number
      ? `EXHIBIT ${s.exhibit_number} — ${s.heading.toUpperCase()}`
      : s.heading.toUpperCase();
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(headingText, MARGIN, pdf.y, { width: w - 2 * MARGIN, characterSpacing: 0.4 });
    pdf.fillColor('black').moveDown(0.4);
  }
  const w = pdf.page.width  - 2 * MARGIN;
  const captionH = s.caption ? 56 : 12;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  pdf.image(buf, MARGIN, pdf.y, { fit: [w, Math.max(220, availH)], align: 'center' });
  pdf.y = pdf.y + Math.max(220, availH) + 6;
  if (s.caption){
    pdf.font(ITALIC_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
       .text(s.caption, MARGIN, pdf.y, { width: w, align: 'left' });
    pdf.fillColor('black');
  }
}

// ────────────────────────────────────────────────────────────────────
// Vector charts — pure pdfkit primitives, no PNG round-trip, no
// external sidecar.  Data lives in exhibit.evidence and is shaped
// by the section builders.
// ────────────────────────────────────────────────────────────────────

function renderChartHeader(pdf, s){
  pdf.addPage();
  if (s.heading){
    const w = pdf.page.width;
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(s.heading.toUpperCase(), MARGIN, pdf.y, { width: w - 2 * MARGIN, characterSpacing: 0.4 });
    pdf.fillColor('black').moveDown(0.4);
  }
}

function renderChartCaption(pdf, s, captionY){
  if (!s.caption) return;
  const w = pdf.page.width - 2 * MARGIN;
  pdf.font(ITALIC_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
     .text(s.caption, MARGIN, captionY, { width: w, align: 'left' });
  pdf.fillColor('black');
}

// Polar chart — concentric range rings + radial spokes + the data
// polygon.  Used for AM-night NIF contour where data is an array of
// { azimuth_deg, distance_km } points spanning 0-360°.  Closes the
// polygon by repeating the first point at the end.
function renderPolarChart(pdf, s){
  renderChartHeader(pdf, s);
  const pts = Array.isArray(s.data) ? s.data : [];
  if (pts.length < 3){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(insufficient data to render polar chart)', { align: 'left' });
    return;
  }
  const w = pdf.page.width  - 2 * MARGIN;
  const captionH = s.caption ? 48 : 8;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  const size   = Math.min(w, Math.max(260, availH));
  const cx     = MARGIN + w / 2;
  const cy     = pdf.y + size / 2;
  const radius = (size / 2) - 28;

  // Auto-scale to data max.
  let rMax = 0;
  for (const p of pts){
    const v = Number(p.value);
    if (Number.isFinite(v) && v > rMax) rMax = v;
  }
  if (s.r_max && s.r_max > rMax) rMax = s.r_max;
  if (rMax <= 0) rMax = 1;

  // Range rings — 4 concentric circles at 0.25 / 0.5 / 0.75 / 1.0 R.
  pdf.save();
  pdf.strokeColor('#888').lineWidth(0.3);
  for (let i = 1; i <= 4; i++){
    const r = radius * (i / 4);
    pdf.circle(cx, cy, r).stroke();
  }
  // Range ring labels (along east axis).
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM);
  for (let i = 1; i <= 4; i++){
    const r  = radius * (i / 4);
    const rv = rMax  * (i / 4);
    pdf.text(`${rv.toFixed(rv >= 100 ? 0 : 1)} ${s.r_unit || 'km'}`,
             cx + r + 2, cy - 4, { lineBreak: false });
  }

  // Compass spokes every 30°.
  pdf.strokeColor('#888').lineWidth(0.25);
  for (let az = 0; az < 360; az += 30){
    const rad = (az - 90) * Math.PI / 180;  // 0° = north (up)
    const x2 = cx + radius * Math.cos(rad);
    const y2 = cy + radius * Math.sin(rad);
    pdf.moveTo(cx, cy).lineTo(x2, y2).stroke();
  }
  // Cardinal labels.
  pdf.font(BOLD_FONT).fontSize(8).fillColor(TEAL_DARK);
  const labels = [['N',  0, -radius - 12], ['E',  radius + 6, -4],
                  ['S',  0,  radius + 4],  ['W', -radius - 14, -4]];
  for (const [lab, dx, dy] of labels){
    pdf.text(lab, cx + dx - 3, cy + dy, { lineBreak: false });
  }

  // Data polygon — close it.
  pdf.strokeColor(AMBER).lineWidth(1.2);
  pdf.fillColor(AMBER_HI).opacity(0.18);
  const fillPath = [];
  for (let i = 0; i < pts.length; i++){
    const az = Number(pts[i].azimuth_deg);
    const v  = Number(pts[i].value);
    if (!Number.isFinite(az) || !Number.isFinite(v) || v <= 0) continue;
    const r  = radius * (Math.min(v, rMax) / rMax);
    const rad = (az - 90) * Math.PI / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    fillPath.push([x, y]);
  }
  if (fillPath.length){
    pdf.moveTo(fillPath[0][0], fillPath[0][1]);
    for (let i = 1; i < fillPath.length; i++){
      pdf.lineTo(fillPath[i][0], fillPath[i][1]);
    }
    pdf.closePath().fillAndStroke(AMBER_HI, AMBER);
  }
  pdf.opacity(1).fillColor('black').strokeColor('black');
  pdf.restore();

  pdf.y = cy + size / 2 + 6;
  renderChartCaption(pdf, s, pdf.y);
}

// Scatter chart — axes + grid + plotted points + optional tolerance
// band.  Used for FORTRAN parity (Δkm vs azimuth°).  data items:
// { x: number, y: number, ok?: boolean }.
function renderScatterChart(pdf, s){
  renderChartHeader(pdf, s);
  const pts = Array.isArray(s.data) ? s.data : [];
  if (pts.length === 0){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(no data points to render)', { align: 'left' });
    return;
  }
  const w = pdf.page.width  - 2 * MARGIN;
  const captionH = s.caption ? 48 : 8;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  const plotW = w - 60;
  const plotH = Math.min(availH - 40, 360);
  const x0 = MARGIN + 50;
  const y0 = pdf.y + 8;

  // Compute scales.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts){
    const x = Number(p.x), y = Number(p.y);
    if (Number.isFinite(x)){ if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    if (Number.isFinite(y)){ if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  }
  if (!Number.isFinite(xMin)){ xMin = 0; xMax = 1; }
  if (!Number.isFinite(yMin)){ yMin = -1; yMax = 1; }
  if (Number.isFinite(s.x_min)) xMin = s.x_min;
  if (Number.isFinite(s.x_max)) xMax = s.x_max;
  // Symmetric y-axis when caller passes y_symmetric (e.g. Δkm).
  if (s.y_symmetric){
    const m = Math.max(Math.abs(yMin), Math.abs(yMax), Number(s.tolerance) || 0);
    yMin = -m * 1.1; yMax = m * 1.1;
  }
  if (yMin === yMax){ yMin -= 1; yMax += 1; }
  const sx = (x) => x0 + plotW * (x - xMin) / Math.max(1e-9, xMax - xMin);
  const sy = (y) => y0 + plotH * (1 - (y - yMin) / Math.max(1e-9, yMax - yMin));

  pdf.save();
  // Plot frame.
  pdf.strokeColor('#888').lineWidth(0.4);
  pdf.rect(x0, y0, plotW, plotH).stroke();

  // Grid lines (5 horizontal, 6 vertical) + axis tick labels.
  pdf.strokeColor('#bbb').lineWidth(0.2);
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM);
  for (let i = 1; i < 5; i++){
    const y = y0 + plotH * (i / 5);
    pdf.moveTo(x0, y).lineTo(x0 + plotW, y).stroke();
    const yv = yMin + (yMax - yMin) * (1 - i / 5);
    pdf.text(yv.toFixed(2), x0 - 36, y - 3, { width: 32, align: 'right', lineBreak: false });
  }
  for (let i = 1; i < 6; i++){
    const x = x0 + plotW * (i / 6);
    pdf.moveTo(x, y0).lineTo(x, y0 + plotH).stroke();
    const xv = xMin + (xMax - xMin) * (i / 6);
    pdf.text(xv.toFixed(0), x - 12, y0 + plotH + 4, { width: 24, align: 'center', lineBreak: false });
  }
  // Min/max tick labels.
  pdf.text(yMin.toFixed(2), x0 - 36, y0 + plotH - 3, { width: 32, align: 'right', lineBreak: false });
  pdf.text(yMax.toFixed(2), x0 - 36, y0 - 3,         { width: 32, align: 'right', lineBreak: false });
  pdf.text(xMin.toFixed(0), x0 - 12, y0 + plotH + 4, { width: 24, align: 'center', lineBreak: false });
  pdf.text(xMax.toFixed(0), x0 + plotW - 12, y0 + plotH + 4, { width: 24, align: 'center', lineBreak: false });

  // Tolerance band (when supplied).
  if (Number.isFinite(s.tolerance) && s.tolerance > 0){
    pdf.fillColor(AMBER_HI).opacity(0.12);
    const yTop = sy(s.tolerance);
    const yBot = sy(-s.tolerance);
    pdf.rect(x0, yTop, plotW, yBot - yTop).fill();
    pdf.opacity(1);
    pdf.strokeColor(AMBER).lineWidth(0.3).dash(3, { space: 2 });
    pdf.moveTo(x0, yTop).lineTo(x0 + plotW, yTop).stroke();
    pdf.moveTo(x0, yBot).lineTo(x0 + plotW, yBot).stroke();
    pdf.undash();
  }

  // Zero line.
  if (yMin < 0 && yMax > 0){
    pdf.strokeColor('#555').lineWidth(0.5);
    const yz = sy(0);
    pdf.moveTo(x0, yz).lineTo(x0 + plotW, yz).stroke();
  }

  // Axis labels.
  pdf.font(BODY_FONT).fontSize(8).fillColor(TEAL_DARK);
  if (s.x_label){
    pdf.text(s.x_label, x0, y0 + plotH + 18, { width: plotW, align: 'center', lineBreak: false });
  }
  if (s.y_label){
    pdf.save();
    pdf.rotate(-90, { origin: [x0 - 40, y0 + plotH / 2] });
    pdf.text(s.y_label, x0 - 40 - plotH / 2, y0 + plotH / 2 - 4,
             { width: plotH, align: 'center', lineBreak: false });
    pdf.restore();
  }

  // Plot points.
  for (const p of pts){
    const x = Number(p.x), y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const px = sx(x), py = sy(y);
    const ok = p.ok !== false;
    pdf.fillColor(ok ? AMBER : '#c0392b');
    pdf.circle(px, py, 1.6).fill();
  }
  pdf.fillColor('black').strokeColor('black');
  pdf.restore();

  pdf.y = y0 + plotH + (s.x_label ? 32 : 14);
  renderChartCaption(pdf, s, pdf.y);
}

// Polygon overlay — multiple lat/lon rings + tx marker + scale bar +
// north arrow.  Used for §73.314 terrain-aware coverage where we
// have both the §73.333 free-space contour ring AND the ITM terrain-
// adjusted ring and want to show how terrain warped the coverage.
//
// Section shape:
//   s.tx = { lat, lon }
//   s.polygons = [
//     { ring_latlng: [[lat, lon], ...], label, stroke, fill, fill_opacity, dashed }
//   ]
// Equirectangular projection centered on tx (good for <500 km exhibits;
// preserves direction-from-tx which is what matters for an FCC
// coverage map).  North is up; scale bar bottom-right; legend top-right.
function renderPolygonOverlay(pdf, s){
  renderChartHeader(pdf, s);
  const polys = Array.isArray(s.polygons) ? s.polygons.filter(p => Array.isArray(p?.ring_latlng) && p.ring_latlng.length >= 4) : [];
  const tx    = s.tx;
  if (polys.length === 0 || !tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(no polygons to render — tx coords or rings missing)', { align: 'left' });
    return;
  }
  const txLat = Number(tx.lat), txLon = Number(tx.lon);

  // Equirectangular: x = (lon - txLon) * cos(txLat) * km_per_deg_lon
  //                  y = (lat - txLat) * km_per_deg_lat
  const KM_PER_DEG_LAT = 111.32;
  const cosLat = Math.cos(txLat * Math.PI / 180);
  const KM_PER_DEG_LON = KM_PER_DEG_LAT * cosLat;
  const toKm = ([lat, lon]) => [
    (Number(lon) - txLon) * KM_PER_DEG_LON,
    (Number(lat) - txLat) * KM_PER_DEG_LAT
  ];

  // Find the bounding box in km space.
  let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
  for (const p of polys){
    for (const v of p.ring_latlng){
      const [x, y] = toKm(v);
      if (Number.isFinite(x)){ if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      if (Number.isFinite(y)){ if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    }
  }
  // Add 10% padding + force square.
  const rangeX = Math.max(1, xMax - xMin);
  const rangeY = Math.max(1, yMax - yMin);
  const half   = Math.max(rangeX, rangeY) * 0.55;  // includes padding
  const cxKm = (xMin + xMax) / 2;
  const cyKm = (yMin + yMax) / 2;
  xMin = cxKm - half; xMax = cxKm + half;
  yMin = cyKm - half; yMax = cyKm + half;

  // Plot bounds in PDF space.
  const w = pdf.page.width - 2 * MARGIN;
  const captionH = s.caption ? 56 : 12;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  const plotSize = Math.min(w, Math.max(280, availH - 8));
  const x0 = MARGIN + (w - plotSize) / 2;
  const y0 = pdf.y + 4;
  const xScale = plotSize / (xMax - xMin);
  // y is FLIPPED in PDF space (y grows downward), so y up = larger lat
  const project = ([lat, lon]) => {
    const [xk, yk] = toKm([lat, lon]);
    return [
      x0 + (xk - xMin) * xScale,
      y0 + plotSize - (yk - yMin) * xScale
    ];
  };
  const txPt = project([txLat, txLon]);

  pdf.save();
  // Plot frame.
  pdf.strokeColor('#888').lineWidth(0.4);
  pdf.rect(x0, y0, plotSize, plotSize).stroke();
  // Bounding-box ticks (km).
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM);
  for (let i = 1; i < 4; i++){
    const x = x0 + plotSize * (i / 4);
    const y = y0 + plotSize * (i / 4);
    pdf.strokeColor('#bbb').lineWidth(0.2);
    pdf.moveTo(x, y0).lineTo(x, y0 + plotSize).stroke();
    pdf.moveTo(x0, y).lineTo(x0 + plotSize, y).stroke();
  }
  // Crosshair at tx.
  pdf.strokeColor('#666').lineWidth(0.3).dash(2, { space: 2 });
  pdf.moveTo(txPt[0], y0).lineTo(txPt[0], y0 + plotSize).stroke();
  pdf.moveTo(x0, txPt[1]).lineTo(x0 + plotSize, txPt[1]).stroke();
  pdf.undash();

  // Polygons (back-to-front so first listed renders bottom-most).
  for (const p of polys){
    const path = p.ring_latlng.map(project);
    if (path.length < 3) continue;
    pdf.save();
    if (p.fill){
      pdf.fillColor(p.fill).opacity(Number.isFinite(p.fill_opacity) ? p.fill_opacity : 0.12);
      pdf.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) pdf.lineTo(path[i][0], path[i][1]);
      pdf.closePath().fill();
      pdf.opacity(1);
    }
    pdf.strokeColor(p.stroke || AMBER).lineWidth(p.line_width || 1.0);
    if (p.dashed) pdf.dash(3, { space: 2 });
    pdf.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) pdf.lineTo(path[i][0], path[i][1]);
    pdf.closePath().stroke();
    pdf.undash();
    pdf.restore();
  }

  // Tx marker.
  pdf.fillColor(TEAL_DARK).circle(txPt[0], txPt[1], 2.4).fill();
  pdf.fillColor('white').strokeColor(TEAL_DARK).lineWidth(0.4)
     .circle(txPt[0], txPt[1], 1.0).fillAndStroke();

  // North arrow (top-left of plot).
  const naX = x0 + 14;
  const naY = y0 + 14;
  pdf.strokeColor(TEAL_DARK).lineWidth(0.8).fillColor(TEAL_DARK);
  pdf.moveTo(naX, naY + 12).lineTo(naX, naY - 6).stroke();
  pdf.moveTo(naX - 4, naY - 2).lineTo(naX, naY - 6).lineTo(naX + 4, naY - 2).closePath().fill();
  pdf.font(BOLD_FONT).fontSize(8).text('N', naX - 3, naY + 14, { lineBreak: false });

  // Scale bar (bottom-right).  Choose a "round" km value ~25% of plot width.
  const targetKm = (xMax - xMin) * 0.25;
  const roundKm = roundScaleStep(targetKm);
  const barLenPdf = roundKm * xScale;
  const sbX = x0 + plotSize - 14 - barLenPdf;
  const sbY = y0 + plotSize - 14;
  pdf.strokeColor(TEAL_DARK).lineWidth(1.0);
  pdf.moveTo(sbX, sbY).lineTo(sbX + barLenPdf, sbY).stroke();
  pdf.moveTo(sbX, sbY - 3).lineTo(sbX, sbY + 3).stroke();
  pdf.moveTo(sbX + barLenPdf, sbY - 3).lineTo(sbX + barLenPdf, sbY + 3).stroke();
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM)
     .text(`${roundKm} km`, sbX, sbY + 4, { width: barLenPdf, align: 'center', lineBreak: false });

  // Legend (top-right).
  const legendW = 130;
  const legX = x0 + plotSize - legendW - 10;
  const legY = y0 + 10;
  pdf.fillColor('white').opacity(0.85)
     .rect(legX - 4, legY - 4, legendW, 12 + polys.length * 12).fill();
  pdf.opacity(1);
  pdf.font(BODY_FONT).fontSize(7.5).fillColor(TEAL_DARK);
  let ly = legY;
  for (const p of polys){
    pdf.strokeColor(p.stroke || AMBER).lineWidth(1.2);
    if (p.dashed) pdf.dash(3, { space: 2 });
    pdf.moveTo(legX, ly + 3).lineTo(legX + 16, ly + 3).stroke();
    pdf.undash();
    pdf.fillColor(TEAL_DARK).text(p.label || '—', legX + 20, ly, { width: legendW - 22, lineBreak: false });
    ly += 12;
  }
  pdf.restore();
  pdf.fillColor('black').strokeColor('black');

  pdf.y = y0 + plotSize + 6;
  renderChartCaption(pdf, s, pdf.y);
}

// Choose a "round" scale-bar step (1, 2, 5, 10, 20, 50, …).
function roundScaleStep(km){
  if (!Number.isFinite(km) || km <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(km)));
  const n = km / pow;
  let mult;
  if (n < 1.5) mult = 1;
  else if (n < 3) mult = 2;
  else if (n < 7) mult = 5;
  else mult = 10;
  return mult * pow;
}

function formatCell(v){
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

function textWidth(pdf, str, font, size){
  pdf.save();
  pdf.font(font).fontSize(size);
  const w = pdf.widthOfString(String(str));
  pdf.restore();
  return w;
}
