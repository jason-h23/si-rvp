/**
 * ProgramExecutor Unit Tests
 */

import { expect } from 'chai';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { PoseidonHasher } from '../src/common/prover';
import { ProgramExecutor } from '../src/common/executor';

describe('ProgramExecutor', () => {
  let executor: ProgramExecutor;
  let mipsExecutor: MipsExecutor;
  let poseidonHasher: PoseidonHasher;

  // PoseidonHasher is stateless after init — initialize once
  before(async () => {
    poseidonHasher = new PoseidonHasher();
    await poseidonHasher.initialize();
  });

  beforeEach(() => {
    mipsExecutor = new MipsExecutor();
    executor = new ProgramExecutor(mipsExecutor, poseidonHasher);
  });

  // ============================================
  // Normal Execution
  // ============================================
  describe('normal execution', () => {
    it('should execute a single instruction and return state history', async () => {
      const instructions = [MipsInstructionBuilder.addi(1, 0, 42)];
      const result = await executor.execute(instructions);

      expect(result.finalState.registers[1]).to.equal(42n);
      expect(result.stateHistory.size).to.equal(2); // initial + 1 step
      expect(result.instructionHistory.size).to.equal(1);
      expect(result.stateRoot).to.match(/^0x[0-9a-f]{64}$/);
    });

    it('should execute multiple instructions sequentially', async () => {
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 10), // r1 = 10
        MipsInstructionBuilder.addi(2, 0, 20), // r2 = 20
        MipsInstructionBuilder.add(3, 1, 2),   // r3 = r1 + r2 = 30
      ];
      const result = await executor.execute(instructions);

      expect(result.finalState.registers[1]).to.equal(10n);
      expect(result.finalState.registers[2]).to.equal(20n);
      expect(result.finalState.registers[3]).to.equal(30n);
      expect(result.stateHistory.size).to.equal(4); // initial + 3 steps
      expect(result.instructionHistory.size).to.equal(3);
    });

    it('should deep-copy states in history (no shared references)', async () => {
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 5),
        MipsInstructionBuilder.addi(1, 1, 10),
      ];
      const result = await executor.execute(instructions);

      const step0 = result.stateHistory.get(0n);
      const step1 = result.stateHistory.get(1n);

      // States should be independent copies
      expect(step0!.registers[1]).to.equal(0n);
      expect(step1!.registers[1]).to.equal(5n);
      expect(step0!.registers).to.not.equal(step1!.registers);
    });

    it('should use provided initial state without mutating it', async () => {
      const base = MipsExecutor.createInitialState();
      const initial = { ...base, registers: base.registers.map((r, i) => i === 5 ? 100n : r) };
      const originalRegs = [...initial.registers];

      const instructions = [MipsInstructionBuilder.addi(6, 5, 1)]; // r6 = r5 + 1
      const result = await executor.execute(instructions, initial);

      expect(result.finalState.registers[6]).to.equal(101n);
      // Verify caller's initialState was not mutated
      expect(initial.registers).to.deep.equal(originalRegs);
    });

    it('should produce deterministic stateRoot for identical inputs', async () => {
      const instructions = [MipsInstructionBuilder.addi(1, 0, 7)];

      const result1 = await executor.execute(instructions);
      const result2 = await executor.execute(instructions);

      expect(result1.stateRoot).to.equal(result2.stateRoot);
    });
  });

  // ============================================
  // Boundary Values
  // ============================================
  describe('boundary values', () => {
    it('should handle uint32 overflow (wrap around)', async () => {
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, -1),  // r1 = 0xFFFFFFFF
        MipsInstructionBuilder.addi(2, 1, 1),    // r2 = 0 (overflow wrap)
      ];
      const result = await executor.execute(instructions);

      expect(result.finalState.registers[1]).to.equal(0xFFFFFFFFn);
      expect(result.finalState.registers[2]).to.equal(0n);
    });

    it('should not modify $zero register (r0)', async () => {
      // MIPS: writes to $zero are silently ignored
      const instructions = [
        MipsInstructionBuilder.addi(0, 0, 42),  // attempt write to $zero
      ];
      const result = await executor.execute(instructions);

      expect(result.finalState.registers[0]).to.equal(0n);
    });
  });

  // ============================================
  // Null / Invalid Input
  // ============================================
  describe('null and invalid input', () => {
    it('should throw on null instructions', async () => {
      try {
        await executor.execute(null as unknown as bigint[]);
        expect.fail('should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.include('instructions must not be null');
      }
    });

    it('should throw on undefined instructions', async () => {
      try {
        await executor.execute(undefined as unknown as bigint[]);
        expect.fail('should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.include('instructions must not be null');
      }
    });

    it('should handle empty instructions array', async () => {
      const result = await executor.execute([]);

      // Should return initial state only
      expect(result.stateHistory.size).to.equal(1);
      expect(result.instructionHistory.size).to.equal(0);
      expect(result.finalState.step).to.equal(0n);
    });
  });

  // ============================================
  // Error Wrapping with Cause
  // ============================================
  describe('error wrapping', () => {
    it('should wrap execution errors with cause chain', async () => {
      const failingExecutor = {
        executeStep: () => {
          throw new Error('MIPS decode failure');
        },
      } as unknown as MipsExecutor;

      const failingProgramExecutor = new ProgramExecutor(failingExecutor, poseidonHasher);

      try {
        await failingProgramExecutor.execute([0n]);
        expect.fail('should have thrown');
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).to.include('MIPS execution failed at step');
        // Verify cause chain preserves original error
        expect(error.cause).to.be.instanceOf(Error);
        expect((error.cause as Error).message).to.equal('MIPS decode failure');
      }
    });

    it('should propagate poseidon hash failure', async () => {
      const uninitHasher = new PoseidonHasher(); // not initialized
      const pe = new ProgramExecutor(mipsExecutor, uninitHasher);

      try {
        await pe.execute([MipsInstructionBuilder.addi(1, 0, 1)]);
        expect.fail('should have thrown');
      } catch (err: unknown) {
        // Poseidon hash fails because hasher is uninitialized
        expect(err).to.be.instanceOf(Error);
      }
    });
  });

  // ============================================
  // Returned Maps are Owned (No External Mutation)
  // ============================================
  describe('ownership', () => {
    it('should return independent Maps on each call', async () => {
      const instructions = [MipsInstructionBuilder.addi(1, 0, 1)];

      const result1 = await executor.execute(instructions);
      const result2 = await executor.execute(instructions);

      // Maps should be separate instances
      expect(result1.stateHistory).to.not.equal(result2.stateHistory);
      expect(result1.instructionHistory).to.not.equal(result2.instructionHistory);
    });
  });
});
