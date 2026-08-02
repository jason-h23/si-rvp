# Reproducibility Guide

End-to-end reproduction of the SI-RVP measurements reported in the
paper.

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.x or newer | Workspace root requires `>=20.0.0` |
| npm | 10.x | Comes with Node 20 |
| circom | 2.1.x | https://docs.circom.io/getting-started/installation/ |
| Foundry (optional) | latest stable | For interacting with Sepolia |
| Python | 3.10+ | For dashboard exporter only |

Cloning a fresh workspace from a clean Node 20 install takes about 2-3
minutes for `npm install`.

## 2. Clone and install

```bash
git clone <REPO-URL> si-rvp
cd si-rvp
npm install
```

`npm install` resolves all three workspaces (`contracts`, `circuits`,
`node`) from a single root `package-lock.json`.

## 3. Build contracts

```bash
npm run compile:contracts
```

This invokes `hardhat compile` inside `contracts/`. Expected output:
6 contracts compiled (DisputeGameFactory, DisputeManager,
RollupManager, ZKDisputeGameProxy, ZKVerifier, Groth16Verifier) plus
their interfaces and OpenZeppelin imports.

## 4. Build circuits

```bash
npm run compile:circuits
```

Compiles `circuits/src/mips_single_step.circom` to R1CS, witness
generator (WASM), and symbol table, then prints the constraint count.
Expect 37,026 constraints (16,857 non-linear + 20,169 linear) — the
figure reported in the paper.

Proving and verification keys are published under `circuits/build/`,
so proof generation works straight from a fresh clone. To regenerate
them instead, run `npm run setup -w circuits`; the first run downloads
the Powers of Tau ceremony output and runs the Phase-2 setup, which
takes 5-15 minutes on a modern laptop.

> The setup script uses a single-party Phase-2 contribution suitable
> only for benchmarking. See [`docs/deployment.md`](deployment.md)
> for the multi-party MPC ceremony required before any production
> deployment.

## 5. Unit tests

```bash
npm test
```

Runs the contracts test suite (Hardhat + Mocha + Chai), the circuit
benchmarks, and the off-chain node tests. Total runtime ~3-5 minutes
after circuits are built.

## 6. Local end-to-end (Hardhat)

In one shell, start a local node:

```bash
cd contracts && npx hardhat node
```

In another shell, run the on-chain E2E script:

```bash
cd node && npx tsx src/scripts/onchain-e2e.ts --network localhost
```

Expected output: per-operation gas costs that match Table 1 of
[`docs/paper-gas-data.md`](paper-gas-data.md) to within Hardhat's
measurement noise (a few hundred gas per operation). Table 1 is the
2026-05-29 post-correction measurement set and is the reference for
every gas figure in the paper. Do not compare against Table 2 — its
direct-path column is the superseded 2026-03 build, retained only to
quantify the Phase-7 proxy overhead.

## 7. Sepolia end-to-end (optional)

Requires:

```
SEPOLIA_RPC_URL=...
SEPOLIA_PRIVATE_KEY=...
```

in `.env` (see `.env.example`). The funded account needs ~0.1 ETH on
Sepolia.

```bash
cd node && npx tsx src/scripts/onchain-e2e.ts --network sepolia
```

Expected wall-clock: **seconds of bisection, not 47 minutes.** The
script runs a short toy trace whose bisection completes in a few
rounds. The ~47-minute figure in the paper is a model-based projection
for the production parameter set ($T = 2^{73}$, 73 rounds), dominated
by four sequential L1 confirmations at an assumed 10-12 minutes each;
it is not a stopwatch reading of this script, and reproducing it is
not the point of this step. What this step reproduces is the *gas* and
the on-chain lifecycle.

The script reports gas-used and transaction hashes after each phase;
these should match the "Sepolia lifecycle transactions (2026-05-29)"
table in [`docs/paper-gas-data.md`](paper-gas-data.md) within
block-to-block variance. Note that your run produces new transaction
hashes — the listed hashes are the authors' measured run, verifiable
on Sepolia explorers, and are also recorded in
[`contracts/deployments/sepolia-2026-05-29.json`](../contracts/deployments/sepolia-2026-05-29.json).

## 8. Reproducing the gas tables

The benchmark harness lives in
`contracts/test/gas-benchmark.test.ts`. Run it with:

```bash
cd contracts && npx hardhat test test/gas-benchmark.test.ts
```

Output is a stable per-operation table that matches Table 1 of
[`docs/paper-gas-data.md`](paper-gas-data.md). Differences greater
than ~1% indicate a hardhat or solc version mismatch — the paper used
solc 0.8.24 with optimizer 200 runs.

## Expected results

| Measurement | Expected value |
|-------------|----------------|
| R1CS constraints | 37,026 (16,857 non-linear + 20,169 linear) |
| `submitProof` gas (Groth16 verification tx) | ~279,930 |
| `submitBisectionResult` gas | ~90,754 |
| Full dispute lifecycle, proof path (5 tx) | 825,750 |
| Full dispute lifecycle, timeout path (3 tx) | 436,279 |
| Single-step proof generation (ALU family) | ~700 ms (Apple M-series ARM64) |
| PoC end-to-end wall-clock | seconds (toy trace) — see §7 |

All gas figures are from the 2026-05-29 post-correction Sepolia
redeployment. The timeout-path total composes the measured
`initiateDispute` and `depositSequencerBond` with the local Hardhat
`triggerTimeout` benchmark (86,480 gas), which was not exercised on
Sepolia.

Deviation > 5% on a fresh checkout indicates an environmental issue
(version mismatch or modified circuit/contract); please open an issue
with the full benchmark output and your tool versions.
