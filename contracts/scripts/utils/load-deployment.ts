/**
 * SI-RVP - Deployment Address Loader Utility
 *
 * Shared utility for loading typed deployment JSON files from
 * contracts/deployments/{network}-latest.json.
 *
 * Works from both:
 *   - contracts/scripts/ (Hardhat context, __dirname resolves here)
 *   - node/src/scripts/  (standalone, pass rootDir explicitly)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DeploymentContracts {
  Groth16Verifier: string;
  ZKVerifier: string;
  RollupManager: string;
  DisputeManager: string;
}

export interface DeploymentGasUsed {
  Groth16Verifier: string;
  ZKVerifier: string;
  RollupManager: string;
  DisputeManager: string;
  total: string;
}

export interface DeploymentResult {
  network: string;
  chainId: number;
  deployer: string;
  contracts: DeploymentContracts;
  gasUsed: DeploymentGasUsed;
  timestamp: string;
}

/**
 * Returns the absolute path to the deployment JSON file for the given network.
 *
 * @param network  - Network name, e.g. "localhost" or "mainnet"
 * @param rootDir  - Optional override for the monorepo root. When omitted,
 *                   resolves from __dirname (contracts/scripts/utils/ → contracts/).
 */
export function getDeploymentPath(network: string, rootDir?: string): string {
  const contractsDir = rootDir
    ? path.join(rootDir, 'contracts')
    : path.join(__dirname, '..', '..');

  return path.join(contractsDir, 'deployments', `${network}-latest.json`);
}

/**
 * Loads and returns the typed deployment result for the given network.
 *
 * @param network  - Network name, e.g. "localhost" or "mainnet"
 * @param rootDir  - Optional override for the monorepo root (see getDeploymentPath).
 * @throws Error if the deployment file does not exist or cannot be parsed.
 */
export function loadDeployment(network: string, rootDir?: string): DeploymentResult {
  const filePath = getDeploymentPath(network, rootDir);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Deployment file not found: ${filePath}\n` +
      `Run "npx hardhat run scripts/deploy.ts --network ${network}" first.`
    );
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as DeploymentResult;
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse deployment file at ${filePath}: ${(error as Error).message}`
    );
  }
}
