/**
 * MIPS Store Instructions & InstructionBuilder Tests
 */

import { expect } from 'chai';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { MipsState } from '../src/common/types';

describe('MIPS Store Instructions', () => {
  let executor: MipsExecutor;

  beforeEach(() => {
    executor = new MipsExecutor();
  });

  /**
   * Helper: create a state with specific register values set.
   * Returns a new state — does not mutate the template.
   */
  function stateWithRegs(regs: Record<number, bigint>): MipsState {
    const base = MipsExecutor.createInitialState();
    const registers = base.registers.map((v, i) =>
      regs[i] !== undefined ? regs[i] : v
    );
    return { ...base, registers };
  }

  // ============================================
  // SW (Store Word) — opcode 0x2b
  // ============================================
  describe('SW (Store Word)', () => {
    it('should produce memWrite descriptor with full 32-bit value', () => {
      // r1 = base address 0x1000, r2 = value 0xDEADBEEF
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xDEADBEEFn });
      const insn = MipsInstructionBuilder.sw(2, 0, 1); // sw $2, 0($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite).to.not.be.undefined;
      expect(result.memWrite!.address).to.equal(0x1000n);
      expect(result.memWrite!.value).to.equal(0xDEADBEEFn);
      expect(result.memWrite!.size).to.equal(4);
    });

    it('should compute address with positive offset', () => {
      const state = stateWithRegs({ 1: 0x2000n, 2: 42n });
      const insn = MipsInstructionBuilder.sw(2, 8, 1); // sw $2, 8($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.address).to.equal(0x2008n);
    });

    it('should compute address with negative offset (sign-extended)', () => {
      const state = stateWithRegs({ 1: 0x2000n, 2: 42n });
      // offset = -4 → 0xFFFC in 16-bit unsigned
      const insn = MipsInstructionBuilder.sw(2, 0xFFFC, 1); // sw $2, -4($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.address).to.equal(0x1FFCn);
    });

    it('should store zero value', () => {
      const state = stateWithRegs({ 1: 0x3000n, 2: 0n });
      const insn = MipsInstructionBuilder.sw(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.value).to.equal(0n);
      expect(result.memWrite!.size).to.equal(4);
    });

    it('should store max uint32 value', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xFFFFFFFFn });
      const insn = MipsInstructionBuilder.sw(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.value).to.equal(0xFFFFFFFFn);
    });

    it('should increment PC by 4 and step by 1', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 1n });
      const insn = MipsInstructionBuilder.sw(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.pc).to.equal(state.nextPC);
      expect(result.step).to.equal(state.step + 1n);
    });

    it('should not mutate the original state', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xABCDn });
      const originalRegs = [...state.registers];
      const insn = MipsInstructionBuilder.sw(2, 0, 1);
      executor.executeStep(state, insn);

      expect(state.memWrite).to.be.undefined;
      expect(state.registers).to.deep.equal(originalRegs);
    });
  });

  // ============================================
  // SH (Store Halfword) — opcode 0x29
  // ============================================
  describe('SH (Store Halfword)', () => {
    it('should mask value to 16 bits', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xDEADBEEFn });
      const insn = MipsInstructionBuilder.sh(2, 0, 1); // sh $2, 0($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.address).to.equal(0x1000n);
      expect(result.memWrite!.value).to.equal(0xBEEFn);
      expect(result.memWrite!.size).to.equal(2);
    });

    it('should store zero value', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0n });
      const insn = MipsInstructionBuilder.sh(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.value).to.equal(0n);
      expect(result.memWrite!.size).to.equal(2);
    });

    it('should store max 16-bit value', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xFFFFn });
      const insn = MipsInstructionBuilder.sh(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.value).to.equal(0xFFFFn);
    });

    it('should compute address with offset', () => {
      const state = stateWithRegs({ 1: 0x4000n, 2: 0x1234n });
      const insn = MipsInstructionBuilder.sh(2, 4, 1); // sh $2, 4($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.address).to.equal(0x4004n);
    });
  });

  // ============================================
  // SB (Store Byte) — opcode 0x28
  // ============================================
  describe('SB (Store Byte)', () => {
    it('should mask value to 8 bits', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xDEADBEEFn });
      const insn = MipsInstructionBuilder.sb(2, 0, 1); // sb $2, 0($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.address).to.equal(0x1000n);
      expect(result.memWrite!.value).to.equal(0xEFn);
      expect(result.memWrite!.size).to.equal(1);
    });

    it('should store zero value', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0n });
      const insn = MipsInstructionBuilder.sb(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.value).to.equal(0n);
      expect(result.memWrite!.size).to.equal(1);
    });

    it('should store max 8-bit value', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xFFn });
      const insn = MipsInstructionBuilder.sb(2, 0, 1);
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.value).to.equal(0xFFn);
    });

    it('should compute address with offset', () => {
      const state = stateWithRegs({ 1: 0x5000n, 2: 0x42n });
      const insn = MipsInstructionBuilder.sb(2, 3, 1); // sb $2, 3($1)
      const result = executor.executeStep(state, insn);

      expect(result.memWrite!.address).to.equal(0x5003n);
    });
  });

  // ============================================
  // Address wrapping (uint32 boundary)
  // ============================================
  describe('address wrapping', () => {
    it('should wrap address at uint32 boundary', () => {
      const state = stateWithRegs({ 1: 0xFFFFFFF0n, 2: 1n });
      const insn = MipsInstructionBuilder.sw(2, 0x20, 1); // sw $2, 32($1)
      const result = executor.executeStep(state, insn);

      // 0xFFFFFFF0 + 0x20 = 0x100000010 → masked to 0x00000010
      expect(result.memWrite!.address).to.equal(0x10n);
    });
  });

  // ============================================
  // InstructionBuilder encoding verification
  // ============================================
  describe('InstructionBuilder encoding', () => {
    it('sb should encode as I-type with opcode 0x28', () => {
      const insn = MipsInstructionBuilder.sb(2, 4, 1); // sb $2, 4($1)
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x28); // opcode
      expect((val >> 21) & 0x1f).to.equal(1);    // rs
      expect((val >> 16) & 0x1f).to.equal(2);    // rt
      expect(val & 0xffff).to.equal(4);           // imm
    });

    it('sh should encode as I-type with opcode 0x29', () => {
      const insn = MipsInstructionBuilder.sh(3, 8, 2); // sh $3, 8($2)
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x29);
      expect((val >> 21) & 0x1f).to.equal(2);    // rs
      expect((val >> 16) & 0x1f).to.equal(3);    // rt
      expect(val & 0xffff).to.equal(8);           // imm
    });

    it('sw should encode as I-type with opcode 0x2b', () => {
      const insn = MipsInstructionBuilder.sw(4, 16, 3); // sw $4, 16($3)
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x2b);
      expect((val >> 21) & 0x1f).to.equal(3);    // rs
      expect((val >> 16) & 0x1f).to.equal(4);    // rt
      expect(val & 0xffff).to.equal(16);          // imm
    });

    it('lb should encode as I-type with opcode 0x20', () => {
      const insn = MipsInstructionBuilder.lb(5, 0, 1);
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x20);
      expect((val >> 21) & 0x1f).to.equal(1);    // rs
      expect((val >> 16) & 0x1f).to.equal(5);    // rt
    });

    it('lh should encode as I-type with opcode 0x21', () => {
      const insn = MipsInstructionBuilder.lh(5, 0, 1);
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x21);
    });

    it('lbu should encode as I-type with opcode 0x24', () => {
      const insn = MipsInstructionBuilder.lbu(5, 0, 1);
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x24);
    });

    it('lhu should encode as I-type with opcode 0x25', () => {
      const insn = MipsInstructionBuilder.lhu(5, 0, 1);
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0x25);
    });

    it('sll should encode as R-type with func 0x00', () => {
      const insn = MipsInstructionBuilder.sll(3, 2, 5); // sll $3, $2, 5
      const val = Number(insn);
      expect((val >> 26) & 0x3f).to.equal(0);    // R-type opcode
      expect((val >> 21) & 0x1f).to.equal(0);    // rs = 0 for shift
      expect((val >> 16) & 0x1f).to.equal(2);    // rt
      expect((val >> 11) & 0x1f).to.equal(3);    // rd
      expect((val >> 6) & 0x1f).to.equal(5);     // shamt
      expect(val & 0x3f).to.equal(0x00);          // func
    });

    it('srl should encode as R-type with func 0x02', () => {
      const insn = MipsInstructionBuilder.srl(3, 2, 4);
      const val = Number(insn);
      expect(val & 0x3f).to.equal(0x02);
      expect((val >> 6) & 0x1f).to.equal(4);     // shamt
    });

    it('sra should encode as R-type with func 0x03', () => {
      const insn = MipsInstructionBuilder.sra(3, 2, 4);
      const val = Number(insn);
      expect(val & 0x3f).to.equal(0x03);
      expect((val >> 6) & 0x1f).to.equal(4);     // shamt
    });
  });

  // ============================================
  // Shift instruction execution
  // ============================================
  describe('Shift instructions via InstructionBuilder', () => {
    it('sll should shift left by shamt', () => {
      const state = stateWithRegs({ 2: 0x01n });
      const insn = MipsInstructionBuilder.sll(3, 2, 4); // sll $3, $2, 4
      const result = executor.executeStep(state, insn);

      expect(result.registers[3]).to.equal(0x10n);
    });

    it('srl should shift right (logical) by shamt', () => {
      const state = stateWithRegs({ 2: 0x80000000n });
      const insn = MipsInstructionBuilder.srl(3, 2, 4); // srl $3, $2, 4
      const result = executor.executeStep(state, insn);

      expect(result.registers[3]).to.equal(0x08000000n);
    });

    it('sra should shift right (arithmetic) preserving sign', () => {
      const state = stateWithRegs({ 2: 0x80000000n });
      const insn = MipsInstructionBuilder.sra(3, 2, 4); // sra $3, $2, 4
      const result = executor.executeStep(state, insn);

      // Arithmetic right shift of 0x80000000 by 4 = 0xF8000000
      expect(result.registers[3]).to.equal(0xF8000000n);
    });

    it('sll with zero shamt should be a nop copy', () => {
      const state = stateWithRegs({ 2: 0xABCDn });
      const insn = MipsInstructionBuilder.sll(3, 2, 0);
      const result = executor.executeStep(state, insn);

      expect(result.registers[3]).to.equal(0xABCDn);
    });
  });

  // ============================================
  // Load instruction execution via InstructionBuilder
  // ============================================
  describe('Load instructions via InstructionBuilder', () => {
    it('lb should sign-extend byte from memValue', () => {
      const state = stateWithRegs({ 1: 0x1000n });
      const insn = MipsInstructionBuilder.lb(2, 0, 1);
      const result = executor.executeStep(state, insn, 0x80n); // negative byte

      // 0x80 sign-extended to 32 bits = 0xFFFFFF80
      expect(result.registers[2]).to.equal(0xFFFFFF80n);
    });

    it('lbu should zero-extend byte from memValue', () => {
      const state = stateWithRegs({ 1: 0x1000n });
      const insn = MipsInstructionBuilder.lbu(2, 0, 1);
      const result = executor.executeStep(state, insn, 0x80n);

      expect(result.registers[2]).to.equal(0x80n);
    });

    it('lh should sign-extend halfword from memValue', () => {
      const state = stateWithRegs({ 1: 0x1000n });
      const insn = MipsInstructionBuilder.lh(2, 0, 1);
      const result = executor.executeStep(state, insn, 0x8000n);

      expect(result.registers[2]).to.equal(0xFFFF8000n);
    });

    it('lhu should zero-extend halfword from memValue', () => {
      const state = stateWithRegs({ 1: 0x1000n });
      const insn = MipsInstructionBuilder.lhu(2, 0, 1);
      const result = executor.executeStep(state, insn, 0x8000n);

      expect(result.registers[2]).to.equal(0x8000n);
    });
  });

  // ============================================
  // Stale memWrite clearing
  // ============================================
  describe('memWrite clearing on non-store instructions', () => {
    it('should clear memWrite on subsequent non-store instruction', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 42n });
      const swInsn = MipsInstructionBuilder.sw(2, 0, 1);
      const step1 = executor.executeStep(state, swInsn);
      expect(step1.memWrite).to.not.be.undefined;

      const addiInsn = MipsInstructionBuilder.addi(3, 0, 1);
      const step2 = executor.executeStep(step1, addiInsn);
      expect(step2.memWrite).to.be.undefined;
    });

    it('should clear memWrite after SH store instruction', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 0xBEEFn });
      const shInsn = MipsInstructionBuilder.sh(2, 0, 1);
      const step1 = executor.executeStep(state, shInsn);
      expect(step1.memWrite).to.not.be.undefined;

      const step2 = executor.executeStep(step1, MipsInstructionBuilder.addi(3, 0, 1));
      expect(step2.memWrite).to.be.undefined;
    });

    it('should not carry memWrite across multiple non-store steps', () => {
      const state = stateWithRegs({ 1: 0x1000n, 2: 99n });
      const sbInsn = MipsInstructionBuilder.sb(2, 0, 1);
      const step1 = executor.executeStep(state, sbInsn);
      expect(step1.memWrite).to.not.be.undefined;

      // Two consecutive non-store steps
      const add1 = MipsInstructionBuilder.addi(3, 0, 1);
      const step2 = executor.executeStep(step1, add1);
      expect(step2.memWrite).to.be.undefined;

      const add2 = MipsInstructionBuilder.addi(4, 0, 2);
      const step3 = executor.executeStep(step2, add2);
      expect(step3.memWrite).to.be.undefined;
    });
  });
});
