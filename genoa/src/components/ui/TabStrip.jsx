import React from 'react';

// TabStrip — dense Bloomberg-style mono tabs with amber underline.
//
// Two prop shapes accepted:
//   - tabs:   [{ id, label }, ...]                                (legacy flat)
//   - groups: [{ label, items: [{ id, label }, ...] }, ...]       (preferred)
//     (groups wins when both are present.)
//
// When groups is supplied, a non-interactive uppercase section
// header renders above each group's first item so the workbench
// rail stays scannable as the rack grows.

export default function TabStrip({ tabs, groups, activeId, onChange }) {
  if (Array.isArray(groups) && groups.length > 0){
    return (
      <nav className="tab-strip" role="tablist">
        {groups.map((g, gi) => (
          <React.Fragment key={`grp-${gi}`}>
            <div className="tab-group-header" aria-hidden="true">
              {g.label}
            </div>
            {(g.items || []).map((t) => (
              <TabButton key={t.id} t={t} activeId={activeId} onChange={onChange} />
            ))}
          </React.Fragment>
        ))}
      </nav>
    );
  }
  return (
    <nav className="tab-strip" role="tablist">
      {(tabs || []).map((t) => (
        <TabButton key={t.id} t={t} activeId={activeId} onChange={onChange} />
      ))}
    </nav>
  );
}

function TabButton({ t, activeId, onChange }){
  return (
    <button
      role="tab"
      aria-selected={t.id === activeId}
      onClick={() => onChange(t.id)}
      className={`tab ${t.id === activeId ? 'active' : ''}`}>
      {t.label}
    </button>
  );
}
