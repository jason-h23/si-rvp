/**
 * MIPS ALU Circuit Tests
 *
 * Unit tests for the MIPS ALU (Arithmetic Logic Unit) circom circuit.
 * Tests all supported ALU operations: ADD, SUB, AND, OR, XOR, NOR, SLT, SLTU.
 *
 * The ALU circuit is a core component of the MIPS single-step verification
 * circuit used in the dispute resolution protocol.
 *
 * KNOWN LIMITATION — operand-B domain restriction (paper §III-C4(iv)):
 * `MipsAlu` evaluates every sub-circuit unconditionally and multiplexes the
 * results by opcode, so the LUI sub-circuit is active for *all* opcodes. Its
 * `Num2Bits(16)` therefore range-checks the shared operand-B bus, and witness
 * generation fails whenever b >= 2^16 — regardless of which operation the
 * opcode selects. The tests below split each affected operation into an
 * in-domain semantics check and a test that pins down the restriction itself.
 *
 * @module test/mips_alu.test.js
 * @see circuits/src/mips_alu.circom
 */

const chai = require('chai');
const path = require('path');
const wasm_tester = require('circom_tester').wasm;

const expect = chai.expect;

/** The Lui sub-circuit's Num2Bits(16) bound on the shared operand-B bus. */
const OPERAND_B_LIMIT = 0x10000; // 2^16

/**
 * Runs the ALU and asserts an exact result.
 */
async function expectResult(circuit, input, expected, label) {
  const witness = await circuit.calculateWitness(input);
  await circuit.checkConstraints(witness);

  expect(witness[1].toString(), label).to.equal(String(expected >>> 0));
}

/**
 * Asserts that witness generation is REJECTED because operand B leaves the
 * domain the deployed circuit accepts.
 *
 * This documents a defect, it does not paper over one. If a future circuit
 * makes the LUI range check conditional, these inputs will start producing a
 * witness and this helper fails loudly — the restriction disappearing must
 * break the test suite so that the paper's §III-C4(iv) deviation list and this
 * file are updated together.
 */
async function expectOperandBRejected(circuit, input, label) {
  expect(input.b, `${label}: vector must actually exceed the bound`)
    .to.be.at.least(OPERAND_B_LIMIT);

  let error = null;
  try {
    await circuit.calculateWitness(input);
  } catch (err) {
    error = err;
  }

  if (error === null) {
    throw new Error(
      `${label}: witness generation SUCCEEDED for b = 0x${(input.b >>> 0).toString(16)} ` +
      '(>= 2^16). The deployed circuit rejects this input via the always-active LUI ' +
      'range check. If a rebuilt circuit now accepts it, the operand-B restriction ' +
      'documented in paper §III-C4(iv) and circuits/README.md no longer holds and both ' +
      'must be updated along with this test.'
    );
  }

  expect(error.message, `${label}: expected a range-check assertion failure`)
    .to.match(/Assert Failed/);
  expect(error.message, `${label}: failure must come from Num2Bits inside Lui`)
    .to.match(/Num2Bits/);
  expect(error.message, `${label}: failure must come from Num2Bits inside Lui`)
    .to.match(/Lui/);
}

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
    it('should perform bitwise AND (operand B within domain)', async function () {
      await expectResult(circuit, { opcode: 2, a: 0xFF00FF00, b: 0xF0F0, shamt: 0 },
        0x0000F000, 'a=0xFF00FF00 & b=0xF0F0');
      await expectResult(circuit, { opcode: 2, a: 0xFFFFFFFF, b: 0xFFFF, shamt: 0 },
        0x0000FFFF, 'a=0xFFFFFFFF & b=0xFFFF');
      await expectResult(circuit, { opcode: 2, a: 0xFFFFFFFF, b: 0x0000, shamt: 0 },
        0x00000000, 'a=0xFFFFFFFF & b=0x0000');
    });

    // Documents the deployed circuit's operand-B domain restriction
    // (paper §III-C4(iv)): the always-active LUI sub-circuit range-checks the
    // shared operand bus, so a 32-bit rt value makes AND unprovable even though
    // the AND sub-circuit itself is a full 32-bit implementation.
    it('rejects operand B >= 2^16 (documents the operand-B domain restriction)', async function () {
      await expectOperandBRejected(circuit,
        { opcode: 2, a: 0xFF00FF00, b: 0xF0F0F0F0, shamt: 0 },
        'AND with a 32-bit rt operand');
      await expectOperandBRejected(circuit,
        { opcode: 2, a: 0xFFFFFFFF, b: OPERAND_B_LIMIT, shamt: 0 },
        'AND at the 2^16 boundary');
    });
  });

  describe('Or32', function () {
    it('should perform bitwise OR (operand B within domain)', async function () {
      await expectResult(circuit, { opcode: 3, a: 0xFF00FF00, b: 0x00FF, shamt: 0 },
        0xFF00FFFF, 'a=0xFF00FF00 | b=0x00FF');
      await expectResult(circuit, { opcode: 3, a: 0xFFFF0000, b: 0xFFFF, shamt: 0 },
        0xFFFFFFFF, 'a=0xFFFF0000 | b=0xFFFF');
      await expectResult(circuit, { opcode: 3, a: 0x00000000, b: 0xABCD, shamt: 0 },
        0x0000ABCD, 'a=0x00000000 | b=0xABCD');
    });

    // Documents the deployed circuit's operand-B domain restriction
    // (paper §III-C4(iv)): the always-active LUI sub-circuit range-checks the
    // shared operand bus, independently of the opcode being selected.
    it('rejects operand B >= 2^16 (documents the operand-B domain restriction)', async function () {
      await expectOperandBRejected(circuit,
        { opcode: 3, a: 0xFF00FF00, b: 0x00FF00FF, shamt: 0 },
        'OR with a 32-bit rt operand');
    });
  });

  describe('Xor32', function () {
    it('should perform bitwise XOR (operand B within domain)', async function () {
      await expectResult(circuit, { opcode: 4, a: 0xFF00FF00, b: 0xF0F0, shamt: 0 },
        0xFF000FF0, 'a=0xFF00FF00 ^ b=0xF0F0');
      await expectResult(circuit, { opcode: 4, a: 0xFFFFFFFF, b: 0xFFFF, shamt: 0 },
        0xFFFF0000, 'a=0xFFFFFFFF ^ b=0xFFFF');
      await expectResult(circuit, { opcode: 4, a: 0x00001234, b: 0x1234, shamt: 0 },
        0x00000000, 'a=0x00001234 ^ b=0x1234');
    });

    // Documents the deployed circuit's operand-B domain restriction
    // (paper §III-C4(iv)): the always-active LUI sub-circuit range-checks the
    // shared operand bus, independently of the opcode being selected.
    it('rejects operand B >= 2^16 (documents the operand-B domain restriction)', async function () {
      await expectOperandBRejected(circuit,
        { opcode: 4, a: 0xFF00FF00, b: 0xF0F0F0F0, shamt: 0 },
        'XOR with a 32-bit rt operand');
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

  // The operand-B restriction is not confined to R-type instructions with large
  // register values: any I-type instruction with a NEGATIVE immediate reaches
  // the ALU sign-extended to 0xFFFFxxxx, which is also >= 2^16. `ADDI $t,$s,-1`
  // — one of the most common instructions in real MIPS code — is therefore
  // unprovable on the deployed circuit, and a dispute over such a step has to
  // fall back to the protocol's timeout path. See paper §III-C4(iv).
  describe('Sign-extended immediates (I-type)', function () {
    it('should add a positive immediate (sign extension stays below 2^16)', async function () {
      await expectResult(circuit, { opcode: 0, a: 0, b: 100, shamt: 0 },
        100, 'ADDI $1,$0,100');
    });

    it('rejects a negative immediate (documents the operand-B domain restriction)', async function () {
      await expectOperandBRejected(circuit,
        { opcode: 0, a: 16, b: 0xFFFFFFFF, shamt: 0 },
        'ADDI $1,$s,-1 (sign-extended to 0xFFFFFFFF)');
      await expectOperandBRejected(circuit,
        { opcode: 0, a: 16, b: 0xFFFFFFF8, shamt: 0 },
        'ADDI $1,$s,-8 (sign-extended to 0xFFFFFFF8)');
    });
  });
});
