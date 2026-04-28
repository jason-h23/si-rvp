/**
 * Phase 7 Sepolia - Resolve pending dispute
 *
 * Run after PROOF_DEADLINE (1 hour) has passed.
 * Triggers timeout and resolves the game via proxy.
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("==============================================================");
  console.log("  Phase 7 - Resolve Pending Dispute (Sepolia)");
  console.log("==============================================================\n");

  // Load E2E result
  const e2ePath = path.join(__dirname, "..", "deployments", `${network.name}-phase7-e2e.json`);
  if (!fs.existsSync(e2ePath)) {
    throw new Error(`E2E result not found. Run e2e-phase7.ts first.`);
  }
  const e2e = JSON.parse(fs.readFileSync(e2ePath, "utf-8"));

  const [deployer] = await ethers.getSigners();
  console.log(`  Deployer: ${deployer.address}`);

  const disputeManager = await ethers.getContractAt("DisputeManager", e2e.deployment.DisputeManager);
  const game = await ethers.getContractAt("ZKDisputeGameProxy", e2e.gameAddress);
  const disputeId = BigInt(e2e.disputeId);

  // Check deadline
  const dispute = await disputeManager.getDispute(disputeId);
  const currentBlock = await ethers.provider.getBlock("latest");
  const currentTime = BigInt(currentBlock!.timestamp);
  const deadline = dispute.deadline;

  console.log(`  Dispute ID: ${disputeId}`);
  console.log(`  Current time: ${currentTime}`);
  console.log(`  Deadline:     ${deadline}`);

  if (currentTime <= deadline) {
    const remaining = deadline - currentTime;
    console.log(`\n  Deadline not passed yet. ${remaining} seconds remaining (~${Number(remaining) / 60} min).`);
    console.log(`  Try again later.`);
    return;
  }

  console.log(`  Deadline passed!\n`);

  // Trigger timeout
  console.log("[1/2] Triggering timeout...");
  const timeoutTx = await disputeManager.triggerTimeout(disputeId);
  const timeoutReceipt = await timeoutTx.wait();
  console.log(`  -> tx: ${timeoutTx.hash}`);
  console.log(`  -> ${timeoutReceipt!.gasUsed} gas\n`);

  // Resolve game
  console.log("[2/2] Resolving game via proxy...");
  const resolveTx = await game.resolve();
  const resolveReceipt = await resolveTx.wait();
  console.log(`  -> tx: ${resolveTx.hash}`);
  console.log(`  -> ${resolveReceipt!.gasUsed} gas\n`);

  const finalStatus = await game.status();
  console.log("==============================================================");
  console.log(`  Final Status: ${finalStatus} (1 = CHALLENGER_WINS)`);
  console.log("==============================================================");

  // Update E2E result
  const updatedResult = {
    ...e2e,
    resolved: true,
    resolveTimestamp: new Date().toISOString(),
    resolveGas: {
      triggerTimeout: timeoutReceipt!.gasUsed.toString(),
      resolve: resolveReceipt!.gasUsed.toString(),
    },
    resolveTxs: {
      triggerTimeout: timeoutTx.hash,
      resolve: resolveTx.hash,
    },
    finalStatus: Number(finalStatus),
  };
  fs.writeFileSync(e2ePath, JSON.stringify(updatedResult, null, 2));
  console.log(`\n  Updated: ${e2ePath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
