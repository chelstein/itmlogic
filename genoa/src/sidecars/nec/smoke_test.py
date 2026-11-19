#!/usr/bin/env python3
"""
Genoa NEC sidecar — regression smoke test.

Runs nec_bridge.py directly (no HTTP server, no Docker) against a set of
fixed inputs and asserts on real, previously-broken behavior:

  1. PyNEC actually imports (--probe).
  2. The README's own documented smoke test (ground.type=pec, theta=90)
     still returns the textbook ~5.08 dBi quarter-wave monopole gain.
  3. Feedpoint impedance is a real, finite number (was: silently None,
     "get_impedance_real" AttributeError -- PyNEC's API dropped the
     separate real/imag accessors in favor of one complex get_impedance()).
  4. ground.type=sommerfeld at the DEFAULT theta=90 is correctly flagged
     as NEC2's grazing-angle sentinel (-999.99), not silently trusted as
     a real value -- and the SAME model at theta=89 returns a real,
     finite gain, proving the flag is about the angle, not the ground
     type being broken outright.
  5. ground.type=pec is NOT flagged by the same check (PEC's image-theory
     ground is well-defined at grazing incidence; only Sommerfeld's
     ground-wave integration is singular there) -- the check from #4
     must not produce false positives on a ground type the README itself
     documents as working at theta=90.
  6. The DA pattern optimizer (--optimize) never reports a fabricated
     "achieved_suppression_db" built from the grazing sentinel (was:
     800.512 dB, a physically impossible number, from a 2-tower sommerfeld
     model at the optimizer's own default theta=90) -- it must instead
     report converged=false with achieved_suppression_db=None and an
     explicit error.
  7. The SAME optimizer call, given a non-degenerate theta override,
     returns a real, finite, physically plausible suppression figure.

Exit code 0 = all checks passed. Any failure raises AssertionError with
a clear message and exits non-zero.

Usage:
    python3 smoke_test.py
"""

import json
import math
import subprocess
import sys
from pathlib import Path

BRIDGE = Path(__file__).parent / "nec_bridge.py"
PY = sys.executable


def run_bridge(stdin_obj=None, args=()):
    proc = subprocess.run(
        [PY, str(BRIDGE), *args],
        input=json.dumps(stdin_obj) if stdin_obj is not None else None,
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode not in (0, 2, 3, 4):
        raise AssertionError(f"unexpected exit code {proc.returncode}: stderr={proc.stderr!r}")
    try:
        return json.loads(proc.stdout), proc.returncode
    except json.JSONDecodeError:
        raise AssertionError(f"non-JSON stdout: {proc.stdout!r} stderr={proc.stderr!r}")


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        raise AssertionError(f"{label}: {detail}")


def main():
    # 1. probe
    probe, _ = run_bridge(args=("--probe",))
    check("PyNEC imports", probe.get("pynec_available") is True, json.dumps(probe))

    # 2 + 3. README's documented smoke test, PEC ground, theta=90
    readme_model = {
        "frequency_mhz": 1.0,
        "ground": {"type": "pec"},
        "wires": [{"tag": 1, "segments": 21, "x1": 0, "y1": 0, "z1": 0,
                   "x2": 0, "y2": 0, "z2": 75, "radius_m": 0.25}],
        "excitations": [{"tag": 1, "segment": 1, "voltage_real": 1, "voltage_imag": 0}],
        "pattern": {"theta_start": 90, "theta_stop": 90, "theta_step": 1,
                    "phi_start": 0, "phi_stop": 355, "phi_step": 45},
    }
    result, _ = run_bridge(readme_model)
    check("README smoke test returns ok", result.get("ok") is True, json.dumps(result))
    gain0 = result["pattern"]["gain_dbi"][0][0]
    check("README smoke test gain ~5.08 dBi (PEC, theta=90, documented value)",
          math.isclose(gain0, 5.08, abs_tol=0.05), f"got {gain0}")
    check("README smoke test: no grazing-singularity warning on PEC",
          not any("NEC_GRAZING_ANGLE_SINGULARITY" in w for w in result.get("warnings", [])),
          json.dumps(result.get("warnings")))
    fp = result.get("feedpoint")
    check("feedpoint impedance is a real object (not None/silently dropped)",
          isinstance(fp, dict) and fp.get("r_ohm") is not None, json.dumps(fp))
    check("feedpoint r_ohm is finite", math.isfinite(fp["r_ohm"]), json.dumps(fp))

    # 4 + 5. Sommerfeld grazing singularity at theta=90, absent at PEC
    sommerfeld_model = {
        "frequency_mhz": 0.780,
        "ground": {"type": "sommerfeld", "conductivity_s_m": 0.002, "dielectric_constant": 15},
        "wires": [{"tag": 1, "segments": 21, "x1": 0, "y1": 0, "z1": 0.01,
                   "x2": 0, "y2": 0, "z2": 96.15, "radius_m": 0.3}],
        "excitations": [{"tag": 1, "segment": 1, "voltage_real": 1.0, "voltage_imag": 0.0}],
        "pattern": {"theta_start": 90, "theta_stop": 90, "theta_step": 1,
                    "phi_start": 0, "phi_stop": 0, "phi_step": 1},
    }
    result, _ = run_bridge(sommerfeld_model)
    check("sommerfeld @ theta=90 flagged as grazing singularity",
          any("NEC_GRAZING_ANGLE_SINGULARITY" in w for w in result.get("warnings", [])),
          json.dumps(result.get("warnings")))

    sommerfeld_model_off = dict(sommerfeld_model, pattern={
        "theta_start": 89, "theta_stop": 89, "theta_step": 1,
        "phi_start": 0, "phi_stop": 0, "phi_step": 1,
    })
    result_off, _ = run_bridge(sommerfeld_model_off)
    check("sommerfeld @ theta=89 (off grazing) is NOT flagged, and returns a real finite gain",
          not any("NEC_GRAZING_ANGLE_SINGULARITY" in w for w in result_off.get("warnings", []))
          and math.isfinite(result_off["pattern"]["gain_dbi"][0][0])
          and result_off["pattern"]["gain_dbi"][0][0] > -100,
          json.dumps(result_off))

    # 6 + 7. DA pattern optimizer
    da_model_default = {
        "base_model": {
            "frequency_khz": 780,
            "towers": [
                {"tag": 1, "x_m": 0, "y_m": 0, "height_m": 96.15, "radius_m": 0.3,
                 "drive": {"amplitude": 1.0, "phase_deg": 0}},
                {"tag": 2, "x_m": 96.15, "y_m": 0, "height_m": 96.15, "radius_m": 0.3,
                 "drive": {"amplitude": 1.0, "phase_deg": 90}},
            ],
        },
        "target_bearing_deg": 90,
        "desired_suppression_db": 20,
        "phase_step_deg": 30,
        "max_iterations": 12,
    }
    opt_result, _ = run_bridge(da_model_default, args=("--optimize",))
    check("optimizer @ default theta=90/sommerfeld does NOT fabricate a suppression number",
          opt_result.get("achieved_suppression_db") is None and opt_result.get("converged") is False,
          json.dumps(opt_result))
    check("optimizer @ default theta=90/sommerfeld reports the grazing-singularity error",
          "NEC_GRAZING_ANGLE_SINGULARITY" in (opt_result.get("error") or ""),
          json.dumps(opt_result))

    da_model_fixed = dict(da_model_default)
    da_model_fixed["base_model"] = dict(da_model_default["base_model"])
    da_model_fixed["base_model"]["pattern"] = {
        "theta_start": 89, "theta_stop": 89, "theta_step": 1,
        "phi_start": 0, "phi_stop": 350, "phi_step": 10,
    }
    opt_result_fixed, _ = run_bridge(da_model_fixed, args=("--optimize",))
    sup = opt_result_fixed.get("achieved_suppression_db")
    check("optimizer @ theta=89 override returns a real, finite, plausible suppression (0-60 dB)",
          sup is not None and math.isfinite(sup) and 0 <= sup <= 60,
          json.dumps(opt_result_fixed))

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\nSMOKE TEST FAILED: {e}", file=sys.stderr)
        sys.exit(1)
