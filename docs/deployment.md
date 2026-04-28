# Deployment Notes

## Environment

Copy `.env.example` to `.env` and fill in:

```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
SEPOLIA_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

`SEPOLIA_PRIVATE_KEY` must control an account funded with at least
~0.1 Sepolia ETH for the full deployment + E2E test. `ETHERSCAN_API_KEY`
is needed only for source verification.

## Deployment order

The contracts must be deployed in dependency order:

1. **`Groth16Verifier`** — auto-generated from the circuit's verification
   key; no constructor arguments.
2. **`ZKVerifier`** — constructor takes the `Groth16Verifier` address.
3. **`RollupManager`** — no constructor arguments; the deployer becomes
   `Ownable` admin.
4. **`DisputeGameFactory`** — no constructor arguments; admin set to
   deployer.
5. **`DisputeManager`** — constructor takes the `RollupManager` and
   `ZKVerifier` addresses.
6. **`ZKDisputeGameProxy`** — constructor takes `DisputeManager`. The
   proxy is then registered as an authorized clone target on the
   factory via `addAuthorizedProxy`.

The Hardhat scripts in
`contracts/scripts/deploy-phase7.ts` orchestrate all six steps and
write the resulting addresses to `contracts/deployments/<network>.json`.

## Gas cost summary

Sepolia deployment costs (measured 2026-03-04):

| Contract | Deployment gas |
|----------|---------------:|
| Groth16Verifier | 366,491 |
| ZKVerifier | 706,653 |
| RollupManager | 826,524 |
| DisputeManager | 1,730,828 |
| DisputeGameFactory | 587,176 |
| ZKDisputeGameProxy | 804,691 |
| **Total** | **5,022,363** |

At 30 gwei and ETH = $3,000, this is roughly $450 USD.

## Trusted setup

The benchmark binaries shipped here use a **single-party Phase-2
contribution** to the Groth16 setup. This is acceptable only for
research benchmarking and must be replaced before any production
deployment.

A production deployment needs:

1. **Powers of Tau (Phase 1)** — universal, can be reused from any
   established public ceremony (e.g. perpetualpowersoftau output up
   to the constraint count required by the MIPS-step circuit).
2. **Phase-2 contribution** — circuit-specific. Must be a multi-party
   ceremony with at least one honest contributor for the standard
   Groth16 soundness assumption to hold; in practice, ceremonies
   target broad participation across independent organizations.
3. **Public verification of the contribution log** — every
   participant publishes their contribution hash; the final `.zkey`
   is auditable end-to-end.

This work is intentionally future-scoped and is not bundled with the
research artifact. The paper's threat model assumes a properly
multi-party Phase-2 ceremony at production time; the benchmark setup
is used solely to measure circuit and contract performance and does
not affect the gas/wall-clock numbers.

## Source verification

After deployment:

```bash
cd contracts && npm run verify:sepolia
```

This runs `hardhat verify` against each deployed address using the
constructor arguments captured in `deployments/sepolia.json`.

## Rollback

If a deployment step fails partway through:

1. The script does not retry partial deployments. Re-running starts
   from contract 1 and produces a fresh address set.
2. To redeploy only the changed contracts, edit
   `deploy-phase7.ts` to skip already-deployed addresses, or deploy
   manually with `hardhat run` and update `deployments/<network>.json`.
3. There is no on-chain admin path to migrate state from an old
   `RollupManager` to a new one in this PoC; production migration is
   future work.
