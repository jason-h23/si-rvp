# SI-RVP: Single-Instruction Responsive Validity Proof

A hybrid Optimistic Rollup + ZK protocol that reduces dispute resolution
from the ~7-day fraud-proof challenge window to **~47 minutes** on
Sepolia testnet, while preserving the 1-of-N permissionless validation
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
  BN254 pairing pre-compile (~233K gas).
- **Poseidon-aligned commitment** binds the off-chain bisection terminal
  step to the ZK proof public inputs — a missing alignment in earlier
  hybrid sketches that prevented end-to-end soundness.
- **1-of-N permissionless validation**: any one honest validator in
  the pool initiates the dispute; safety holds at the pool level even
  when individual validators are unavailable.

End-to-end on Sepolia: ~47 minutes wall-clock. Gas reduction relative
to Optimism Cannon's on-chain MIPS execution: approximately 15-23x
fewer dispute-path on-chain operations (see
[`docs/paper-gas-data.md`](docs/paper-gas-data.md) for the full
benchmark tables).

## Contracts (Sepolia)

Deployed 2026-03-04 on Ethereum Sepolia (chainId 11155111):

| Contract | Address |
|---|---|
| DisputeGameFactory | [`0x2714cC2c244aFbbd7375d714E6373f7aE462F516`](https://sepolia.etherscan.io/address/0x2714cC2c244aFbbd7375d714E6373f7aE462F516) |
| DisputeManager | [`0x643adE2d8f33b1E3D29b54b785C67092B25540CC`](https://sepolia.etherscan.io/address/0x643adE2d8f33b1E3D29b54b785C67092B25540CC) |
| RollupManager | [`0x552fa1Fa994108326Ba51202f7A797bffBa12B8f`](https://sepolia.etherscan.io/address/0x552fa1Fa994108326Ba51202f7A797bffBa12B8f) |
| ZKDisputeGameProxy | [`0xAeb354514CcbBB47aDaaE2afBA7BaC9d34049dA4`](https://sepolia.etherscan.io/address/0xAeb354514CcbBB47aDaaE2afBA7BaC9d34049dA4) |
| ZKVerifier | [`0x66eC412CC375EdbaF5f58Fc867D1b54DFf8eEf5e`](https://sepolia.etherscan.io/address/0x66eC412CC375EdbaF5f58Fc867D1b54DFf8eEf5e) |
| Groth16Verifier | [`0xd554A04207dE9BC33De245FCC16F76a105D9f2Fb`](https://sepolia.etherscan.io/address/0xd554A04207dE9BC33De245FCC16F76a105D9f2Fb) |

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
