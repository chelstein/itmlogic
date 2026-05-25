// Product / explainer page — public (pre-login) AND internal.
//
// Phase 1: kill the study-music widget, reclaim the top strip for nav,
// and give the product a place to be explained.  Sales mechanics
// (lead capture, "spin up a sample exhibit", collateral) are a later
// pass — the demo CTA below is a lightweight placeholder for now.
//
// Rendered by App before the auth gate, so visitors see it logged-out
// and the team sees it logged-in (TopNav switches Sign in / Sign out).

import React from 'react';
import TopNav from './TopNav.jsx';
import LogoMark from './LogoMark.jsx';

function Section({ id, eyebrow, title, children }){
  return (
    <section id={id} className="max-w-5xl mx-auto px-6 py-12 border-t border-rule/40">
      {eyebrow && <div className="font-mono text-[10px] tracking-rack uppercase text-amber mb-2">{eyebrow}</div>}
      {title && <h2 className="text-cream text-2xl font-bold mb-5">{title}</h2>}
      {children}
    </section>
  );
}

function Card({ title, children }){
  return (
    <div className="rounded-lg border border-rule/60 bg-black/40 p-5">
      <div className="text-cream font-semibold mb-2">{title}</div>
      <p className="text-textDim text-sm leading-relaxed">{children}</p>
    </div>
  );
}

export default function ProductPage({ authed, onNavigate, onLogout }){
  return (
    <div className="min-h-screen bg-black text-cream">
      <TopNav current="product" authed={!!authed} onNavigate={onNavigate} onLogout={onLogout} />

      {/* Hero */}
      <header className="max-w-5xl mx-auto px-6 pt-24 pb-12 text-center">
        <div className="flex justify-center mb-6"><LogoMark /></div>
        <div className="font-mono text-[11px] tracking-rack uppercase text-amber mb-4">Genoa FCC Propagation Studio</div>
        <h1 className="text-cream text-4xl sm:text-5xl font-bold leading-tight mb-5">
          Filing-grade FCC propagation studies, automated.
        </h1>
        <p className="text-textDim text-lg max-w-2xl mx-auto leading-relaxed">
          Genoa turns a station's parameters into a complete, auditable engineering
          statement — the §73 contour study a broadcaster would otherwise pay a
          consulting RF firm weeks to produce — in minutes, with the math verified
          against the FCC's own engine.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <a href="#start" className="rounded px-5 py-2.5 bg-amber text-black font-semibold text-sm hover:bg-cream transition-colors">
            Request a demo
          </a>
          <a
            href="/"
            onClick={(e) => { if (onNavigate){ e.preventDefault(); onNavigate('/'); } }}
            className="rounded px-5 py-2.5 border border-rule text-cream font-semibold text-sm hover:border-gold/60 transition-colors"
          >
            {authed ? 'Open the Studio' : 'Sign in to the Studio'}
          </a>
        </div>
      </header>

      {/* What it is */}
      <Section eyebrow="What it is" title="An engineering statement, generated and self-verified">
        <p className="text-textDim leading-relaxed">
          Feed Genoa a facility — call sign, coordinates, ERP, antenna height and pattern,
          class — and it produces the multi-page <span className="text-cream">Engineering Statement</span> exhibit
          used to support FCC filings for AM, FM, and TV broadcast stations. Every contour,
          spacing check, and HAAT figure is computed deterministically from the actual
          <span className="text-cream"> 47 CFR Part 73</span> rules, then cross-checked against the FCC's published
          curves and FORTRAN reference — so the document arrives with its own proof of correctness.
        </p>
      </Section>

      {/* What it computes */}
      <Section eyebrow="What it computes" title="The Part 73 engine">
        <div className="grid sm:grid-cols-2 gap-4">
          <Card title="§73.333 FM/TV contours">F(50,50) and F(50,10) curves → service, city-grade, and protected contours, per-radial and terrain-aware.</Card>
          <Card title="§73.207 / §73.215">Minimum distance separation and contour-protection for short-spaced stations, with full interference studies.</Card>
          <Card title="§73.313 HAAT">Height above average terrain, per-radial, derived from real elevation data (SRTM 30 m).</Card>
          <Card title="§73.182 / .184 / .190 AM">Groundwave + skywave field strength (RSS/NIF, the skywave formulas) for AM facilities.</Card>
        </div>
      </Section>

      {/* Why it's different */}
      <Section eyebrow="Why it's different" title="Built to be trusted, not just generated">
        <div className="grid sm:grid-cols-2 gap-4">
          <Card title="Deterministic & reproducible">Same inputs always produce the same numbers — SHA-256 hashed with replay tokens, so any exhibit can be independently re-verified.</Card>
          <Card title="Self-validating">Every exhibit carries a validation verdict: golden-suite curve checks, live geo.fcc.gov parity, and FORTRAN parity — visible to the reviewer.</Card>
          <Card title="AI consistency audit">An automated reviewer, grounded in the verbatim Part 73 rule text, flags internal contradictions for the engineer of record.</Card>
          <Card title="Engineer-of-record ready">Genoa does the deterministic computation and evidence assembly; a qualified broadcast engineer reviews and certifies. It never certifies on its own.</Card>
        </div>
      </Section>

      {/* How it works */}
      <Section eyebrow="How it works" title="From call sign to signed exhibit">
        <ol className="space-y-4">
          {[
            ['Enter the facility', 'Look up by call sign / facility ID, or enter parameters directly.'],
            ['Compute', 'The engine runs the §73 contours, spacing, HAAT, and interference study over real terrain.'],
            ['Review the verdict', 'See the self-validation results and the AI consistency audit before anything leaves the building.'],
            ['Export & certify', 'Download the engineering-statement PDF; the engineer of record reviews and signs.'],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-4">
              <span className="font-mono text-amber text-sm shrink-0 w-6">{String(i + 1).padStart(2, '0')}</span>
              <span><span className="text-cream font-semibold">{t}.</span> <span className="text-textDim">{d}</span></span>
            </li>
          ))}
        </ol>
      </Section>

      {/* CTA */}
      <Section id="start" eyebrow="Get started" title="See it on your own station">
        <p className="text-textDim leading-relaxed mb-6">
          The fastest pitch is a real exhibit. Reach out and we'll generate a sample
          engineering statement for a station you choose, so you can see the output
          quality before anything else.
        </p>
        <a
          href="mailto:chuck@mellowmountainradio.com?subject=Genoa%20demo%20request"
          className="inline-block rounded px-5 py-2.5 bg-amber text-black font-semibold text-sm hover:bg-cream transition-colors"
        >
          Request a demo
        </a>
        <p className="font-mono text-[10px] tracking-rack uppercase text-textDim/70 mt-10">
          Genoa FCC Propagation Studio — decision-support for broadcast engineering. Not a substitute for a licensed engineer of record.
        </p>
      </Section>
    </div>
  );
}
