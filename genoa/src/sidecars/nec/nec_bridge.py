#!/usr/bin/env python3
"""
Genoa NEC bridge.

LICENSE BOUNDARY
    NEC2++ / PyNEC are GPL v2.  This Python file is part of the
    GPL-isolated sidecar (sidecars/nec/*).  Nothing in src/ outside
    of sidecars/nec/* may import or link this script.

USAGE
    nec_bridge.py            (model JSON on stdin → result JSON on stdout)
    nec_bridge.py --probe    (no stdin input; emits probe JSON)

NETWORK / SECURITY
    No network calls; reads stdin, writes stdout, that's it.

REQUIREMENTS
    pip3 install -r requirements.txt
    apt-get install -y nec
"""

import sys
import json
import math
import io


def out(obj):
    sys.stdout.write(json.dumps(obj))


def fail(error, detail, code=2):
    sys.stdout.write(json.dumps({"ok": False, "error": error, "detail": str(detail)[:600]}))
    sys.exit(code)


def probe():
    """Health probe — never raise; report PyNEC availability."""
    info = {"pynec_available": False, "pynec_version": None, "error": None}
    try:
        import PyNEC                                              # noqa: F401
        info["pynec_available"] = True
        info["pynec_version"]   = getattr(PyNEC, "__version__", "unknown")
    except Exception as e:
        info["error"] = "PyNEC import failed: %s" % e
    out(info)


def import_pynec():
    try:
        import PyNEC                                              # noqa: F401
        from PyNEC import nec_context
        return PyNEC, nec_context
    except Exception as e:
        fail("PYNEC_NOT_INSTALLED",
             "PyNEC import failed: %s.  Install PyNEC / NEC2++ in sidecar image: "
             "apt-get install -y nec && pip3 install -r requirements.txt" % e,
             code=4)


def read_input():
    raw = sys.stdin.read()
    if not raw:
        fail("INVALID_INPUT", "no JSON on stdin")
    try:
        return json.loads(raw)
    except Exception as e:
        fail("INVALID_INPUT", "stdin JSON parse failed: %s" % e)


def make_geometry(ctx, wires, warnings):
    """GW (wire geometry) cards."""
    geom = ctx.get_geometry()
    total_length = 0.0
    n_segments = 0
    for w in wires:
        try:
            tag = int(w["tag"])
            seg = int(w["segments"])
            x1 = float(w["x1"]); y1 = float(w["y1"]); z1 = float(w["z1"])
            x2 = float(w["x2"]); y2 = float(w["y2"]); z2 = float(w["z2"])
            r  = float(w["radius_m"])
        except Exception as e:
            fail("NEC_MODEL_INVALID_GEOMETRY",
                 "wire missing/non-numeric field: %s" % e)
        length = math.sqrt((x2-x1)**2 + (y2-y1)**2 + (z2-z1)**2)
        if length <= 0 or r <= 0 or seg < 1:
            fail("NEC_MODEL_INVALID_GEOMETRY",
                 "wire tag=%s has zero/negative length, radius, or segments" % tag)
        total_length += length
        n_segments   += seg
        # Segment-length vs. radius sanity (NEC2 best practices).
        seg_len = length / seg
        if seg_len < 8 * r:
            warnings.append(
                "wire tag=%s: segment length %.3f m < 8·radius (%.3f m); accuracy may degrade"
                % (tag, seg_len, 8 * r))
        try:
            geom.wire(tag, seg, x1, y1, z1, x2, y2, z2, r, 1.0, 1.0)
        except Exception as e:
            fail("NEC_MODEL_INVALID_GEOMETRY",
                 "geom.wire(tag=%s) failed: %s" % (tag, e))
    ctx.geometry_complete(0)
    return {"n_wires": len(wires), "total_length_m": round(total_length, 4), "n_segments": n_segments}


def configure_ground(ctx, ground, warnings):
    g = ground or {"type": "free_space"}
    gtype = (g.get("type") or "free_space").lower()
    if gtype == "free_space":
        ctx.gn_card(-1, 0, 0, 0, 0, 0, 0, 0)
        return {"type": "free_space"}
    if gtype == "pec":
        ctx.gn_card(1, 0, 0, 0, 0, 0, 0, 0)
        warnings.append(
            "NEC_GROUND_MODEL_LIMITATION: PEC ground assumes ideal infinite "
            "perfectly-conducting earth.  For AM towers over real soil use "
            "type=sommerfeld with conductivity_s_m + dielectric_constant.")
        return {"type": "pec"}
    if gtype == "sommerfeld":
        epsr = float(g.get("dielectric_constant") or 13.0)
        sig  = float(g.get("conductivity_s_m") or 0.005)
        ctx.gn_card(2, 0, epsr, sig, 0, 0, 0, 0)
        return {"type": "sommerfeld",
                "dielectric_constant": epsr,
                "conductivity_s_m":    sig}
    fail("NEC_MODEL_INVALID_GEOMETRY", "unknown ground.type: %s" % gtype)


def configure_excitations(ctx, excitations, warnings):
    if not excitations:
        fail("NEC_MODEL_INVALID_GEOMETRY", "excitations required (at least one)")
    for e in excitations:
        try:
            tag = int(e["tag"])
            seg = int(e.get("segment", 1))
            vr  = float(e.get("voltage_real", 1.0))
            vi  = float(e.get("voltage_imag", 0.0))
        except Exception as ex:
            fail("NEC_MODEL_INVALID_GEOMETRY", "excitation field non-numeric: %s" % ex)
        ctx.ex_card(0, tag, seg, 0, vr, vi, 0, 0, 0, 0)


def configure_loads(ctx, loads):
    for L in loads or []:
        try:
            tag = int(L["tag"])
            seg = int(L.get("segment", 1))
            r   = float(L.get("r_ohm", 0))
            l   = float(L.get("l_h",   0))
            c   = float(L.get("c_f",   0))
        except Exception as ex:
            fail("NEC_MODEL_INVALID_GEOMETRY", "load field non-numeric: %s" % ex)
        ctx.ld_card(0, tag, seg, seg, r, l, c)


def run_pattern(ctx, p, warnings):
    p = p or {}
    th_start = float(p.get("theta_start", 90))
    th_stop  = float(p.get("theta_stop",  90))
    th_step  = float(p.get("theta_step",   1))
    ph_start = float(p.get("phi_start",    0))
    ph_stop  = float(p.get("phi_stop",   359))
    ph_step  = float(p.get("phi_step",     1))
    n_theta  = max(1, int(round((th_stop - th_start) / th_step)) + 1) if th_stop != th_start else 1
    n_phi    = max(1, int(round((ph_stop - ph_start) / ph_step)) + 1) if ph_stop != ph_start else 1
    ctx.rp_card(0, n_theta, n_phi, 0, 0, 0, 0,
                th_start, ph_start, th_step, ph_step, 0.0, 0.0)
    rp = ctx.get_radiation_pattern(0)
    gain = rp.get_gain()                                         # ndarray [n_theta, n_phi] dBi
    theta_deg = [round(th_start + i * th_step, 4) for i in range(n_theta)]
    phi_deg   = [round(ph_start + i * ph_step, 4) for i in range(n_phi)]
    gain_dbi  = [[float(gain[t, ph]) for ph in range(n_phi)] for t in range(n_theta)]
    return {
        "theta_deg": theta_deg,
        "phi_deg":   phi_deg,
        "gain_dbi":  gain_dbi
    }


def run_near_field(ctx, nf, warnings):
    if not nf or not nf.get("enabled"):
        return None
    pts = nf.get("points") or []
    if not pts:
        return []
    warnings.append(
        "NEC_NEAR_FIELD_APPROXIMATION: NEC2++ near-field is computed at the "
        "sample points using the assumed wire-current distribution from the "
        "MoM solve; uncertainty grows within ~λ/(8) of the conductors.")
    out_pts = []
    for i, p in enumerate(pts):
        try:
            x = float(p["x"]); y = float(p["y"]); z = float(p["z"])
        except Exception as e:
            warnings.append("near-field point %d skipped: %s" % (i, e))
            continue
        ctx.ne_card(0, 1, 1, 1, x, y, z, 0.0, 0.0, 0.0)
        try:
            ne = ctx.get_near_field_pattern(i)
            ex = ne.get_e_field()
            hx = ne.get_h_field()
            e_mag = math.sqrt(sum(abs(c) ** 2 for c in ex.flat))
            h_mag = math.sqrt(sum(abs(c) ** 2 for c in hx.flat))
            # Plane-wave-equivalent power density: S(W/m²) = E²/(2η₀), η₀=376.73Ω
            # → mW/cm² = ×0.1.
            s_mw_cm2 = (e_mag ** 2 / (2 * 376.73)) * 0.1
            out_pts.append({
                "x": x, "y": y, "z": z,
                "e_v_m":    round(e_mag, 6),
                "h_a_m":    round(h_mag, 6),
                "s_mw_cm2": round(s_mw_cm2, 6)
            })
        except Exception as e:
            warnings.append("near-field point %d failed: %s" % (i, e))
    return out_pts


def get_feedpoint_impedance(ctx, warnings):
    try:
        z = ctx.get_input_parameters(0)
        zr = float(z.get_impedance_real()[0])
        zi = float(z.get_impedance_imag()[0])
        gamma_num = math.sqrt((zr - 50.0) ** 2 + zi ** 2)
        gamma_den = math.sqrt((zr + 50.0) ** 2 + zi ** 2)
        gamma = gamma_num / gamma_den if gamma_den > 0 else 1.0
        vswr = (1 + gamma) / max(1e-9, (1 - gamma)) if gamma < 1.0 else None
        return {
            "r_ohm":   round(zr, 4),
            "x_ohm":   round(zi, 4),
            "vswr_50": round(vswr, 3) if vswr is not None and math.isfinite(vswr) else None
        }
    except Exception as e:
        warnings.append("feedpoint impedance read failed: %s" % e)
        return None


def optimize_pattern(base_model, target_bearing_deg, desired_suppression_db,
                     phase_step_deg=10, max_iterations=36):
    """
    Coarse grid search over phase offsets of all non-reference towers.
    Reference tower (first in array or tower with phase_deg == 0) is fixed.
    All others are swept from 0 to 360 in phase_step_deg increments.

    Returns:
    {
      "converged": bool,
      "optimal_phases_deg": [{"tag": int, "phase_deg": float}, ...],
      "achieved_suppression_db": float,
      "bearing_factor": float,   # field factor at target bearing [0..1]
      "pattern": {...},          # same format as run_model() pattern output
      "iterations": int
    }

    Supports 1-4 tower arrays. For a 2-tower array, sweeps the phase of
    tower 2. For 3+ towers, sweeps tower 2 phase with tower 3+ held at
    their base_model values (first pass only).
    """
    PyNEC, nec_context = import_pynec()

    towers = base_model.get("towers", [])
    if not towers:
        return {
            "converged": False,
            "optimal_phases_deg": [],
            "achieved_suppression_db": 0.0,
            "bearing_factor": 1.0,
            "pattern": None,
            "iterations": 0
        }

    # Build the frequency_mhz from frequency_khz if needed (match buildAmArrayModel)
    freq_mhz = base_model.get("frequency_mhz")
    if freq_mhz is None:
        freq_khz = base_model.get("frequency_khz")
        if freq_khz is None:
            return {
                "converged": False,
                "optimal_phases_deg": [],
                "achieved_suppression_db": 0.0,
                "bearing_factor": 1.0,
                "pattern": None,
                "iterations": 0
            }
        freq_mhz = float(freq_khz) / 1000.0

    ground = base_model.get("ground") or {
        "type": "sommerfeld", "conductivity_s_m": 0.005, "dielectric_constant": 13
    }
    pattern_spec = base_model.get("pattern") or {
        "theta_start": 90, "theta_stop": 90, "theta_step": 1,
        "phi_start": 0, "phi_stop": 359, "phi_step": 1
    }

    def run_candidate(candidate_towers):
        """Build and run one NEC model for the given tower drive phases."""
        ctx = nec_context()
        warnings_inner = []

        wires = []
        excitations = []
        for t in candidate_towers:
            tag = int(t["tag"])
            segs = int(t.get("segments", 21))
            x = float(t.get("x_m", 0))
            y = float(t.get("y_m", 0))
            h = float(t.get("height_m", 75))
            r = float(t.get("radius_m", 0.25))
            wires.append({
                "tag": tag, "segments": segs,
                "x1": x, "y1": y, "z1": 0,
                "x2": x, "y2": y, "z2": h,
                "radius_m": r
            })
            amp = float(t.get("drive", {}).get("amplitude", 1.0))
            ph_deg = float(t.get("drive", {}).get("phase_deg", 0))
            ph_rad = ph_deg * math.pi / 180.0
            excitations.append({
                "tag": tag, "segment": 1,
                "voltage_real": amp * math.cos(ph_rad),
                "voltage_imag": amp * math.sin(ph_rad)
            })

        make_geometry(ctx, wires, warnings_inner)
        configure_ground(ctx, ground, warnings_inner)
        configure_excitations(ctx, excitations, warnings_inner)
        ctx.fr_card(0, 1, freq_mhz, 0)
        return run_pattern(ctx, pattern_spec, warnings_inner)

    def gain_at_bearing(pattern, bearing_deg):
        """Find gain_dbi at theta=90 (horizon), nearest phi to bearing_deg."""
        theta_degs = pattern["theta_deg"]
        phi_degs   = pattern["phi_deg"]
        gain_dbi   = pattern["gain_dbi"]

        # Find theta index closest to 90
        best_t = 0
        best_dt = abs(theta_degs[0] - 90.0)
        for i, td in enumerate(theta_degs):
            dt = abs(td - 90.0)
            if dt < best_dt:
                best_dt = dt
                best_t = i

        row = gain_dbi[best_t]

        # Normalise target bearing to [0, 360)
        target = float(bearing_deg) % 360.0

        # Find phi index with minimum angular distance
        best_p = 0
        best_dp = float('inf')
        for i, pd in enumerate(phi_degs):
            dp = abs((float(pd) - target + 180.0) % 360.0 - 180.0)
            if dp < best_dp:
                best_dp = dp
                best_p = i

        return float(row[best_p])

    def compute_suppression(pattern):
        """Suppression = peak_gain_dbi - gain_at_bearing_dbi (at horizon)."""
        theta_degs = pattern["theta_deg"]
        phi_degs   = pattern["phi_deg"]
        gain_dbi   = pattern["gain_dbi"]

        # Find horizon row
        best_t = 0
        best_dt = abs(theta_degs[0] - 90.0)
        for i, td in enumerate(theta_degs):
            dt = abs(td - 90.0)
            if dt < best_dt:
                best_dt = dt
                best_t = i

        row = gain_dbi[best_t]
        finite_vals = [v for v in row if math.isfinite(v)]
        if not finite_vals:
            return 0.0, 0.0, 0.0

        peak_dbi = max(finite_vals)
        bearing_dbi = gain_at_bearing(pattern, target_bearing_deg)
        suppression = peak_dbi - bearing_dbi
        # bearing_factor in field (linear): 10^((bearing_dbi - peak_dbi)/20)
        factor = pow(10.0, (bearing_dbi - peak_dbi) / 20.0)
        return suppression, factor, bearing_dbi

    # Phase steps to try
    steps = max(1, int(round(360.0 / phase_step_deg)))
    phases_to_try = [i * phase_step_deg for i in range(steps)]

    # Best state
    best_suppression = -float('inf')
    best_pattern = None
    best_phases = [{"tag": int(t["tag"]),
                    "phase_deg": float(t.get("drive", {}).get("phase_deg", 0))}
                   for t in towers]
    best_factor = 1.0

    # Reference tower is index 0 (or first tower — kept fixed).
    # We sweep tower index 1 (tag 2 in a 2-tower array).
    iterations = 0

    if len(towers) < 2:
        # Single tower — run once, report suppression (may be 0 if omni)
        try:
            pattern = run_candidate(towers)
            suppression, factor, _ = compute_suppression(pattern)
            converged = suppression >= desired_suppression_db
            return {
                "converged": converged,
                "optimal_phases_deg": [{"tag": int(towers[0]["tag"]),
                                        "phase_deg": float(towers[0].get("drive", {}).get("phase_deg", 0))}],
                "achieved_suppression_db": round(suppression, 4),
                "bearing_factor": round(factor, 6),
                "pattern": pattern,
                "iterations": 1
            }
        except SystemExit:
            raise
        except Exception:
            return {
                "converged": False,
                "optimal_phases_deg": [],
                "achieved_suppression_db": 0.0,
                "bearing_factor": 1.0,
                "pattern": None,
                "iterations": 0
            }

    for ph in phases_to_try:
        if iterations >= max_iterations:
            break

        # Build candidate tower list: reference tower unchanged, tower[1] swept,
        # tower[2+] kept at base model values.
        candidate = []
        for idx, t in enumerate(towers):
            tc = dict(t)
            drive = dict(t.get("drive") or {})
            if idx == 1:
                drive["phase_deg"] = ph
            tc["drive"] = drive
            candidate.append(tc)

        try:
            pattern = run_candidate(candidate)
        except SystemExit:
            raise
        except Exception:
            iterations += 1
            continue

        suppression, factor, _ = compute_suppression(pattern)
        iterations += 1

        if suppression > best_suppression:
            best_suppression = suppression
            best_pattern = pattern
            best_factor = factor
            best_phases = [{"tag": int(t2["tag"]),
                            "phase_deg": float(t2.get("drive", {}).get("phase_deg", 0))}
                           for t2 in candidate]

        if suppression >= desired_suppression_db:
            break  # converged — stop early

    converged = best_suppression >= desired_suppression_db
    return {
        "converged": converged,
        "optimal_phases_deg": best_phases,
        "achieved_suppression_db": round(best_suppression, 4),
        "bearing_factor": round(best_factor, 6),
        "pattern": best_pattern,
        "iterations": iterations
    }


def main_run():
    PyNEC, nec_context = import_pynec()
    body = read_input()
    warnings = []

    if not isinstance(body, dict) or "frequency_mhz" not in body:
        fail("NEC_MODEL_INVALID_GEOMETRY", "frequency_mhz required")
    f_mhz = float(body["frequency_mhz"])
    if f_mhz <= 0 or f_mhz > 30000:
        fail("NEC_MODEL_INVALID_GEOMETRY", "frequency_mhz out of range")

    ctx = nec_context()
    geom_summary = make_geometry(ctx, body.get("wires", []), warnings)
    ground_meta  = configure_ground(ctx, body.get("ground"), warnings)
    configure_excitations(ctx, body.get("excitations", []), warnings)
    configure_loads(ctx, body.get("loads"))

    ctx.fr_card(0, 1, f_mhz, 0)

    pattern   = run_pattern(ctx, body.get("pattern"), warnings)
    feedpoint = get_feedpoint_impedance(ctx, warnings)
    near_field = run_near_field(ctx, body.get("near_field"), warnings)

    out({
        "ok":            True,
        "model_valid":   True,
        "frequency_mhz": f_mhz,
        "geometry":      geom_summary,
        "ground":        ground_meta,
        "feedpoint":     feedpoint,
        "pattern":       pattern,
        "near_field":    near_field,
        "warnings":      warnings,
        "pynec_version": getattr(PyNEC, "__version__", "unknown")
    })


def main_optimize():
    """Entry point for optimize-pattern: reads JSON from stdin, runs grid search, writes result."""
    body = read_input()
    if not isinstance(body, dict):
        fail("INVALID_INPUT", "expected JSON object on stdin")

    base_model = body.get("base_model")
    if not isinstance(base_model, dict):
        fail("INVALID_INPUT", "base_model required (object)")

    target_bearing = body.get("target_bearing_deg")
    if not isinstance(target_bearing, (int, float)):
        fail("INVALID_INPUT", "target_bearing_deg required (number)")

    desired_suppression = body.get("desired_suppression_db")
    if not isinstance(desired_suppression, (int, float)) or desired_suppression <= 0:
        fail("INVALID_INPUT", "desired_suppression_db required (number > 0)")

    phase_step  = float(body.get("phase_step_deg",  10))
    max_iter    = int(body.get("max_iterations",    36))

    result = optimize_pattern(
        base_model,
        float(target_bearing),
        float(desired_suppression),
        phase_step_deg=phase_step,
        max_iterations=max_iter
    )
    out({"ok": True, **result})


if __name__ == "__main__":
    if "--probe" in sys.argv:
        probe()
        sys.exit(0)
    if "--optimize" in sys.argv:
        try:
            main_optimize()
        except SystemExit:
            raise
        except Exception as e:
            fail("NEC_BRIDGE_UNHANDLED", "unhandled optimize error: %s" % e, code=3)
        sys.exit(0)
    try:
        main_run()
    except SystemExit:
        raise
    except Exception as e:
        fail("NEC_BRIDGE_UNHANDLED", "unhandled bridge error: %s" % e, code=3)
