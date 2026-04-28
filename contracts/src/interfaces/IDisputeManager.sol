// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IDisputeManager
 * @notice Dispute management interface
 * @dev SI-RVP dispute resolution protocol
 */
interface IDisputeManager {
    /// @notice Dispute status
    enum DisputeStatus {
        None,           // No dispute
        Initiated,      // Dispute initiated (off-chain bisection in progress)
        ProofSubmitted, // ZK proof submitted
        Resolved,       // Resolved
        Timeout         // Timeout (fallback needed)
    }

    /// @notice Dispute information
    struct Dispute {
        uint256 batchIndex;         // Disputed batch
        address challenger;         // Challenger
        address sequencer;          // Sequencer
        bytes32 challengerClaim;    // State root claimed by challenger
        bytes32 sequencerClaim;     // State root claimed by sequencer
        uint256 challengerBond;     // Challenger bond
        uint256 sequencerBond;      // Sequencer bond
        uint256 createdAt;          // Dispute creation time
        uint256 deadline;           // Proof submission deadline
        bytes32 bisectionCommitment;// Off-chain bisection result commitment
        DisputeStatus status;       // Dispute status
        uint256 resolvedAt;         // Resolution timestamp (0 if unresolved)
        bytes32 l1Head;             // L1 block hash at dispute creation
    }

    /// @notice Dispute initiation event
    event DisputeInitiated(
        uint256 indexed disputeId,
        uint256 indexed batchIndex,
        address indexed challenger,
        bytes32 challengerClaim
    );

    /// @notice Off-chain bisection completion event
    event BisectionCompleted(
        uint256 indexed disputeId,
        bytes32 bisectionCommitment,
        uint256 disputedStep
    );

    /// @notice ZK proof submission event
    event ProofSubmitted(
        uint256 indexed disputeId,
        address indexed submitter,
        bool proofValid
    );

    /// @notice Dispute resolution event
    event DisputeResolved(
        uint256 indexed disputeId,
        address indexed winner,
        uint256 reward
    );

    /// @notice Timeout event
    event DisputeTimeout(uint256 indexed disputeId);

    /// @notice Authorized proxy added
    event AuthorizedProxyAdded(address indexed proxy);

    /// @notice Authorized proxy removed
    event AuthorizedProxyRemoved(address indexed proxy);

    /**
     * @notice Initiate dispute
     * @param batchIndex Batch index to dispute
     * @param claimedStateRoot Correct state root claimed by challenger
     * @return disputeId Created dispute ID
     */
    function initiateDispute(
        uint256 batchIndex,
        bytes32 claimedStateRoot
    ) external payable returns (uint256 disputeId);

    /**
     * @notice Submit off-chain bisection result
     * @param disputeId Dispute ID
     * @param bisectionCommitment Bisection result commitment
     * @param disputedStep Disputed single step index
     * @param challengerSig Challenger signature
     * @param sequencerSig Sequencer signature
     */
    function submitBisectionResult(
        uint256 disputeId,
        bytes32 bisectionCommitment,
        uint256 disputedStep,
        bytes calldata challengerSig,
        bytes calldata sequencerSig
    ) external;

    /**
     * @notice Submit ZK proof
     * @param disputeId Dispute ID
     * @param proof Groth16 proof (a, b, c)
     * @param publicInputs Public inputs
     */
    function submitProof(
        uint256 disputeId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external;

    /**
     * @notice Resolve dispute (after proof verification)
     * @param disputeId Dispute ID
     */
    function resolveDispute(uint256 disputeId) external;

    /**
     * @notice Trigger timeout (fallback mode)
     * @param disputeId Dispute ID
     */
    function triggerTimeout(uint256 disputeId) external;

    /**
     * @notice Get dispute information
     * @param disputeId Dispute ID
     * @return dispute Dispute information
     */
    function getDispute(uint256 disputeId) external view returns (Dispute memory dispute);

    /**
     * @notice Initiate dispute on behalf of a challenger (proxy only)
     * @param onBehalfOf The actual challenger address
     * @param batchIndex Batch index to dispute
     * @param claimedStateRoot Correct state root claimed by challenger
     * @return disputeId Created dispute ID
     */
    function initiateDisputeFor(
        address onBehalfOf,
        uint256 batchIndex,
        bytes32 claimedStateRoot
    ) external payable returns (uint256 disputeId);

    /**
     * @notice Get required bond amount
     * @return amount Bond amount (wei)
     */
    function requiredBond() external view returns (uint256 amount);
}
