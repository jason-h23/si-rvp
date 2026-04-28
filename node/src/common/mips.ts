/**
 * SI-RVP - MIPS Emulator
 *
 * Port of Cannon FPVM's mips_instructions.go
 * Minimal instruction set implementation for POC
 */

import { MipsState, MipsOpcode, VMStatus, MemoryWriteDescriptor } from './types';

// ============================================
// Constants
// ============================================
const REGISTER_COUNT = 32;
const REG_RA = 31; // Return address register
const U32_MASK = 0xFFFFFFFFn;

// ============================================
// MIPS Executor
// ============================================
export class MipsExecutor {
  /**
   * Execute single step
   * @param state Current state
   * @param instruction 32-bit instruction
   * @param memValue Value read from memory (if needed)
   * @returns New state
   */
  executeStep(
    state: MipsState,
    instruction: bigint,
    memValue: bigint = 0n
  ): MipsState {
    // Copy state (immutability)
    const newState: MipsState = {
      ...state,
      registers: [...state.registers],
      memWrite: undefined,
    };

    // Instruction decoding
    const insn = Number(instruction & U32_MASK);
    const opcode = (insn >> 26) & 0x3f;
    const func = insn & 0x3f;
    const rs = (insn >> 21) & 0x1f;
    const rt = (insn >> 16) & 0x1f;
    const rd = (insn >> 11) & 0x1f;
    const shamt = (insn >> 6) & 0x1f;
    const imm = insn & 0xffff;
    const signExtImm = imm & 0x8000 ? BigInt(imm) | ~0xFFFFn : BigInt(imm);

    const rsVal = newState.registers[rs];
    const rtVal = newState.registers[rt];

    // PC update (default)
    newState.pc = newState.nextPC;
    newState.nextPC = newState.nextPC + 4n;
    newState.step = newState.step + 1n;

    // R-Type (opcode = 0)
    if (opcode === 0) {
      const result = this.executeRType(func, rsVal, rtVal, shamt, newState);
      if (rd !== 0 && result !== undefined) {
        newState.registers[rd] = result & U32_MASK;
      }
    }
    // J-Type
    else if (opcode === 2 || opcode === 3) {
      const target =
        (newState.pc & 0xF0000000n) | (BigInt(insn & 0x03ffffff) << 2n);
      if (opcode === 3) {
        // JAL
        newState.registers[REG_RA] = newState.pc + 4n;
      }
      newState.nextPC = target;
    }
    // I-Type
    else {
      const result = this.executeIType(
        opcode,
        rsVal,
        rtVal,
        signExtImm,
        imm,
        memValue,
        newState
      );
      if (rt !== 0 && result !== undefined) {
        newState.registers[rt] = result & U32_MASK;
      }
    }

    return newState;
  }

  /**
   * Execute R-Type instruction
   */
  private executeRType(
    func: number,
    rs: bigint,
    rt: bigint,
    shamt: number,
    state: MipsState
  ): bigint | undefined {
    const shamtBig = BigInt(shamt);

    switch (func) {
      // Shift
      case 0x00: // SLL
        return this.signExtend32((rt << shamtBig) & U32_MASK);
      case 0x02: // SRL
        return this.signExtend32((rt & U32_MASK) >> shamtBig);
      case 0x03: // SRA
        return this.signExtend32(BigInt(Number(rt & U32_MASK) >> shamt));
      case 0x04: // SLLV
        return this.signExtend32((rt << (rs & 0x1fn)) & U32_MASK);
      case 0x06: // SRLV
        return this.signExtend32((rt & U32_MASK) >> (rs & 0x1fn));

      // Jump Register
      case 0x08: // JR
        state.nextPC = rs;
        return undefined;
      case 0x09: // JALR
        const retAddr = state.pc + 4n;
        state.nextPC = rs;
        return retAddr;

      // Move
      case 0x10: // MFHI
        return state.hi;
      case 0x11: // MTHI
        state.hi = rs;
        return undefined;
      case 0x12: // MFLO
        return state.lo;
      case 0x13: // MTLO
        state.lo = rs;
        return undefined;

      // Multiply/Divide
      case 0x18: // MULT
        const multResult = BigInt(Number(rs & U32_MASK)) * BigInt(Number(rt & U32_MASK));
        state.hi = this.signExtend32((multResult >> 32n) & U32_MASK);
        state.lo = this.signExtend32(multResult & U32_MASK);
        return undefined;
      case 0x19: // MULTU
        const multuResult = (rs & U32_MASK) * (rt & U32_MASK);
        state.hi = this.signExtend32((multuResult >> 32n) & U32_MASK);
        state.lo = this.signExtend32(multuResult & U32_MASK);
        return undefined;
      case 0x1a: // DIV (signed)
        if (rt === 0n) throw new Error('Division by zero');
        // Use proper BigInt signed division (truncate toward zero)
        const signedRs = this.toSigned32(rs);
        const signedRt = this.toSigned32(rt);
        // BigInt division truncates toward zero (matches MIPS behavior)
        state.lo = this.signExtend32(signedRs / signedRt);
        state.hi = this.signExtend32(signedRs % signedRt);
        return undefined;
      case 0x1b: // DIVU
        if (rt === 0n) throw new Error('Division by zero');
        state.lo = this.signExtend32((rs & U32_MASK) / (rt & U32_MASK));
        state.hi = this.signExtend32((rs & U32_MASK) % (rt & U32_MASK));
        return undefined;

      // Arithmetic
      case 0x20: // ADD
      case 0x21: // ADDU
        return this.signExtend32((rs + rt) & U32_MASK);
      case 0x22: // SUB
      case 0x23: // SUBU
        return this.signExtend32((rs - rt) & U32_MASK);

      // Logic
      case 0x24: // AND
        return rs & rt;
      case 0x25: // OR
        return rs | rt;
      case 0x26: // XOR
        return rs ^ rt;
      case 0x27: // NOR
        return ~(rs | rt) & U32_MASK;

      // Compare
      case 0x2a: // SLT
        return Number(rs) < Number(rt) ? 1n : 0n;
      case 0x2b: // SLTU
        return (rs & U32_MASK) < (rt & U32_MASK) ? 1n : 0n;

      default:
        throw new Error(`Unknown R-type function: 0x${func.toString(16)}`);
    }
  }

  /**
   * Execute I-Type instruction
   */
  private executeIType(
    opcode: number,
    rs: bigint,
    rt: bigint,
    signExtImm: bigint,
    imm: number,
    memValue: bigint,
    state: MipsState
  ): bigint | undefined {
    switch (opcode) {
      // Branch
      case 0x04: // BEQ
        if (rs === rt) {
          state.nextPC = state.pc + (signExtImm << 2n);
        }
        return undefined;
      case 0x05: // BNE
        if (rs !== rt) {
          state.nextPC = state.pc + (signExtImm << 2n);
        }
        return undefined;
      case 0x06: // BLEZ
        if (Number(rs) <= 0) {
          state.nextPC = state.pc + (signExtImm << 2n);
        }
        return undefined;
      case 0x07: // BGTZ
        if (Number(rs) > 0) {
          state.nextPC = state.pc + (signExtImm << 2n);
        }
        return undefined;

      // Arithmetic Immediate
      case 0x08: // ADDI
      case 0x09: // ADDIU
        return this.signExtend32((rs + signExtImm) & U32_MASK);

      // Logic Immediate
      case 0x0c: // ANDI
        return rs & BigInt(imm);
      case 0x0d: // ORI
        return rs | BigInt(imm);
      case 0x0e: // XORI
        return rs ^ BigInt(imm);

      // Compare Immediate
      case 0x0a: // SLTI
        return Number(rs) < Number(signExtImm) ? 1n : 0n;
      case 0x0b: // SLTIU
        return (rs & U32_MASK) < (signExtImm & U32_MASK) ? 1n : 0n;

      // Load Upper Immediate
      case 0x0f: // LUI
        return this.signExtend32(BigInt(imm) << 16n);

      // Load/Store (memory value provided externally)
      case 0x23: // LW
        return memValue & U32_MASK;
      case 0x20: // LB
        return this.signExtend8(memValue & 0xFFn);
      case 0x21: // LH
        return this.signExtend16(memValue & 0xFFFFn);
      case 0x24: // LBU
        return memValue & 0xFFn;
      case 0x25: // LHU
        return memValue & 0xFFFFn;

      // Store instructions — compute address and set memWrite descriptor
      case 0x28: { // SB
        const addr = (rs + signExtImm) & U32_MASK;
        state.memWrite = { address: addr, value: rt & 0xFFn, size: 1 };
        return undefined;
      }
      case 0x29: { // SH
        const addr = (rs + signExtImm) & U32_MASK;
        state.memWrite = { address: addr, value: rt & 0xFFFFn, size: 2 };
        return undefined;
      }
      case 0x2b: { // SW
        const addr = (rs + signExtImm) & U32_MASK;
        state.memWrite = { address: addr, value: rt & U32_MASK, size: 4 };
        return undefined;
      }

      default:
        throw new Error(`Unknown I-type opcode: 0x${opcode.toString(16)}`);
    }
  }

  /**
   * Convert unsigned 32-bit BigInt to signed (for DIV/MOD)
   */
  private toSigned32(val: bigint): bigint {
    const masked = val & U32_MASK;
    return (masked & 0x80000000n) ? masked - 0x100000000n : masked;
  }

  /**
   * 32-bit sign extension
   */
  private signExtend32(val: bigint): bigint {
    if (val & 0x80000000n) {
      return val | ~U32_MASK;
    }
    return val & U32_MASK;
  }

  /**
   * 16-bit sign extension
   */
  private signExtend16(val: bigint): bigint {
    if (val & 0x8000n) {
      return val | ~0xFFFFn;
    }
    return val;
  }

  /**
   * 8-bit sign extension
   */
  private signExtend8(val: bigint): bigint {
    if (val & 0x80n) {
      return val | ~0xFFn;
    }
    return val;
  }

  /**
   * Create initial state
   */
  static createInitialState(pc: bigint = 0n): MipsState {
    return {
      pc,
      nextPC: pc + 4n,
      registers: new Array(REGISTER_COUNT).fill(0n),
      hi: 0n,
      lo: 0n,
      heap: 0n,
      exitCode: 0,
      exited: false,
      step: 0n,
      memoryRoot: '0x' + '0'.repeat(64),
      preimageKey: '0x' + '0'.repeat(64),
      preimageOffset: 0n,
    };
  }

  /**
   * Check VM status
   */
  static getVMStatus(state: MipsState): VMStatus {
    if (!state.exited) {
      return VMStatus.UNFINISHED;
    }

    switch (state.exitCode) {
      case 0:
        return VMStatus.VALID;
      case 1:
        return VMStatus.INVALID;
      default:
        return VMStatus.PANIC;
    }
  }
}

// ============================================
// Instruction Builder Utility
// ============================================
export const MipsInstructionBuilder = {
  /**
   * Create R-Type instruction
   */
  rType(func: number, rs: number, rt: number, rd: number, shamt: number = 0): bigint {
    return BigInt(
      ((rs & 0x1f) << 21) |
      ((rt & 0x1f) << 16) |
      ((rd & 0x1f) << 11) |
      ((shamt & 0x1f) << 6) |
      (func & 0x3f)
    );
  },

  /**
   * Create I-Type instruction
   */
  iType(opcode: number, rs: number, rt: number, imm: number): bigint {
    return BigInt(
      ((opcode & 0x3f) << 26) |
      ((rs & 0x1f) << 21) |
      ((rt & 0x1f) << 16) |
      (imm & 0xffff)
    );
  },

  /**
   * Create J-Type instruction
   */
  jType(opcode: number, address: number): bigint {
    return BigInt(
      ((opcode & 0x3f) << 26) |
      (address & 0x03ffffff)
    );
  },

  // Convenience functions
  add: (rd: number, rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x20, rs, rt, rd),
  sub: (rd: number, rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x22, rs, rt, rd),
  and: (rd: number, rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x24, rs, rt, rd),
  or: (rd: number, rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x25, rs, rt, rd),
  xor: (rd: number, rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x26, rs, rt, rd),
  slt: (rd: number, rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x2a, rs, rt, rd),
  sllv: (rd: number, rt: number, rs: number) =>
    MipsInstructionBuilder.rType(0x04, rs, rt, rd),
  srlv: (rd: number, rt: number, rs: number) =>
    MipsInstructionBuilder.rType(0x06, rs, rt, rd),
  mfhi: (rd: number) =>
    MipsInstructionBuilder.rType(0x10, 0, 0, rd),
  mflo: (rd: number) =>
    MipsInstructionBuilder.rType(0x12, 0, 0, rd),
  mult: (rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x18, rs, rt, 0),
  multu: (rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x19, rs, rt, 0),
  div: (rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x1a, rs, rt, 0),
  divu: (rs: number, rt: number) =>
    MipsInstructionBuilder.rType(0x1b, rs, rt, 0),
  addi: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x08, rs, rt, imm),
  addiu: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x09, rs, rt, imm),
  andi: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x0c, rs, rt, imm),
  ori: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x0d, rs, rt, imm),
  xori: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x0e, rs, rt, imm),
  slti: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x0a, rs, rt, imm),
  sltiu: (rt: number, rs: number, imm: number) =>
    MipsInstructionBuilder.iType(0x0b, rs, rt, imm),
  lui: (rt: number, imm: number) =>
    MipsInstructionBuilder.iType(0x0f, 0, rt, imm),
  beq: (rs: number, rt: number, offset: number) =>
    MipsInstructionBuilder.iType(0x04, rs, rt, offset),
  bne: (rs: number, rt: number, offset: number) =>
    MipsInstructionBuilder.iType(0x05, rs, rt, offset),
  blez: (rs: number, offset: number) =>
    MipsInstructionBuilder.iType(0x06, rs, 0, offset),
  bgtz: (rs: number, offset: number) =>
    MipsInstructionBuilder.iType(0x07, rs, 0, offset),
  jr: (rs: number) =>
    MipsInstructionBuilder.rType(0x08, rs, 0, 0),
  sll: (rd: number, rt: number, shamt: number) =>
    MipsInstructionBuilder.rType(0x00, 0, rt, rd, shamt),
  srl: (rd: number, rt: number, shamt: number) =>
    MipsInstructionBuilder.rType(0x02, 0, rt, rd, shamt),
  sra: (rd: number, rt: number, shamt: number) =>
    MipsInstructionBuilder.rType(0x03, 0, rt, rd, shamt),
  lb: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x20, rs, rt, offset),
  lh: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x21, rs, rt, offset),
  lbu: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x24, rs, rt, offset),
  lhu: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x25, rs, rt, offset),
  lw: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x23, rs, rt, offset),
  sb: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x28, rs, rt, offset),
  sh: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x29, rs, rt, offset),
  sw: (rt: number, offset: number, rs: number) =>
    MipsInstructionBuilder.iType(0x2b, rs, rt, offset),
  j: (address: number) =>
    MipsInstructionBuilder.jType(0x02, address),
  jal: (address: number) =>
    MipsInstructionBuilder.jType(0x03, address),
};
