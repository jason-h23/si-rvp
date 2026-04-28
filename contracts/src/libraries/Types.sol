// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Types
 * @notice Common type definitions for SI-RVP protocol
 * @dev Structure compatible with Cannon FPVM (MIPS64.sol)
 */

/// @notice Game type identifier (Optimism DisputeGameFactory compatible)
/// @dev uint32 allows up to ~4 billion game types
type GameType is uint32;

/// @notice State claim hash (Optimism compatible)
/// @dev Wraps bytes32 for type safety in dispute game interfaces
type Claim is bytes32;

/// @notice Timestamp type
type Timestamp is uint64;

/// @notice Duration type
type Duration is uint64;

/// @notice VM execution status
enum VMStatus {
    VALID,      // Execution succeeded, result valid
    INVALID,    // Execution succeeded, result invalid
    PANIC,      // VM panic
    UNFINISHED  // Execution incomplete
}

/// @notice Dispute game status
enum GameStatus {
    IN_PROGRESS,     // In progress
    CHALLENGER_WINS, // Challenger wins
    DEFENDER_WINS    // Sequencer wins
}

/// @notice Bisection phase
enum BisectionPhase {
    IDLE,
    SEQUENCER_TURN,
    CHALLENGER_TURN,
    AWAITING_PROOF,
    RESOLVED,
    TIMEOUT
}

/// @notice MIPS CPU state (simplified)
/// @dev Full VMState is too large, so only essential fields are included
struct MipsState {
    uint64 pc;
    uint64 nextPC;
    uint64 lo;
    uint64 hi;
    uint64[32] registers;
    bytes32 memRoot;
    uint64 step;
    uint8 exitCode;
    bool exited;
}

/// @notice Position - Generalized Index based
/// @dev gindex of node at depth d, index i = 2^d + i
type Position is uint128;

/// @notice Position library
library LibPosition {
    /// @notice Root Position
    function root() internal pure returns (Position) {
        return Position.wrap(1);
    }

    /// @notice Calculate depth
    function depth(Position pos) internal pure returns (uint8) {
        uint128 g = Position.unwrap(pos);
        if (g == 0) return 0;

        uint8 d = 0;
        while (g > 1) {
            g >>= 1;
            d++;
        }
        return d;
    }

    /// @notice Calculate index at depth
    function indexAtDepth(Position pos) internal pure returns (uint128) {
        uint8 d = depth(pos);
        return Position.unwrap(pos) - (uint128(1) << d);
    }

    /// @notice Left child (Attack move)
    function left(Position pos) internal pure returns (Position) {
        return Position.wrap(Position.unwrap(pos) * 2);
    }

    /// @notice Right child (Defend move)
    function right(Position pos) internal pure returns (Position) {
        return Position.wrap(Position.unwrap(pos) * 2 + 1);
    }

    /// @notice Parent
    function parent(Position pos) internal pure returns (Position) {
        return Position.wrap(Position.unwrap(pos) / 2);
    }

    /// @notice Calculate trace index
    function traceIndex(Position pos, uint256 maxDepth) internal pure returns (uint256) {
        uint8 d = depth(pos);
        uint256 remaining = maxDepth - d;
        return (uint256(Position.unwrap(pos)) << remaining) - (1 << maxDepth);
    }
}

/// @notice Claim data (FaultDisputeGame compatible)
struct ClaimData {
    uint32 parentIndex;
    address counteredBy;
    address claimant;
    uint128 bond;
    bytes32 claim;      // state hash
    Position position;
    uint128 clock;      // packed: timestamp (64) + duration (64)
}

/// @notice Off-chain bisection result
struct BisectionResult {
    bytes32 preStateHash;
    bytes32 postStateHash;
    uint64 disputedStep;
    bytes sequencerSignature;
    bytes challengerSignature;
}

/// @notice ZK proof (Groth16)
struct Groth16Proof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}

/// @notice Dispute data
struct Dispute {
    uint256 id;
    address sequencer;
    address challenger;
    bytes32 batchRoot;
    uint256 batchIndex;
    uint128 bond;
    uint64 startTime;
    uint64 deadline;
    BisectionPhase phase;
    GameStatus status;
    BisectionResult bisectionResult;
}

/// @notice Clock utility
library LibClock {
    /// @notice Clock packing (timestamp + duration)
    function pack(uint64 timestamp, uint64 duration) internal pure returns (uint128) {
        return (uint128(timestamp) << 64) | uint128(duration);
    }

    /// @notice Extract timestamp
    function timestamp(uint128 clock) internal pure returns (uint64) {
        return uint64(clock >> 64);
    }

    /// @notice Extract duration
    function duration(uint128 clock) internal pure returns (uint64) {
        return uint64(clock);
    }
}
