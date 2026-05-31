// engine.js — Node.js ES module that wraps the GroundWaveFCC Octave engine.
//
// Exports:
//   runFccgw({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km })
//     → { fields_mvm, distances_km, engine }
//
// The Octave script fccgw_run.m is invoked as a subprocess with a 30-second
// AbortSignal timeout.  Input is passed via a temp file; output is read from
// stdout and parsed as JSON.

import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Environment-configured path to the GroundWaveFCC Octave package. */
export const FCCGW_OCTAVE_PATH =
  process.env.FCCGW_OCTAVE_PATH || '/opt/fccgw/GroundWaveFCC';

/**
 * Run the FCC/OET R86-1 GroundWaveFCC engine via Octave.
 *
 * @param {object} params
 * @param {number}   params.freq_hz        Carrier frequency in Hz (530 kHz–1710 kHz band)
 * @param {number}   params.sigma_s_per_m  Ground conductivity in S/m (e.g. 0.008 for 8 mS/m)
 * @param {number}   params.epsilon        Relative dielectric constant (≥1; e.g. 15)
 * @param {number}   params.e1km_mvm       Reference field strength at 1 km in mV/m
 * @param {number[]} params.distances_km   Array of distances in km at which to evaluate
 * @returns {Promise<{ fields_mvm: number[], distances_km: number[], engine: string }>}
 * @throws {Error} on Octave failure, parse error, or 30-second timeout
 */
export async function runFccgw({
  freq_hz,
  sigma_s_per_m,
  epsilon,
  e1km_mvm,
  distances_km
}){
  // Write inputs to a temp file so the Octave script can read them.
  const tmpPath = join(
    tmpdir(),
    `fccgw_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`
  );

  try {
    await writeFile(
      tmpPath,
      JSON.stringify({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km }),
      'utf8'
    );

    // 30-second AbortSignal timeout.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);

    let stdout;
    try {
      const result = await execFileAsync(
        'octave',
        ['--no-gui', '--no-init-file', join(__dirname, 'fccgw_run.m'), tmpPath],
        {
          signal: ctrl.signal,
          env: {
            ...process.env,
            FCCGW_OCTAVE_PATH
          },
          maxBuffer: 4 * 1024 * 1024   // 4 MB — large distance grids produce big output
        }
      );
      stdout = result.stdout;
    } finally {
      clearTimeout(timer);
    }

    // Parse the single JSON line emitted by fccgw_run.m.
    const line = stdout.trim().split('\n').find(l => l.startsWith('{'));
    if (!line){
      throw new Error(`GroundWaveFCC produced no JSON output. stdout: ${stdout.slice(0, 500)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e){
      throw new Error(`GroundWaveFCC output is not valid JSON: ${line.slice(0, 200)}`);
    }

    if (!parsed.ok){
      throw new Error(`GroundWaveFCC engine error: ${parsed.error || 'unknown error'}`);
    }

    if (!Array.isArray(parsed.fields_mvm)){
      throw new Error('GroundWaveFCC result missing fields_mvm array');
    }

    return {
      fields_mvm:   parsed.fields_mvm.map(Number),
      distances_km: distances_km.map(Number),
      engine:       'fccgw-oet-r86-1'
    };

  } finally {
    // Always clean up the temp file; ignore errors.
    await unlink(tmpPath).catch(() => {});
  }
}
