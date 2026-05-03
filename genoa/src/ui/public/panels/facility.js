// Facility panel — reads / writes the input form.

const $ = id => document.getElementById(id);

export function readInputs(){
  const v = (id, fallback = null) => {
    const el = $(id); if (!el) return fallback;
    const t = el.value.trim();
    return t === '' ? fallback : t;
  };
  return {
    call:            v('call'),
    facility_id:     v('fid'),
    service:         v('svc', 'FM'),
    fcc_class:       v('cls'),
    frequency:       num(v('freq')),
    erp_kw:          num(v('erp')),
    haat_m:          num(v('haat')),
    lat:             num(v('lat')),
    lon:             num(v('lon')),
    ground_sigma_mS_m: num(v('sigma')),
    radial_step_deg: num(v('step')) || 10,
    pattern_table:   $('pat').value === 'DA' ? v('pat_tbl') : null
  };
}

export function setInputs(inputs){
  const set = (id, val) => { const el = $(id); if (el && val !== null && val !== undefined) el.value = val; };
  set('svc',   inputs.service);
  set('cls',   inputs.fcc_class);
  set('call',  inputs.call);
  set('fid',   inputs.facility_id);
  set('freq',  inputs.frequency);
  set('erp',   inputs.erp_kw);
  set('haat',  inputs.haat_m);
  set('lat',   inputs.lat ?? '');
  set('lon',   inputs.lon ?? '');
  set('sigma', inputs.ground_sigma_mS_m);
  set('step',  inputs.radial_step_deg);
  if (inputs.pattern_table){
    $('pat').value = 'DA';
    $('pat_tbl').value = inputs.pattern_table;
  } else {
    $('pat').value = 'ND';
  }
}

function num(s){
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const PRESETS = {
  synthetic: {
    call:'WBOB-FM', facility_id:'12345', service:'FM', fcc_class:'A',
    frequency:98.7, erp_kw:6.0, haat_m:100,
    lat:37.0902, lon:-95.7129,
    radial_step_deg: 10
  },
  kslx: {
    call:'KSLX-FM', facility_id:'11282', service:'FM', fcc_class:'C',
    frequency:100.7, erp_kw:100, haat_m:561,
    lat:null, lon:null,
    radial_step_deg: 10
  }
};
