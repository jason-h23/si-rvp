/**
 * MIPS Executor Unit Tests
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { MipsState } from '../src/common/types';

describe('MIPS Executor', () => {
  let executor: MipsExecutor;

  beforeEach(() => {
    executor = new MipsExecutor();
  });

  // ============================================
  // Initial State Tests
  // ============================================
  describe('createInitialState', () => {
    it('should create state with zero PC', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.pc).to.equal(0n);
    });

    it('should create state with nextPC = 4', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.nextPC).to.equal(4n);
    });

    it('should create state with 32 zero registers', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.registers).to.have.lengthOf(32);
      expect(state.registers.every(r => r === 0n)).to.be.true;
    });

    it('should create state with zero step', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.step).to.equal(0n);
    });

    it('should create state with zero memoryRoot', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.memoryRoot).to.equal(ethers.ZeroHash);
    });

    it('should create state with exited = false', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.exited).to.be.false;
    });

    it('should create state with exitCode = 0', () => {
      const state = MipsExecutor.createInitialState();
      expect(state.exitCode).to.equal(0);
    });
  });

  // ============================================
  // executeStep Basic Tests
  // ============================================
  describe('executeStep', () => {
    it('should increment step counter', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0));

      expect(state.step).to.equal(1n);
    });

    it('should update PC correctly', () => {
      let state = MipsExecutor.createInitialState();
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0));

      expect(state.pc).to.equal(4n);
      expect(state.nextPC).to.equal(8n);
    });

    it('should maintain immutability', () => {
      const state1 = MipsExecutor.createInitialState();
      const state2 = executor.executeStep(state1, MipsInstructionBuilder.addi(1, 0, 100));

      expect(state1.registers[1]).to.equal(0n);
      expect(state2.registers[1]).to.equal(100n);
    });

    it('should not modify register 0', () => {
      let state = MipsExecutor.createInitialState();
      // Try to write to r0
      state = executor.executeStep(state, MipsInstructionBuilder.addi(0, 0, 100));

      expect(state.registers[0]).to.equal(0n);
    });
  });

  // ============================================
  // R-Type Instructions
  // ============================================
  describe('R-Type Instructions', () => {
    describe('ADD', () => {
      it('should add two registers', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 100));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 50));
        state = executor.executeStep(state, MipsInstructionBuilder.add(3, 1, 2));

        expect(state.registers[3]).to.equal(150n);
      });

      it('should handle large numbers', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0x7fff));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0x7fff));
        state = executor.executeStep(state, MipsInstructionBuilder.add(3, 1, 2));

        expect(state.registers[3]).to.equal(BigInt(0xfffe));
      });

      it('should mask to 32 bits', () => {
        let state = MipsExecutor.createInitialState();
        state.registers = [...state.registers];
        state.registers[1] = 0xFFFFFFFFn;
        state.registers[2] = 1n;
        state = executor.executeStep(state, MipsInstructionBuilder.add(3, 1, 2));

        expect(state.registers[3]).to.equal(0n); // Overflow wraps
      });
    });

    describe('SUB', () => {
      it('should subtract two registers', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 100));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 30));
        state = executor.executeStep(state, MipsInstructionBuilder.sub(3, 1, 2));

        expect(state.registers[3]).to.equal(70n);
      });

      it('should handle underflow (wrap around)', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 20));
        state = executor.executeStep(state, MipsInstructionBuilder.sub(3, 1, 2));

        // Result should be 2^32 - 10 = 0xFFFFFFF6
        expect(state.registers[3]).to.equal(0xFFFFFFF6n);
      });
    });

    describe('AND', () => {
      it('should AND two registers', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0b1111));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0b1010));
        state = executor.executeStep(state, MipsInstructionBuilder.and(3, 1, 2));

        expect(state.registers[3]).to.equal(BigInt(0b1010));
      });

      it('should return 0 for non-overlapping bits', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0b1100));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0b0011));
        state = executor.executeStep(state, MipsInstructionBuilder.and(3, 1, 2));

        expect(state.registers[3]).to.equal(0n);
      });
    });

    describe('OR', () => {
      it('should OR two registers', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0b1100));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0b0011));
        state = executor.executeStep(state, MipsInstructionBuilder.or(3, 1, 2));

        expect(state.registers[3]).to.equal(BigInt(0b1111));
      });
    });

    describe('XOR', () => {
      it('should XOR two registers', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 0b1111));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 0b1010));
        state = executor.executeStep(state, MipsInstructionBuilder.xor(3, 1, 2));

        expect(state.registers[3]).to.equal(BigInt(0b0101));
      });

      it('should return 0 for same values', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 123));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 123));
        state = executor.executeStep(state, MipsInstructionBuilder.xor(3, 1, 2));

        expect(state.registers[3]).to.equal(0n);
      });
    });

    describe('SLT (Set Less Than)', () => {
      it('should set 1 when rs < rt', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 20));
        state = executor.executeStep(state, MipsInstructionBuilder.slt(3, 1, 2));

        expect(state.registers[3]).to.equal(1n);
      });

      it('should set 0 when rs >= rt', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 20));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 10));
        state = executor.executeStep(state, MipsInstructionBuilder.slt(3, 1, 2));

        expect(state.registers[3]).to.equal(0n);
      });

      it('should set 0 when equal', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 50));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 50));
        state = executor.executeStep(state, MipsInstructionBuilder.slt(3, 1, 2));

        expect(state.registers[3]).to.equal(0n);
      });
    });
  });

  // ============================================
  // I-Type Instructions
  // ============================================
  describe('I-Type Instructions', () => {
    describe('ADDI', () => {
      it('should add immediate value', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 42));

        expect(state.registers[1]).to.equal(42n);
      });

      it('should sign-extend negative immediate', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 100));
        // Add -10 (0xFFF6 in 16-bit)
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 1, -10 & 0xFFFF));

        expect(state.registers[2]).to.equal(90n);
      });

      it('should add to existing register value', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 50));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 1, 25));

        expect(state.registers[1]).to.equal(75n);
      });
    });

    describe('BEQ (Branch if Equal)', () => {
      it('should not branch when registers are not equal', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 20));
        const pcBefore = state.nextPC;
        state = executor.executeStep(state, MipsInstructionBuilder.beq(1, 2, 4));

        // PC should advance normally (no branch taken)
        expect(state.nextPC).to.equal(pcBefore + 4n);
      });
    });

    describe('BNE (Branch if Not Equal)', () => {
      it('should branch when registers are not equal', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 20));
        // Branch with offset 4 (skip 4 instructions)
        state = executor.executeStep(state, MipsInstructionBuilder.bne(1, 2, 4));

        // Branch should be taken: nextPC = pc + (offset * 4) = 12 + 16 = 28
        expect(state.nextPC).to.equal(28n);
      });

      it('should not branch when registers are equal', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));
        state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 10));
        const pcBefore = state.nextPC;
        state = executor.executeStep(state, MipsInstructionBuilder.bne(1, 2, 4));

        // PC should advance normally (no branch taken)
        expect(state.nextPC).to.equal(pcBefore + 4n);
      });
    });
  });

  // ============================================
  // J-Type Instructions
  // ============================================
  describe('J-Type Instructions', () => {
    describe('J (Jump)', () => {
      it('should jump to target address', () => {
        let state = MipsExecutor.createInitialState();
        // Jump to address 0x100 (word address 0x40)
        state = executor.executeStep(state, MipsInstructionBuilder.j(0x40));

        expect(state.nextPC).to.equal(BigInt(0x100));
      });
    });

    describe('JAL (Jump and Link)', () => {
      it('should save return address in r31', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 1)); // Advance PC
        // After ADDI: pc=4, nextPC=8
        // JAL saves pc+4 to r31, which is the address after the delay slot
        state = executor.executeStep(state, MipsInstructionBuilder.jal(0x40));

        // r31 should contain the new PC + 4 (return address after delay slot)
        // When JAL executes: pc becomes 8, then we save pc + 4 = 12
        expect(state.registers[31]).to.equal(12n);
      });

      it('should jump to target address', () => {
        let state = MipsExecutor.createInitialState();
        state = executor.executeStep(state, MipsInstructionBuilder.jal(0x40));

        expect(state.nextPC).to.equal(BigInt(0x100));
      });
    });
  });

  // ============================================
  // Complex Program Tests
  // ============================================
  describe('Complex Programs', () => {
    it('should execute a sequence computing factorial base case', () => {
      let state = MipsExecutor.createInitialState();

      // result = 1, n = 5
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 1));   // r1 = 1 (result)
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 5));   // r2 = 5 (n)

      expect(state.registers[1]).to.equal(1n);
      expect(state.registers[2]).to.equal(5n);
      expect(state.step).to.equal(2n);
    });

    it('should execute arithmetic expression: (a + b) - (a - b)', () => {
      let state = MipsExecutor.createInitialState();

      // a = 10, b = 3
      state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 10));  // r1 = 10 (a)
      state = executor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 3));   // r2 = 3 (b)
      state = executor.executeStep(state, MipsInstructionBuilder.add(3, 1, 2));    // r3 = a + b = 13
      state = executor.executeStep(state, MipsInstructionBuilder.sub(4, 1, 2));    // r4 = a - b = 7
      state = executor.executeStep(state, MipsInstructionBuilder.sub(5, 3, 4));    // r5 = (a+b) - (a-b) = 6

      expect(state.registers[3]).to.equal(13n);
      expect(state.registers[4]).to.equal(7n);
      expect(state.registers[5]).to.equal(6n);
    });

    it('should maintain correct PC progression', () => {
      let state = MipsExecutor.createInitialState();

      for (let i = 0; i < 10; i++) {
        state = executor.executeStep(state, MipsInstructionBuilder.addi(1, 0, i));
      }

      expect(state.pc).to.equal(40n);
      expect(state.nextPC).to.equal(44n);
      expect(state.step).to.equal(10n);
    });
  });
});

describe('MipsInstructionBuilder', () => {
  // ============================================
  // Instruction Encoding Tests
  // ============================================
  describe('Instruction Encoding', () => {
    it('should encode ADDI correctly', () => {
      const insn = MipsInstructionBuilder.addi(1, 0, 100);
      // ADDI: opcode=8, rs=0, rt=1, imm=100
      // 001000 00000 00001 0000000001100100
      expect(insn).to.equal(BigInt(0x20010064));
    });

    it('should encode ADD correctly', () => {
      const insn = MipsInstructionBuilder.add(3, 1, 2);
      // ADD: opcode=0, rs=1, rt=2, rd=3, shamt=0, func=0x20
      // 000000 00001 00010 00011 00000 100000
      expect(insn).to.equal(BigInt(0x00221820));
    });

    it('should encode SUB correctly', () => {
      const insn = MipsInstructionBuilder.sub(3, 1, 2);
      // SUB: func=0x22
      expect(insn).to.equal(BigInt(0x00221822));
    });

    it('should encode AND correctly', () => {
      const insn = MipsInstructionBuilder.and(3, 1, 2);
      // AND: func=0x24
      expect(insn).to.equal(BigInt(0x00221824));
    });

    it('should encode OR correctly', () => {
      const insn = MipsInstructionBuilder.or(3, 1, 2);
      // OR: func=0x25
      expect(insn).to.equal(BigInt(0x00221825));
    });

    it('should encode XOR correctly', () => {
      const insn = MipsInstructionBuilder.xor(3, 1, 2);
      // XOR: func=0x26
      expect(insn).to.equal(BigInt(0x00221826));
    });

    it('should encode SLT correctly', () => {
      const insn = MipsInstructionBuilder.slt(3, 1, 2);
      // SLT: func=0x2a
      expect(insn).to.equal(BigInt(0x0022182a));
    });

    it('should encode J correctly', () => {
      const insn = MipsInstructionBuilder.j(0x100);
      // J: opcode=2
      expect(insn).to.equal(BigInt(0x08000100));
    });

    it('should encode JAL correctly', () => {
      const insn = MipsInstructionBuilder.jal(0x100);
      // JAL: opcode=3
      expect(insn).to.equal(BigInt(0x0C000100));
    });

    it('should encode BEQ correctly', () => {
      const insn = MipsInstructionBuilder.beq(1, 2, 10);
      // BEQ: opcode=4
      expect(insn).to.equal(BigInt(0x1022000a));
    });

    it('should encode BNE correctly', () => {
      const insn = MipsInstructionBuilder.bne(1, 2, 10);
      // BNE: opcode=5
      expect(insn).to.equal(BigInt(0x1422000a));
    });
  });

  // ============================================
  // R-Type Builder Tests
  // ============================================
  describe('rType', () => {
    it('should encode R-type instruction with all fields', () => {
      const insn = MipsInstructionBuilder.rType(0x20, 1, 2, 3, 0);
      expect(insn).to.equal(BigInt(0x00221820));
    });

    it('should encode R-type with shamt', () => {
      const insn = MipsInstructionBuilder.rType(0, 0, 1, 2, 4);
      // SLL with shamt=4
      expect(insn & 0x7E0n).to.equal(BigInt(4 << 6)); // Check shamt field
    });
  });

  // ============================================
  // I-Type Builder Tests
  // ============================================
  describe('iType', () => {
    it('should encode I-type instruction', () => {
      const insn = MipsInstructionBuilder.iType(8, 0, 1, 100);
      expect(insn).to.equal(BigInt(0x20010064));
    });

    it('should handle negative immediate', () => {
      const insn = MipsInstructionBuilder.iType(8, 0, 1, -1 & 0xFFFF);
      expect(insn & 0xFFFFn).to.equal(BigInt(0xFFFF));
    });
  });

  // ============================================
  // J-Type Builder Tests
  // ============================================
  describe('jType', () => {
    it('should encode J-type instruction', () => {
      const insn = MipsInstructionBuilder.jType(2, 0x100);
      expect(insn).to.equal(BigInt(0x08000100));
    });

    it('should mask address to 26 bits', () => {
      const insn = MipsInstructionBuilder.jType(2, 0xFFFFFFFF);
      expect(insn & 0x03FFFFFFn).to.equal(BigInt(0x03FFFFFF));
    });
  });
});
