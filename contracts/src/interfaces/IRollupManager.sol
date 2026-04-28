// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IRollupManager
 * @notice Rollup state root management interface
 * @dev Contract for sequencer to submit and manage batch state roots
 */
interface IRollupManager {
    /// @notice Batch status
    enum BatchStatus {
        Pending,    // Submitted, challenge period ongoing
        Finalized,  // Finalized
        Disputed,   // Under dispute
        Rejected    // Rejected
    }

    /// @notice Batch information
    struct Batch {
        bytes32 stateRoot;      // State root
        bytes32 prevStateRoot;  // Previous state root
        uint256 timestamp;      // Submission time
        address proposer;       // Proposer (sequencer)
        BatchStatus status;     // Batch status
    }

    /// @notice State root submission event
    event StateRootProposed(
        uint256 indexed batchIndex,
        bytes32 stateRoot,
        bytes32 prevStateRoot,
        address indexed proposer
    );

    /// @notice Batch finalization event
    event BatchFinalized(uint256 indexed batchIndex, bytes32 stateRoot);

    /// @notice Batch rejection event
    event BatchRejected(uint256 indexed batchIndex, bytes32 stateRoot);

    /// @notice Dispute manager configuration event
    event DisputeManagerSet(address indexed disputeManager);

    /**
     * @notice Submit new state root
     * @param stateRoot New state root
     * @param batchIndex Batch index
     */
    function proposeStateRoot(bytes32 stateRoot, uint256 batchIndex) external;

    /**
     * @notice Get batch status
     * @param batchIndex Batch index
     * @return batch Batch information
     */
    function getBatch(uint256 batchIndex) external view returns (Batch memory batch);

    /**
     * @notice Get latest finalized batch index
     * @return index Latest finalized batch index
     */
    function latestFinalizedBatchIndex() external view returns (uint256 index);

    /**
     * @notice Finalize batch (after challenge period ends)
     * @param batchIndex Batch index
     */
    function finalizeBatch(uint256 batchIndex) external;
}
