// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IZKVerifier.sol";
import "./Groth16Verifier.sol";

/**
 * @title ZKVerifier
 * @notice Wrapper contract for Groth16Verifier
 * @dev Implements IZKVerifier interface and internally calls snarkjs-generated verifier
 *
 * Public inputs (MIPS Single Step):
 * - publicInputs[0]: preStateHash (previous state hash)
 * - publicInputs[1]: postStateHash (post state hash)
 * - publicInputs[2]: valid (verification result, circuit output)
 */
contract ZKVerifier is IZKVerifier {
    /// @notice Internal Groth16 verifier
    Groth16Verifier public immutable groth16Verifier;

    /// @notice Expected number of public inputs
    uint256 public constant EXPECTED_PUBLIC_INPUTS = 3;

    constructor() {
        groth16Verifier = new Groth16Verifier();
    }

    /**
     * @inheritdoc IZKVerifier
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view override returns (bool valid) {
        require(
            publicInputs.length == EXPECTED_PUBLIC_INPUTS,
            "ZKVerifier: invalid public inputs length"
        );

        // Convert dynamic array to fixed-size array
        uint256[3] memory pubSignals;
        pubSignals[0] = publicInputs[0];
        pubSignals[1] = publicInputs[1];
        pubSignals[2] = publicInputs[2];

        // uint256 -> uint conversion (snarkjs generated code compatibility)
        uint[2] memory _a = [a[0], a[1]];
        uint[2][2] memory _b = [[b[0][0], b[0][1]], [b[1][0], b[1][1]]];
        uint[2] memory _c = [c[0], c[1]];
        uint[3] memory _pubSignals = [pubSignals[0], pubSignals[1], pubSignals[2]];

        return groth16Verifier.verifyProof(_a, _b, _c, _pubSignals);
    }

    /**
     * @notice Direct verification with fixed-size arrays (gas optimization)
     * @param a Proof point A (G1)
     * @param b Proof point B (G2)
     * @param c Proof point C (G1)
     * @param pubSignals Public inputs (fixed size)
     * @return valid Whether the proof is valid
     */
    function verifyProofFixed(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata pubSignals
    ) external view returns (bool valid) {
        uint[2] memory _a = [a[0], a[1]];
        uint[2][2] memory _b = [[b[0][0], b[0][1]], [b[1][0], b[1][1]]];
        uint[2] memory _c = [c[0], c[1]];
        uint[3] memory _pubSignals = [pubSignals[0], pubSignals[1], pubSignals[2]];

        return groth16Verifier.verifyProof(_a, _b, _c, _pubSignals);
    }
}
