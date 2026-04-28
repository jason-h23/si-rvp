/**
 * Types Module Unit Tests
 */

import { expect } from 'chai';
import {
  DEFAULT_CONFIG,
  GameTypes,
  GameStatus,
  VMStatus,
  MipsOpcode,
  BisectionPhase,
  PositionLib,
  gameType,
  claim,
} from '../src/common/types';
import type { MipsState, Position, DisputeConfig } from '../src/common/types';

describe('Types', () => {
  // ============================================
  // DEFAULT_CONFIG
  // ============================================
  describe('DEFAULT_CONFIG', () => {
    it('should have positive bondAmount', () => {
      expect(DEFAULT_CONFIG.bondAmount > 0n).to.be.true;
    });

    it('should have bondAmount equal to 0.01 ETH', () => {
      expect(DEFAULT_CONFIG.bondAmount).to.equal(BigInt('10000000000000000'));
    });

    it('should have reasonable bisectionTimeout', () => {
      expect(DEFAULT_CONFIG.bisectionTimeout).to.be.greaterThan(0);
      expect(DEFAULT_CONFIG.bisectionTimeout).to.equal(60);
    });

    it('should have reasonable proofTimeout', () => {
      expect(DEFAULT_CONFIG.proofTimeout).to.be.greaterThan(0);
      expect(DEFAULT_CONFIG.proofTimeout).to.equal(3600);
    });

    it('should have maxDepth of 73 (Cannon default)', () => {
      expect(DEFAULT_CONFIG.maxDepth).to.equal(73);
    });

    it('should have all required fields of DisputeConfig', () => {
      const config: DisputeConfig = DEFAULT_CONFIG;
      expect(config).to.have.property('bondAmount');
      expect(config).to.have.property('bisectionTimeout');
      expect(config).to.have.property('proofTimeout');
      expect(config).to.have.property('maxDepth');
    });
  });

  // ============================================
  // Branded types (GameType, Claim)
  // ============================================
  describe('branded types', () => {
    it('should create GameType values', () => {
      const gt = gameType(42);
      expect(gt).to.equal(42);
    });

    it('should define well-known GameTypes', () => {
      expect(GameTypes.CANNON).to.equal(0);
      expect(GameTypes.PERMISSIONED_CANNON).to.equal(1);
      expect(GameTypes.ASTERISC).to.equal(2);
      expect(GameTypes.ZK_CANNON).to.equal(255);
    });

    it('should create Claim values', () => {
      const c = claim('0xabcdef');
      expect(c).to.equal('0xabcdef');
    });
  });

  // ============================================
  // Enums
  // ============================================
  describe('enums', () => {
    it('should have correct GameStatus values', () => {
      expect(GameStatus.IN_PROGRESS).to.equal(0);
      expect(GameStatus.CHALLENGER_WINS).to.equal(1);
      expect(GameStatus.DEFENDER_WINS).to.equal(2);
    });

    it('should have correct VMStatus values', () => {
      expect(VMStatus.VALID).to.equal(0);
      expect(VMStatus.INVALID).to.equal(1);
      expect(VMStatus.PANIC).to.equal(2);
      expect(VMStatus.UNFINISHED).to.equal(3);
    });

    it('should have correct BisectionPhase string values', () => {
      expect(BisectionPhase.IDLE).to.equal('IDLE');
      expect(BisectionPhase.SEQUENCER_TURN).to.equal('SEQUENCER_TURN');
      expect(BisectionPhase.CHALLENGER_TURN).to.equal('CHALLENGER_TURN');
      expect(BisectionPhase.AWAITING_PROOF).to.equal('AWAITING_PROOF');
      expect(BisectionPhase.RESOLVED).to.equal('RESOLVED');
      expect(BisectionPhase.TIMEOUT).to.equal('TIMEOUT');
    });

    it('should have expected MipsOpcode values for R-Type', () => {
      expect(MipsOpcode.ADD).to.equal(0x20);
      expect(MipsOpcode.ADDU).to.equal(0x21);
      expect(MipsOpcode.SLL).to.equal(0x00);
      expect(MipsOpcode.SLT).to.equal(0x2a);
    });

    it('should have expected MipsOpcode values for I-Type', () => {
      expect(MipsOpcode.ADDI).to.equal(0x08);
      expect(MipsOpcode.LW).to.equal(0x23);
      expect(MipsOpcode.SW).to.equal(0x2b);
      expect(MipsOpcode.BEQ).to.equal(0x04);
    });

    it('should have expected MipsOpcode values for J-Type', () => {
      expect(MipsOpcode.J).to.equal(0x02);
      expect(MipsOpcode.JAL).to.equal(0x03);
    });
  });

  // ============================================
  // MipsState shape
  // ============================================
  describe('MipsState shape', () => {
    it('should be constructable with required fields', () => {
      const state: MipsState = {
        pc: 0n,
        nextPC: 4n,
        registers: new Array(32).fill(0n),
        hi: 0n,
        lo: 0n,
        heap: 0n,
        exitCode: 0,
        exited: false,
        step: 0n,
        memoryRoot: '0x' + '00'.repeat(32),
        preimageKey: '0x' + '00'.repeat(32),
        preimageOffset: 0n,
      };
      expect(state.registers).to.have.lengthOf(32);
      expect(typeof state.step).to.equal('bigint');
      expect(typeof state.pc).to.equal('bigint');
    });

    it('should support memWrite optional field', () => {
      const state: MipsState = {
        pc: 0n,
        nextPC: 4n,
        registers: new Array(32).fill(0n),
        hi: 0n,
        lo: 0n,
        heap: 0n,
        exitCode: 0,
        exited: false,
        step: 0n,
        memoryRoot: '0x' + '00'.repeat(32),
        preimageKey: '0x' + '00'.repeat(32),
        preimageOffset: 0n,
        memWrite: { address: 0x1000n, value: 42n, size: 4 },
      };
      expect(state.memWrite).to.not.be.undefined;
      expect(state.memWrite!.size).to.equal(4);
    });
  });

  // ============================================
  // PositionLib
  // ============================================
  describe('PositionLib', () => {
    it('should have ROOT at gindex 1', () => {
      expect(PositionLib.ROOT.gindex).to.equal(1n);
    });

    describe('depth', () => {
      it('should return 0 for root (gindex=1)', () => {
        expect(PositionLib.depth({ gindex: 1n })).to.equal(0);
      });

      it('should return 1 for gindex 2 or 3', () => {
        expect(PositionLib.depth({ gindex: 2n })).to.equal(1);
        expect(PositionLib.depth({ gindex: 3n })).to.equal(1);
      });

      it('should return correct depth for deeper nodes', () => {
        expect(PositionLib.depth({ gindex: 8n })).to.equal(3);
        expect(PositionLib.depth({ gindex: 15n })).to.equal(3);
        expect(PositionLib.depth({ gindex: 16n })).to.equal(4);
      });

      it('should return 0 for gindex 0', () => {
        expect(PositionLib.depth({ gindex: 0n })).to.equal(0);
      });
    });

    describe('indexAtDepth', () => {
      it('should return 0 for root', () => {
        expect(PositionLib.indexAtDepth({ gindex: 1n })).to.equal(0n);
      });

      it('should return correct index for left/right children', () => {
        expect(PositionLib.indexAtDepth({ gindex: 2n })).to.equal(0n);
        expect(PositionLib.indexAtDepth({ gindex: 3n })).to.equal(1n);
      });

      it('should return correct index at depth 3', () => {
        // gindex 8..15 at depth 3, indices 0..7
        expect(PositionLib.indexAtDepth({ gindex: 8n })).to.equal(0n);
        expect(PositionLib.indexAtDepth({ gindex: 11n })).to.equal(3n);
        expect(PositionLib.indexAtDepth({ gindex: 15n })).to.equal(7n);
      });
    });

    describe('left / right / parent', () => {
      it('should compute left child', () => {
        expect(PositionLib.left({ gindex: 1n }).gindex).to.equal(2n);
        expect(PositionLib.left({ gindex: 5n }).gindex).to.equal(10n);
      });

      it('should compute right child', () => {
        expect(PositionLib.right({ gindex: 1n }).gindex).to.equal(3n);
        expect(PositionLib.right({ gindex: 5n }).gindex).to.equal(11n);
      });

      it('should compute parent', () => {
        expect(PositionLib.parent({ gindex: 2n }).gindex).to.equal(1n);
        expect(PositionLib.parent({ gindex: 3n }).gindex).to.equal(1n);
        expect(PositionLib.parent({ gindex: 10n }).gindex).to.equal(5n);
      });
    });

    describe('attack / defend', () => {
      it('should attack = left child', () => {
        const pos: Position = { gindex: 4n };
        expect(PositionLib.attack(pos).gindex).to.equal(PositionLib.left(pos).gindex);
      });

      it('should defend = right child', () => {
        const pos: Position = { gindex: 4n };
        expect(PositionLib.defend(pos).gindex).to.equal(PositionLib.right(pos).gindex);
      });
    });

    describe('traceIndex', () => {
      it('should return correct trace index for root at maxDepth=4', () => {
        // root gindex=1, depth=0, remaining=4
        // (1 << 4) - (1 << 4) = 16 - 16 = 0
        const result = PositionLib.traceIndex({ gindex: 1n }, 4);
        expect(result).to.equal(0n);
      });

      it('should return correct trace index for right child at maxDepth=4', () => {
        // gindex=3, depth=1, remaining=3
        // (3 << 3) - (1 << 4) = 24 - 16 = 8
        const result = PositionLib.traceIndex({ gindex: 3n }, 4);
        expect(result).to.equal(8n);
      });

      it('should return maxIndex for rightmost leaf at maxDepth', () => {
        // At maxDepth=3, rightmost leaf gindex = 2^3 + 7 = 15
        // depth=3, remaining=0
        // (15 << 0) - (1 << 3) = 15 - 8 = 7
        const result = PositionLib.traceIndex({ gindex: 15n }, 3);
        expect(result).to.equal(7n);
      });

      it('should return 0 for leftmost leaf at maxDepth', () => {
        // leftmost leaf at maxDepth=3: gindex=8
        // depth=3, remaining=0
        // (8 << 0) - (1 << 3) = 8 - 8 = 0
        const result = PositionLib.traceIndex({ gindex: 8n }, 3);
        expect(result).to.equal(0n);
      });
    });

    describe('immutability', () => {
      it('should not mutate input position', () => {
        const pos: Position = { gindex: 5n };
        PositionLib.left(pos);
        PositionLib.right(pos);
        PositionLib.parent(pos);
        PositionLib.attack(pos);
        PositionLib.defend(pos);
        expect(pos.gindex).to.equal(5n);
      });
    });
  });
});
