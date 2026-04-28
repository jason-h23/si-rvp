import { ethers, network } from 'hardhat';
import { loadDeployment } from './utils/load-deployment';

async function main() {
  const deployment = loadDeployment(network.name);

  const [, challenger] = await ethers.getSigners();

  const disputeManager = await ethers.getContractAt('DisputeManager', deployment.contracts.DisputeManager);

  const rollupAddr = await disputeManager.rollupManager();
  console.log('DisputeManager.rollupManager:', rollupAddr);
  console.log('Expected:', deployment.contracts.RollupManager);
  console.log('Match:', rollupAddr === deployment.contracts.RollupManager);

  const bondAmount = await disputeManager.BOND_AMOUNT();
  console.log('\nBond amount:', ethers.formatEther(bondAmount), 'ETH');

  // Try to initiate dispute
  const challengerStateRoot = '0x42e78ed13aeea7602e7c1783f9c8b858bd19fe5ccddfbfcbc40979bd6cfc8bb7';

  console.log('\nAttempting to initiate dispute...');
  console.log('Challenger:', challenger.address);
  console.log('Batch index: 1');
  console.log('Claimed state root:', challengerStateRoot);

  try {
    const tx = await disputeManager.connect(challenger).initiateDispute(1, challengerStateRoot, {
      value: bondAmount,
    });
    const receipt = await tx.wait();
    console.log('✅ Dispute initiated successfully!');
    console.log('Transaction:', receipt.hash);
  } catch (error: any) {
    console.error('❌ Dispute initiation failed:');
    console.error(error.message);

    // Try to get more details
    if (error.data) {
      console.error('Error data:', error.data);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
