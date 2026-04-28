pragma circom 2.1.0;

include "./mips_alu.circom";

/**
 * Test wrapper for MipsAlu
 */
template TestAlu() {
    signal input opcode;
    signal input a;
    signal input b;
    signal input shamt;
    signal output result;

    component alu = MipsAlu();
    alu.opcode <== opcode;
    alu.a <== a;
    alu.b <== b;
    alu.shamt <== shamt;

    result <== alu.result;
}

component main = TestAlu();
