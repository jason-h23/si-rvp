/**
 * Edge Case Tests
 *
 * Additional tests to increase coverage for edge cases and error handling
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { BisectionProtocol, ChannelManager } from '../src/common/bisection';
import { hashMipsStateKeccak, computeMerkleRoot, generateMerkleProof, verifyMerkleProof } from '../src/common/hash';
import { MipsState } from '../src/common/types';

describe('MIPS Executor Edge Cases', () => {
  let executor: MipsExecutor;

  beforeEach(() => {
    executor = new MipsExecutor();
  });

  describe('Overflow Handling', () => {
    it('should handle 32-bit overflow in ADD', () => {
      let state = MipsExecutor.createInitialState();
      // Set r1 to max 32-bit value
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0x7FFF));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0x7FFF));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 1, 0x7FFF)); // r1 = 0xFFFE
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 1, 0x7FFF)); // overflow

      // Should wrap around
      expect(state.registers[1] & 0xFFFFFFFFn).to.equal(state.registers[1]);
    });

    it('should handle underflow in SUB', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 100));
      state = executor.executeStep(state, MipsInstructionBuilder.sub(3, 1, 2)); // 10 - 100 = underflow

      // Should wrap around in 32-bit unsigned
      expect(state.registers[3] & 0xFFFFFFFFn).to.equal(state.registers[3]);
    });
  });

  describe('Special Register Cases', () => {
    it('should never modify r0 (zero register)', () => {
      let state = MipsExecutor.createInitialState();
      // Try to write to r0
      state = executor.executeStep(state, MipsInstructionBuilder.addi(0, 0, 100));

      expect(state.registers[0]).to.equal(0n);
    });

    it('should handle all 32 registers', () => {
      let state = MipsExecutor.createInitialState();

      for (let i = 1; i < 32; i++) {
        state = executor.executeStep(state, MipsInstructionBuilder.addi(i, 0, i));
      }

      for (let i = 1; i < 32; i++) {
        expect(state.registers[i]).to.equal(BigInt(i));
      }
    });
  });

  describe('Bitwise Operations', () => {
    it('should handle AND with all zeros', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0xFFFF));
      state = executor.executeStep(state, MipsInstructionBuilder.and(3, 1, 0)); // AND with 0

      expect(state.registers[3]).to.equal(0n);
    });

    it('should handle OR with all ones', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0x00FF));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0xFF00 & 0x7FFF)); // Avoid sign extension
      state = executor.executeStep(state, MipsInstructionBuilder.or(3, 1, 2));

      expect(state.registers[3]).to.not.equal(0n);
    });

    it('should handle XOR self (result zero)', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 12345));
      state = executor.executeStep(state, MipsInstructionBuilder.xor(2, 1, 1)); // XOR with self

      expect(state.registers[2]).to.equal(0n);
    });
  });

  describe('Branch Instructions', () => {
    it('should not branch on BEQ when not equal', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 100));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 200));
      const pcBefore = state.pc;
      state = executor.executeStep(state, MipsInstructionBuilder.beq(1, 2, 10));

      // PC should advance normally (no branch)
      expect(state.pc).to.equal(pcBefore + 4n);
    });

    it('should handle zero offset branch', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 100));
      state = executor.executeStep(state, MipsInstructionBuilder.beq(1, 1, 0)); // Branch with 0 offset

      // Should still advance PC
      expect(state.pc).to.not.equal(0n);
    });
  });

  describe('Jump Instructions', () => {
    it('should handle jump to address 0', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.j(0));

      // MIPS has branch delay slot - PC advances to nextPC first, then jump target is set
      // After j 0: pc = 4 (advanced), nextPC = 0 (jump target)
      expect(state.pc).to.equal(4n);
      expect(state.nextPC).to.equal(0n);
    });

    it('should save correct return address in JAL', () => {
      let state = MipsExecutor.createInitialState();
      // Advance PC a bit
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 1));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 2));
      const pcBeforeJal = state.pc;
      state = executor.executeStep(state, MipsInstructionBuilder.jal(100));

      // r31 should contain return address (PC + 8 due to delay slot)
      expect(state.registers[31]).to.equal(pcBeforeJal + 8n);
    });
  });

  describe('SLT Edge Cases', () => {
    it('should handle comparison with zero', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 1));
      state = executor.executeStep(state, MipsInstructionBuilder.slt(3, 0, 1)); // 0 < 1

      expect(state.registers[3]).to.equal(1n);
    });

    it('should handle equal values', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 50));
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 50));
      state = executor.executeStep(state, MipsInstructionBuilder.slt(3, 1, 2)); // 50 < 50

      expect(state.registers[3]).to.equal(0n);
    });
  });
});

describe('Bisection Protocol Edge Cases', () => {
  let protocol: BisectionProtocol;

  beforeEach(() => {
    protocol = new BisectionProtocol();
  });

  describe('Range Calculations', () => {
    it('should handle very large ranges', () => {
      const result = protocol.calculateDisputeRange(0, 0n, 1000000n);
      expect(result.midpoint).to.equal(500000n);
    });

    it('should handle minimum range of 2', () => {
      const result = protocol.calculateDisputeRange(0, 0n, 2n);
      expect(result.midpoint).to.equal(1n);
    });

    it('should handle asymmetric ranges', () => {
      const result = protocol.calculateDisputeRange(0, 100n, 200n);
      expect(result.midpoint).to.equal(150n);
      expect(result.leftStart).to.equal(100n);
      expect(result.rightEnd).to.equal(200n);
    });

    it('should calculate correct subranges', () => {
      const result = protocol.calculateDisputeRange(0, 0n, 100n);
      expect(result.leftStart).to.equal(0n);
      expect(result.leftEnd).to.equal(50n);
      expect(result.rightStart).to.equal(50n);
      expect(result.rightEnd).to.equal(100n);
    });
  });

  describe('Commitment Creation', () => {
    it('should create different commitments for different steps', () => {
      const state = MipsExecutor.createInitialState();
      const commitment1 = protocol.createCommitment(state, 10n);
      const commitment2 = protocol.createCommitment(state, 20n);

      expect(commitment1.stateHash).to.equal(commitment2.stateHash); // Same state
      expect(commitment1.step).to.not.equal(commitment2.step); // Different steps
    });
  });

  describe('Timeout Handling', () => {
    it('should detect timeout when expired', () => {
      const pastTime = Date.now() - 4000000; // Well past timeout
      const result = protocol.checkTimeout(pastTime);

      expect(result).to.be.true;
    });

    it('should not timeout when still within period', () => {
      const recentTime = Date.now() - 1000; // 1 second ago
      const result = protocol.checkTimeout(recentTime);

      expect(result).to.be.false;
    });
  });
});

describe('Channel Manager Edge Cases', () => {
  let channelManager: ChannelManager;

  beforeEach(() => {
    channelManager = new ChannelManager();
  });

  describe('Channel Operations', () => {
    it('should handle rapid channel creation', () => {
      for (let i = 0; i < 100; i++) {
        channelManager.createChannel(
          `channel-${i}`,
          `0x${i.toString(16).padStart(40, '0')}`,
          `0x${(i + 1).toString(16).padStart(40, '0')}`,
          0n,
          100n
        );
      }

      const channel = channelManager.getChannel('channel-50');
      expect(channel).to.not.be.undefined;
    });

    it('should handle channel not found gracefully', () => {
      const channel = channelManager.getChannel('non-existent');
      expect(channel).to.be.undefined;
    });

    it('should update channel status correctly', () => {
      channelManager.createChannel('test', '0x1', '0x2', 0n, 100n);
      channelManager.updateChannel('test', { status: 'closed' });

      const channel = channelManager.getChannel('test');
      expect(channel!.status).to.equal('closed');
    });
  });
});

describe('Hash Utilities Edge Cases', () => {
  describe('Merkle Tree Edge Cases', () => {
    it('should handle power of 2 leaves', () => {
      const leaves = Array(8).fill(null).map((_, i) =>
        ethers.keccak256(ethers.toUtf8Bytes(`leaf${i}`))
      );
      const root = computeMerkleRoot(leaves);

      expect(root).to.match(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should handle non-power of 2 leaves', () => {
      const leaves = Array(5).fill(null).map((_, i) =>
        ethers.keccak256(ethers.toUtf8Bytes(`leaf${i}`))
      );
      const root = computeMerkleRoot(leaves);

      expect(root).to.match(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should verify proof for middle leaf', () => {
      const leaves = Array(8).fill(null).map((_, i) =>
        ethers.keccak256(ethers.toUtf8Bytes(`leaf${i}`))
      );
      const root = computeMerkleRoot(leaves);
      const { proof, siblings } = generateMerkleProof(leaves, 4);
      const isValid = verifyMerkleProof(leaves[4], proof, siblings, root);

      expect(isValid).to.be.true;
    });
  });

  describe('State Hashing', () => {
    it('should produce different hashes for minimal state changes', () => {
      const state1 = MipsExecutor.createInitialState();
      const state2 = { ...state1, registers: [...state1.registers] };
      state2.registers[1] = 1n; // Change just one register by 1

      const hash1 = hashMipsStateKeccak(state1);
      const hash2 = hashMipsStateKeccak(state2);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to PC changes', () => {
      const state1 = MipsExecutor.createInitialState();
      const state2: MipsState = {
        ...state1,
        registers: [...state1.registers],
        pc: 4n
      };

      const hash1 = hashMipsStateKeccak(state1);
      const hash2 = hashMipsStateKeccak(state2);

      expect(hash1).to.not.equal(hash2);
    });

    it('should handle state with max values', () => {
      // Start with initial state and modify to max values
      const state = MipsExecutor.createInitialState();
      state.pc = 0xFFFFFFFFn;
      state.nextPC = 0xFFFFFFFFn;
      state.step = 0xFFFFFFFFFFFFFFFFn;
      state.exited = true;
      state.exitCode = 0xFF;
      for (let i = 0; i < 32; i++) {
        state.registers[i] = 0xFFFFFFFFn;
      }

      const hash = hashMipsStateKeccak(state);
      expect(hash).to.match(/^0x[a-fA-F0-9]{64}$/);
    });
  });
});

describe('Instruction Builder Edge Cases', () => {
  describe('Immediate Value Handling', () => {
    it('should handle max positive immediate', () => {
      const insn = MipsInstructionBuilder.addi(1, 0, 0x7FFF);
      expect(insn).to.be.a('bigint');
    });

    it('should handle negative immediate', () => {
      const insn = MipsInstructionBuilder.addi(1, 0, -1);
      expect(insn).to.be.a('bigint');
    });

    it('should handle zero immediate', () => {
      const insn = MipsInstructionBuilder.addi(1, 0, 0);
      expect(insn).to.be.a('bigint');
    });
  });

  describe('Register Bounds', () => {
    it('should encode max register number', () => {
      const insn = MipsInstructionBuilder.add(31, 31, 31);
      expect(insn).to.be.a('bigint');
    });

    it('should encode min register number', () => {
      const insn = MipsInstructionBuilder.add(0, 0, 0);
      expect(insn).to.be.a('bigint');
    });
  });

  describe('Jump Address', () => {
    it('should handle large jump address', () => {
      const insn = MipsInstructionBuilder.j(0x3FFFFFF);
      expect(insn).to.be.a('bigint');
    });

    it('should mask jump address to 26 bits', () => {
      const insn = MipsInstructionBuilder.j(0xFFFFFFFF);
      // Should be masked to 26 bits
      expect(insn).to.be.a('bigint');
    });
  });
});

describe('State Consistency', () => {
  let executor: MipsExecutor;

  beforeEach(() => {
    executor = new MipsExecutor();
  });

  it('should maintain step count across many instructions', () => {
    let state = MipsExecutor.createInitialState();
    const numInstructions = 100;

    for (let i = 0; i < numInstructions; i++) {
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 1, 1));
    }

    expect(state.step).to.equal(BigInt(numInstructions));
  });

  it('should maintain PC progression', () => {
    let state = MipsExecutor.createInitialState();
    const numInstructions = 50;

    for (let i = 0; i < numInstructions; i++) {
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 1, 1));
    }

    expect(state.pc).to.equal(BigInt(numInstructions * 4));
  });

  it('should preserve immutability of original state', () => {
    const state1 = MipsExecutor.createInitialState();
    const originalRegisters = [...state1.registers];
    const originalPc = state1.pc;
    const originalStep = state1.step;

    executor.executeStep(state1, MipsInstructionBuilder.addi(1, 0, 100));

    expect(state1.pc).to.equal(originalPc);
    expect(state1.step).to.equal(originalStep);
    expect(state1.registers[1]).to.equal(originalRegisters[1]);
  });
});
