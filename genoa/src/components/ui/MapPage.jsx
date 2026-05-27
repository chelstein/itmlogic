// Live Map page — the first MapLibre integration.  Renders the
// pg_tileserv vector layers (see @components/map/config.js) on a dark
// basemap, with the shared TopNav.  Authed feature (mounted inside
// AuthedRouter); the /tiles proxy enforces auth at the ingress.

import React, { useState } from 'react';
import TopNav from './TopNav.jsx';
import MapView from '@components/map/MapView.jsx';
import { TILES_BASE, LAYERS } from '@components/map/config.js';

export default function MapPage({ authed, onNavigate, onLogout }){
  const [status, setStatus] = useState(null);
  const isErr = status?.kind === 'error';
  return (
    <div className="relative min-h-screen bg-black text-cream">
      <TopNav current="map" authed={!!authed} onNavigate={onNavigate} onLogout={onLogout} />
      <MapView onStatus={setStatus} />

      <div className="absolute top-3 left-4 z-30 rounded border border-rule bg-black/70 backdrop-blur-sm px-3 py-2 font-mono text-[10px] tracking-rack uppercase">
        <div className="text-cream">Genoa · Live Map</div>
        <div className="text-textDim normal-case tracking-normal mt-0.5">
          tiles: {TILES_BASE} · {LAYERS.map(l => l.sourceLayer).join(', ')}
        </div>
        {status && (
          <div className={(isErr ? 'text-red-400' : 'text-textDim') + ' normal-case tracking-normal mt-1 max-w-xs'}>
            {isErr ? 'error: ' : 'status: '}{status.text}
          </div>
        )}
      </div>
    </div>
  );
}
