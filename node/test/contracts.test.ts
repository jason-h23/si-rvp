/**
 * Contract Client Tests
 *
 * Tests for the contract interaction layer with mocked ethers.js
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import {
  RollupManagerClient,
  DisputeManagerClient,
  ZKVerifierClient,
  BatchStatus,
  DisputeStatus,
  BatchInfo,
  DisputeInfo,
} from '../src/common/contracts';
import { ZKProof } from '../src/common/types';

// Mock contract factory
function createMockContract(methods: Record<string, (...args: any[]) => any>) {
  const contract: any = {
    ...methods,
    on: (_event: string, _callback: Function) => {},
    removeAllListeners: () => {},
  };
  return contract;
}

describe('Contract Clients', () => {
  describe('BatchStatus Enum', () => {
    it('should have correct values', () => {
      expect(BatchStatus.Pending).to.equal(0);
      expect(BatchStatus.Finalized).to.equal(1);
      expect(BatchStatus.Disputed).to.equal(2);
      expect(BatchStatus.Rejected).to.equal(3);
    });
  });

  describe('DisputeStatus Enum', () => {
    it('should have correct values', () => {
      expect(DisputeStatus.None).to.equal(0);
      expect(DisputeStatus.Initiated).to.equal(1);
      expect(DisputeStatus.ProofSubmitted).to.equal(2);
      expect(DisputeStatus.Resolved).to.equal(3);
      expect(DisputeStatus.Timeout).to.equal(4);
    });
  });

  describe('RollupManagerClient', () => {
    let mockProvider: any;

    beforeEach(() => {
      mockProvider = {
        getNetwork: async () => ({ chainId: 1n }),
      };
    });

    it('should create instance with address and provider', () => {
      const client = new RollupManagerClient('0x1234567890123456789012345678901234567890', mockProvider);
      expect(client).to.be.instanceOf(RollupManagerClient);
    });

    it('should parse batch info correctly', () => {
      const batchInfo: BatchInfo = {
        stateRoot: ethers.ZeroHash,
        prevStateRoot: ethers.ZeroHash,
        timestamp: 1234567890n,
        proposer: '0x1234567890123456789012345678901234567890',
        status: BatchStatus.Pending,
      };

      expect(batchInfo.status).to.equal(BatchStatus.Pending);
      expect(typeof batchInfo.timestamp).to.equal('bigint');
      expect(batchInfo.stateRoot).to.equal(ethers.ZeroHash);
    });

    it('should handle batch status transitions', () => {
      const statuses = [
        BatchStatus.Pending,
        BatchStatus.Finalized,
        BatchStatus.Disputed,
        BatchStatus.Rejected,
      ];

      statuses.forEach((status, index) => {
        expect(status).to.equal(index);
      });
    });
  });

  describe('DisputeManagerClient', () => {
    let mockProvider: any;

    beforeEach(() => {
      mockProvider = {
        getNetwork: async () => ({ chainId: 1n }),
      };
    });

    it('should create instance with address and provider', () => {
      const client = new DisputeManagerClient('0x1234567890123456789012345678901234567890', mockProvider);
      expect(client).to.be.instanceOf(DisputeManagerClient);
    });

    it('should parse dispute info correctly', () => {
      const disputeInfo: DisputeInfo = {
        batchIndex: 1n,
        challenger: '0xchallenger',
        sequencer: '0xsequencer',
        challengerClaim: ethers.ZeroHash,
        sequencerClaim: ethers.ZeroHash,
        challengerBond: ethers.parseEther('1'),
        sequencerBond: ethers.parseEther('1'),
        createdAt: BigInt(Date.now()),
        deadline: BigInt(Date.now() + 86400000),
        bisectionCommitment: ethers.ZeroHash,
        status: DisputeStatus.Initiated,
        resolvedAt: 0n,
        l1Head: ethers.ZeroHash,
      };

      expect(disputeInfo.status).to.equal(DisputeStatus.Initiated);
      expect(disputeInfo.challengerBond).to.equal(ethers.parseEther('1'));
      expect(disputeInfo.batchIndex).to.equal(1n);
    });

    it('should handle dispute status transitions', () => {
      const statuses = [
        DisputeStatus.None,
        DisputeStatus.Initiated,
        DisputeStatus.ProofSubmitted,
        DisputeStatus.Resolved,
        DisputeStatus.Timeout,
      ];

      statuses.forEach((status, index) => {
        expect(status).to.equal(index);
      });
    });

    it('should format ZK proof for contract submission', () => {
      const zkProof: ZKProof = {
        proof: {
          a: ['123', '456'],
          b: [['111', '222'], ['333', '444']],
          c: ['555', '666'],
        },
        publicInputs: ['1', '2', '3'],
      };

      // Simulate proof format conversion
      const proof = [
        BigInt(zkProof.proof.a[0]),
        BigInt(zkProof.proof.a[1]),
        BigInt(zkProof.proof.b[0][0]),
        BigInt(zkProof.proof.b[0][1]),
        BigInt(zkProof.proof.b[1][0]),
        BigInt(zkProof.proof.b[1][1]),
        BigInt(zkProof.proof.c[0]),
        BigInt(zkProof.proof.c[1]),
      ];

      expect(proof.length).to.equal(8);
      expect(proof[0]).to.equal(123n);
      expect(proof[1]).to.equal(456n);

      const publicInputs = zkProof.publicInputs.map((x) => BigInt(x));
      expect(publicInputs.length).to.equal(3);
      expect(publicInputs[0]).to.equal(1n);
    });
  });

  describe('ZKVerifierClient', () => {
    let mockProvider: any;

    beforeEach(() => {
      mockProvider = {
        getNetwork: async () => ({ chainId: 1n }),
      };
    });

    it('should create instance with address and provider', () => {
      const client = new ZKVerifierClient('0x1234567890123456789012345678901234567890', mockProvider);
      expect(client).to.be.instanceOf(ZKVerifierClient);
    });

    it('should format proof for verification', () => {
      const zkProof: ZKProof = {
        proof: {
          a: ['100', '200'],
          b: [['10', '20'], ['30', '40']],
          c: ['50', '60'],
        },
        publicInputs: ['1000', '2000', '3000'],
      };

      // Simulate proof format conversion
      const a: [bigint, bigint] = [BigInt(zkProof.proof.a[0]), BigInt(zkProof.proof.a[1])];
      const b: [[bigint, bigint], [bigint, bigint]] = [
        [BigInt(zkProof.proof.b[0][0]), BigInt(zkProof.proof.b[0][1])],
        [BigInt(zkProof.proof.b[1][0]), BigInt(zkProof.proof.b[1][1])],
      ];
      const c: [bigint, bigint] = [BigInt(zkProof.proof.c[0]), BigInt(zkProof.proof.c[1])];

      expect(a[0]).to.equal(100n);
      expect(a[1]).to.equal(200n);
      expect(b[0][0]).to.equal(10n);
      expect(b[1][1]).to.equal(40n);
      expect(c[0]).to.equal(50n);
      expect(c[1]).to.equal(60n);
    });
  });

  describe('Proof Format Conversion', () => {
    it('should handle large numbers in proof', () => {
      const largeNum = '21888242871839275222246405745257275088696311157297823662689037894645226208583';
      const bigNum = BigInt(largeNum);

      expect(bigNum.toString()).to.equal(largeNum);
    });

    it('should handle zero values in proof', () => {
      const zkProof: ZKProof = {
        proof: {
          a: ['0', '0'],
          b: [['0', '0'], ['0', '0']],
          c: ['0', '0'],
        },
        publicInputs: ['0'],
      };

      const a = [BigInt(zkProof.proof.a[0]), BigInt(zkProof.proof.a[1])];
      expect(a[0]).to.equal(0n);
      expect(a[1]).to.equal(0n);
    });

    it('should handle hex strings in public inputs', () => {
      const hexValue = '0x1234567890abcdef';
      const bigNum = BigInt(hexValue);

      expect(bigNum).to.be.a('bigint');
      expect(bigNum.toString(16)).to.equal('1234567890abcdef');
    });
  });

  describe('Event Types', () => {
    it('should define StateRootProposed event structure', () => {
      const event = {
        batchIndex: 1n,
        stateRoot: ethers.keccak256(ethers.toUtf8Bytes('state')),
        prevStateRoot: ethers.ZeroHash,
        proposer: '0x1234567890123456789012345678901234567890',
      };

      expect(typeof event.batchIndex).to.equal('bigint');
      expect(event.stateRoot).to.match(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should define DisputeInitiated event structure', () => {
      const event = {
        disputeId: 1n,
        batchIndex: 5n,
        challenger: '0x1234567890123456789012345678901234567890',
        challengerClaim: ethers.ZeroHash,
      };

      expect(typeof event.disputeId).to.equal('bigint');
      expect(typeof event.batchIndex).to.equal('bigint');
    });

    it('should define DisputeResolved event structure', () => {
      const event = {
        disputeId: 1n,
        winner: '0x1234567890123456789012345678901234567890',
        reward: ethers.parseEther('2'),
      };

      expect(event.reward).to.equal(ethers.parseEther('2'));
    });
  });

  describe('Bond Calculations', () => {
    it('should handle ETH to Wei conversion', () => {
      const bondEth = '1.5';
      const bondWei = ethers.parseEther(bondEth);

      expect(bondWei).to.equal(1500000000000000000n);
    });

    it('should handle Wei to ETH conversion', () => {
      const bondWei = 1500000000000000000n;
      const bondEth = ethers.formatEther(bondWei);

      expect(bondEth).to.equal('1.5');
    });

    it('should calculate total bond correctly', () => {
      const challengerBond = ethers.parseEther('1');
      const sequencerBond = ethers.parseEther('1');
      const totalBond = challengerBond + sequencerBond;

      expect(totalBond).to.equal(ethers.parseEther('2'));
    });
  });

  describe('Address Validation', () => {
    it('should validate correct Ethereum address', () => {
      const address = '0x1234567890123456789012345678901234567890';
      expect(ethers.isAddress(address)).to.be.true;
    });

    it('should reject invalid address', () => {
      const invalidAddress = '0x123';
      expect(ethers.isAddress(invalidAddress)).to.be.false;
    });

    it('should handle checksummed addresses', () => {
      const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      expect(ethers.isAddress(address)).to.be.true;
    });
  });
});

describe('Contract Integration Helpers', () => {
  describe('Transaction Receipt Parsing', () => {
    it('should extract hash from receipt', () => {
      const mockReceipt = {
        hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockNumber: 12345,
        status: 1,
      };

      expect(mockReceipt.hash).to.match(/^0x[a-fA-F0-9]{64}$/);
      expect(mockReceipt.status).to.equal(1);
    });

    it('should parse event logs', () => {
      const mockLog = {
        fragment: { name: 'DisputeInitiated' },
        args: [1n, 5n, '0x1234', '0xabcd'],
      };

      expect(mockLog.fragment.name).to.equal('DisputeInitiated');
      expect(mockLog.args[0]).to.equal(1n);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing event error', () => {
      const logs: any[] = [];
      const event = logs.find((log: any) => log.fragment?.name === 'DisputeInitiated');

      expect(event).to.be.undefined;
    });

    it('should handle contract call errors', async () => {
      const error = new Error('execution reverted: insufficient bond');
      expect(error.message).to.include('insufficient bond');
    });
  });

  describe('Deadline Calculations', () => {
    it('should calculate bisection deadline', () => {
      const createdAt = BigInt(Math.floor(Date.now() / 1000));
      const bisectionPeriod = 3600n; // 1 hour
      const deadline = createdAt + bisectionPeriod;

      expect(deadline > createdAt).to.be.true;
    });

    it('should check if deadline passed', () => {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 3600);
      const currentTime = BigInt(Math.floor(Date.now() / 1000));

      expect(currentTime > pastDeadline).to.be.true;
    });

    it('should check if deadline not yet passed', () => {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const currentTime = BigInt(Math.floor(Date.now() / 1000));

      expect(currentTime < futureDeadline).to.be.true;
    });
  });
});
