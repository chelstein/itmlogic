import React from 'react';

// Terminal-style console for blockers / warnings / recommendations.
// Codes are deduped visually (one row per code; the first detail wins,
// matching the engine's W.dedupe behavior).

function dedupe(list){
  const seen = new Map();
  for (const w of (list || [])){
    if (!seen.has(w.code)) seen.set(w.code, w);
  }
  return [...seen.values()];
}

function Block({ heading, items, codeCls, gtCls = 'gt' }) {
  if (!items || !items.length){
    return (
      <div className="mb-2">
        <div className="font-mono text-[10px] tracking-rack uppercase text-textDim mb-1">[ {heading} ]</div>
        <div className="font-mono text-[12px] text-textDim italic">— none —</div>
      </div>
    );
  }
  const list = typeof items[0] === 'string' ? items.map(s => ({ code: '', detail: s })) : dedupe(items);
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] tracking-rack uppercase text-textDim mb-1">[ {heading} ]</div>
      <div className="space-y-1">
        {list.map((w, i) => (
          <div key={(w.code || '') + i} className="console-line">
            <span className={`gt ${gtCls}`}>{'>'}</span>
            <span className={`font-mono text-[12px] ${codeCls}`}>
              {w.code || ''}{w.detail ? <span className="text-textDim">{w.code ? ' — ' : ''}{w.detail}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WarningConsole({ blockers = [], warnings = [], recommendations = [] }) {
  // Filter the warnings list down to severity 'warning' only — blockers
  // are already shown separately and 'info' items aren't surfaced here.
  const ws = (warnings || []).filter(w => w.severity !== 'blocker');
  return (
    <div className="console-frame">
      <Block heading="Blockers"        items={blockers} codeCls="text-red"   gtCls="text-red"/>
      <Block heading="Warnings"        items={ws}       codeCls="text-amber" gtCls="text-amber"/>
      <Block heading="Recommendations" items={recommendations} codeCls="text-cyan" gtCls="text-cyan"/>
    </div>
  );
}
