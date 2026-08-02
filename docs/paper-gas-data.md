# SI-RVP Paper: Gas Comparison Data

Reference gas data backing the evaluation section of the SI-RVP manuscript.

Unless a row says otherwise, every figure below was measured end-to-end on the **2026-05-29
post-correction Sepolia redeployment** (chainId 11155111, solc 0.8.24, optimizer enabled,
200 runs). USD estimates assume ETH = $3,000.

The machine-readable record of that deployment — addresses, block numbers, transaction hashes,
and gas used for every lifecycle step — is
[`contracts/deployments/sepolia-2026-05-29.json`](../contracts/deployments/sepolia-2026-05-29.json).

### Measurement history

This file previously carried a 2026-03-04 measurement set. That set was taken before the
bisection-commitment binding fix: the on-chain commitment check did not read the pre/post state
hashes at the circom signal positions `publicInputs[1]` and `publicInputs[2]`, so the off-chain
bisection terminal step was not actually bound to the ZK proof. Fixing that changed both the
contract bytecode and the shape of the dispute lifecycle — the corrected protocol has a
`submitBisectionResult` transaction that the 2026-03 lifecycle did not, making it a
**five-transaction** proof path rather than four operations. The core contracts were redeployed
on 2026-05-29 and the full lifecycle was re-executed with a real single-instruction Groth16
proof that passed on-chain verification. All figures in this file are from that re-measurement;
the 2026-03 numbers are superseded and are retained only where explicitly labelled as the
Phase-7 factory-path benchmark, which the fix did not affect.

---

## Table 1: ZK Dispute Resolution Gas Costs

Per-operation costs on the direct `DisputeManager` path (no factory overhead).

| Operation | Gas Used | Notes |
|-----------|----------:|-------|
| `proposeStateRoot` | 119,431 | Sequencer submits new state root to RollupManager |
| `initiateDispute` | 301,236 | Challenger opens dispute with bond (0.01 ETH) |
| `depositSequencerBond` | 48,563 | Sequencer posts response bond |
| `submitBisectionResult` | ~90,754 | On-chain commit of the co-signed bisection result |
| `submitProof` | ~279,930 | ZK Groth16 verification (BN254 pairing pre-compile) |
| `resolveDispute` | 105,267 | On-chain resolution after proof accepted |
| `triggerTimeout` | 86,480 ᵃ | Challenger wins when sequencer fails to submit proof |

ᵃ `triggerTimeout` was not exercised on the 2026-05-29 redeployment. Its figure comes from the
local Hardhat benchmark of the identical contract build (`contracts/test/gas-benchmark.test.ts`);
a Sepolia factory-path timeout resolution measured 61,869 gas through the proxy.

**Measured total dispute lifecycle (direct path):**

| Path | Transactions | Gas Total |
|------|-------------:|----------:|
| initiate + bond + bisection + proof + resolve | 5 | **825,750** |
| initiate + bond + triggerTimeout | 3 | **436,279** ᵃ |

The proof path is a genuine end-to-end Sepolia measurement of all five transactions. The
timeout-path total is a composition of the redeployment's measured `initiateDispute` and
`depositSequencerBond` with the Hardhat `triggerTimeout` benchmark, not an end-to-end Sepolia
measurement.

Four of the five proof-path transactions form the sequential critical path
(`initiateDispute` → `submitBisectionResult` → `submitProof` → `resolveDispute`); each needs the
previous transaction's state. `depositSequencerBond` carries gas but contributes no sequential
latency, because no later entry point is gated on the bond and the sequencer posts it
concurrently with the off-chain bisection phase.

---

## Table 2: Direct Path vs Factory Path (2026-03 Phase-7 benchmark)

Side-by-side comparison between the native SI-RVP path and the Phase-7 Optimism-compatible
Factory → Proxy → DisputeManager path, measured via `gas-benchmark.test.ts`.

> **Vintage note.** Both columns below are from the same 2026-03 build, so the overhead deltas
> are internally consistent. The Phase-7 factory contracts were unaffected by the
> commitment-binding fix and were not redeployed. The *direct-path* figures in this table are
> superseded for citation purposes by Table 1; this table is retained only to quantify the
> proxy overhead, which is a property of the factory path rather than of the corrected protocol.

| Operation | Direct Path | Factory Path | Overhead |
|-----------|------------:|-------------:|----------:|
| Initiate / Challenge | 298,872 | 347,254 | +48,382 (+16.2%) |
| Factory.create() | N/A | 319,838 | one-time per game |
| addAuthorizedProxy() | N/A | 45,266 | one-time setup |
| depositSequencerBond | 46,197 | 46,197 | 0 (direct call) |
| triggerTimeout | 86,480 | 86,480 | 0 (direct call) |
| Resolve | 86,480 | 67,312 | -19,168 (-22.2%) |
| **Total lifecycle (timeout)** | **431,549** | **912,347** | +480,798 |

**Key insight**: the factory path adds ~48,382 gas per challenge (16.2%) for the proxy delegate
call. `Factory.create()` (319,838 gas) is a one-time cost to instantiate each game clone. That
overhead buys Optimism `IDisputeGame` compatibility, and it is incurred once per dispute rather
than once per bisection round.

---

## Table 3: Deployment Costs

Contract deployment gas on Sepolia. The four core contracts were redeployed on 2026-05-29; the
two Phase-7 factory contracts remain at their 2026-03-04 deployment.

| Contract | Deployment Gas | Vintage | Role |
|----------|---------------:|---------|------|
| Groth16Verifier | 366,491 | 2026-03 | Auto-generated Solidity verifier from snarkjs |
| ZKVerifier | 706,653 | 2026-03 | Wrapper for Groth16Verifier with array conversion |
| RollupManager | 826,524 | 2026-03 | State root submission and batch lifecycle |
| DisputeManager | 1,730,828 | 2026-03 | Dispute coordination and resolution |
| DisputeManager (post-correction) | 1,900,728 | **2026-05-29** | Redeployment carrying the commitment binding |
| ZKDisputeGameProxy | 804,691 | 2026-03 | Adapter: IDisputeGame → DisputeManager (Phase 7) |
| DisputeGameFactory | 587,176 | 2026-03 | EIP-1167 minimal clone factory (Phase 7) |

> The 2026-05-29 `DisputeManager` deployment is
> `0x8987bfdf80a75383ce156d89a28a19c08fd498e4b35a217c1dbb99725eecfb18` (block 10947998). The
> ~170K gas increase over the 2026-03 build is the commitment-binding check added in the fix.
> Local Hardhat measurements of the 2026-03 build: DisputeManager 1,850,009 gas,
> ZKDisputeGameProxy 828,711 gas.

---

## Table 4: Cost Estimates

USD cost at various gas prices with ETH = $3,000.

### Full dispute lifecycle, proof path (825,750 gas)

| Gas Price | Cost (ETH) | Cost (USD) |
|-----------|------------|------------|
| 10 Gwei | 0.008258 ETH | $24.77 |
| 30 Gwei | 0.024773 ETH | $74.32 |
| 50 Gwei | 0.041288 ETH | $123.86 |
| 100 Gwei | 0.082575 ETH | $247.73 |

The 30 Gwei row is the normalisation used in the manuscript: ~USD 74.32 per fully played dispute.

### Full dispute lifecycle, timeout path (436,279 gas)

| Gas Price | Cost (ETH) | Cost (USD) |
|-----------|------------|------------|
| 10 Gwei | 0.004363 ETH | $13.09 |
| 30 Gwei | 0.013088 ETH | $39.27 |
| 50 Gwei | 0.021814 ETH | $65.44 |
| 100 Gwei | 0.043628 ETH | $130.88 |

### ZK verification only (`submitProof`, 279,930 gas)

| Gas Price | Cost (ETH) | Cost (USD) |
|-----------|------------|------------|
| 10 Gwei | 0.002799 ETH | $8.40 |
| 30 Gwei | 0.008398 ETH | $25.19 |
| 50 Gwei | 0.013997 ETH | $41.99 |
| 100 Gwei | 0.027993 ETH | $83.98 |

---

## Key Metrics Summary

### ZK verification

- **Measured gas**: 279,930 for the full `submitProof` transaction on Sepolia — calldata,
  storage writes, and the Groth16 pairing check together, not the pairing check alone.
- **Algorithm**: Groth16 pairing check over BN254, via the pairing pre-compile.
- **Constraint system**: 37,026 R1CS constraints (16,857 non-linear + 20,169 linear), reproducible
  from source with `npm run compile:circuits`.
- **Proof generation time**: ~700 ms average for ALU-family steps (Apple M-series ARM64). A
  memory-operation leaf additionally pays Merkle-witness generation — up to ~94 s for `SW` in the
  unoptimized JavaScript harness.

### Total dispute lifecycle

| Scenario | Transactions | Gas |
|----------|-------------:|----:|
| Proof path (Sepolia, measured) | 5 | 825,750 |
| Timeout path (composed) | 3 | 436,279 |
| Factory path, timeout (2026-03 benchmark) | — | 912,347 |

We deliberately do **not** summarise the comparison against Cannon as a single reduction
multiplier. The Cannon figure is an order-of-magnitude estimate assembled from specification and
monitoring pages rather than a measured, fully played dispute, so any ratio would inherit that
uncertainty in its denominator. See the structural comparison below.

### Sepolia lifecycle transactions (2026-05-29, post-correction)

All transactions confirmed on Ethereum Sepolia (chainId 11155111). These are the hashes backing
every figure in Table 1 and are listed in the manuscript appendix.

| Operation | Block | Gas Used | Transaction Hash |
|-----------|------:|----------:|------------------|
| DisputeManager deployment | 10947998 | 1,900,728 | `0x8987bfdf80a75383ce156d89a28a19c08fd498e4b35a217c1dbb99725eecfb18` |
| proposeStateRoot | 10948001 | 119,431 | `0xbbcfd24190387e3f05131a47273399c3042f4441fe7bfd62fdfc58f6c5f52234` |
| initiateDispute | 10948002 | 301,236 | `0x65636a0adda1ab58dbe02cf17c03b5c296948de2a82c7b9bae17dc9eb89cfc96` |
| depositSequencerBond | 10948003 | 48,563 | `0x10a8c444a0b63ef8ad56536c3c26eb9fabc4d58280c6512bcd0e21853f1c7221` |
| submitBisectionResult | 10948004 | 90,754 | `0x4ef1c6242dce50a936f6ddcabf7888a43d918859fee3963e303e8d6eaa59e13f` |
| submitProof | 10948005 | 279,930 | `0xf49e6517bb2cadb2d1d7af856f112091196946311b5b3c71d1cafda630a14207` |
| resolveDispute | 10948447 | 105,267 | `0x8abc13c5b2a23036160cce6ec9b7b7416081d073ec57030cd8d80a5a6c74b5eb` |
| **Lifecycle total (5 tx)** | — | **825,750** | initiate + bond + bisection + proof + resolve |

**Deployed contracts (2026-05-29 core redeployment)**:

| Contract | Address |
|----------|---------|
| Groth16Verifier | `0x81f6a41774c0A4627A116BD417744AaCf7092Ad4` |
| ZKVerifier | `0xeDa3C0429D49cc10f4A36082d6F8a537B6bd923F` |
| RollupManager | `0xC6390919eA2f96853E9044291AD421e4C8ae4492` |
| DisputeManager | `0xA0771DC8f9668342fC435174145953B9Ab36f534` |

**Phase-7 factory-path contracts (2026-03-04, not redeployed)**:

| Contract | Address |
|----------|---------|
| DisputeGameFactory | `0x2714cC2c244aFbbd7375d714E6373f7aE462F516` |
| ZKDisputeGameProxy (impl) | `0xAeb354514CcbBB47aDaaE2afBA7BaC9d34049dA4` |

### Phase-7 factory-path E2E (2026-03-04)

Retained because the factory path was not redeployed. This exercised the timeout path through
the proxy, not the corrected five-transaction proof path.

| Operation | Gas Used | Transaction Hash |
|-----------|----------:|------------------|
| proposeStateRoot | 119,431 | `0x6f52ce0ad675c56945828b6fbb21538d0d5a28a7dd8bca07540acb4c9dd28ea6` |
| Factory.create() | 319,746 | `0x6bf5fa80e74e81d579ae3a3fc825315d887cb78a5d6ca1916581c2543928bbfe` |
| addAuthorizedProxy | 45,266 | `0x660a279aec18285a8edab8684f9dc2a2ed358ff1e567b05b5d107c65ecae9204` |
| Proxy.challenge() | 347,254 | `0xc3f83dd983ea56cd89b1c246d85d4d2f017186e504fe7ead4a1865b6af8010d6` |
| triggerTimeout | 61,869 | `0xb47348ba23b2ed682c10d27e3e1d9c6a224d22fd6ade84d480720ae932ba889d` |
| Proxy.resolve() | 67,312 | `0x9c7b98f885c64037c68ba3326884716ca803424ef676e73e43ab6f34de25d6a2` |
| **E2E Total** | **961,878** | — |

---

## Comparison with Optimism Cannon

Cannon resolves disputes by replaying the bisection protocol entirely on-chain. Each round
requires on-chain moves, and narrowing a dispute to a single MIPS instruction at
$T = 2^{73}$ takes 73 rounds, after which the disputed instruction is re-executed on-chain by
the MIPS interpreter.

| Metric | Optimism Cannon (estimated) | SI-RVP |
|--------|----------------------------:|-------:|
| On-chain transactions per dispute | on the order of 74 sequential | 5 fixed (4 sequential) |
| On-chain bisection moves | 73 rounds, all on-chain | 0 (off-chain state channel) |
| Single-step settlement | On-chain MIPS re-execution (multi-million gas) | One constant-gas BN254 pairing check |
| Total dispute gas | multi-million (order-of-magnitude estimate) | 825,750 (measured) |
| Data stored on-chain | All bisection moves | One proof + one bisection commitment |
| On-chain MIPS execution | Yes (attack surface) | No |

**Why we state this structurally rather than as a ratio.** The Cannon column is an
order-of-magnitude estimate assembled from specification and monitoring pages, not a measured
fully played dispute. A single "N% cheaper" figure would carry that uncertainty in its
denominator while presenting itself as precise. The claim that does not depend on a contested
denominator is the structural one: Cannon needs on the order of 73 sequential bisection
transactions plus a multi-million-gas on-chain leaf re-execution, whereas SI-RVP settles the same
disagreement with five fixed transactions whose dominant cost is one constant-gas pairing check.

SI-RVP moves bisection entirely off-chain via a P2P state channel (146 signed messages over 73
rounds, ~125 KB). The on-chain footprint of the bisection phase collapses to a single
`submitBisectionResult` transaction (~90,754 gas) that commits the co-signed terminal step.

### Dispute resolution latency

The ~47-minute end-to-end figure is a **model-based projection for the production parameter set**
($T = 2^{73}$, 73 rounds), not a stopwatch reading. It composes the measured proof-generation and
peer-to-peer round-trip primitives with an *assumed* mainnet-finality L1 confirmation of 10-12
minutes per transaction, over the four sequential lifecycle transactions — that L1 term dominates
the total. The proof-of-concept run in this repository executes a short toy trace whose bisection
completes in seconds; it does not and is not meant to reproduce 47 minutes.

---

## Table 5: MIPS Executor Performance Statistics

Single-step execution time on Apple M-series ARM64 (Node.js, 500 runs per instruction type with
50-run warmup). Data from `gas-statistical.test.ts`.

| Instruction | Mean (ms) | Median (ms) | Std Dev (ms) | P95 (ms) | P99 (ms) |
|-------------|----------:|------------:|-------------:|---------:|---------:|
| R-Type ADD  | 0.0005    | 0.0002      | 0.0032       | 0.0004   | 0.0018   |
| I-Type ADDI | 0.0003    | 0.0002      | 0.0017       | 0.0002   | 0.0005   |
| I-Type SW   | 0.0005    | 0.0005      | 0.0006       | 0.0007   | 0.0011   |
| I-Type LW   | 0.0002    | 0.0002      | 0.0001       | 0.0002   | 0.0005   |

### Multi-instruction program scaling (100 runs per program size)

| Program Size | Mean (ms) | Median (ms) | Std Dev (ms) | P95 (ms) | P99 (ms) |
|-------------:|----------:|------------:|-------------:|---------:|---------:|
| 10           | 0.004     | 0.003       | 0.005        | 0.004    | 0.056    |
| 50           | 0.018     | 0.018       | 0.002        | 0.020    | 0.033    |
| 100          | 0.035     | 0.029       | 0.066        | 0.031    | 0.688    |
| 200          | 0.059     | 0.054       | 0.040        | 0.064    | 0.452    |

> Execution scales linearly: ~0.3 microseconds per instruction at median. A full 73-step
> bisection MIPS trace executes in well under 1 ms off-chain.

---

## Table 6: Protocol Message Sizes

Serialized JSON payload sizes for all SI-RVP P2P protocol message types, via `message-size.test.ts`.

| Message Type    | Payload (bytes) | Wrapped P2P (bytes) | Overhead Ratio |
|-----------------|----------------:|--------------------:|---------------:|
| channel_open    | 397             | 719                 | 1.81x          |
| channel_ack     | 56              | 377                 | 6.73x          |
| bisection_move  | 527             | 851                 | 1.61x          |
| proof_request   | 233             | 556                 | 2.39x          |
| proof_submit    | 779             | 1,101               | 1.41x          |
| channel_close   | 83              | 406                 | 4.89x          |

> "Wrapped P2P" includes the outer P2P envelope: sender/recipient addresses, ECDSA signature
> (65 bytes), timestamp, and sequence number.

### Bisection message size by depth

| Depth | Wrapped Size (bytes) |
|------:|---------------------:|
| 1     | 839                  |
| 10    | 844                  |
| 20    | 847                  |
| 36    | 851                  |
| 50    | 856                  |
| 73    | 862                  |

> Message size is nearly constant across depths (variance < 25 bytes). Depth and position are
> scalar values, not arrays.

---

## Table 7: Full Dispute Off-Chain Bandwidth

Total off-chain data transferred during a complete 73-round dispute lifecycle.

| Phase | Messages | Bytes per Message | Subtotal (bytes) |
|-------|----------:|------------------:|-----------------:|
| channel_open | 1 | 719 | 719 |
| channel_ack | 1 | 377 | 377 |
| bisection (73 rounds x 2) | 146 | ~851 | ~124,246 |
| proof_request | 1 | 556 | 556 |
| proof_submit | 1 | 1,101 | 1,101 |
| channel_close | 1 | 406 | 406 |
| **Total** | **151** | — | **~127,405 (124.4 KB)** |

> The entire off-chain dispute fits within 125 KB of P2P bandwidth. This is what replaces
> Cannon's 73 rounds of on-chain bisection moves; on-chain, the phase reduces to one
> `submitBisectionResult` transaction plus one Groth16 verification.

### Bandwidth vs gas

| Metric | Traditional (Cannon) | SI-RVP |
|--------|---------------------:|-------:|
| On-chain transactions | on the order of 74 sequential | 5 fixed (4 sequential) |
| On-chain gas | multi-million (estimated) | 825,750 (measured) |
| Off-chain bandwidth | 0 KB | ~125 KB |
| Off-chain messages | 0 | 151 |

---

*Gas and lifecycle data: 2026-05-29 Sepolia post-correction redeployment.*
*Phase-7 factory-path data and deployment costs: 2026-03-04.*
*Statistical benchmarks (gas-statistical.test.ts, message-size.test.ts): 2026-03-04; unaffected
by the commitment-binding fix, which touched contract logic rather than the off-chain executor
or the P2P message schema.*
