// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IDisputeManager.sol";
import "./interfaces/IZKVerifier.sol";
import "./RollupManager.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DisputeManager
 * @notice SI-RVP dispute management contract
 * @dev Off-chain bisection + on-demand ZK proof verification
 */
contract DisputeManager is IDisputeManager, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Required bond (POC: 0.01 ETH)
    uint256 public constant BOND_AMOUNT = 0.01 ether;

    /// @notice Proof submission deadline (POC: 1 hour)
    uint256 public constant PROOF_DEADLINE = 1 hours;

    /// @notice Off-chain bisection deadline (POC: 30 minutes)
    uint256 public constant BISECTION_DEADLINE = 30 minutes;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice ZK Verifier contract
    IZKVerifier public immutable zkVerifier;

    /// @notice Rollup Manager contract
    RollupManager public immutable rollupManager;

    /// @notice Dispute ID => Dispute info
    mapping(uint256 => Dispute) public disputes;

    /// @notice Next dispute ID
    uint256 public nextDisputeId = 1;

    /// @notice Batch index => Active dispute ID (0 if no dispute)
    mapping(uint256 => uint256) public activeDisputes;

    /// @notice Dispute ID => Disputed single step index
    mapping(uint256 => uint256) public disputedSteps;

    /// @notice Dispute ID => Proof verification result (true: sequencer is correct)
    mapping(uint256 => bool) public proofResults;

    /// @notice Contract owner (for proxy authorization)
    address public immutable owner;

    /// @notice Authorized proxy contracts (can call initiateDisputeFor)
    mapping(address => bool) public authorizedProxies;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _zkVerifier, address _rollupManager) {
        zkVerifier = IZKVerifier(_zkVerifier);
        rollupManager = RollupManager(_rollupManager);
        owner = msg.sender;
    }

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        require(msg.sender == owner, "DisputeManager: not owner");
        _;
    }

    modifier onlyAuthorizedProxy() {
        require(authorizedProxies[msg.sender], "DisputeManager: not authorized proxy");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                          EXTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @inheritdoc IDisputeManager
     */
    function initiateDispute(
        uint256 batchIndex,
        bytes32 claimedStateRoot
    ) external payable override nonReentrant returns (uint256 disputeId) {
        require(msg.value >= BOND_AMOUNT, "DisputeManager: insufficient bond");
        require(activeDisputes[batchIndex] == 0, "DisputeManager: dispute exists");

        // Get batch info
        IRollupManager.Batch memory batch = rollupManager.getBatch(batchIndex);
        require(
            batch.status == IRollupManager.BatchStatus.Pending,
            "DisputeManager: batch not pending"
        );
        require(
            claimedStateRoot != batch.stateRoot,
            "DisputeManager: same state root"
        );

        disputeId = _createDispute(msg.sender, batchIndex, claimedStateRoot, msg.value, batch);
    }

    /**
     * @inheritdoc IDisputeManager
     */
    function initiateDisputeFor(
        address onBehalfOf,
        uint256 batchIndex,
        bytes32 claimedStateRoot
    ) external payable override nonReentrant onlyAuthorizedProxy returns (uint256 disputeId) {
        require(onBehalfOf != address(0), "DisputeManager: zero address");
        require(msg.value >= BOND_AMOUNT, "DisputeManager: insufficient bond");
        require(activeDisputes[batchIndex] == 0, "DisputeManager: dispute exists");

        IRollupManager.Batch memory batch = rollupManager.getBatch(batchIndex);
        require(
            batch.status == IRollupManager.BatchStatus.Pending,
            "DisputeManager: batch not pending"
        );
        require(
            claimedStateRoot != batch.stateRoot,
            "DisputeManager: same state root"
        );

        disputeId = _createDispute(onBehalfOf, batchIndex, claimedStateRoot, msg.value, batch);
    }

    /**
     * @dev Internal helper to create a dispute (shared by direct and proxy paths)
     */
    function _createDispute(
        address challengerAddr,
        uint256 batchIndex,
        bytes32 claimedStateRoot,
        uint256 bondValue,
        IRollupManager.Batch memory batch
    ) internal returns (uint256 disputeId) {
        disputeId = nextDisputeId++;
        disputes[disputeId] = Dispute({
            batchIndex: batchIndex,
            challenger: challengerAddr,
            sequencer: batch.proposer,
            challengerClaim: claimedStateRoot,
            sequencerClaim: batch.stateRoot,
            challengerBond: bondValue,
            sequencerBond: 0,
            createdAt: block.timestamp,
            deadline: block.timestamp + PROOF_DEADLINE,
            bisectionCommitment: bytes32(0),
            status: DisputeStatus.Initiated,
            resolvedAt: 0,
            l1Head: blockhash(block.number - 1)
        });

        activeDisputes[batchIndex] = disputeId;
        rollupManager.markDisputed(batchIndex);

        emit DisputeInitiated(disputeId, batchIndex, challengerAddr, claimedStateRoot);
    }

    /**
     * @inheritdoc IDisputeManager
     */
    function submitBisectionResult(
        uint256 disputeId,
        bytes32 bisectionCommitment,
        uint256 disputedStep,
        bytes calldata challengerSig,
        bytes calldata sequencerSig
    ) external override nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.Initiated, "DisputeManager: invalid status");
        require(
            dispute.bisectionCommitment == bytes32(0),
            "DisputeManager: bisection already submitted"
        );
        require(block.timestamp <= dispute.createdAt + BISECTION_DEADLINE, "DisputeManager: bisection timeout");

        // Bisection result message hash
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                disputeId,
                bisectionCommitment,
                disputedStep
            )
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        // Verify signatures from both parties
        address recoveredChallenger = ethSignedHash.recover(challengerSig);
        address recoveredSequencer = ethSignedHash.recover(sequencerSig);

        require(
            recoveredChallenger == dispute.challenger,
            "DisputeManager: invalid challenger sig"
        );
        require(
            recoveredSequencer == dispute.sequencer,
            "DisputeManager: invalid sequencer sig"
        );

        // Store bisection result
        dispute.bisectionCommitment = bisectionCommitment;
        disputedSteps[disputeId] = disputedStep;

        emit BisectionCompleted(disputeId, bisectionCommitment, disputedStep);
    }

    /**
     * @inheritdoc IDisputeManager
     */
    function submitProof(
        uint256 disputeId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external override nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(
            msg.sender == dispute.sequencer || msg.sender == dispute.challenger,
            "DisputeManager: not dispute participant"
        );
        require(
            publicInputs.length == 3,
            "DisputeManager: invalid public inputs length"
        );
        require(
            dispute.status == DisputeStatus.Initiated,
            "DisputeManager: invalid status"
        );
        require(
            dispute.bisectionCommitment != bytes32(0),
            "DisputeManager: bisection not completed"
        );
        require(
            block.timestamp <= dispute.deadline,
            "DisputeManager: proof deadline passed"
        );
        // Verify proof binds to agreed bisection result
        bytes32 expectedCommitment = keccak256(
            abi.encodePacked(publicInputs[1], publicInputs[2], disputedSteps[disputeId])
        );
        require(
            expectedCommitment == dispute.bisectionCommitment,
            "DisputeManager: proof does not match bisection"
        );

        // Groth16 proof verification
        // proof[0-1]: a, proof[2-5]: b (flattened), proof[6-7]: c
        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];

        bool proofValid = zkVerifier.verifyProof(a, b, c, publicInputs);

        dispute.status = DisputeStatus.ProofSubmitted;
        proofResults[disputeId] = proofValid;

        emit ProofSubmitted(disputeId, msg.sender, proofValid);
    }

    /**
     * @inheritdoc IDisputeManager
     */
    function resolveDispute(uint256 disputeId) external override nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(
            dispute.status == DisputeStatus.ProofSubmitted,
            "DisputeManager: proof not submitted"
        );

        bool sequencerWins = proofResults[disputeId];
        address winner;
        uint256 reward;

        if (sequencerWins) {
            // Sequencer wins: confiscate challenger's bond
            winner = dispute.sequencer;
            reward = dispute.challengerBond;
            rollupManager.confirmBatch(dispute.batchIndex);
        } else {
            // Challenger wins: confiscate sequencer's bond (+ return own bond)
            winner = dispute.challenger;
            reward = dispute.challengerBond + dispute.sequencerBond;
            rollupManager.rejectBatch(dispute.batchIndex);
        }

        dispute.status = DisputeStatus.Resolved;
        dispute.resolvedAt = block.timestamp;
        activeDisputes[dispute.batchIndex] = 0;

        // Pay reward
        if (reward > 0) {
            (bool success, ) = winner.call{value: reward}("");
            require(success, "DisputeManager: transfer failed");
        }

        emit DisputeResolved(disputeId, winner, reward);
    }

    /**
     * @inheritdoc IDisputeManager
     */
    function triggerTimeout(uint256 disputeId) external override nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(
            dispute.status == DisputeStatus.Initiated,
            "DisputeManager: invalid status"
        );
        require(
            block.timestamp > dispute.deadline,
            "DisputeManager: deadline not passed"
        );

        // Timeout: the party that failed to submit proof loses
        // Since sequencer must submit proof, challenger wins on timeout
        dispute.status = DisputeStatus.Timeout;
        dispute.resolvedAt = block.timestamp;

        address winner = dispute.challenger;
        uint256 reward = dispute.challengerBond + dispute.sequencerBond;

        rollupManager.rejectBatch(dispute.batchIndex);
        activeDisputes[dispute.batchIndex] = 0;

        if (reward > 0) {
            (bool success, ) = winner.call{value: reward}("");
            require(success, "DisputeManager: transfer failed");
        }

        emit DisputeTimeout(disputeId);
        emit DisputeResolved(disputeId, winner, reward);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @inheritdoc IDisputeManager
     */
    function getDispute(uint256 disputeId) external view override returns (Dispute memory) {
        return disputes[disputeId];
    }

    /**
     * @inheritdoc IDisputeManager
     */
    function requiredBond() external pure override returns (uint256) {
        return BOND_AMOUNT;
    }

    /*//////////////////////////////////////////////////////////////
                          SEQUENCER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Deposit sequencer bond
     * @param disputeId Dispute ID
     */
    function depositSequencerBond(uint256 disputeId) external payable nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(msg.sender == dispute.sequencer, "DisputeManager: not sequencer");
        require(msg.value >= BOND_AMOUNT, "DisputeManager: insufficient bond");
        require(dispute.sequencerBond == 0, "DisputeManager: already deposited");

        dispute.sequencerBond = msg.value;
    }

    /*//////////////////////////////////////////////////////////////
                        PROXY MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Add an authorized proxy contract
     * @param proxy Address of the proxy contract to authorize
     */
    function addAuthorizedProxy(address proxy) external onlyOwner {
        require(proxy != address(0), "DisputeManager: zero address");
        require(!authorizedProxies[proxy], "DisputeManager: already authorized");

        authorizedProxies[proxy] = true;
        emit AuthorizedProxyAdded(proxy);
    }

    /**
     * @notice Remove an authorized proxy contract
     * @param proxy Address of the proxy contract to deauthorize
     */
    function removeAuthorizedProxy(address proxy) external onlyOwner {
        require(authorizedProxies[proxy], "DisputeManager: not authorized");

        authorizedProxies[proxy] = false;
        emit AuthorizedProxyRemoved(proxy);
    }
}
