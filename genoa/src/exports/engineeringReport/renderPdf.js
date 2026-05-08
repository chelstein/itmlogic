// PDF renderer for the engineering report — pdfkit-based, Letter size,
// 0.75" margins, Times-Roman 11pt body, Times-Bold 14pt section headers.

import PDFDocument from 'pdfkit';

const PT_PER_INCH   = 72;
const MARGIN        = 0.75 * PT_PER_INCH;
const BODY_FONT     = 'Times-Roman';
const BOLD_FONT     = 'Times-Bold';
const ITALIC_FONT   = 'Times-Italic';
const BODY_SIZE     = 11;
const HEADING_SIZE  = 14;
const TITLE_SIZE    = 20;
const FOOTER_TEXT   = 'Genoa FCC Propagation Studio';

export async function renderEngineeringReportPdf(doc){
  if (!doc || !Array.isArray(doc.sections)){
    throw new Error('renderEngineeringReportPdf: invalid document model');
  }
  const pdf = new PDFDocument({
    size:        'LETTER',
    margins:     { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title:    doc.meta?.title || 'Engineering Statement',
      Author:   doc.meta?.generated_by || 'Genoa FCC Propagation Studio',
      Subject:  doc.meta?.station ? `FCC propagation study — ${doc.meta.station}` : 'FCC propagation study',
      Keywords: 'FCC, propagation, broadcast engineering, Genoa'
    }
  });

  const chunks = [];
  pdf.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    pdf.on('end',   () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  for (let i = 0; i < doc.sections.length; i++){
    const s = doc.sections[i];
    if (i > 0) pdf.addPage();
    renderSection(pdf, s, doc.meta);
  }

  const footer = (doc.meta && doc.meta.footer) || FOOTER_TEXT;
  const range  = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++){
    pdf.switchToPage(i);
    drawFooter(pdf, footer, i + 1, range.count);
  }

  pdf.end();
  return done;
}

function drawFooter(pdf, footer, pageNum, totalPages){
  const w = pdf.page.width;
  const h = pdf.page.height;
  pdf.save();
  pdf.font(BODY_FONT).fontSize(9).fillColor('#666666');
  const y = h - MARGIN + 18;
  pdf.text(footer, MARGIN, y, { width: w - 2 * MARGIN, align: 'left', lineBreak: false });
  pdf.text(`Page ${pageNum} of ${totalPages}`, MARGIN, y,
           { width: w - 2 * MARGIN, align: 'right', lineBreak: false });
  pdf.fillColor('black');
  pdf.restore();
}

function renderSection(pdf, s, meta){
  if (s.type === 'cover'){
    renderCover(pdf, s, meta);
    return;
  }
  if (s.heading){
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor('black')
       .text(s.heading, { align: 'left' });
    pdf.moveDown(0.5);
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
    default:
      if (Array.isArray(s.rows)) renderKv(pdf, s.rows);
      else if (Array.isArray(s.paragraphs)) renderParagraphs(pdf, s.paragraphs);
      else if (s.table) renderTable(pdf, s.table);
      break;
  }
}

function renderCover(pdf, s, meta){
  const w = pdf.page.width;
  pdf.font(BOLD_FONT).fontSize(TITLE_SIZE).fillColor('black')
     .text(s.heading || 'ENGINEERING STATEMENT', MARGIN, MARGIN + 60, {
        width: w - 2 * MARGIN, align: 'center'
     });
  pdf.moveDown(0.5);
  pdf.font(ITALIC_FONT).fontSize(12)
     .text(meta?.subtitle || 'FCC Propagation Study', { align: 'center' });
  pdf.moveDown(2);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE);
  renderKv(pdf, s.rows);
}

function renderKv(pdf, rows){
  if (!Array.isArray(rows)) return;
  const items = rows.filter(Boolean).map(r => Array.isArray(r) ? r : [r.label || r.key || '', r.value || '']);
  if (!items.length) return;
  const w   = pdf.page.width - 2 * MARGIN;
  const lw  = Math.min(220, Math.max(...items.map(([k]) => textWidth(pdf, String(k), BOLD_FONT, BODY_SIZE))) + 12);
  pdf.fontSize(BODY_SIZE);
  for (const [k, v] of items){
    const startY = pdf.y;
    pdf.font(BOLD_FONT).text(String(k), MARGIN, startY, { width: lw, continued: false });
    const keyEndY = pdf.y;
    pdf.font(BODY_FONT).text(String(v == null ? '' : v), MARGIN + lw, startY, { width: w - lw });
    pdf.y = Math.max(keyEndY, pdf.y);
  }
}

function renderParagraphs(pdf, paragraphs){
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  const w = pdf.page.width - 2 * MARGIN;
  for (const p of (paragraphs || [])){
    pdf.text(String(p), { width: w, align: 'left' });
    pdf.moveDown(0.5);
  }
}

function renderTable(pdf, table){
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return;
  const w = pdf.page.width - 2 * MARGIN;
  const cols = table.columns;
  const widths = cols.map(c => Math.max(40, Math.floor(w * (Number(c.width) || (1 / cols.length)))));
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE - 1).fillColor('black');
  let x = MARGIN, y = pdf.y;
  for (let i = 0; i < cols.length; i++){
    pdf.text(cols[i].label || cols[i].key, x + 2, y, {
      width: widths[i] - 4, align: cols[i].align || 'left', lineBreak: false
    });
    x += widths[i];
  }
  y = pdf.y + 2;
  pdf.moveTo(MARGIN, y).lineTo(MARGIN + w, y).strokeColor('#888').lineWidth(0.5).stroke();
  pdf.y = y + 3;
  pdf.font(BODY_FONT).fontSize(BODY_SIZE - 1);
  for (const r of table.rows){
    if (pdf.y > pdf.page.height - MARGIN - 30){
      pdf.addPage();
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
    pdf.y = maxBottom + 2;
  }
  pdf.fontSize(BODY_SIZE);
}

function renderVerdict(pdf, v){
  if (!v) return;
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1)
     .text(`Status: ${v.status || '—'}    Confidence: ${v.confidence || '—'}`);
  pdf.moveDown(0.5);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE);
  for (const c of (v.components || [])){
    pdf.font(BOLD_FONT).text(`• ${c.name}: ${c.status}`, { continued: false });
    if (c.detail){
      pdf.font(BODY_FONT).text(c.detail, { indent: 14 });
    }
  }
  if (v.interpretation){
    pdf.moveDown(0.5);
    pdf.font(BODY_FONT).text(v.interpretation, { align: 'left' });
  }
  if (Array.isArray(v.limitations) && v.limitations.length){
    pdf.moveDown(0.5);
    pdf.font(BOLD_FONT).text('Limitations:');
    pdf.font(BODY_FONT);
    for (const l of v.limitations) pdf.text(`• ${l}`, { indent: 14 });
  }
}

function renderConclusion(pdf, s){
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 2).text(`Conclusion: ${s.status}`);
  pdf.moveDown(0.5);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).text(s.narrative || '', { align: 'left' });
  if (Array.isArray(s.findings) && s.findings.length){
    pdf.moveDown(0.5);
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
      pdf.font(BODY_FONT).fontSize(BODY_SIZE).text(s.statement, { align: 'left' });
      pdf.moveDown(1);
    }
    renderKv(pdf, s.fields);
    if (s.footer){
      pdf.moveDown(1);
      pdf.font(BODY_FONT).fontSize(BODY_SIZE - 1).fillColor('#444')
         .text(s.footer, { align: 'left' });
      pdf.fillColor('black');
    }
  } else {
    if (s.boilerplate){
      pdf.font(BODY_FONT).fontSize(BODY_SIZE).text(s.boilerplate, { align: 'left' });
      pdf.moveDown(1);
    }
    renderKv(pdf, s.fields);
  }
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
