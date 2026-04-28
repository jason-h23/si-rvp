import { ethers, network } from 'hardhat';
import { loadDeployment } from './utils/load-deployment';

const SEP = '══════════════════════════════════════';

type CheckResult = { label: string; passed: boolean; detail: string };

function ok(label: string, detail: string): CheckResult {
  return { label, passed: true, detail };
}

function fail(label: string, detail: string): CheckResult {
  return { label, passed: false, detail };
}

function printCheck(result: CheckResult): void {
  const tag = result.passed ? '[OK]  ' : '[FAIL]';
  console.log(`  ${tag} ${result.label}: ${result.detail}`);
}

async function verifyCode(
  provider: ethers.Provider,
  label: string,
  address: string,
): Promise<CheckResult> {
  try {
    const code = await provider.getCode(address);
    if (code === '0x') {
      return fail(label, `no contract code at ${address}`);
    }
    return ok(label, address);
  } catch (error) {
    return fail(label, `provider error — ${(error as Error).message}`);
  }
}

async function main() {
  console.log(SEP);
  console.log('  SI-RVP Live Network Test');
  console.log(`  Network: ${network.name}`);
  console.log(SEP);
  console.log();

  const deployment = loadDeployment(network.name);
  const provider = ethers.provider;
  const { contracts } = deployment;

  const results: CheckResult[] = [];

  // ── 1. Contract deployment checks ────────────────────────────────────────
  console.log('Contract Deployment:');

  const deploymentChecks = await Promise.all([
    verifyCode(provider, 'Groth16Verifier', contracts.Groth16Verifier),
    verifyCode(provider, 'ZKVerifier', contracts.ZKVerifier),
    verifyCode(provider, 'RollupManager', contracts.RollupManager),
    verifyCode(provider, 'DisputeManager', contracts.DisputeManager),
  ]);

  for (const result of deploymentChecks) {
    printCheck(result);
    results.push(result);
  }

  // Abort early if any contract is missing — state reads would revert
  if (deploymentChecks.some((r) => !r.passed)) {
    console.log();
    console.log('[WARN] One or more contracts missing — skipping state checks.');
    printSummary(results);
    return;
  }

  // ── 2. State verification ─────────────────────────────────────────────────
  console.log();
  console.log('State Verification:');

  try {
    const rollup = await ethers.getContractAt('RollupManager', contracts.RollupManager);
    const dispute = await ethers.getContractAt('DisputeManager', contracts.DisputeManager);
    const zkVerifier = await ethers.getContractAt('ZKVerifier', contracts.ZKVerifier);

    // RollupManager state
    const sequencer: string = await rollup.sequencer();
    results.push(ok('RollupManager.sequencer', sequencer));
    printCheck(results[results.length - 1]);

    const latestBatchIndex: bigint = await rollup.latestBatchIndex();
    results.push(ok('RollupManager.latestBatchIndex', latestBatchIndex.toString()));
    printCheck(results[results.length - 1]);

    const challengePeriod: bigint = await rollup.CHALLENGE_PERIOD();
    results.push(ok('RollupManager.CHALLENGE_PERIOD', `${challengePeriod.toString()}s`));
    printCheck(results[results.length - 1]);

    const rollupDisputeManager: string = await rollup.disputeManager();
    const dmLinkOk =
      rollupDisputeManager.toLowerCase() === contracts.DisputeManager.toLowerCase();
    const dmCheck = dmLinkOk
      ? ok('RollupManager.disputeManager', rollupDisputeManager)
      : fail(
          'RollupManager.disputeManager',
          `${rollupDisputeManager} != expected ${contracts.DisputeManager}`,
        );
    results.push(dmCheck);
    printCheck(dmCheck);

    // DisputeManager state
    const dmRollupManager: string = await dispute.rollupManager();
    const rmLinkOk =
      dmRollupManager.toLowerCase() === contracts.RollupManager.toLowerCase();
    const rmCheck = rmLinkOk
      ? ok('DisputeManager.rollupManager', dmRollupManager)
      : fail(
          'DisputeManager.rollupManager',
          `${dmRollupManager} != expected ${contracts.RollupManager}`,
        );
    results.push(rmCheck);
    printCheck(rmCheck);

    const dmZkVerifier: string = await dispute.zkVerifier();
    const zkLinkOk = dmZkVerifier.toLowerCase() === contracts.ZKVerifier.toLowerCase();
    const zkCheck = zkLinkOk
      ? ok('DisputeManager.zkVerifier', dmZkVerifier)
      : fail(
          'DisputeManager.zkVerifier',
          `${dmZkVerifier} != expected ${contracts.ZKVerifier}`,
        );
    results.push(zkCheck);
    printCheck(zkCheck);

    const bondAmount: bigint = await dispute.BOND_AMOUNT();
    results.push(ok('DisputeManager.BOND_AMOUNT', `${ethers.formatEther(bondAmount)} ETH`));
    printCheck(results[results.length - 1]);

    const nextDisputeId: bigint = await dispute.nextDisputeId();
    results.push(ok('DisputeManager.nextDisputeId', nextDisputeId.toString()));
    printCheck(results[results.length - 1]);

    // ZKVerifier state
    const expectedInputs: bigint = await zkVerifier.EXPECTED_PUBLIC_INPUTS();
    results.push(ok('ZKVerifier.EXPECTED_PUBLIC_INPUTS', expectedInputs.toString()));
    printCheck(results[results.length - 1]);
  } catch (error) {
    const errResult = fail('State read', (error as Error).message);
    results.push(errResult);
    printCheck(errResult);
  }

  printSummary(results);
}

function printSummary(results: CheckResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  console.log();
  console.log(`Summary: ${passed}/${results.length} checks passed`);
  console.log(SEP);
}

main().catch((error) => {
  console.error('[FAIL] Unhandled error:', (error as Error).message);
  process.exit(1);
});
