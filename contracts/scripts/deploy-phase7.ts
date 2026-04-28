/**
 * SI-RVP - Phase 7 Full Deployment Script
 *
 * Deploys all contracts including Phase 7 (DisputeGameFactory + ZKDisputeGameProxy).
 * Requires fresh deployment since DisputeManager has new Phase 7 fields.
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface Phase7DeploymentResult {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    Groth16Verifier: string;
    ZKVerifier: string;
    RollupManager: string;
    DisputeManager: string;
    ZKDisputeGameProxy: string;
    DisputeGameFactory: string;
  };
  gasUsed: Record<string, string>;
  timestamp: string;
}

async function main(): Promise<Phase7DeploymentResult> {
  console.log("==============================================================");
  console.log("  SI-RVP - Phase 7 Full Deployment");
  console.log("==============================================================");
  console.log();

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`  Network:  ${network.name}`);
  console.log(`  Chain ID: ${chainId}`);
  console.log(`  Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log();

  const gasUsed: Record<string, bigint> = {};

  // Step 1: Groth16Verifier
  console.log("[1/8] Deploying Groth16Verifier...");
  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const groth16Verifier = await Groth16Verifier.deploy();
  await groth16Verifier.waitForDeployment();
  const groth16Addr = await groth16Verifier.getAddress();
  gasUsed.Groth16Verifier = (await groth16Verifier.deploymentTransaction()?.wait())?.gasUsed ?? 0n;
  console.log(`  -> ${groth16Addr} (${gasUsed.Groth16Verifier} gas)`);

  // Step 2: ZKVerifier
  console.log("[2/8] Deploying ZKVerifier...");
  const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
  const zkVerifier = await ZKVerifier.deploy();
  await zkVerifier.waitForDeployment();
  const zkVerifierAddr = await zkVerifier.getAddress();
  gasUsed.ZKVerifier = (await zkVerifier.deploymentTransaction()?.wait())?.gasUsed ?? 0n;
  console.log(`  -> ${zkVerifierAddr} (${gasUsed.ZKVerifier} gas)`);

  // Step 3: RollupManager
  console.log("[3/8] Deploying RollupManager...");
  const RollupManager = await ethers.getContractFactory("RollupManager");
  const rollupManager = await RollupManager.deploy(deployer.address);
  await rollupManager.waitForDeployment();
  const rollupAddr = await rollupManager.getAddress();
  gasUsed.RollupManager = (await rollupManager.deploymentTransaction()?.wait())?.gasUsed ?? 0n;
  console.log(`  -> ${rollupAddr} (${gasUsed.RollupManager} gas)`);

  // Step 4: DisputeManager (Phase 7: includes authorizedProxy, initiateDisputeFor)
  console.log("[4/8] Deploying DisputeManager (Phase 7)...");
  const DisputeManager = await ethers.getContractFactory("DisputeManager");
  const disputeManager = await DisputeManager.deploy(zkVerifierAddr, rollupAddr);
  await disputeManager.waitForDeployment();
  const disputeAddr = await disputeManager.getAddress();
  gasUsed.DisputeManager = (await disputeManager.deploymentTransaction()?.wait())?.gasUsed ?? 0n;
  console.log(`  -> ${disputeAddr} (${gasUsed.DisputeManager} gas)`);

  // Step 5: Link DisputeManager to RollupManager
  console.log("[5/8] Linking DisputeManager to RollupManager...");
  const linkTx = await rollupManager.setDisputeManager(disputeAddr);
  const linkReceipt = await linkTx.wait();
  gasUsed.linkDisputeManager = linkReceipt?.gasUsed ?? 0n;
  console.log(`  -> linked (${gasUsed.linkDisputeManager} gas)`);

  // Step 6: ZKDisputeGameProxy (implementation template)
  console.log("[6/8] Deploying ZKDisputeGameProxy implementation...");
  const Proxy = await ethers.getContractFactory("ZKDisputeGameProxy");
  const proxyImpl = await Proxy.deploy();
  await proxyImpl.waitForDeployment();
  const proxyImplAddr = await proxyImpl.getAddress();
  gasUsed.ZKDisputeGameProxy = (await proxyImpl.deploymentTransaction()?.wait())?.gasUsed ?? 0n;
  console.log(`  -> ${proxyImplAddr} (${gasUsed.ZKDisputeGameProxy} gas)`);

  // Step 7: DisputeGameFactory
  console.log("[7/8] Deploying DisputeGameFactory...");
  const Factory = await ethers.getContractFactory("DisputeGameFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  gasUsed.DisputeGameFactory = (await factory.deploymentTransaction()?.wait())?.gasUsed ?? 0n;
  console.log(`  -> ${factoryAddr} (${gasUsed.DisputeGameFactory} gas)`);

  // Step 8: Register ZK_CANNON (type 255) in factory
  console.log("[8/8] Registering ZK_CANNON (type 255) in factory...");
  const registerTx = await factory.setImplementation(255, proxyImplAddr);
  const registerReceipt = await registerTx.wait();
  gasUsed.registerZKCannon = registerReceipt?.gasUsed ?? 0n;
  console.log(`  -> registered (${gasUsed.registerZKCannon} gas)`);

  // Summary
  const totalGas = Object.values(gasUsed).reduce((a, b) => a + b, 0n);

  console.log();
  console.log("==============================================================");
  console.log("  Deployment Summary");
  console.log("==============================================================");
  console.log(`  Groth16Verifier:      ${groth16Addr}`);
  console.log(`  ZKVerifier:           ${zkVerifierAddr}`);
  console.log(`  RollupManager:        ${rollupAddr}`);
  console.log(`  DisputeManager:       ${disputeAddr}`);
  console.log(`  ZKDisputeGameProxy:   ${proxyImplAddr}`);
  console.log(`  DisputeGameFactory:   ${factoryAddr}`);
  console.log(`  ------------------------------------------------------`);
  console.log(`  Total Gas Used:       ${totalGas}`);
  console.log(`  Cost:                 ${ethers.formatEther(totalGas * 30n)} ETH @ 30 Gwei`);
  console.log("==============================================================");

  // Save deployment
  const result: Phase7DeploymentResult = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    contracts: {
      Groth16Verifier: groth16Addr,
      ZKVerifier: zkVerifierAddr,
      RollupManager: rollupAddr,
      DisputeManager: disputeAddr,
      ZKDisputeGameProxy: proxyImplAddr,
      DisputeGameFactory: factoryAddr,
    },
    gasUsed: Object.fromEntries(
      Object.entries(gasUsed).map(([k, v]) => [k, v.toString()])
    ),
    timestamp: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${network.name}-phase7-${Date.now()}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(result, null, 2));
  console.log(`\n  Saved: ${deploymentFile}`);

  const latestFile = path.join(deploymentsDir, `${network.name}-phase7-latest.json`);
  fs.writeFileSync(latestFile, JSON.stringify(result, null, 2));
  console.log(`  Latest: ${latestFile}`);

  return result;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
