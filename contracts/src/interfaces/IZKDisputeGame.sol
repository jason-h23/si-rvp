// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDisputeGame} from "./IDisputeGame.sol";
import {GameStatus} from "../libraries/Types.sol";

/**
 * @title IZKDisputeGame
 * @notice Extended dispute game interface for ZK-based resolution
 * @dev Adds ZK proof submission capability on top of the standard IDisputeGame.
 *      This is the "ZK adapter" — while IDisputeGame is the standard plug,
 *      IZKDisputeGame adds the ZK-specific wiring inside.
 */
interface IZKDisputeGame is IDisputeGame {
    /// @notice Emitted when a ZK proof is submitted to this game
    /// @param disputeId The internal dispute ID in DisputeManager
    /// @param submitter Address that submitted the proof
    /// @param proofValid Whether the proof verified successfully
    event ZKProofSubmitted(
        uint256 indexed disputeId,
        address indexed submitter,
        bool proofValid
    );

    /**
     * @notice Challenge a state root via the ZK dispute path
     * @param claimedStateRoot The correct state root the challenger believes
     * @return disputeId The dispute ID in DisputeManager
     */
    function challenge(bytes32 claimedStateRoot) external payable returns (uint256 disputeId);

    /**
     * @notice The address of the underlying DisputeManager
     * @return disputeManager_ The DisputeManager contract address
     */
    function disputeManager() external view returns (address disputeManager_);

    /**
     * @notice The address of the ZK verifier
     * @return zkVerifier_ The ZKVerifier contract address
     */
    function zkVerifier() external view returns (address zkVerifier_);

    /**
     * @notice The internal dispute ID in DisputeManager (0 if not yet challenged)
     * @return disputeId_ The dispute ID
     */
    function disputeId() external view returns (uint256 disputeId_);
}
