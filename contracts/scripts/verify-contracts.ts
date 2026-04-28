/**
 * SI-RVP - Etherscan Contract Verification Script
 *
 * Loads the latest deployment for the current network and verifies
 * each contract on Etherscan independently. One failure does not
 * prevent the remaining contracts from being verified.
 */

import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentContracts {
  Groth16Verifier: string;
  ZKVerifier: string;
  RollupManager: string;
  DisputeManager: string;
}

interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  contracts: DeploymentContracts;
  timestamp: string;
}

type VerificationStatus = "verified" | "already_verified" | "failed";

interface VerificationResult {
  name: string;
  address: string;
  status: VerificationStatus;
  error?: string;
}

function loadDeployment(networkName: string): Deployment {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const latestFile = path.join(deploymentsDir, `${networkName}-latest.json`);

  if (!fs.existsSync(latestFile)) {
    throw new Error(
      `Deployment file not found: ${latestFile}\n` +
        `Run 'npm run deploy:${networkName}' first.`
    );
  }

  const raw = fs.readFileSync(latestFile, "utf-8");
  return JSON.parse(raw) as Deployment;
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
  console.log("  Verification Summary");
  console.log("══════════════════════════════════════════════");

  for (const result of results) {
    const icon =
      result.status === "verified"
        ? "OK          "
        : result.status === "already_verified"
        ? "SKIP        "
        : "FAIL        ";
    console.log(`  ${icon} ${result.name}`);
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
  console.log("  SI-RVP - Etherscan Contract Verification");
  console.log("══════════════════════════════════════════════");
  console.log(`  Network: ${network.name}`);

  const deployment = loadDeployment(network.name);
  const { contracts, deployer } = deployment;

  console.log(`  Deployer: ${deployer}`);
  console.log(`  Deployed at: ${deployment.timestamp}`);

  const verifications: Array<{
    name: string;
    address: string;
    constructorArguments: unknown[];
  }> = [
    {
      name: "Groth16Verifier",
      address: contracts.Groth16Verifier,
      constructorArguments: [],
    },
    {
      name: "ZKVerifier",
      address: contracts.ZKVerifier,
      constructorArguments: [],
    },
    {
      name: "RollupManager",
      address: contracts.RollupManager,
      constructorArguments: [deployer],
    },
    {
      name: "DisputeManager",
      address: contracts.DisputeManager,
      constructorArguments: [contracts.ZKVerifier, contracts.RollupManager],
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
    throw new Error(`${failedCount} contract(s) failed verification.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
