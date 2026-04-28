/**
 * SI-RVP - Phase 7 Etherscan Contract Verification Script
 *
 * Verifies the two new Phase 7 contracts on Etherscan:
 *   - ZKDisputeGameProxy (no constructor args)
 *   - DisputeGameFactory (no constructor args)
 *
 * Loads addresses from deployments/sepolia-phase7-latest.json.
 * One failure does not prevent the remaining contracts from being verified.
 */

import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface Phase7Contracts {
  ZKDisputeGameProxy: string;
  DisputeGameFactory: string;
  [key: string]: string;
}

interface Phase7Deployment {
  network: string;
  chainId: number;
  deployer: string;
  contracts: Phase7Contracts;
  timestamp: string;
}

type VerificationStatus = "verified" | "already_verified" | "failed";

interface VerificationResult {
  name: string;
  address: string;
  status: VerificationStatus;
  error?: string;
}

function loadPhase7Deployment(networkName: string): Phase7Deployment {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const latestFile = path.join(deploymentsDir, `${networkName}-phase7-latest.json`);

  if (!fs.existsSync(latestFile)) {
    throw new Error(
      `Phase 7 deployment file not found: ${latestFile}\n` +
        `Run the phase7 deploy script first.`
    );
  }

  const raw = fs.readFileSync(latestFile, "utf-8");
  return JSON.parse(raw) as Phase7Deployment;
}

function isAlreadyVerifiedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("already verified") ||
    message.toLowerCase().includes("already been verified")
  );
}

async function verifyContract(
  name: string,
  address: string,
  constructorArguments: unknown[]
): Promise<VerificationResult> {
  console.log(`\nVerifying ${name} at ${address}...`);

  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`  [OK] ${name} verified`);
    return { name, address, status: "verified" };
  } catch (error) {
    if (isAlreadyVerifiedError(error)) {
      console.log(`  [SKIP] ${name} already verified`);
      return { name, address, status: "already_verified" };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`  [FAIL] ${name}: ${message}`);
    return { name, address, status: "failed", error: message };
  }
}

function printSummary(results: VerificationResult[]): void {
  console.log("\n══════════════════════════════════════════════");
  console.log("  Phase 7 Verification Summary");
  console.log("══════════════════════════════════════════════");

  for (const result of results) {
    const icon =
      result.status === "verified"
        ? "OK          "
        : result.status === "already_verified"
        ? "SKIP        "
        : "FAIL        ";
    console.log(`  ${icon} ${result.name}`);
    if (result.error) {
      console.log(`            Error: ${result.error}`);
    }
  }

  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Record<VerificationStatus, number>
  );

  console.log("──────────────────────────────────────────────");
  console.log(
    `  Verified: ${counts.verified ?? 0}  |  ` +
      `Skipped: ${counts.already_verified ?? 0}  |  ` +
      `Failed: ${counts.failed ?? 0}`
  );
  console.log("══════════════════════════════════════════════\n");
}

async function main(): Promise<void> {
  console.log("══════════════════════════════════════════════");
  console.log("  SI-RVP - Phase 7 Etherscan Verification");
  console.log("══════════════════════════════════════════════");
  console.log(`  Network: ${network.name}`);

  const deployment = loadPhase7Deployment(network.name);
  const { contracts, deployer } = deployment;

  console.log(`  Deployer: ${deployer}`);
  console.log(`  Deployed at: ${deployment.timestamp}`);
  console.log(`  ZKDisputeGameProxy: ${contracts.ZKDisputeGameProxy}`);
  console.log(`  DisputeGameFactory:  ${contracts.DisputeGameFactory}`);

  const verifications: Array<{
    name: string;
    address: string;
    constructorArguments: unknown[];
  }> = [
    {
      name: "ZKDisputeGameProxy",
      address: contracts.ZKDisputeGameProxy,
      constructorArguments: [],
    },
    {
      name: "DisputeGameFactory",
      address: contracts.DisputeGameFactory,
      constructorArguments: [],
    },
  ];

  const results: VerificationResult[] = [];

  for (const v of verifications) {
    const result = await verifyContract(
      v.name,
      v.address,
      v.constructorArguments
    );
    results.push(result);
  }

  printSummary(results);

  const failedCount = results.filter((r) => r.status === "failed").length;
  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 7 contract(s) failed verification.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
