// engine.js — Node.js module that wraps the GroundWaveFCC Octave engine.
//
// Exports:
//   runFccgw({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km })
//     → { fields_mvm, distances_km, engine }
//
// The Octave script fccgw_run.m is invoked as a subprocess with a 30-second
// timeout.  Input is passed via a temp file; output is read from stdout and
// parsed as JSON.

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Environment-configured path to the GroundWaveFCC Octave package. */
const FCCGW_OCTAVE_PATH =
  process.env.FCCGW_OCTAVE_PATH || '/opt/fccgw/GroundWaveFCC';

/**
 * Run the FCC/OET R86-1 GroundWaveFCC engine via Octave.
 *
 * @param {object} params
 * @param {number}   params.freq_hz        Carrier frequency in Hz
 * @param {number}   params.sigma_s_per_m  Ground conductivity in S/m
 * @param {number}   params.epsilon        Relative dielectric constant
 * @param {number}   params.e1km_mvm       Reference field at 1 km in mV/m
 * @param {number[]} params.distances_km   Array of distances in km
 * @returns {Promise<{ fields_mvm: number[], distances_km: number[], engine: string }>}
 * @throws {Error} on Octave failure, parse error, or 30-second timeout
 */
function runFccgw(params){
  const { freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km } = params;

  const tmpPath = path.join(
    os.tmpdir(),
    'fccgw_' + process.pid + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.json'
  );

  const scriptPath = path.join(__dirname, 'fccgw_run.m');
  const payload = JSON.stringify({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km });

  fs.writeFileSync(tmpPath, payload, 'utf8');

  return new Promise(function(resolve, reject){
    const timer = setTimeout(function(){
      child.kill('SIGTERM');
      cleanup();
      reject(new Error('GroundWaveFCC timed out after 30 seconds'));
    }, 30000);

    const env = Object.assign({}, process.env, { FCCGW_OCTAVE_PATH: FCCGW_OCTAVE_PATH });

    const child = execFile(
      'octave',
      ['--no-gui', '--no-init-file', scriptPath, tmpPath],
      { env: env, maxBuffer: 4 * 1024 * 1024 },
      function(err, stdout, stderr){
        clearTimeout(timer);
        cleanup();

        if (err){
          return reject(new Error('Octave process failed: ' + (err.message || String(err))));
        }

        const line = (stdout || '').trim().split('\n').filter(function(l){ return l.trim().startsWith('{'); })[0];
        if (!line){
          return reject(new Error('GroundWaveFCC produced no JSON output. stdout: ' + (stdout || '').slice(0, 500)));
        }

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch(e){
          return reject(new Error('GroundWaveFCC output is not valid JSON: ' + line.slice(0, 200)));
        }

        if (!parsed.ok){
          return reject(new Error('GroundWaveFCC engine error: ' + (parsed.error || 'unknown error')));
        }

        if (!Array.isArray(parsed.fields_mvm)){
          return reject(new Error('GroundWaveFCC result missing fields_mvm array'));
        }

        resolve({
          fields_mvm:   parsed.fields_mvm.map(Number),
          distances_km: distances_km.map(Number),
          engine:       'fccgw-oet-r86-1'
        });
      }
    );

    function cleanup(){
      try { fs.unlinkSync(tmpPath); } catch(e){ /* ignore */ }
    }
  });
}

module.exports = { runFccgw, FCCGW_OCTAVE_PATH };
