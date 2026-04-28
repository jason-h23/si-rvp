/**
 * Phase 7 Sepolia E2E Test
 *
 * Full lifecycle: Factory.create() -> Proxy.challenge() -> timeout -> Proxy.resolve()
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("==============================================================");
  console.log("  Phase 7 - Sepolia E2E Verification");
  console.log("==============================================================\n");

  // Load deployment
  const deploymentPath = path.join(__dirname, "..", "deployments", `${network.name}-phase7-latest.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment not found: ${deploymentPath}`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  const addrs = deployment.contracts;

  const [deployer] = await ethers.getSigners();
  console.log(`  Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Connect to contracts
  const rollupManager = await ethers.getContractAt("RollupManager", addrs.RollupManager);
  const disputeManager = await ethers.getContractAt("DisputeManager", addrs.DisputeManager);
  const factory = await ethers.getContractAt("DisputeGameFactory", addrs.DisputeGameFactory);

  const gasLog: Record<string, bigint> = {};

  // Step 1: Propose state root
  console.log("[1/7] Proposing state root...");
  const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("phase7-sepolia-test-" + Date.now()));
  const latestBatch = await rollupManager.latestBatchIndex();
  const nextBatch = latestBatch + 1n;
  const proposeTx = await rollupManager.proposeStateRoot(stateRoot, nextBatch);
  const proposeReceipt = await proposeTx.wait();
  gasLog.proposeStateRoot = proposeReceipt!.gasUsed;
  console.log(`  -> batch ${nextBatch}, tx: ${proposeTx.hash}`);
  console.log(`  -> ${gasLog.proposeStateRoot} gas\n`);

  // Step 2: Create game via factory
  console.log("[2/7] Creating dispute game via factory...");
  const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address"],
    [nextBatch, addrs.DisputeManager]
  );
  const createTx = await factory.create(255, stateRoot, nextBatch, extraData);
  const createReceipt = await createTx.wait();
  gasLog.factoryCreate = createReceipt!.gasUsed;

  const gameCount = await factory.gameCount();
  const gameAddr = await factory.gameAtIdx(gameCount - 1n);
  console.log(`  -> game: ${gameAddr}`);
  console.log(`  -> tx: ${createTx.hash}`);
  console.log(`  -> ${gasLog.factoryCreate} gas\n`);

  // Step 3: Authorize game clone in DisputeManager
  console.log("[3/7] Authorizing game clone as proxy...");
  const authTx = await disputeManager.addAuthorizedProxy(gameAddr);
  const authReceipt = await authTx.wait();
  gasLog.addAuthorizedProxy = authReceipt!.gasUsed;
  console.log(`  -> tx: ${authTx.hash}`);
  console.log(`  -> ${gasLog.addAuthorizedProxy} gas\n`);

  // Step 4: Challenge via proxy
  console.log("[4/7] Challenging via game proxy...");
  const game = await ethers.getContractAt("ZKDisputeGameProxy", gameAddr);
  const challengerClaim = ethers.keccak256(ethers.toUtf8Bytes("challenger-claim-" + Date.now()));
  const bondAmount = ethers.parseEther("0.01");

  const challengeTx = await game.challenge(challengerClaim, { value: bondAmount });
  const challengeReceipt = await challengeTx.wait();
  gasLog.challenge = challengeReceipt!.gasUsed;
  console.log(`  -> tx: ${challengeTx.hash}`);
  console.log(`  -> ${gasLog.challenge} gas\n`);

  // Verify dispute was created
  const disputeId = await game.disputeId();
  const dispute = await disputeManager.getDispute(disputeId);
  console.log(`  Dispute ID: ${disputeId}`);
  console.log(`  Challenger: ${dispute.challenger}`);
  console.log(`  Batch: ${dispute.batchIndex}`);

  // Step 5: Check game status
  console.log("\n[5/7] Checking game status...");
  const status = await game.status();
  const gameType = await game.gameType();
  const rootClaim = await game.rootClaim();
  const createdAt = await game.createdAt();
  console.log(`  Status: ${status} (0 = IN_PROGRESS)`);
  console.log(`  GameType: ${gameType} (255 = ZK_CANNON)`);
  console.log(`  RootClaim: ${rootClaim}`);
  console.log(`  CreatedAt: ${createdAt}`);

  // Step 6: Wait for timeout then trigger it
  console.log("\n[6/7] Triggering timeout...");
  console.log("  (DisputeManager PROOF_DEADLINE = 1 hour on mainnet,");
  console.log("   but on Sepolia we can trigger after deadline)");

  // Check if deadline has passed
  const disputeInfo = await disputeManager.getDispute(disputeId);
  const currentBlock = await ethers.provider.getBlock("latest");
  const currentTime = BigInt(currentBlock!.timestamp);
  const deadline = disputeInfo.deadline;

  if (currentTime <= deadline) {
    console.log(`  Current time: ${currentTime}`);
    console.log(`  Deadline:     ${deadline}`);
    console.log(`  Remaining:    ${deadline - currentTime} seconds`);
    console.log("\n  [SKIP] Timeout not yet available.");
    console.log("  To complete E2E: wait for deadline, then run this script again with --resolve flag.");
  } else {
    const timeoutTx = await disputeManager.triggerTimeout(disputeId);
    const timeoutReceipt = await timeoutTx.wait();
    gasLog.triggerTimeout = timeoutReceipt!.gasUsed;
    console.log(`  -> tx: ${timeoutTx.hash}`);
    console.log(`  -> ${gasLog.triggerTimeout} gas`);

    // Step 7: Resolve game
    console.log("\n[7/7] Resolving game via proxy...");
    const resolveTx = await game.resolve();
    const resolveReceipt = await resolveTx.wait();
    gasLog.resolve = resolveReceipt!.gasUsed;
    console.log(`  -> tx: ${resolveTx.hash}`);
    console.log(`  -> ${gasLog.resolve} gas`);

    const finalStatus = await game.status();
    console.log(`  Final Status: ${finalStatus} (1 = CHALLENGER_WINS)`);
  }

  // Summary
  const totalGas = Object.values(gasLog).reduce((a, b) => a + b, 0n);
  console.log("\n==============================================================");
  console.log("  E2E Gas Summary");
  console.log("==============================================================");
  for (const [op, gas] of Object.entries(gasLog)) {
    console.log(`  ${op.padEnd(25)} ${gas.toString().padStart(10)} gas`);
  }
  console.log(`  ${"─".repeat(37)}`);
  console.log(`  ${"total".padEnd(25)} ${totalGas.toString().padStart(10)} gas`);
  console.log("==============================================================");

  // Save E2E result
  const resultFile = path.join(__dirname, "..", "deployments", `${network.name}-phase7-e2e.json`);
  const e2eResult = {
    network: network.name,
    timestamp: new Date().toISOString(),
    deployment: addrs,
    gameAddress: gameAddr,
    disputeId: disputeId.toString(),
    gasLog: Object.fromEntries(Object.entries(gasLog).map(([k, v]) => [k, v.toString()])),
    totalGas: totalGas.toString(),
    transactions: {
      proposeStateRoot: proposeTx.hash,
      factoryCreate: createTx.hash,
      addAuthorizedProxy: authTx.hash,
      challenge: challengeTx.hash,
    },
  };
  fs.writeFileSync(resultFile, JSON.stringify(e2eResult, null, 2));
  console.log(`\n  E2E result saved: ${resultFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
