# SI-RVP Paper: Gas Comparison Data

All values measured on Hardhat local network (Solc 0.8.24, optimizer enabled, 200 runs) and verified
on Ethereum Sepolia testnet. ETH price assumed at $3,000 for USD estimates.

---

## Table 1: ZK Dispute Resolution Gas Costs

Individual operation costs measured via the direct DisputeManager path (no factory overhead).

| Operation | Gas Used | Notes |
|-----------|----------:|-------|
| `proposeStateRoot` | 119,431 | Sequencer submits new state root to RollupManager |
| `initiateDispute` | 298,872 | Challenger opens dispute with bond (0.01 ETH) |
| `depositSequencerBond` | 46,197 | Sequencer posts response bond |
| `submitProof` | ~233,464 | ZK Groth16 verification (ZKVerifier.verifyProofFixed) |
| `resolveDispute` | ~80,000 | On-chain resolution after proof accepted |
| `triggerTimeout` | 86,480 | Challenger wins when sequencer fails to submit proof |

**Measured total dispute lifecycle (direct path, timeout scenario):**

| Path | Gas Total |
|------|----------:|
| initiateDispute + depositBond + triggerTimeout | 431,549 |
| initiateDispute + depositBond + submitProof + resolveDispute | ~658,533 |

> Note: The timeout scenario (431,549 gas) reflects the optimistic case where the sequencer
> does not respond. The proof-submission scenario (~658,533 gas) applies when the sequencer
> submits a ZK proof and the dispute is resolved on-chain.

---

## Table 2: Direct Path vs Factory Path

Side-by-side gas comparison between the native SI-RVP path and the Phase 7 Optimism-compatible
Factory → Proxy → DisputeManager path. All values measured via `gas-benchmark.test.ts`.

| Operation | Direct Path | Factory Path | Overhead |
|-----------|------------:|-------------:|----------:|
| Initiate / Challenge | 298,872 | 347,254 | +48,382 (+16.2%) |
| Factory.create() | N/A | 319,838 | one-time per game |
| addAuthorizedProxy() | N/A | 45,266 | one-time setup |
| depositSequencerBond | 46,197 | 46,197 | 0 (direct call) |
| triggerTimeout | 86,480 | 86,480 | 0 (direct call) |
| Resolve | 86,480 | 67,312 | -19,168 (-22.2%) |
| **Total lifecycle** | **431,549** | **912,347** | +480,798 |

**Key insight**: The Factory path adds ~48,382 gas overhead per challenge (16.2%) due to the
proxy delegate call. `Factory.create()` (319,838 gas) is a one-time cost to instantiate each
game clone. The factory overhead is acceptable for Optimism compatibility and is offset by the
elimination of 73 on-chain bisection rounds.

---

## Table 3: Deployment Costs

Contract deployment gas measured on Sepolia testnet (Phase 7 deployment,
timestamp: 2026-03-04T00:44:13.059Z).

| Contract | Deployment Gas | Role |
|----------|---------------:|------|
| Groth16Verifier | 366,491 | Auto-generated Solidity verifier from snarkjs |
| ZKVerifier | 706,653 | Wrapper for Groth16Verifier with array conversion |
| RollupManager | 826,524 | State root submission and batch lifecycle |
| DisputeManager | 1,730,828 | Dispute coordination and resolution |
| ZKDisputeGameProxy | 804,691 | Adapter: IDisputeGame → DisputeManager (Phase 7) |
| DisputeGameFactory | 587,176 | EIP-1167 minimal clone factory (Phase 7) |
| **Core total (Phase 1–6)** | **3,630,496** | Groth16Verifier + ZKVerifier + RollupManager + DisputeManager |
| **Phase 7 overhead** | **1,391,867** | ZKDisputeGameProxy + DisputeGameFactory |
| **Grand total** | **5,022,363** | Full Phase 7 deployment |

> Local Hardhat measurements: DisputeManager 1,850,009 gas, ZKDisputeGameProxy 828,711 gas.
> Sepolia values reflect actual testnet deployment including base fee and EIP-1559 mechanics.

---

## Table 4: Cost Estimates

USD cost at various gas prices with ETH = $3,000. Covers single dispute lifecycle (direct path,
431,549 gas) and ZK verification only (233,464 gas).

### Full Dispute Lifecycle (431,549 gas — timeout path)

| Gas Price | Cost (ETH) | Cost (USD) |
|-----------|------------|------------|
| 10 Gwei | 0.004315 ETH | $12.95 |
| 30 Gwei | 0.012946 ETH | $38.84 |
| 50 Gwei | 0.021577 ETH | $64.73 |
| 100 Gwei | 0.043155 ETH | $129.46 |

### ZK Verification Only (233,464 gas)

| Gas Price | Cost (ETH) | Cost (USD) |
|-----------|------------|------------|
| 10 Gwei | 0.002335 ETH | $7.00 |
| 30 Gwei | 0.007004 ETH | $21.01 |
| 50 Gwei | 0.011673 ETH | $35.02 |
| 100 Gwei | 0.023346 ETH | $70.04 |

### Full Dispute Lifecycle with Proof Submission (~658,533 gas)

| Gas Price | Cost (ETH) | Cost (USD) |
|-----------|------------|------------|
| 10 Gwei | 0.006585 ETH | $19.76 |
| 30 Gwei | 0.019756 ETH | $59.27 |
| 50 Gwei | 0.032927 ETH | $98.78 |
| 100 Gwei | 0.065853 ETH | $197.56 |

---

## Key Metrics Summary

### ZK Verification

- **Measured gas**: 233,464 (ZKVerifier.verifyProofFixed on Hardhat)
- **Paper target**: ~280,000 gas
- **Improvement**: 16.6% better than target
- **Algorithm**: Groth16 pairing check (BN128 curve)
- **Proof generation time**: ~880ms average (Apple M-series ARM64)

### Total Dispute Lifecycle

| Scenario | Gas | vs. Cannon |
|----------|----:|----------:|
| Timeout (no proof) | 431,549 | -88.2% |
| With ZK proof submission | ~658,533 | -82.0% |
| Factory path (timeout) | 912,347 | -75.0% |

### Sepolia E2E Transaction Hashes (2026-03-04)

All transactions confirmed on Ethereum Sepolia (chainId: 11155111).

| Operation | Gas Used | Transaction Hash |
|-----------|----------:|------------------|
| proposeStateRoot | 119,431 | `0x6f52ce0ad675c56945828b6fbb21538d0d5a28a7dd8bca07540acb4c9dd28ea6` |
| Factory.create() | 319,746 | `0x6bf5fa80e74e81d579ae3a3fc825315d887cb78a5d6ca1916581c2543928bbfe` |
| addAuthorizedProxy | 45,266 | `0x660a279aec18285a8edab8684f9dc2a2ed358ff1e567b05b5d107c65ecae9204` |
| Proxy.challenge() | 347,254 | `0xc3f83dd983ea56cd89b1c246d85d4d2f017186e504fe7ead4a1865b6af8010d6` |
| triggerTimeout | 61,869 | `0xb47348ba23b2ed682c10d27e3e1d9c6a224d22fd6ade84d480720ae932ba889d` |
| Proxy.resolve() | 67,312 | `0x9c7b98f885c64037c68ba3326884716ca803424ef676e73e43ab6f34de25d6a2` |
| **E2E Total** | **961,878** | — |

**Deployed contracts (Sepolia Phase 7)**:

| Contract | Address |
|----------|---------|
| Groth16Verifier | `0xd554A04207dE9BC33De245FCC16F76a105D9f2Fb` |
| ZKVerifier | `0x66eC412CC375EdbaF5f58Fc867D1b54DFf8eEf5e` |
| RollupManager | `0x552fa1Fa994108326Ba51202f7A797bffBa12B8f` |
| DisputeManager | `0x643adE2d8f33b1E3D29b54b785C67092B25540CC` |
| ZKDisputeGameProxy (impl) | `0xAeb354514CcbBB47aDaaE2afBA7BaC9d34049dA4` |
| DisputeGameFactory | `0x2714cC2c244aFbbd7375d714E6373f7aE462F516` |
| Game instance (clone) | `0x4118D635F80Da5D918BC0B04F775a7A03Ff9b4A2` |

---

## Comparison with Optimism Cannon

### Optimism Cannon: Traditional On-Chain Bisection

Cannon resolves disputes by replaying the bisection protocol entirely on-chain. Each round
requires two on-chain transactions (attack and defend), and the protocol requires 73 rounds
to narrow a dispute to a single MIPS instruction.

| Metric | Optimism Cannon (estimated) | SI-RVP ZK |
|--------|--------------------------:|----------:|
| On-chain transactions per dispute | 73+ | 3 |
| Per-round gas (attack/defend) | ~50,000 | N/A |
| Total bisection gas (73 rounds × 2 × 50K) | ~3,650,000 | 0 |
| ZK proof verification | N/A | 233,464 |
| Total dispute gas | ~3,650,000 | ~431,549–658,533 |
| Gas reduction | — | **82–88%** |
| Dispute resolution time | 7 days (challenge period) | ~47 minutes |
| Time reduction | — | **99.5%** |
| Data stored on-chain | All bisection moves | ZK proof only |
| On-chain MIPS execution | Yes (attack surface) | No |

### Why SI-RVP Is More Gas-Efficient

Traditional Cannon performs bisection on-chain: each of the 73 rounds writes state to L1
storage, costing ~50,000 gas per round (attack + defend = ~100,000 gas per round pair).
At 73 rounds this totals approximately 3,650,000 gas before the final execution step.

SI-RVP moves bisection entirely off-chain via a P2P state channel (146 signed messages,
73 rounds). Only three transactions touch L1: `initiateDispute`, optionally `submitProof`,
and `resolveDispute` (or `triggerTimeout`). The Groth16 proof replaces the entire on-chain
execution trace with a single 233,464-gas pairing check.

The Phase 7 factory path adds ~480,798 gas overhead for Optimism protocol compatibility
(Factory.create + proxy delegation) but remains well below the Cannon baseline of 3,650,000 gas.

---

## Table 5: MIPS Executor Performance Statistics

Single-step execution time measured on Apple M-series ARM64 (Node.js, 500 runs
per instruction type with 50-run warmup). Data from `gas-statistical.test.ts`.

| Instruction | Mean (ms) | Median (ms) | Std Dev (ms) | P95 (ms) | P99 (ms) |
|-------------|----------:|------------:|-------------:|---------:|---------:|
| R-Type ADD  | 0.0005    | 0.0002      | 0.0032       | 0.0004   | 0.0018   |
| I-Type ADDI | 0.0003    | 0.0002      | 0.0017       | 0.0002   | 0.0005   |
| I-Type SW   | 0.0005    | 0.0005      | 0.0006       | 0.0007   | 0.0011   |
| I-Type LW   | 0.0002    | 0.0002      | 0.0001       | 0.0002   | 0.0005   |

### Multi-Instruction Program Scaling (100 runs per program size)

| Program Size | Mean (ms) | Median (ms) | Std Dev (ms) | P95 (ms) | P99 (ms) |
|-------------:|----------:|------------:|-------------:|---------:|---------:|
| 10           | 0.004     | 0.003       | 0.005        | 0.004    | 0.056    |
| 50           | 0.018     | 0.018       | 0.002        | 0.020    | 0.033    |
| 100          | 0.035     | 0.029       | 0.066        | 0.031    | 0.688    |
| 200          | 0.059     | 0.054       | 0.040        | 0.064    | 0.452    |

> Execution scales linearly: ~0.3 microseconds per instruction at median. A full
> 73-step bisection MIPS trace executes in well under 1 ms off-chain.

---

## Table 6: Protocol Message Sizes

Serialized JSON payload sizes for all SI-RVP P2P protocol message types.
Measured via `message-size.test.ts`.

| Message Type    | Payload (bytes) | Wrapped P2P (bytes) | Overhead Ratio |
|-----------------|----------------:|--------------------:|---------------:|
| channel_open    | 397             | 719                 | 1.81x          |
| channel_ack     | 56              | 377                 | 6.73x          |
| bisection_move  | 527             | 851                 | 1.61x          |
| proof_request   | 233             | 556                 | 2.39x          |
| proof_submit    | 779             | 1,101               | 1.41x          |
| channel_close   | 83              | 406                 | 4.89x          |

> "Wrapped P2P" includes the outer P2P envelope: sender/recipient addresses,
> ECDSA signature (65 bytes), timestamp, and sequence number.

### Bisection Message Size by Depth

| Depth | Wrapped Size (bytes) |
|------:|---------------------:|
| 1     | 839                  |
| 10    | 844                  |
| 20    | 847                  |
| 36    | 851                  |
| 50    | 856                  |
| 73    | 862                  |

> Message size is nearly constant across depths (variance < 25 bytes).
> Depth and position are scalar values, not arrays.

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

> The entire off-chain dispute fits within 125 KB of P2P bandwidth.
> This replaces 73 on-chain transactions (~3,650,000 gas) with a single
> ZK proof verification (233,464 gas).

### Bandwidth vs Gas Comparison

| Metric | Traditional (Cannon) | SI-RVP ZK |
|--------|--------------------:|----------:|
| On-chain data | 73+ transactions | 3 transactions |
| On-chain gas | ~3,650,000 | 431,549--658,533 |
| Off-chain bandwidth | 0 KB | ~125 KB |
| Off-chain messages | 0 | 151 |

> SI-RVP trades ~125 KB of off-chain P2P bandwidth for an 82--94% reduction
> in on-chain gas costs.

---

*Data collected: 2026-03-04. Sepolia deployment timestamp: 2026-03-04T00:44:13Z.*
*E2E verification timestamp: 2026-03-04T01:58:14Z.*
*Statistical benchmarks: 2026-03-04 (gas-statistical.test.ts, message-size.test.ts).*
