# SI-RVP: Single-Instruction Responsive Validity Proof

A hybrid Optimistic Rollup + ZK protocol that reduces dispute resolution
from the ~7-day fraud-proof challenge window to a projected
**~47 minutes**, while preserving the 1-of-N permissionless validation
trust model of established optimistic rollups.

> Reference implementation accompanying the IEEE Access manuscript
> *SI-RVP: A Hybrid Optimistic Rollup Dispute Protocol with Off-Chain
> Bisection and On-Demand Single-Instruction Validity Proofs*
> (under review).

## Architecture (high level)

- **Off-chain bisection** narrows the disputed batch trace to a single
  MIPS instruction in $\lceil \log_2 T \rceil$ rounds (73 rounds for
  $T = 2^{73}$).
- **On-demand Groth16 proof** at the disputed instruction (~$4 \times 10^4$
  R1CS constraints per single-step proof), verified on-chain by the
  BN254 pairing pre-compile (~280K gas for the full `submitProof`
  transaction).
- **Poseidon-aligned commitment** binds the off-chain bisection terminal
  step to the ZK proof public inputs — a missing alignment in earlier
  hybrid sketches that prevented end-to-end soundness.
- **1-of-N permissionless validation**: any one honest validator in
  the pool initiates the dispute; safety holds at the pool level even
  when individual validators are unavailable.

A fully played proof-path dispute cost **825,750 gas** across five
Sepolia transactions (2026-05-29 redeployment). We do not summarise the
comparison against Optimism Cannon as a single reduction multiplier —
the Cannon figure is an order-of-magnitude estimate rather than a
measured, fully played dispute. The claim that does not depend on a
contested denominator is structural: Cannon needs on the order of 73
sequential bisection transactions plus a multi-million-gas on-chain
leaf re-execution, whereas SI-RVP settles the same disagreement with
five fixed transactions (four sequential) whose dominant cost is one
constant-gas pairing check. See
[`docs/paper-gas-data.md`](docs/paper-gas-data.md) for the full
benchmark tables.

The ~47-minute figure is a model-based projection for the production
parameter set ($T = 2^{73}$, 73 bisection rounds), dominated by four
sequential L1 confirmations at an assumed 10-12 min each. It is not a
stopwatch reading: the proof-of-concept run executes a short toy trace
whose bisection completes in seconds.

## Contracts (Sepolia)

Chain ID 11155111. The four core contracts are the **2026-05-29
post-correction redeployment** used for every measurement reported in
the manuscript; the earlier 2026-03 deployment carried the
commitment-binding defect described in the paper and is superseded.

| Contract | Address |
|---|---|
| Groth16Verifier | [`0x81f6a41774c0A4627A116BD417744AaCf7092Ad4`](https://sepolia.etherscan.io/address/0x81f6a41774c0A4627A116BD417744AaCf7092Ad4) |
| ZKVerifier | [`0xeDa3C0429D49cc10f4A36082d6F8a537B6bd923F`](https://sepolia.etherscan.io/address/0xeDa3C0429D49cc10f4A36082d6F8a537B6bd923F) |
| RollupManager | [`0xC6390919eA2f96853E9044291AD421e4C8ae4492`](https://sepolia.etherscan.io/address/0xC6390919eA2f96853E9044291AD421e4C8ae4492) |
| DisputeManager | [`0xA0771DC8f9668342fC435174145953B9Ab36f534`](https://sepolia.etherscan.io/address/0xA0771DC8f9668342fC435174145953B9Ab36f534) |

The two Phase-7 factory-path contracts were unaffected by the
commitment-binding fix and were not redeployed; they remain at their
2026-03-04 addresses:

| Contract | Address |
|---|---|
| DisputeGameFactory | [`0x2714cC2c244aFbbd7375d714E6373f7aE462F516`](https://sepolia.etherscan.io/address/0x2714cC2c244aFbbd7375d714E6373f7aE462F516) |
| ZKDisputeGameProxy | [`0xAeb354514CcbBB47aDaaE2afBA7BaC9d34049dA4`](https://sepolia.etherscan.io/address/0xAeb354514CcbBB47aDaaE2afBA7BaC9d34049dA4) |

[`contracts/deployments/sepolia-2026-05-29.json`](contracts/deployments/sepolia-2026-05-29.json)
is the machine-readable record, including the transaction hash and gas
used for every step of the measured lifecycle.

## Quick Start

```bash
npm install
npm run compile:contracts
npm run compile:circuits
npm test
```

See [`docs/reproducibility.md`](docs/reproducibility.md) for the full
end-to-end reproduction guide (build circuits, deploy locally, run
the on-chain E2E demo) and [`docs/deployment.md`](docs/deployment.md)
for production deployment notes including the trusted-setup discussion.

## Repository layout

```
si-rvp/
├── contracts/   Solidity (DisputeManager, RollupManager, factory/proxy, ZK verifiers)
├── circuits/    circom (MIPS single-step circuit, Groth16)
├── node/        TypeScript (sequencer, challenger, prover, P2P bisection transport)
└── docs/        Architecture, deployment, reproducibility, gas data
```

## Status

Research-grade reference implementation. The single-party trusted
setup ceremony used for benchmarking is **not** suitable for
production use — see [`docs/deployment.md`](docs/deployment.md) for
the multi-party MPC ceremony required before mainnet deployment.

## Citation

```bibtex
@article{si-rvp-2026,
  title   = {SI-RVP: A Hybrid Optimistic Rollup Dispute Protocol with Off-Chain Bisection and On-Demand Single-Instruction Validity Proofs},
  author  = {Hwang, Jae-Seung and Kim, Younghan},
  journal = {IEEE Access},
  year    = {2026},
  note    = {Manuscript under review}
}
```

## License

MIT — see [LICENSE](LICENSE).
