// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDisputeGame} from "./interfaces/IDisputeGame.sol";
import {ZKDisputeGameProxy} from "./ZKDisputeGameProxy.sol";
import {GameType, Claim, GameStatus} from "./libraries/Types.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DisputeGameFactory
 * @notice Minimal Optimism-compatible factory for creating dispute game instances
 * @dev Think of this as a "vending machine" for dispute games:
 *      - Owner stocks it with game type implementations (setImplementation)
 *      - Anyone can insert a coin (create) and get a new game instance
 *      - Each game is a minimal clone (EIP-1167) of the registered implementation
 *
 *      This is a simplified version of Optimism's DisputeGameFactory,
 *      tailored for SI-RVP's ZK dispute resolution.
 */
contract DisputeGameFactory is Ownable {
    using Clones for address;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice GameType => implementation address
    mapping(GameType => address) public implementations;

    /// @notice All created games (index => game address)
    address[] internal _games;

    /// @notice Lookup: hash(gameType, rootClaim, extraData) => game address
    mapping(bytes32 => address) public gameAtIndex;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a new dispute game is created
    event DisputeGameCreated(
        address indexed proxy,
        GameType indexed gameType,
        Claim indexed rootClaim,
        uint256 l2BlockNumber,
        bytes extraData
    );

    /// @notice Emitted when a game type implementation is set
    event ImplementationSet(
        GameType indexed gameType,
        address indexed implementation
    );

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor() Ownable(msg.sender) {}

    /*//////////////////////////////////////////////////////////////
                          EXTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Register an implementation for a game type
     * @param _gameType The game type to register
     * @param _implementation The implementation contract address
     */
    function setImplementation(
        GameType _gameType,
        address _implementation
    ) external onlyOwner {
        require(_implementation != address(0), "DisputeGameFactory: zero address");

        implementations[_gameType] = _implementation;
        emit ImplementationSet(_gameType, _implementation);
    }

    /**
     * @notice Create a new dispute game instance
     * @param _gameType The type of game to create
     * @param _rootClaim The root claim (state root being disputed)
     * @param _l2BlockNumber The L2 block number
     * @param _extraData Extra data passed to the game (e.g., batchIndex, disputeManagerAddr)
     * @return proxy_ The newly created game proxy address
     */
    function create(
        GameType _gameType,
        Claim _rootClaim,
        uint256 _l2BlockNumber,
        bytes calldata _extraData
    ) external payable returns (address proxy_) {
        address impl = implementations[_gameType];
        require(impl != address(0), "DisputeGameFactory: no implementation");

        // Ensure no duplicate game for same parameters
        bytes32 lookupKey = _gameKey(_gameType, _rootClaim, _extraData);
        require(
            gameAtIndex[lookupKey] == address(0),
            "DisputeGameFactory: game already exists"
        );

        // Clone the implementation
        proxy_ = impl.clone();

        // Initialize the clone
        IDisputeGame(proxy_).initialize{value: msg.value}();

        // Setup the game parameters (ZKDisputeGameProxy-specific)
        ZKDisputeGameProxy(proxy_).setup(_rootClaim, _extraData, _l2BlockNumber);

        // Track the game
        _games.push(proxy_);
        gameAtIndex[lookupKey] = proxy_;

        emit DisputeGameCreated(proxy_, _gameType, _rootClaim, _l2BlockNumber, _extraData);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get total number of created games
     * @return count_ The number of games created
     */
    function gameCount() external view returns (uint256 count_) {
        return _games.length;
    }

    /**
     * @notice Get a game by its index
     * @param _index The index in the games array
     * @return proxy_ The game proxy address
     */
    function gameAtIdx(uint256 _index) external view returns (address proxy_) {
        require(_index < _games.length, "DisputeGameFactory: index out of bounds");
        return _games[_index];
    }

    /**
     * @notice Look up a game by its parameters
     * @param _gameType The game type
     * @param _rootClaim The root claim
     * @param _extraData The extra data
     * @return proxy_ The game proxy address (address(0) if not found)
     */
    function games(
        GameType _gameType,
        Claim _rootClaim,
        bytes calldata _extraData
    ) external view returns (address proxy_) {
        return gameAtIndex[_gameKey(_gameType, _rootClaim, _extraData)];
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Compute a unique key for game lookup
     */
    function _gameKey(
        GameType _gameType,
        Claim _rootClaim,
        bytes memory _extraData
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(_gameType, _rootClaim, _extraData));
    }
}
