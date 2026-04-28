/**
 * SI-RVP - Contract Deployment Script
 *
 * Deploys all contracts to the specified network
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentResult {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    Groth16Verifier: string;
    ZKVerifier: string;
    RollupManager: string;
    DisputeManager: string;
  };
  gasUsed: {
    Groth16Verifier: bigint;
    ZKVerifier: bigint;
    RollupManager: bigint;
    DisputeManager: bigint;
    total: bigint;
  };
  timestamp: string;
}

async function main(): Promise<DeploymentResult> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         SI-RVP - Contract Deployment                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`📋 Deployment Configuration:`);
  console.log(`   Network:  ${network.name}`);
  console.log(`   Chain ID: ${chainId}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log();

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`   Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log();

  const gasUsed: DeploymentResult["gasUsed"] = {
    Groth16Verifier: 0n,
    ZKVerifier: 0n,
    RollupManager: 0n,
    DisputeManager: 0n,
    total: 0n,
  };

  // ============================================
  // Deploy Groth16Verifier (auto-generated)
  // ============================================
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ Step 1: Deploy Groth16Verifier                               │");
  console.log("└──────────────────────────────────────────────────────────────┘");

  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const groth16Verifier = await Groth16Verifier.deploy();
  await groth16Verifier.waitForDeployment();
  const groth16VerifierAddress = await groth16Verifier.getAddress();

  const groth16Receipt = await groth16Verifier.deploymentTransaction()?.wait();
  gasUsed.Groth16Verifier = groth16Receipt?.gasUsed ?? 0n;

  console.log(`   ✓ Groth16Verifier deployed: ${groth16VerifierAddress}`);
  console.log(`   Gas used: ${gasUsed.Groth16Verifier}`);
  console.log();

  // ============================================
  // Deploy ZKVerifier (wrapper)
  // ============================================
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ Step 2: Deploy ZKVerifier                                    │");
  console.log("└──────────────────────────────────────────────────────────────┘");

  const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
  const zkVerifier = await ZKVerifier.deploy();
  await zkVerifier.waitForDeployment();
  const zkVerifierAddress = await zkVerifier.getAddress();

  const zkVerifierReceipt = await zkVerifier.deploymentTransaction()?.wait();
  gasUsed.ZKVerifier = zkVerifierReceipt?.gasUsed ?? 0n;

  console.log(`   ✓ ZKVerifier deployed: ${zkVerifierAddress}`);
  console.log(`   Gas used: ${gasUsed.ZKVerifier}`);
  console.log();

  // ============================================
  // Deploy RollupManager
  // ============================================
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ Step 3: Deploy RollupManager                                 │");
  console.log("└──────────────────────────────────────────────────────────────┘");

  const RollupManager = await ethers.getContractFactory("RollupManager");
  const rollupManager = await RollupManager.deploy(deployer.address);
  await rollupManager.waitForDeployment();
  const rollupManagerAddress = await rollupManager.getAddress();

  const rollupReceipt = await rollupManager.deploymentTransaction()?.wait();
  gasUsed.RollupManager = rollupReceipt?.gasUsed ?? 0n;

  console.log(`   ✓ RollupManager deployed: ${rollupManagerAddress}`);
  console.log(`   Gas used: ${gasUsed.RollupManager}`);
  console.log();

  // ============================================
  // Deploy DisputeManager
  // ============================================
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ Step 4: Deploy DisputeManager                                │");
  console.log("└──────────────────────────────────────────────────────────────┘");

  const DisputeManager = await ethers.getContractFactory("DisputeManager");
  const disputeManager = await DisputeManager.deploy(
    zkVerifierAddress,
    rollupManagerAddress
  );
  await disputeManager.waitForDeployment();
  const disputeManagerAddress = await disputeManager.getAddress();

  const disputeReceipt = await disputeManager.deploymentTransaction()?.wait();
  gasUsed.DisputeManager = disputeReceipt?.gasUsed ?? 0n;

  console.log(`   ✓ DisputeManager deployed: ${disputeManagerAddress}`);
  console.log(`   Gas used: ${gasUsed.DisputeManager}`);
  console.log();

  // ============================================
  // Configure RollupManager
  // ============================================
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ Step 5: Configure RollupManager                              │");
  console.log("└──────────────────────────────────────────────────────────────┘");

  const setDisputeTx = await rollupManager.setDisputeManager(disputeManagerAddress);
  await setDisputeTx.wait();
  console.log(`   ✓ DisputeManager linked to RollupManager`);
  console.log();

  // ============================================
  // Summary
  // ============================================
  gasUsed.total =
    gasUsed.Groth16Verifier +
    gasUsed.ZKVerifier +
    gasUsed.RollupManager +
    gasUsed.DisputeManager;

  const result: DeploymentResult = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    contracts: {
      Groth16Verifier: groth16VerifierAddress,
      ZKVerifier: zkVerifierAddress,
      RollupManager: rollupManagerAddress,
      DisputeManager: disputeManagerAddress,
    },
    gasUsed,
    timestamp: new Date().toISOString(),
  };

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                   Deployment Summary                         ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ Groth16Verifier: ${groth16VerifierAddress.slice(0, 20)}...      ║`);
  console.log(`║ ZKVerifier:      ${zkVerifierAddress.slice(0, 20)}...      ║`);
  console.log(`║ RollupManager:   ${rollupManagerAddress.slice(0, 20)}...      ║`);
  console.log(`║ DisputeManager:  ${disputeManagerAddress.slice(0, 20)}...      ║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ Total Gas Used: ${gasUsed.total.toString().padStart(15)}                    ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // Save deployment result
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(
    deploymentsDir,
    `${network.name}-${Date.now()}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(result, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));
  console.log(`📄 Deployment saved to: ${deploymentFile}`);

  // Save latest deployment for easy access
  const latestFile = path.join(deploymentsDir, `${network.name}-latest.json`);
  fs.writeFileSync(latestFile, JSON.stringify(result, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));
  console.log(`📄 Latest deployment: ${latestFile}`);

  return result;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
