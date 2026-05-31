% fccgw_run.m — Octave driver for the FCC/OET R86-1 GroundWaveFCC engine.
%
% Usage:
%   octave --no-gui --no-init-file fccgw_run.m <input_json_path>
%
% Input JSON schema:
%   {
%     "freq_hz":        <number>,   % Carrier frequency in Hz (530000–1710000)
%     "sigma_s_per_m":  <number>,   % Ground conductivity in S/m (e.g. 0.008)
%     "epsilon":        <number>,   % Relative dielectric constant (e.g. 15)
%     "e1km_mvm":       <number>,   % Reference field at 1 km in mV/m (e.g. 80)
%     "distances_km":   [<number>]  % Array of distances in km
%   }
%
% Output (one JSON line on stdout):
%   {"ok":true,"fields_mvm":[...]}
%   {"ok":false,"error":"..."}
%
% Exit codes:
%   0 — success
%   1 — error
%
% The Octave function called is:
%   GroundWave(freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distance_km)
% located at FCCGW_OCTAVE_PATH (env var, default /opt/fccgw/GroundWaveFCC).

try
  % ---- 1. Parse argv ----
  args = argv();
  if length(args) < 1
    error('Usage: fccgw_run.m <input_json_path>');
  end
  input_path = args{1};

  % ---- 2. Add GroundWaveFCC to Octave path ----
  fccgw_path = getenv('FCCGW_OCTAVE_PATH');
  if isempty(fccgw_path)
    fccgw_path = '/opt/fccgw/GroundWaveFCC';
  end
  addpath(fccgw_path);

  % ---- 3. Read and decode input JSON ----
  fid = fopen(input_path, 'r');
  if fid < 0
    error('Cannot open input file: %s', input_path);
  end
  raw = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);

  inp = jsondecode(raw);

  % ---- 4. Extract and validate parameters ----
  freq_hz       = double(inp.freq_hz);
  sigma_s_per_m = double(inp.sigma_s_per_m);
  epsilon       = double(inp.epsilon);
  e1km_mvm      = double(inp.e1km_mvm);
  distances_km  = double(inp.distances_km(:))';  % ensure row vector

  if ~isfinite(freq_hz) || freq_hz <= 0
    error('freq_hz must be a positive finite number');
  end
  if ~isfinite(sigma_s_per_m) || sigma_s_per_m <= 0
    error('sigma_s_per_m must be a positive finite number');
  end
  if ~isfinite(epsilon) || epsilon < 1
    error('epsilon must be >= 1');
  end
  if ~isfinite(e1km_mvm) || e1km_mvm <= 0
    error('e1km_mvm must be a positive finite number');
  end
  if isempty(distances_km)
    error('distances_km must be a non-empty array');
  end

  % ---- 5. Call GroundWave — vectorized if supported, loop fallback ----
  n = length(distances_km);
  fields_mvm = zeros(1, n);

  try
    % Try vectorized call first — some GroundWaveFCC builds support it.
    fields_mvm = GroundWave(freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km);
    fields_mvm = double(fields_mvm(:))';
  catch vec_err
    % Fallback: call per-distance.
    for i = 1:n
      fields_mvm(i) = GroundWave(freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km(i));
    end
  end

  % ---- 6. Emit result JSON ----
  % Build JSON array manually to avoid precision loss.
  parts = arrayfun(@(v) sprintf('%.6g', v), fields_mvm, 'UniformOutput', false);
  arr   = ['[', strjoin(parts, ','), ']'];
  fprintf('{"ok":true,"fields_mvm":%s}\n', arr);
  exit(0);

catch e
  msg = strtrim(e.message);
  % Escape backslashes and double-quotes for JSON safety.
  msg = strrep(msg, '\', '\\');
  msg = strrep(msg, '"', '\"');
  fprintf('{"ok":false,"error":"%s"}\n', msg);
  exit(1);
end
