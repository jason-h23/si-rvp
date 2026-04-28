// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IRollupManager.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RollupManager
 * @notice Rollup state root management contract
 * @dev Sequencer optimistically submits and manages batch state roots
 */
contract RollupManager is IRollupManager, Ownable {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Challenge period (POC: 10 minutes, Production: 7 days)
    uint256 public constant CHALLENGE_PERIOD = 10 minutes;

    /// @notice Genesis state root
    bytes32 public constant GENESIS_STATE_ROOT = bytes32(0);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Batch index => Batch info
    mapping(uint256 => Batch) public batches;

    /// @notice Latest submitted batch index
    uint256 public latestBatchIndex;

    /// @notice Latest finalized batch index
    uint256 public override latestFinalizedBatchIndex;

    /// @notice Dispute manager contract address
    address public disputeManager;

    /// @notice Sequencer address (POC: single sequencer)
    address public sequencer;

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlySequencer() {
        require(msg.sender == sequencer, "RollupManager: not sequencer");
        _;
    }

    modifier onlyDisputeManager() {
        require(msg.sender == disputeManager, "RollupManager: not dispute manager");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _sequencer) Ownable(msg.sender) {
        sequencer = _sequencer;

        // Genesis batch setup
        batches[0] = Batch({
            stateRoot: GENESIS_STATE_ROOT,
            prevStateRoot: bytes32(0),
            timestamp: block.timestamp,
            proposer: address(0),
            status: BatchStatus.Finalized
        });
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set dispute manager
     * @param _disputeManager Dispute manager contract address
     */
    function setDisputeManager(address _disputeManager) external onlyOwner {
        require(_disputeManager != address(0), "RollupManager: zero address");
        require(disputeManager == address(0), "RollupManager: already set");
        disputeManager = _disputeManager;
        emit DisputeManagerSet(_disputeManager);
    }

    /*//////////////////////////////////////////////////////////////
                          SEQUENCER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @inheritdoc IRollupManager
     */
    function proposeStateRoot(
        bytes32 stateRoot,
        uint256 batchIndex
    ) external override onlySequencer {
        require(stateRoot != bytes32(0), "RollupManager: invalid state root");
        require(batchIndex == latestBatchIndex + 1, "RollupManager: invalid batch index");

        bytes32 prevStateRoot = batches[latestBatchIndex].stateRoot;

        batches[batchIndex] = Batch({
            stateRoot: stateRoot,
            prevStateRoot: prevStateRoot,
            timestamp: block.timestamp,
            proposer: msg.sender,
            status: BatchStatus.Pending
        });

        latestBatchIndex = batchIndex;

        emit StateRootProposed(batchIndex, stateRoot, prevStateRoot, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                          PUBLIC FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @inheritdoc IRollupManager
     */
    function getBatch(uint256 batchIndex) external view override returns (Batch memory) {
        return batches[batchIndex];
    }

    /**
     * @inheritdoc IRollupManager
     */
    function finalizeBatch(uint256 batchIndex) external override {
        Batch storage batch = batches[batchIndex];

        require(batch.status == BatchStatus.Pending, "RollupManager: not pending");
        require(
            block.timestamp >= batch.timestamp + CHALLENGE_PERIOD,
            "RollupManager: challenge period not ended"
        );
        require(
            batchIndex == latestFinalizedBatchIndex + 1,
            "RollupManager: must finalize in order"
        );

        batch.status = BatchStatus.Finalized;
        latestFinalizedBatchIndex = batchIndex;

        emit BatchFinalized(batchIndex, batch.stateRoot);
    }

    /*//////////////////////////////////////////////////////////////
                      DISPUTE MANAGER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Mark batch status as disputed
     * @param batchIndex Batch index
     */
    function markDisputed(uint256 batchIndex) external onlyDisputeManager {
        Batch storage batch = batches[batchIndex];
        require(batch.status == BatchStatus.Pending, "RollupManager: not pending");
        batch.status = BatchStatus.Disputed;
    }

    /**
     * @notice Reject batch (challenger wins dispute)
     * @param batchIndex Batch index
     */
    function rejectBatch(uint256 batchIndex) external onlyDisputeManager {
        Batch storage batch = batches[batchIndex];
        require(batch.status == BatchStatus.Disputed, "RollupManager: not disputed");
        batch.status = BatchStatus.Rejected;

        emit BatchRejected(batchIndex, batch.stateRoot);
    }

    /**
     * @notice Confirm batch (sequencer wins dispute)
     * @param batchIndex Batch index
     */
    function confirmBatch(uint256 batchIndex) external onlyDisputeManager {
        Batch storage batch = batches[batchIndex];
        require(batch.status == BatchStatus.Disputed, "RollupManager: not disputed");
        batch.status = BatchStatus.Finalized;

        // If there are intermediate batches, they must be finalized sequentially
        if (batchIndex == latestFinalizedBatchIndex + 1) {
            latestFinalizedBatchIndex = batchIndex;
        }

        emit BatchFinalized(batchIndex, batch.stateRoot);
    }
}
