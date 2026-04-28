/**
 * SI-RVP - Shared MIPS Program Executor
 *
 * Extracted from SequencerNode and ChallengerNode to eliminate duplication.
 * Both nodes execute MIPS programs and store state/instruction history
 * using identical logic.
 */

import { MipsState } from './types';
import { PoseidonHasher } from './prover';
import { MipsExecutor } from './mips';

export interface ExecutionResult {
  finalState: MipsState;
  stateRoot: string;
  stateHistory: Map<bigint, MipsState>;
  instructionHistory: Map<bigint, bigint>;
}

export class ProgramExecutor {
  private mipsExecutor: MipsExecutor;
  private poseidonHasher: PoseidonHasher;

  constructor(mipsExecutor: MipsExecutor, poseidonHasher: PoseidonHasher) {
    this.mipsExecutor = mipsExecutor;
    this.poseidonHasher = poseidonHasher;
  }

  /**
   * Execute a MIPS program, returning state history and instruction history
   * as new Maps owned by the caller. Does not mutate any external state.
   */
  async execute(
    instructions: bigint[],
    initialState?: MipsState
  ): Promise<ExecutionResult> {
    if (!instructions) {
      throw new Error('ProgramExecutor: instructions must not be null');
    }

    const stateHistory = new Map<bigint, MipsState>();
    const instructionHistory = new Map<bigint, bigint>();

    let state = initialState || MipsExecutor.createInitialState();

    // Deep-copy state before storing (registers array is separately cloned)
    stateHistory.set(state.step, { ...state, registers: [...state.registers] });

    try {
      for (const instruction of instructions) {
        instructionHistory.set(state.step, instruction);
        state = this.mipsExecutor.executeStep(state, instruction);
        stateHistory.set(state.step, { ...state, registers: [...state.registers] });
      }
    } catch (err) {
      throw new Error(`MIPS execution failed at step ${state.step}`, { cause: err });
    }

    // Calculate state root via Poseidon hash
    const stateHash = this.poseidonHasher.hashMipsState(state);
    const stateRoot = '0x' + stateHash.toString(16).padStart(64, '0');

    return { finalState: state, stateRoot, stateHistory, instructionHistory };
  }
}
