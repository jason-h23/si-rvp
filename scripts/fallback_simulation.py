"""Fallback rate simulation for SI-RVP permissionless validation.

Model
-----
A pool of N validators independently monitors each L2 batch. Each validator
is honest with probability h, so the probability that no honest validator
detects a given fraud (i.e. the dispute falls back to the optimistic Cannon
path) is::

    P(fallback) = (1 - h) ** N

The closed form is the ground truth for this independence model. We also
run a Monte Carlo simulation as a sanity check that the simulator and the
formula agree. Note that Monte Carlo can only resolve rates above its
sampling floor of ~1/n_trials; for rates below that floor the MC estimate
is zero by sampling, not by truth, so the figure omits those markers.

Outputs
-------
- ``paper/figures/fig_fallback_rate.pdf`` (vector)
- ``paper/figures/fig_fallback_rate.png`` (raster, 300 dpi)
- stdout: a (N, h) table of closed-form fallback probabilities

CLI
---
::

    python3 fallback_simulation.py --trials 100000 --seed 42
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


def closed_form_rate(N: int, h: float) -> float:
    """P(all N validators dishonest) = (1-h)^N. h in [0, 1]."""
    if not 0.0 <= h <= 1.0:
        raise ValueError(f"h must be in [0, 1], got {h}")
    if N <= 0:
        raise ValueError(f"N must be positive, got {N}")
    return (1.0 - h) ** N


def monte_carlo_rate(
    N: int,
    h: float,
    n_trials: int,
    rng: np.random.Generator,
) -> float:
    """Empirical fallback rate over n_trials independent batches."""
    if not 0.0 <= h <= 1.0:
        raise ValueError(f"h must be in [0, 1], got {h}")
    if N <= 0:
        raise ValueError(f"N must be positive, got {N}")
    if n_trials <= 0:
        raise ValueError(f"n_trials must be positive, got {n_trials}")
    honest_draws = rng.random((n_trials, N)) < h
    no_honest = ~honest_draws.any(axis=1)
    return float(no_honest.mean())


# ---------------------------------------------------------------------
# Common-cause (shared-infrastructure) extension.
#
# A fraction s of the pool shares infrastructure (cloud region, RPC
# provider, operator identity). With probability q per challenge
# window, a shared-infrastructure event (e.g. a stale RPC view)
# blinds ALL shared validators simultaneously; the remaining
# ceil(N*(1-s)) validators detect independently as before.
#
#   P(fallback) = q * (1-h)^(N - round(N*s)) + (1-q) * (1-h)^N
#
# For s = 1 the exponential decay collapses to a floor of q: no pool
# size overcomes a fully shared blind spot.
# ---------------------------------------------------------------------

def closed_form_rate_shared(N: int, h: float, s: float, q: float) -> float:
    """Fallback probability under the common-cause model."""
    for name, v in (("h", h), ("s", s), ("q", q)):
        if not 0.0 <= v <= 1.0:
            raise ValueError(f"{name} must be in [0, 1], got {v}")
    if N <= 0:
        raise ValueError(f"N must be positive, got {N}")
    n_shared = int(round(N * s))
    n_indep = N - n_shared
    return q * (1.0 - h) ** n_indep + (1.0 - q) * (1.0 - h) ** N


def monte_carlo_rate_shared(
    N: int,
    h: float,
    s: float,
    q: float,
    n_trials: int,
    rng: np.random.Generator,
) -> float:
    """Empirical fallback rate under the common-cause model."""
    n_shared = int(round(N * s))
    outage = rng.random(n_trials) < q
    honest = rng.random((n_trials, N)) < h
    if n_shared > 0:
        honest[outage, :n_shared] = False
    no_honest = ~honest.any(axis=1)
    return float(no_honest.mean())


def run(out_dir: Path, n_trials: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    N_values = [1, 3, 5, 10, 20, 50, 100]
    h_values = [0.50, 0.70, 0.90, 0.99]

    results_cf = {h: [closed_form_rate(N, h) for N in N_values] for h in h_values}
    results_mc = {
        h: [monte_carlo_rate(N, h, n_trials, rng) for N in N_values]
        for h in h_values
    }

    header = f"{'N':>4} | " + " | ".join(f"h={h:.2f} (cf)   MC" for h in h_values)
    print(header)
    print("-" * len(header))
    for i, N in enumerate(N_values):
        cells = []
        for h in h_values:
            cells.append(f"{results_cf[h][i]:.3e} {results_mc[h][i]:.3e}")
        print(f"{N:>4} | " + " | ".join(cells))

    fig, ax = plt.subplots(figsize=(7.0, 4.5))
    markers = ["o", "s", "^", "D"]
    # Distinct linestyles so analytic curves remain distinguishable in B&W print.
    linestyles = ["-", "--", "-.", ":"]
    N_arr = np.array(N_values)
    for h, marker, ls in zip(h_values, markers, linestyles):
        ax.semilogy(N_values, results_cf[h], ls, label=f"h = {h:.2f} (analytic)")
        # Skip MC markers below the sampling floor (rate < 1/n_trials).
        # MC reports 0 for those cells, which is a sampling-floor artifact,
        # not a measurement; plotting them creates a misleading horizontal line.
        mc_arr = np.array(results_mc[h])
        detectable = mc_arr > 0
        if detectable.any():
            ax.semilogy(
                N_arr[detectable],
                mc_arr[detectable],
                marker,
                alpha=0.6,
                label=f"h = {h:.2f} (MC, n={n_trials})",
            )
    ax.set_xlabel("Validator pool size $N$")
    ax.set_ylabel("Fallback probability (log scale)")
    ax.set_title("SI-RVP fallback rate vs. validator pool size")
    ax.legend(loc="lower left", fontsize=8, ncol=2)
    ax.grid(True, which="both", linestyle="--", alpha=0.4)
    ax.set_ylim(1e-12, 1.0)
    # Annotation: MC markers are omitted where the empirical rate is 0
    # (i.e. below the sampling floor of 1/n_trials).
    ax.text(
        0.99,
        0.02,
        f"MC markers omitted where rate < 1/{n_trials} (below detection limit)",
        transform=ax.transAxes,
        fontsize=7,
        ha="right",
        va="bottom",
        alpha=0.7,
    )
    plt.tight_layout()

    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / "fig_fallback_rate.pdf"
    png_path = out_dir / "fig_fallback_rate.png"
    plt.savefig(pdf_path)
    plt.savefig(png_path, dpi=300)
    print(f"\nSaved: {pdf_path}")
    print(f"Saved: {png_path}")

    # ------------------------------------------------------------------
    # Second figure: common-cause (shared-infrastructure) sensitivity.
    # Fixed h = 0.5 (conservative); curves parameterized by the shared
    # fraction s at a per-window shared-outage probability q = 0.1.
    # ------------------------------------------------------------------
    h_fix = 0.50
    q_fix = 0.10
    scenarios = [
        (0.0, "-", "o", "independent ($s=0$)"),
        (0.5, "--", "s", "$s=0.5$ shared"),
        (0.8, "-.", "^", "$s=0.8$ shared"),
        (1.0, ":", "D", "$s=1.0$ shared (floor $=q$)"),
    ]

    print(f"\nCommon-cause model, h={h_fix}, q={q_fix}:")
    header2 = f"{'N':>4} | " + " | ".join(f"s={s:.1f} (cf)    MC" for s, *_ in scenarios)
    print(header2)
    print("-" * len(header2))
    results_shared_cf = {}
    results_shared_mc = {}
    for s, *_ in scenarios:
        results_shared_cf[s] = [closed_form_rate_shared(N, h_fix, s, q_fix) for N in N_values]
        results_shared_mc[s] = [
            monte_carlo_rate_shared(N, h_fix, s, q_fix, n_trials, rng)
            for N in N_values
        ]
    for i, N in enumerate(N_values):
        cells = [
            f"{results_shared_cf[s][i]:.3e} {results_shared_mc[s][i]:.3e}"
            for s, *_ in scenarios
        ]
        print(f"{N:>4} | " + " | ".join(cells))

    fig2, ax2 = plt.subplots(figsize=(7.0, 4.5))
    for s, ls, marker, lab in scenarios:
        ax2.semilogy(N_values, results_shared_cf[s], ls, label=f"{lab} (analytic)")
        mc_arr = np.array(results_shared_mc[s])
        detectable = mc_arr > 0
        if detectable.any():
            ax2.semilogy(
                N_arr[detectable], mc_arr[detectable], marker,
                alpha=0.6, label=f"{lab} (MC)",
            )
    ax2.axhline(q_fix, color="black", lw=0.8, alpha=0.5)
    ax2.text(1.2, q_fix * 1.25, f"systemic floor $q = {q_fix}$", fontsize=8)
    ax2.set_xlabel("Validator pool size $N$")
    ax2.set_ylabel("Fallback probability (log scale)")
    ax2.set_title(
        f"Fallback rate under shared infrastructure "
        f"($h={h_fix}$, shared-outage prob.\\ $q={q_fix}$)"
    )
    ax2.legend(loc="lower left", fontsize=8, ncol=2)
    ax2.grid(True, which="both", linestyle="--", alpha=0.4)
    ax2.set_ylim(1e-12, 1.0)
    plt.tight_layout()

    pdf2 = out_dir / "fig_fallback_correlated.pdf"
    png2 = out_dir / "fig_fallback_correlated.png"
    plt.savefig(pdf2)
    plt.savefig(png2, dpi=300)
    print(f"Saved: {pdf2}")
    print(f"Saved: {png2}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "figures",
        help="output directory for figure files",
    )
    parser.add_argument(
        "--trials",
        type=int,
        default=100_000,
        help="Monte Carlo trial count per (N, h) pair",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="random seed for reproducibility",
    )
    args = parser.parse_args()
    if args.trials <= 0:
        parser.error("--trials must be positive")
    if args.seed < 0:
        parser.error("--seed must be non-negative")
    return args


if __name__ == "__main__":
    args = parse_args()
    run(args.out, args.trials, args.seed)
