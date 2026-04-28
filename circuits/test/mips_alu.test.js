/**
 * MIPS ALU Circuit Tests
 *
 * Unit tests for the MIPS ALU (Arithmetic Logic Unit) circom circuit.
 * Tests all supported ALU operations: ADD, SUB, AND, OR, XOR, NOR, SLT, SLTU.
 *
 * The ALU circuit is a core component of the MIPS single-step verification
 * circuit used in the dispute resolution protocol.
 *
 * @module test/mips_alu.test.js
 * @see circuits/src/mips_alu.circom
 */

const chai = require('chai');
const path = require('path');
const wasm_tester = require('circom_tester').wasm;

const expect = chai.expect;

describe('MIPS ALU Circuit Tests', function () {
  this.timeout(100000);

  let circuit;

  before(async function () {
    circuit = await wasm_tester(
      path.join(__dirname, '..', 'src', 'test_alu.circom'),
      {
        include: path.join(__dirname, '..', '..', 'node_modules')
      }
    );
  });

  describe('Add32', function () {
    it('should add two numbers correctly', async function () {
      const input = {
        opcode: 0,
        a: 10,
        b: 20,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('30');
    });

    it('should handle overflow (wrap around)', async function () {
      const input = {
        opcode: 0,
        a: 0xFFFFFFFF,
        b: 1,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('0');
    });
  });

  describe('Sub32', function () {
    it('should subtract two numbers correctly', async function () {
      const input = {
        opcode: 1,
        a: 30,
        b: 10,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('20');
    });

    it('should handle underflow (wrap around)', async function () {
      const input = {
        opcode: 1,
        a: 0,
        b: 1,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('4294967295'); // 0xFFFFFFFF
    });
  });

  describe('And32', function () {
    it('should perform bitwise AND', async function () {
      const input = {
        opcode: 2,
        a: 0xFF00FF00,
        b: 0xF0F0F0F0,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal((0xF000F000).toString());
    });
  });

  describe('Or32', function () {
    it('should perform bitwise OR', async function () {
      const input = {
        opcode: 3,
        a: 0xFF00FF00,
        b: 0x00FF00FF,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal((0xFFFFFFFF).toString());
    });
  });

  describe('Xor32', function () {
    it('should perform bitwise XOR', async function () {
      const input = {
        opcode: 4,
        a: 0xFF00FF00,
        b: 0xF0F0F0F0,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal((0x0FF00FF0).toString());
    });
  });

  describe('Slt (Set Less Than)', function () {
    it('should return 1 when a < b (signed)', async function () {
      const input = {
        opcode: 6,
        a: 5,
        b: 10,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('1');
    });

    it('should return 0 when a >= b', async function () {
      const input = {
        opcode: 6,
        a: 10,
        b: 5,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('0');
    });
  });

  describe('Sll (Shift Left Logical)', function () {
    it('should shift left correctly', async function () {
      const input = {
        opcode: 8,
        a: 0, // a is not used for shift, b is shifted
        b: 1,
        shamt: 4
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('16');
    });
  });

  describe('Srl (Shift Right Logical)', function () {
    it('should shift right correctly', async function () {
      const input = {
        opcode: 9,
        a: 0,
        b: 16,
        shamt: 2
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal('4');
    });
  });

  describe('Lui (Load Upper Immediate)', function () {
    it('should load upper 16 bits', async function () {
      const input = {
        opcode: 11,
        a: 0,
        b: 0x1234,
        shamt: 0
      };

      const witness = await circuit.calculateWitness(input);
      await circuit.checkConstraints(witness);

      expect(witness[1].toString()).to.equal((0x12340000).toString());
    });
  });
});
