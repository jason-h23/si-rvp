import { ethers, network } from 'hardhat';
import { loadDeployment } from './utils/load-deployment';

async function main() {
  const deployment = loadDeployment(network.name);

  const rollup = await ethers.getContractAt('RollupManager', deployment.contracts.RollupManager);

  const latest = await rollup.latestBatchIndex();
  console.log('Latest batch index:', latest.toString());

  const sequencer = await rollup.sequencer();
  console.log('Sequencer:', sequencer);

  if (latest >= 1n) {
    const batch = await rollup.getBatch(1);
    console.log('\nBatch 1:');
    console.log('  State root:', batch.stateRoot);
    console.log('  Proposer:', batch.proposer);
    console.log('  Status:', batch.status, '(0=Pending, 1=Finalized, 2=Disputed, 3=Rejected)');
    console.log('  Timestamp:', batch.timestamp.toString());
  }

  const disputeManager = await rollup.disputeManager();
  console.log('\nDispute Manager:', disputeManager);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
