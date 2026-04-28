pragma circom 2.1.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";
include "circomlib/circuits/mux1.circom";

/**
 * @title MIPS ALU Operations
 * @notice MIPS 32비트 ALU 연산 회로
 * @dev Cannon FPVM과 호환되는 MIPS ALU 구현
 *
 * ALU Opcode 매핑:
 * 0: ADD/ADDU  1: SUB/SUBU  2: AND   3: OR
 * 4: XOR       5: NOR       6: SLT   7: SLTU
 * 8: SLL       9: SRL       10: SRA  11: LUI
 */

/**
 * 32비트 덧셈 회로
 */
template Add32() {
    signal input a;
    signal input b;
    signal output out;
    signal output overflow;

    // Input range validation (32비트)
    component aBits = Num2Bits(32);
    component bBits = Num2Bits(32);
    aBits.in <== a;
    bBits.in <== b;

    // 33비트 덧셈으로 오버플로우 캡처
    signal sum;
    sum <== a + b;

    // 결과 분리
    component sumBits = Num2Bits(33);
    sumBits.in <== sum;

    // 하위 32비트가 결과
    component outBits = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        outBits.in[i] <== sumBits.out[i];
    }
    out <== outBits.out;

    // bit 32가 오버플로우
    overflow <== sumBits.out[32];
}

/**
 * 32비트 뺄셈 회로
 */
template Sub32() {
    signal input a;
    signal input b;
    signal output out;
    signal output underflow;

    // Input range validation
    component aBits = Num2Bits(32);
    component bBits = Num2Bits(32);
    aBits.in <== a;
    bBits.in <== b;

    // 언더플로우 감지
    component lt = LessThan(32);
    lt.in[0] <== a;
    lt.in[1] <== b;
    underflow <== lt.out;

    // 결과 계산 (2의 보수)
    signal diff;
    diff <== a - b + 4294967296; // 음수 방지

    component diffBits = Num2Bits(33);
    diffBits.in <== diff;

    component outBits = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        outBits.in[i] <== diffBits.out[i];
    }
    out <== outBits.out;
}

/**
 * 32비트 비트 AND 회로
 */
template And32() {
    signal input a;
    signal input b;
    signal output out;

    component aBits = Num2Bits(32);
    component bBits = Num2Bits(32);
    aBits.in <== a;
    bBits.in <== b;

    component andGates[32];
    signal outBits[32];

    for (var i = 0; i < 32; i++) {
        andGates[i] = AND();
        andGates[i].a <== aBits.out[i];
        andGates[i].b <== bBits.out[i];
        outBits[i] <== andGates[i].out;
    }

    component toNum = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        toNum.in[i] <== outBits[i];
    }
    out <== toNum.out;
}

/**
 * 32비트 비트 OR 회로
 */
template Or32() {
    signal input a;
    signal input b;
    signal output out;

    component aBits = Num2Bits(32);
    component bBits = Num2Bits(32);
    aBits.in <== a;
    bBits.in <== b;

    component orGates[32];
    signal outBits[32];

    for (var i = 0; i < 32; i++) {
        orGates[i] = OR();
        orGates[i].a <== aBits.out[i];
        orGates[i].b <== bBits.out[i];
        outBits[i] <== orGates[i].out;
    }

    component toNum = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        toNum.in[i] <== outBits[i];
    }
    out <== toNum.out;
}

/**
 * 32비트 비트 XOR 회로
 */
template Xor32() {
    signal input a;
    signal input b;
    signal output out;

    component aBits = Num2Bits(32);
    component bBits = Num2Bits(32);
    aBits.in <== a;
    bBits.in <== b;

    component xorGates[32];
    signal outBits[32];

    for (var i = 0; i < 32; i++) {
        xorGates[i] = XOR();
        xorGates[i].a <== aBits.out[i];
        xorGates[i].b <== bBits.out[i];
        outBits[i] <== xorGates[i].out;
    }

    component toNum = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        toNum.in[i] <== outBits[i];
    }
    out <== toNum.out;
}

/**
 * 32비트 비트 NOR 회로
 */
template Nor32() {
    signal input a;
    signal input b;
    signal output out;

    component orOp = Or32();
    orOp.a <== a;
    orOp.b <== b;

    // NOT: XOR with all 1s
    component notOp = Xor32();
    notOp.a <== orOp.out;
    notOp.b <== 4294967295; // 0xFFFFFFFF
    out <== notOp.out;
}

/**
 * Set Less Than (부호 없음)
 */
template Sltu() {
    signal input a;
    signal input b;
    signal output out;

    component lt = LessThan(32);
    lt.in[0] <== a;
    lt.in[1] <== b;
    out <== lt.out;
}

/**
 * Set Less Than (부호 있음)
 * 2의 보수 비교
 */
template Slt() {
    signal input a;
    signal input b;
    signal output out;

    // 부호 비트 추출
    component aBits = Num2Bits(32);
    component bBits = Num2Bits(32);
    aBits.in <== a;
    bBits.in <== b;

    signal aSign, bSign;
    aSign <== aBits.out[31];
    bSign <== bBits.out[31];

    // 부호가 다른 경우: a가 음수(sign=1)이면 a < b
    // 부호가 같은 경우: 부호 없는 비교와 동일
    component lt = LessThan(32);
    lt.in[0] <== a;
    lt.in[1] <== b;

    // a가 음수이고 b가 양수면 a < b (out = 1)
    // a가 양수이고 b가 음수면 a > b (out = 0)
    // 부호 같으면 부호 없는 비교
    signal sameSign;
    component signEq = IsEqual();
    signEq.in[0] <== aSign;
    signEq.in[1] <== bSign;
    sameSign <== signEq.out;

    // 중간 신호로 분리 (이차 제약 유지)
    signal term1;
    signal term2;
    signal notSameSign;

    term1 <== sameSign * lt.out;
    notSameSign <== 1 - sameSign;
    term2 <== notSameSign * aSign;

    out <== term1 + term2;
}

/**
 * Shift Left Logical (SLL)
 * Simplified version - supports shift amount 0-31
 */
template Sll() {
    signal input a;
    signal input shamt; // 0-31
    signal output out;

    // Input range validation
    component aBits = Num2Bits(32);
    aBits.in <== a;

    // Verify shamt is in 5-bit range
    component shamtBits = Num2Bits(5);
    shamtBits.in <== shamt;

    // Calculate 2^shamt - constant array
    signal powers[32];
    powers[0] <== 1;
    for (var i = 1; i < 32; i++) {
        powers[i] <== powers[i-1] * 2;
    }

    // Shift amount selection based on shamt
    // All components declared at top level
    component shamtEq[32];
    signal selected[32];
    signal sumShamt[32];

    for (var i = 0; i < 32; i++) {
        shamtEq[i] = IsEqual();
        shamtEq[i].in[0] <== shamt;
        shamtEq[i].in[1] <== i;
        selected[i] <== shamtEq[i].out * powers[i];
    }

    sumShamt[0] <== selected[0];
    for (var i = 1; i < 32; i++) {
        sumShamt[i] <== sumShamt[i-1] + selected[i];
    }

    signal multiplier;
    multiplier <== sumShamt[31];

    // 32-bit masking after multiplication
    signal product;
    product <== a * multiplier;

    component productBits = Num2Bits(64);
    productBits.in <== product;

    component outBits = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        outBits.in[i] <== productBits.out[i];
    }
    out <== outBits.out;
}

/**
 * Shift Right Logical (SRL)
 * Simplified version - division method
 */
template Srl() {
    signal input a;
    signal input shamt;
    signal output out;

    component aBits = Num2Bits(32);
    aBits.in <== a;

    component shamtBits = Num2Bits(5);
    shamtBits.in <== shamt;

    // Calculate 2^shamt (for division)
    signal divisors[32];
    divisors[0] <== 1;
    for (var i = 1; i < 32; i++) {
        divisors[i] <== divisors[i-1] * 2;
    }

    // Division value selection based on shamt
    component shamtEqSrl[32];
    signal selectedDiv[32];
    signal sumDiv[32];

    for (var i = 0; i < 32; i++) {
        shamtEqSrl[i] = IsEqual();
        shamtEqSrl[i].in[0] <== shamt;
        shamtEqSrl[i].in[1] <== i;
        selectedDiv[i] <== shamtEqSrl[i].out * divisors[i];
    }

    sumDiv[0] <== selectedDiv[0];
    for (var i = 1; i < 32; i++) {
        sumDiv[i] <== sumDiv[i-1] + selectedDiv[i];
    }

    signal divisor;
    divisor <== sumDiv[31];

    // a / 2^shamt (integer division)
    out <-- a \ divisor;

    // Verify: out * divisor <= a < (out+1) * divisor
    signal product;
    product <== out * divisor;

    component leq = LessEqThan(32);
    leq.in[0] <== product;
    leq.in[1] <== a;
    leq.out === 1;

    component lt = LessThan(33);
    lt.in[0] <== a;
    lt.in[1] <== product + divisor;
    lt.out === 1;
}

/**
 * Shift Right Arithmetic (SRA)
 * Fills upper bits with sign bit
 */
template Sra() {
    signal input a;
    signal input shamt;
    signal output out;

    component aBits = Num2Bits(32);
    aBits.in <== a;

    signal signBit;
    signBit <== aBits.out[31];

    component shamtBits = Num2Bits(5);
    shamtBits.in <== shamt;

    // Calculate SRL result (logical shift)
    component srl = Srl();
    srl.a <== a;
    srl.shamt <== shamt;

    // Calculate sign extension mask
    // For negative numbers, upper bits must be filled with 1
    // mask = signBit ? (0xFFFFFFFF << (32 - shamt)) : 0
    // 간소화: signBit * (2^32 - 2^(32-shamt))

    // Calculate 2^(32-shamt)
    signal invDivisors[32];
    invDivisors[0] <== 4294967296; // 2^32
    for (var i = 1; i < 32; i++) {
        invDivisors[i] <== invDivisors[i-1] / 2;
    }

    component shamtEqSra[32];
    signal selectedMask[32];
    signal sumMask[32];

    for (var i = 0; i < 32; i++) {
        shamtEqSra[i] = IsEqual();
        shamtEqSra[i].in[0] <== shamt;
        shamtEqSra[i].in[1] <== i;

        // mask value = 0xFFFFFFFF - (2^(32-i) - 1) = 2^32 - 2^(32-i)
        // For i=0: mask = 0
        // For i=1: mask = 0x80000000
        // etc.
        if (i == 0) {
            selectedMask[i] <== 0;
        } else {
            selectedMask[i] <== shamtEqSra[i].out * (4294967296 - invDivisors[i]);
        }
    }

    sumMask[0] <== selectedMask[0];
    for (var i = 1; i < 32; i++) {
        sumMask[i] <== sumMask[i-1] + selectedMask[i];
    }

    signal signExtMask;
    signExtMask <== sumMask[31] * signBit;

    // Result = SRL result | sign extension mask
    component orResult = Or32();
    orResult.a <== srl.out;
    orResult.b <== signExtMask;

    out <== orResult.out;
}

/**
 * Load Upper Immediate
 * imm << 16
 */
template Lui() {
    signal input imm;
    signal output out;

    // 16-bit range validation
    component immBits = Num2Bits(16);
    immBits.in <== imm;

    // 16-bit left shift
    out <== imm * 65536; // 2^16
}

/**
 * MIPS ALU Integrated Circuit
 * @input opcode ALU operation code (0-11)
 * @input a Operand A (or rt for shifts)
 * @input b Operand B (or immediate)
 * @input shamt Shift amount (for shift instructions)
 * @output result Operation result
 */
template MipsAlu() {
    signal input opcode; // 0-11
    signal input a;
    signal input b;
    signal input shamt;
    signal output result;

    // Perform all operations
    component add = Add32();
    add.a <== a;
    add.b <== b;

    component sub = Sub32();
    sub.a <== a;
    sub.b <== b;

    component andOp = And32();
    andOp.a <== a;
    andOp.b <== b;

    component orOp = Or32();
    orOp.a <== a;
    orOp.b <== b;

    component xorOp = Xor32();
    xorOp.a <== a;
    xorOp.b <== b;

    component norOp = Nor32();
    norOp.a <== a;
    norOp.b <== b;

    component slt = Slt();
    slt.a <== a;
    slt.b <== b;

    component sltu = Sltu();
    sltu.a <== a;
    sltu.b <== b;

    component sll = Sll();
    sll.a <== b; // rt is shift target
    sll.shamt <== shamt;

    component srl = Srl();
    srl.a <== b;
    srl.shamt <== shamt;

    component sra = Sra();
    sra.a <== b;
    sra.shamt <== shamt;

    component lui = Lui();
    lui.imm <== b;

    // 결과 배열
    signal results[12];
    results[0] <== add.out;     // ADD/ADDU
    results[1] <== sub.out;     // SUB/SUBU
    results[2] <== andOp.out;   // AND
    results[3] <== orOp.out;    // OR
    results[4] <== xorOp.out;   // XOR
    results[5] <== norOp.out;   // NOR
    results[6] <== slt.out;     // SLT
    results[7] <== sltu.out;    // SLTU
    results[8] <== sll.out;     // SLL
    results[9] <== srl.out;     // SRL
    results[10] <== sra.out;    // SRA
    results[11] <== lui.out;    // LUI

    // Opcode에 따른 결과 선택
    component opcodeEq[12];
    signal selectedResult[12];
    signal sumResult[12];

    for (var i = 0; i < 12; i++) {
        opcodeEq[i] = IsEqual();
        opcodeEq[i].in[0] <== opcode;
        opcodeEq[i].in[1] <== i;
        selectedResult[i] <== opcodeEq[i].out * results[i];
    }

    sumResult[0] <== selectedResult[0];
    for (var i = 1; i < 12; i++) {
        sumResult[i] <== sumResult[i-1] + selectedResult[i];
    }

    result <== sumResult[11];
}
