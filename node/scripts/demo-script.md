# SI-RVP Dashboard Demo Script

## Video: `demo.mp4` (32s, 1440x900)

---

### Scene 1: Page Load (0:00 - 0:02)
- Dashboard loads with "Dispute Early (Step 3)" scenario selected
- Header shows: **SI-RVP** | Dashboard | "Real Data" badge
- Three-column layout: State Viewers (left), Bisection Tree (center), ZK Proof + Metrics (right)

### Scene 2: MIPS Execution — Bisection (0:02 - 0:12)
- Play button clicked, step-by-step execution begins
- **Left column**: Sequencer and Challenger register states update in real-time
  - Changed registers flash green on each step
  - At Step 3 (SUB instruction), challenger's `r4` diverges to `999` instead of `50`
- **Center column**: Bisection tree builds progressively
  - Round 0: Step 2 — Agreement (green)
  - Round 1: Step 3 — Agreement (green)
  - Round 2: Step 4 — Disagreement (red) → disputed step pinpointed
- **Channel Status**: progresses from "open" → "bisecting" → "awaiting proof"

### Scene 3: ZK Proof Generation (0:12 - 0:30)
- Proof panel shows progress bar with phases:
  - 0-30%: "Computing witness..."
  - 30-60%: "FFT on evaluation domain..."
  - 60-90%: "Multi-scalar multiplication..."
  - 90-100%: "Finalizing proof..."
- ETA countdown from ~15s to 0s
- On completion: "Proof Verified!" with Groth16 proof elements (a, b, c)
- **Channel Status**: transitions to "resolved"
- **Metrics panel** (right): Shows real on-chain data
  - Time Saved: 100.00%
  - Fewer Messages: 93.15%
  - Gas Saved: 77.98%
  - Traditional: 7 days / 73 msgs / 3.65M gas
  - ZK Channel: ~17s / 5 msgs / 804K gas

### Scene 4: On-chain Dispute Transition (0:30 - 0:32)
- Scenario selector switches to "On-chain Dispute"
- "On-chain" amber badge appears in header
- Dashboard resets for new scenario with real Hardhat network data
- On-chain Data panel appears showing:
  - Network: localhost, Chain 31337
  - Contract addresses (RollupManager, DisputeManager, ZKVerifier)
  - Real participant addresses
  - 5 real transactions with gas costs
  - Total gas: 803,725

---

## Key Talking Points

1. **Real Execution Data**: All state transitions are computed by actual MIPS VM execution
2. **Bisection Protocol**: Log₂(N) rounds to find the disputed step — 3 rounds for 10 instructions
3. **ZK Proof**: Single Groth16 proof replaces replaying all instructions on-chain
4. **On-chain Verification**: 803,725 gas total (77.98% reduction vs traditional 3.65M gas)
5. **5 Transactions**: proposeStateRoot (122K) → initiateDispute (274K) → depositBond (46K) → submitBisection (88K) → submitProof (273K)
