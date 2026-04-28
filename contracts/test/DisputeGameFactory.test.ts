/**
 * DisputeGameFactory Contract Tests
 *
 * E2E tests for the DisputeGameFactory which creates dispute game instances
 * using the EIP-1167 minimal clone pattern. Tests cover game type registration,
 * game creation, and a full lifecycle with ZK_CANNON game type.
 *
 * @module test/DisputeGameFactory.test.ts
 * @see contracts/src/DisputeGameFactory.sol
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DisputeGameFactory,
  ZKDisputeGameProxy,
  DisputeManager,
  RollupManager,
  ZKVerifier,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("DisputeGameFactory", function () {
  let factory: DisputeGameFactory;
  let proxyImpl: ZKDisputeGameProxy;
  let disputeManager: DisputeManager;
  let rollupManager: RollupManager;
  let zkVerifier: ZKVerifier;
  let owner: HardhatEthersSigner;
  let sequencer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const BOND_AMOUNT = ethers.parseEther("0.01");
  const PROOF_DEADLINE = 60 * 60; // 1 hour

  const ZK_CANNON = 255; // GameType for ZK Cannon

  const stateRoot1 = ethers.keccak256(ethers.toUtf8Bytes("state1"));
  const stateRoot2 = ethers.keccak256(ethers.toUtf8Bytes("state2"));

  beforeEach(async function () {
    [owner, sequencer, challenger, other] = await ethers.getSigners();

    // Deploy core contracts
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    zkVerifier = await ZKVerifier.deploy();
    await zkVerifier.waitForDeployment();

    const RollupManager = await ethers.getContractFactory("RollupManager");
    rollupManager = await RollupManager.deploy(sequencer.address);
    await rollupManager.waitForDeployment();

    const DisputeManager = await ethers.getContractFactory("DisputeManager");
    disputeManager = await DisputeManager.deploy(
      await zkVerifier.getAddress(),
      await rollupManager.getAddress()
    );
    await disputeManager.waitForDeployment();

    // Wire up
    await rollupManager.setDisputeManager(await disputeManager.getAddress());

    // Deploy factory
    const Factory = await ethers.getContractFactory("DisputeGameFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // Deploy ZKDisputeGameProxy implementation
    const Proxy = await ethers.getContractFactory("ZKDisputeGameProxy");
    proxyImpl = await Proxy.deploy();
    await proxyImpl.waitForDeployment();

    // Register ZK_CANNON game type
    await factory.setImplementation(ZK_CANNON, await proxyImpl.getAddress());

    // Sequencer proposes state root
    await rollupManager.connect(sequencer).proposeStateRoot(stateRoot1, 1);
  });

  describe("Implementation Management", function () {
    it("should register game type implementation", async function () {
      expect(await factory.implementations(ZK_CANNON)).to.equal(
        await proxyImpl.getAddress()
      );
    });

    it("should emit ImplementationSet event", async function () {
      const NewProxy = await ethers.getContractFactory("ZKDisputeGameProxy");
      const newImpl = await NewProxy.deploy();
      await newImpl.waitForDeployment();

      await expect(
        factory.setImplementation(254, await newImpl.getAddress())
      )
        .to.emit(factory, "ImplementationSet")
        .withArgs(254, await newImpl.getAddress());
    });

    it("should reject non-owner from setting implementation", async function () {
      await expect(
        factory
          .connect(other)
          .setImplementation(ZK_CANNON, await proxyImpl.getAddress())
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("should reject zero address implementation", async function () {
      await expect(
        factory.setImplementation(ZK_CANNON, ethers.ZeroAddress)
      ).to.be.revertedWith("DisputeGameFactory: zero address");
    });
  });

  describe("Game Creation", function () {
    it("should create a new game via clone", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      const tx = await factory.create(ZK_CANNON, stateRoot1, 100, extraData);
      const receipt = await tx.wait();

      // Verify game was created
      expect(await factory.gameCount()).to.equal(1);
    });

    it("should emit DisputeGameCreated event", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await expect(factory.create(ZK_CANNON, stateRoot1, 100, extraData))
        .to.emit(factory, "DisputeGameCreated");
    });

    it("should setup clone with correct parameters", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await factory.create(ZK_CANNON, stateRoot1, 100, extraData);

      const gameAddr = await factory.gameAtIdx(0);
      const game = await ethers.getContractAt("ZKDisputeGameProxy", gameAddr);

      expect(await game.rootClaim()).to.equal(stateRoot1);
      expect(await game.l2BlockNumber()).to.equal(100);
      expect(await game.status()).to.equal(0); // IN_PROGRESS
      expect(await game.gameType()).to.equal(ZK_CANNON);
    });

    it("should reject unregistered game type", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await expect(
        factory.create(254, stateRoot1, 100, extraData)
      ).to.be.revertedWith("DisputeGameFactory: no implementation");
    });

    it("should reject duplicate game creation", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await factory.create(ZK_CANNON, stateRoot1, 100, extraData);

      await expect(
        factory.create(ZK_CANNON, stateRoot1, 100, extraData)
      ).to.be.revertedWith("DisputeGameFactory: game already exists");
    });

    it("should allow different games for different rootClaims", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await factory.create(ZK_CANNON, stateRoot1, 100, extraData);
      await factory.create(ZK_CANNON, stateRoot2, 100, extraData);

      expect(await factory.gameCount()).to.equal(2);
    });
  });

  describe("Game Lookup", function () {
    it("should find game by parameters", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await factory.create(ZK_CANNON, stateRoot1, 100, extraData);

      const gameAddr = await factory.games(ZK_CANNON, stateRoot1, extraData);
      expect(gameAddr).to.not.equal(ethers.ZeroAddress);

      const gameByIdx = await factory.gameAtIdx(0);
      expect(gameAddr).to.equal(gameByIdx);
    });

    it("should return zero address for non-existent game", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      const gameAddr = await factory.games(ZK_CANNON, stateRoot1, extraData);
      expect(gameAddr).to.equal(ethers.ZeroAddress);
    });
  });

  describe("E2E: Factory → Proxy → DisputeManager", function () {
    it("should complete full dispute lifecycle via factory", async function () {
      // 1. Create game via factory
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await factory.create(ZK_CANNON, stateRoot1, 100, extraData);

      const gameAddr = await factory.gameAtIdx(0);
      const game = await ethers.getContractAt("ZKDisputeGameProxy", gameAddr);

      // 2. Authorize the game clone as a proxy in DisputeManager
      await disputeManager.addAuthorizedProxy(gameAddr);

      // 3. Challenger challenges via the game
      await game
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });

      // Verify dispute was created in DisputeManager
      const disputeId = await game.disputeId();
      expect(disputeId).to.equal(1);

      const dispute = await disputeManager.getDispute(disputeId);
      expect(dispute.challenger).to.equal(challenger.address);
      expect(dispute.batchIndex).to.equal(1);

      // 4. Timeout → challenger wins
      await time.increase(PROOF_DEADLINE + 1);
      await disputeManager.triggerTimeout(disputeId);

      // 5. Resolve game via proxy
      await game.resolve();
      expect(await game.status()).to.equal(1); // CHALLENGER_WINS
    });

    it("should track gas costs for factory operations", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      // Measure create() gas
      const createTx = await factory.create(ZK_CANNON, stateRoot1, 100, extraData);
      const createReceipt = await createTx.wait();
      const createGas = createReceipt!.gasUsed;

      console.log(`\n  Gas Costs:`);
      console.log(`    Factory.create(): ${createGas.toString()} gas`);

      const gameAddr = await factory.gameAtIdx(0);
      const game = await ethers.getContractAt("ZKDisputeGameProxy", gameAddr);
      await disputeManager.addAuthorizedProxy(gameAddr);

      // Measure challenge() gas
      const challengeTx = await game
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });
      const challengeReceipt = await challengeTx.wait();
      const challengeGas = challengeReceipt!.gasUsed;

      console.log(`    Proxy.challenge(): ${challengeGas.toString()} gas`);

      // Measure resolve() gas (after timeout)
      await time.increase(PROOF_DEADLINE + 1);
      await disputeManager.triggerTimeout(1);

      const resolveTx = await game.resolve();
      const resolveReceipt = await resolveTx.wait();
      const resolveGas = resolveReceipt!.gasUsed;

      console.log(`    Proxy.resolve(): ${resolveGas.toString()} gas`);
      console.log(`    Total lifecycle: ${(createGas + challengeGas + resolveGas).toString()} gas\n`);

      // Sanity check: total should be reasonable
      expect(createGas + challengeGas + resolveGas).to.be.lt(1_000_000n);
    });
  });
});
