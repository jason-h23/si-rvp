// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZKDisputeGame} from "./interfaces/IZKDisputeGame.sol";
import {IDisputeGame} from "./interfaces/IDisputeGame.sol";
import {IDisputeManager} from "./interfaces/IDisputeManager.sol";
import {GameType, Claim, Timestamp, GameStatus} from "./libraries/Types.sol";

/**
 * @title ZKDisputeGameProxy
 * @notice Adapter that bridges IDisputeGame (Optimism Factory) to DisputeManager (SI-RVP)
 * @dev Think of this as a "standard plug" adapter:
 *      - The Factory creates clones of this contract (each clone = one dispute game)
 *      - Each clone delegates to the existing DisputeManager for actual dispute logic
 *      - This way, SI-RVP's ZK dispute resolution "plugs into" Optimism's Factory outlet
 *
 *      Lifecycle:
 *      1. Factory clones this implementation -> calls initialize()
 *      2. Factory calls setup() with game parameters
 *      3. Challenger calls challenge() -> forwards to DisputeManager.initiateDisputeFor()
 *      4. Off-chain bisection happens via existing DisputeManager flow
 *      5. Anyone calls resolve() -> reads result from DisputeManager
 */
contract ZKDisputeGameProxy is IZKDisputeGame {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice The game type identifier for ZK Cannon
    /// @dev Value 255 avoids collision with Optimism built-in types
    ///      (0 = CANNON, 1 = PERMISSIONED_CANNON, 2 = ASTERISC, etc.)
    GameType public constant GAME_TYPE = GameType.wrap(255);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The DisputeManager this proxy delegates to
    IDisputeManager internal _disputeManager;

    /// @notice The root claim (state root being disputed)
    Claim internal _rootClaim;

    /// @notice Extra data from factory (abi.encode(batchIndex, disputeManagerAddr))
    bytes internal _extraData;

    /// @notice L2 block number this dispute pertains to
    uint256 internal _l2BlockNumber;

    /// @notice When this game was created
    Timestamp internal _createdAt;

    /// @notice Current game status
    GameStatus internal _status;

    /// @notice The dispute ID in DisputeManager (0 = not yet challenged)
    uint256 internal _disputeId;

    /// @notice Whether initialize() has been called
    bool internal _initialized;

    /// @notice The factory contract that deployed this clone
    address internal _factory;

    /*//////////////////////////////////////////////////////////////
                            INITIALIZATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Initialize the dispute game (called by Factory after cloning)
    function initialize() external payable override {
        require(!_initialized, "ZKDisputeGameProxy: already initialized");
        _initialized = true;
        _factory = msg.sender;
        _createdAt = Timestamp.wrap(uint64(block.timestamp));
        _status = GameStatus.IN_PROGRESS;
    }

    /**
     * @notice Set game parameters (called by Factory right after initialize)
     * @param rootClaim_ The root claim for this game
     * @param extraData_ Extra data (abi.encode(batchIndex, disputeManagerAddr))
     * @param l2BlockNumber_ The L2 block number
     */
    function setup(
        Claim rootClaim_,
        bytes calldata extraData_,
        uint256 l2BlockNumber_
    ) external {
        require(msg.sender == _factory, "ZKDisputeGameProxy: not factory");
        require(_initialized, "ZKDisputeGameProxy: not initialized");
        require(Claim.unwrap(_rootClaim) == bytes32(0), "ZKDisputeGameProxy: already setup");

        _rootClaim = rootClaim_;
        _extraData = extraData_;
        _l2BlockNumber = l2BlockNumber_;

        // Decode disputeManager address from extraData
        (, address disputeManagerAddr) = abi.decode(extraData_, (uint256, address));
        _disputeManager = IDisputeManager(disputeManagerAddr);
    }

    /*//////////////////////////////////////////////////////////////
                          CHALLENGE (ZK PATH)
    //////////////////////////////////////////////////////////////*/

    /// @notice Challenge a state root via the ZK dispute path
    function challenge(bytes32 claimedStateRoot) external payable override returns (uint256) {
        require(_status == GameStatus.IN_PROGRESS, "ZKDisputeGameProxy: game not in progress");
        require(_disputeId == 0, "ZKDisputeGameProxy: already challenged");

        // Decode batchIndex from extraData
        (uint256 batchIndex,) = abi.decode(_extraData, (uint256, address));

        // Forward to DisputeManager via authorized proxy path
        _disputeId = _disputeManager.initiateDisputeFor{value: msg.value}(
            msg.sender,
            batchIndex,
            claimedStateRoot
        );

        return _disputeId;
    }

    /*//////////////////////////////////////////////////////////////
                            RESOLUTION
    //////////////////////////////////////////////////////////////*/

    /// @notice Resolve the dispute game by reading result from DisputeManager
    function resolve() external override returns (GameStatus status_) {
        require(_status == GameStatus.IN_PROGRESS, "ZKDisputeGameProxy: already resolved");
        require(_disputeId != 0, "ZKDisputeGameProxy: not challenged");

        IDisputeManager.Dispute memory dispute = _disputeManager.getDispute(_disputeId);

        if (dispute.status == IDisputeManager.DisputeStatus.Resolved) {
            status_ = _isSequencerWinner(dispute)
                ? GameStatus.DEFENDER_WINS
                : GameStatus.CHALLENGER_WINS;
        } else if (dispute.status == IDisputeManager.DisputeStatus.Timeout) {
            status_ = GameStatus.CHALLENGER_WINS;
        } else {
            revert("ZKDisputeGameProxy: dispute not resolved");
        }

        _status = status_;
        emit Resolved(status_);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice The current status of the game
    function status() external view override returns (GameStatus) {
        return _status;
    }

    /// @notice The type of this dispute game (ZK_CANNON = 255)
    function gameType() external pure override returns (GameType) {
        return GAME_TYPE;
    }

    /// @notice The root claim being disputed
    function rootClaim() external view override returns (Claim) {
        return _rootClaim;
    }

    /// @notice Timestamp when this game was created
    function createdAt() external view override returns (Timestamp) {
        return _createdAt;
    }

    /// @notice The L2 block number this dispute pertains to
    function l2BlockNumber() external view override returns (uint256) {
        return _l2BlockNumber;
    }

    /// @notice Extra data passed during game creation
    function extraData() external view override returns (bytes memory) {
        return _extraData;
    }

    /// @notice The address of the underlying DisputeManager
    function disputeManager() external view override returns (address) {
        return address(_disputeManager);
    }

    /// @notice The address of the ZK verifier (read from DisputeManager)
    function zkVerifier() external view override returns (address) {
        (bool success, bytes memory data) = address(_disputeManager).staticcall(
            abi.encodeWithSignature("zkVerifier()")
        );
        require(success, "ZKDisputeGameProxy: zkVerifier call failed");
        return abi.decode(data, (address));
    }

    /// @notice The internal dispute ID in DisputeManager
    function disputeId() external view override returns (uint256) {
        return _disputeId;
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Determine if sequencer won by reading proofResults from DisputeManager
     */
    function _isSequencerWinner(IDisputeManager.Dispute memory dispute) internal view returns (bool) {
        // Read proofResults mapping from DisputeManager
        (bool success, bytes memory data) = address(_disputeManager).staticcall(
            abi.encodeWithSignature("proofResults(uint256)", _disputeId)
        );
        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }
        // Fallback: infer from bond state
        return dispute.sequencerBond == 0 && dispute.challengerBond > 0;
    }
}
