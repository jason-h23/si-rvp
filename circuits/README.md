# SI-RVP Circuits — MIPS Single-Step Verification

Circom sources and Groth16 proving/verifying artifacts for the
single-instruction MIPS step circuit used by the SI-RVP proof path.

The artifacts published here are **the exact ones backing the deployed
`Groth16Verifier`** at
[`0x81f6a41774c0A4627A116BD417744AaCf7092Ad4`](https://eth-sepolia.blockscout.com/address/0x81f6a41774c0A4627A116BD417744AaCf7092Ad4)
on Sepolia (chain ID 11155111). They are committed rather than regenerated
on demand because a fresh trusted setup yields a *different* proving key
(see [Reproducibility](#reproducibility) below) that would not match the
already-deployed verifier.

## Circuit

`src/mips_single_step.circom` is the top-level circuit; it pulls in
`mips_alu.circom`, `mips_memory.circom`, and `mips_utils.circom`.

| Property | Value |
|---|---|
| Curve | BN254 (`bn128`) |
| Proving system | Groth16 |
| Constraints | 37,026 |
| Wires | 37,015 |
| Public inputs | 2 |
| Private inputs | 99 |
| Outputs | 1 |
| Public signals | 3 — `[valid, H_P(σ_i), H_P(σ_{i+1})]` |

The public-signal ordering matters: snarkjs emits the circuit **output
first**, then the public inputs. The on-chain commitment check therefore
binds `publicInputs[1]` and `publicInputs[2]` (the pre- and post-state
hashes), not `publicInputs[0]`.

## Published artifacts

All paths are relative to this directory.

| File | Size | SHA-256 |
|---|---|---|
| `build/mips_single_step.r1cs` | 5,250,444 | `c632e205ab1e154795733aa075226bdb980bd3bba8a5f73f7ccd682aec42f2c5` |
| `build/mips_single_step_final.zkey` | 17,590,408 | `66aeb43e8318a0ae04d724f540159cb02b9074d3f7af91e82f10b1728aa3f4bc` |
| `build/verification_key.json` | 3,289 | `07b9b548d985b740427bc01a496a3bdfefe11d9cdd93f1a70e1b98e12625a396` |
| `build/mips_single_step_js/mips_single_step.wasm` | 4,918,745 | `9849f236e0fc665abb8711e078286c361dfbc03f2a875ca85bbfbe5de91bf4b8` |

`build/mips_single_step.sym` (debug symbol map) and the Powers-of-Tau file
are not committed; both are regenerable, and the `.ptau` is 75 MB.

## Powers of Tau (phase 1)

Phase 1 is **not** ours — it reuses the Hermez perpetual powers-of-tau
ceremony for BN254, which is the setup snarkjs itself distributes. Only
phase 2 (circuit-specific) was run by us.

| Property | Value |
|---|---|
| File | `powersOfTau28_hez_final_16.ptau` (2^16 = 65,536 constraints) |
| Source | Hermez perpetual powers of tau, BN254 |
| URL | https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau |
| Size | 75,580,568 bytes |
| SHA-256 | `1c401abb57c9ce531370f3015c3e75c0892e0f32b8b1e94ace0f6682d9695922` |

2^16 is the smallest power that accommodates the circuit's 37,026
constraints.

```bash
curl -O https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau
shasum -a 256 powersOfTau28_hez_final_16.ptau
# expect 1c401abb57c9ce531370f3015c3e75c0892e0f32b8b1e94ace0f6682d9695922
```

## Verifying the published artifacts

These three checks confirm that the committed zkey is a valid setup for the
committed circuit *and* that it is the one the deployed contract enforces.
Toolchain used: `circom 2.2.2`, `snarkjs 0.7.6`, Node.js v22.

**1. The zkey is a valid Groth16 setup for this circuit and this ptau:**

```bash
npx snarkjs zkey verify \
  build/mips_single_step.r1cs \
  build/powersOfTau28_hez_final_16.ptau \
  build/mips_single_step_final.zkey
# => "ZKey Ok!", contribution #1 "SI-RVP POC"
```

**2. The committed verification key really is this zkey's:**

```bash
npx snarkjs zkey export verificationkey \
  build/mips_single_step_final.zkey /tmp/vkey_check.json
diff <(jq -S . /tmp/vkey_check.json) <(jq -S . build/verification_key.json)
```

**3. The deployed verifier embeds this verification key.** Regenerating the
Solidity verifier from the zkey reproduces `contracts/src/Groth16Verifier.sol`,
whose 22 verification-key constants (`alphax`…`IC3y`) are present verbatim in
the runtime bytecode at `0x81f6a417…7092Ad4`:

```bash
npx snarkjs zkey export solidityverifier \
  build/mips_single_step_final.zkey /tmp/Groth16Verifier.sol
diff /tmp/Groth16Verifier.sol ../contracts/src/Groth16Verifier.sol
```

## Reproducing the build

```bash
npm install

# 1. Compile circom -> r1cs / wasm / sym
node scripts/compile.js

# 2. Download ptau (if absent), groth16 setup, contribute,
#    export verification_key.json and contracts/src/Groth16Verifier.sol
node scripts/setup.js
```

`scripts/setup.js` performs, in order:

```bash
circom src/mips_single_step.circom --r1cs --wasm --sym -o build -l ../node_modules
snarkjs groth16 setup build/mips_single_step.r1cs \
  build/powersOfTau28_hez_final_16.ptau build/mips_single_step_0000.zkey
snarkjs zkey contribute build/mips_single_step_0000.zkey \
  build/mips_single_step_final.zkey --name="SI-RVP POC" -v -e="random entropy for si-rvp"
snarkjs zkey export verificationkey build/mips_single_step_final.zkey build/verification_key.json
snarkjs zkey export solidityverifier build/mips_single_step_final.zkey ../contracts/src/Groth16Verifier.sol
```

### Reproducibility

Steps up to and including `groth16 setup` are deterministic: recompiling the
circuit reproduces the byte-identical `.r1cs` and `.wasm` listed above.

`zkey contribute` is **not** deterministic, and the `-e` entropy string in
`setup.js` does not make it so — snarkjs mixes 64 bytes of OS randomness into
the contribution seed regardless of `-e`. A re-run therefore produces a valid
but *different* proving key: `alpha`, `beta`, `gamma`, and the `IC` points are
unchanged (they derive from the ptau and the R1CS), while `delta` differs.

The practical consequence is that a regenerated zkey **will not verify against
the already-deployed `Groth16Verifier`**; you would have to redeploy the
verifier generated alongside it. This is precisely why the zkey is published
here rather than left to be regenerated.
