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
