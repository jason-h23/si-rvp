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
generator, and Groth16 keys. The first run downloads the Powers of
Tau ceremony output and runs the Phase-2 setup; expect 5-15 minutes
on a modern laptop. Subsequent runs reuse the cached artifacts.

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

Expected output: per-operation gas costs that match the "Direct Path"
column of [`docs/paper-gas-data.md`](paper-gas-data.md) Table 2 to
within Hardhat's measurement noise (a few hundred gas per operation).

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

Expected wall-clock: ~47 minutes end-to-end. The script reports
gas-used and transaction hashes after each phase; these should match
the values in [`docs/paper-gas-data.md`](paper-gas-data.md) Table 3
(Sepolia E2E Transaction Hashes) within block-to-block variance.

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
| ZK verification gas | ~233,464 |
| Full dispute lifecycle (timeout) | ~431,549 |
| Full dispute lifecycle (proof submission) | ~658,533 |
| Sepolia wall-clock (end-to-end) | ~47 minutes |
| Single-step proof generation | ~880 ms (Apple M-series ARM64) |

Deviation > 5% on a fresh checkout indicates an environmental issue
(version mismatch or modified circuit/contract); please open an issue
with the full benchmark output and your tool versions.
