// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GameType, Claim, Timestamp, GameStatus} from "../libraries/Types.sol";

/**
 * @title IDisputeGame
 * @notice Optimism DisputeGameFactory-compatible dispute game interface
 * @dev Any dispute game implementation must conform to this interface
 *      to be registered with the DisputeGameFactory.
 *      Think of this as the "standard plug" that lets any dispute game
 *      connect to the Factory's "outlet."
 */
interface IDisputeGame {
    /// @notice Emitted when the game is resolved
    /// @param status The resolved game status
    event Resolved(GameStatus indexed status);

    /**
     * @notice Initialize the dispute game (called by Factory after cloning)
     * @dev MUST revert if called more than once.
     *      The Factory calls this right after deploying a clone.
     */
    function initialize() external payable;

    /**
     * @notice Resolve the dispute game
     * @return status_ The final status of the game
     */
    function resolve() external returns (GameStatus status_);

    /**
     * @notice The current status of the game
     * @return status_ The current GameStatus
     */
    function status() external view returns (GameStatus status_);

    /**
     * @notice The type of this dispute game
     * @return gameType_ The GameType identifier
     */
    function gameType() external view returns (GameType gameType_);

    /**
     * @notice The root claim being disputed
     * @return rootClaim_ The Claim (state root hash)
     */
    function rootClaim() external view returns (Claim rootClaim_);

    /**
     * @notice Timestamp when this game instance was created
     * @return createdAt_ Creation timestamp
     */
    function createdAt() external view returns (Timestamp createdAt_);

    /**
     * @notice The L2 block number this dispute pertains to
     * @return l2BlockNumber_ The L2 block number
     */
    function l2BlockNumber() external view returns (uint256 l2BlockNumber_);

    /**
     * @notice Extra data passed during game creation
     * @return extraData_ Arbitrary bytes (e.g., batch index, proposer)
     */
    function extraData() external view returns (bytes memory extraData_);
}
