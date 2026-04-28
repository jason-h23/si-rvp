pragma circom 2.1.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/gates.circom";

/**
 * @title MIPS Utility Circuits
 * @notice Utility circuits for MUX, sign extension, range checking, etc.
 * @dev circom 2.x compatible
 */

/**
 * N-to-1 Multiplexer
 * @param n Number of inputs
 * @input in[n] n inputs
 * @input sel Selector (0 ~ n-1)
 * @output out Selected input
 */
template Mux(n) {
    signal input in[n];
    signal input sel;
    signal output out;

    // Verify selector is within range
    component ltCheck = LessThan(8);
    ltCheck.in[0] <== sel;
    ltCheck.in[1] <== n;
    ltCheck.out === 1;

    // All components declared at top level
    component eqChecks[n];
    signal isSelected[n];
    signal products[n];
    signal sums[n];

    for (var i = 0; i < n; i++) {
        eqChecks[i] = IsEqual();
        eqChecks[i].in[0] <== sel;
        eqChecks[i].in[1] <== i;
        isSelected[i] <== eqChecks[i].out;
        products[i] <== in[i] * isSelected[i];
    }

    sums[0] <== products[0];
    for (var i = 1; i < n; i++) {
        sums[i] <== sums[i-1] + products[i];
    }

    out <== sums[n-1];
}

/**
 * 32-entry Register File MUX
 * Select one of 32 registers
 */
template RegMux() {
    signal input regs[32];
    signal input sel;
    signal output out;

    component mux = Mux(32);
    for (var i = 0; i < 32; i++) {
        mux.in[i] <== regs[i];
    }
    mux.sel <== sel;
    out <== mux.out;
}

/**
 * 16-bit Sign Extension (to 32-bit)
 * @input in 16-bit value
 * @output out 32-bit sign-extended value
 */
template SignExtend16() {
    signal input in;
    signal output out;

    // 16-bit range validation
    component bits = Num2Bits(16);
    bits.in <== in;

    // Sign bit (bit 15)
    signal signBit;
    signBit <== bits.out[15];

    // Sign extension: if signBit is 1, fill upper 16 bits with 1
    // out = in + signBit * 0xFFFF0000
    out <== in + signBit * 4294901760; // 0xFFFF0000 = 4294901760
}

/**
 * 8-bit Sign Extension (to 32-bit)
 */
template SignExtend8() {
    signal input in;
    signal output out;

    component bits = Num2Bits(8);
    bits.in <== in;

    signal signBit;
    signBit <== bits.out[7];

    // out = in + signBit * 0xFFFFFF00
    out <== in + signBit * 4294967040; // 0xFFFFFF00
}

/**
 * 32-bit Range Validation
 */
template Range32() {
    signal input in;
    signal output valid;

    component lt = LessThan(33);
    lt.in[0] <== in;
    lt.in[1] <== 4294967296; // 2^32
    valid <== lt.out;
}

/**
 * Conditional Select
 * @input cond Condition (0 or 1)
 * @input ifTrue Selected when cond=1
 * @input ifFalse Selected when cond=0
 * @output out Selected value
 */
template Select() {
    signal input cond;
    signal input ifTrue;
    signal input ifFalse;
    signal output out;

    // Verify cond is 0 or 1
    cond * (cond - 1) === 0;

    // out = cond * ifTrue + (1 - cond) * ifFalse
    // = cond * (ifTrue - ifFalse) + ifFalse
    out <== cond * (ifTrue - ifFalse) + ifFalse;
}

/**
 * Conditional Register Update
 * Update only rd register, keep others unchanged
 */
template ConditionalRegUpdate() {
    signal input oldRegs[32];
    signal input newValue;
    signal input rd;
    signal input writeEnable;
    signal output newRegs[32];

    component selects[32];
    component eqs[32];
    signal shouldUpdate[32];

    for (var i = 0; i < 32; i++) {
        // i == rd 이고 writeEnable이 1이면 newValue, 아니면 oldRegs[i]
        eqs[i] = IsEqual();
        eqs[i].in[0] <== rd;
        eqs[i].in[1] <== i;

        shouldUpdate[i] <== eqs[i].out * writeEnable;

        selects[i] = Select();
        selects[i].cond <== shouldUpdate[i];
        selects[i].ifTrue <== newValue;
        selects[i].ifFalse <== oldRegs[i];

        // $0는 항상 0
        if (i == 0) {
            newRegs[i] <== 0;
        } else {
            newRegs[i] <== selects[i].out;
        }
    }
}

/**
 * Instruction Type Detection
 * @input opcode 6-bit opcode
 * @output isRType opcode == 0 (SPECIAL)
 * @output isJType opcode == 2 or 3 (J, JAL)
 * @output isIType Otherwise
 */
template InstructionType() {
    signal input opcode;
    signal output isRType;
    signal output isJType;
    signal output isIType;

    // R-Type: opcode == 0
    component rCheck = IsZero();
    rCheck.in <== opcode;
    isRType <== rCheck.out;

    // J-Type: opcode == 2 or opcode == 3
    component jCheck2 = IsEqual();
    jCheck2.in[0] <== opcode;
    jCheck2.in[1] <== 2;

    component jCheck3 = IsEqual();
    jCheck3.in[0] <== opcode;
    jCheck3.in[1] <== 3;

    // isJType = jCheck2.out OR jCheck3.out
    // OR(a,b) = a + b - a*b
    signal jOr;
    jOr <== jCheck2.out * jCheck3.out;
    isJType <== jCheck2.out + jCheck3.out - jOr;

    // I-Type: 나머지 (1 - isRType - isJType + isRType*isJType)
    // Since R and J are mutually exclusive, simplify:
    isIType <== 1 - isRType - isJType;
}

/**
 * ALU opcode 매핑 (R-Type)
 * funct 필드를 ALU opcode로 변환
 */
template FunctToAluOp() {
    signal input funct;
    signal output aluOp;

    // funct 값에 따른 ALU 연산 매핑 테이블
    // 12개의 매핑 체크
    component eqs[12];
    signal matches[12];
    signal mappingValues[12];
    signal products[12];
    signal sums[12];

    // ADD (32) / ADDU (33) -> 0
    eqs[0] = IsEqual(); eqs[0].in[0] <== funct; eqs[0].in[1] <== 32;
    component eq0b = IsEqual(); eq0b.in[0] <== funct; eq0b.in[1] <== 33;
    matches[0] <== eqs[0].out + eq0b.out;
    mappingValues[0] <== 0;

    // SUB (34) / SUBU (35) -> 1
    eqs[1] = IsEqual(); eqs[1].in[0] <== funct; eqs[1].in[1] <== 34;
    component eq1b = IsEqual(); eq1b.in[0] <== funct; eq1b.in[1] <== 35;
    matches[1] <== eqs[1].out + eq1b.out;
    mappingValues[1] <== 1;

    // AND (36) -> 2
    eqs[2] = IsEqual(); eqs[2].in[0] <== funct; eqs[2].in[1] <== 36;
    matches[2] <== eqs[2].out;
    mappingValues[2] <== 2;

    // OR (37) -> 3
    eqs[3] = IsEqual(); eqs[3].in[0] <== funct; eqs[3].in[1] <== 37;
    matches[3] <== eqs[3].out;
    mappingValues[3] <== 3;

    // XOR (38) -> 4
    eqs[4] = IsEqual(); eqs[4].in[0] <== funct; eqs[4].in[1] <== 38;
    matches[4] <== eqs[4].out;
    mappingValues[4] <== 4;

    // NOR (39) -> 5
    eqs[5] = IsEqual(); eqs[5].in[0] <== funct; eqs[5].in[1] <== 39;
    matches[5] <== eqs[5].out;
    mappingValues[5] <== 5;

    // SLT (42) -> 6
    eqs[6] = IsEqual(); eqs[6].in[0] <== funct; eqs[6].in[1] <== 42;
    matches[6] <== eqs[6].out;
    mappingValues[6] <== 6;

    // SLTU (43) -> 7
    eqs[7] = IsEqual(); eqs[7].in[0] <== funct; eqs[7].in[1] <== 43;
    matches[7] <== eqs[7].out;
    mappingValues[7] <== 7;

    // SLL (0) / SLLV (4) -> 8
    eqs[8] = IsEqual(); eqs[8].in[0] <== funct; eqs[8].in[1] <== 0;
    component eq8b = IsEqual(); eq8b.in[0] <== funct; eq8b.in[1] <== 4;
    matches[8] <== eqs[8].out + eq8b.out;
    mappingValues[8] <== 8;

    // SRL (2) / SRLV (6) -> 9
    eqs[9] = IsEqual(); eqs[9].in[0] <== funct; eqs[9].in[1] <== 2;
    component eq9b = IsEqual(); eq9b.in[0] <== funct; eq9b.in[1] <== 6;
    matches[9] <== eqs[9].out + eq9b.out;
    mappingValues[9] <== 9;

    // SRA (3) -> 10
    eqs[10] = IsEqual(); eqs[10].in[0] <== funct; eqs[10].in[1] <== 3;
    matches[10] <== eqs[10].out;
    mappingValues[10] <== 10;

    // Default -> 0 (always matches)
    matches[11] <== 1;
    mappingValues[11] <== 0;

    // 결과 합산
    for (var i = 0; i < 12; i++) {
        products[i] <== matches[i] * mappingValues[i];
    }

    sums[0] <== products[0];
    for (var i = 1; i < 12; i++) {
        sums[i] <== sums[i-1] + products[i];
    }

    aluOp <== sums[11];
}

/**
 * I-Type opcode to ALU operation mapping
 * @input opcode 6-bit I-Type opcode
 * @output aluOp ALU operation code
 *
 * Mapping:
 * 8  (ADDI)  -> 0 (ADD)
 * 9  (ADDIU) -> 0 (ADD)
 * 10 (SLTI)  -> 6 (SLT)
 * 11 (SLTIU) -> 7 (SLTU)
 * 12 (ANDI)  -> 2 (AND)
 * 13 (ORI)   -> 3 (OR)
 * 14 (XORI)  -> 4 (XOR)
 * 15 (LUI)   -> 11 (LUI)
 * default    -> 0 (ADD)
 */
template OpcodeToAluOp() {
    signal input opcode;
    signal output aluOp;

    component eqs[8];
    signal matches[9];
    signal mappingValues[9];
    signal products[9];
    signal sums[9];

    // ADDI (8) -> 0
    eqs[0] = IsEqual(); eqs[0].in[0] <== opcode; eqs[0].in[1] <== 8;
    matches[0] <== eqs[0].out;
    mappingValues[0] <== 0;

    // ADDIU (9) -> 0
    eqs[1] = IsEqual(); eqs[1].in[0] <== opcode; eqs[1].in[1] <== 9;
    matches[1] <== eqs[1].out;
    mappingValues[1] <== 0;

    // SLTI (10) -> 6
    eqs[2] = IsEqual(); eqs[2].in[0] <== opcode; eqs[2].in[1] <== 10;
    matches[2] <== eqs[2].out;
    mappingValues[2] <== 6;

    // SLTIU (11) -> 7
    eqs[3] = IsEqual(); eqs[3].in[0] <== opcode; eqs[3].in[1] <== 11;
    matches[3] <== eqs[3].out;
    mappingValues[3] <== 7;

    // ANDI (12) -> 2
    eqs[4] = IsEqual(); eqs[4].in[0] <== opcode; eqs[4].in[1] <== 12;
    matches[4] <== eqs[4].out;
    mappingValues[4] <== 2;

    // ORI (13) -> 3
    eqs[5] = IsEqual(); eqs[5].in[0] <== opcode; eqs[5].in[1] <== 13;
    matches[5] <== eqs[5].out;
    mappingValues[5] <== 3;

    // XORI (14) -> 4
    eqs[6] = IsEqual(); eqs[6].in[0] <== opcode; eqs[6].in[1] <== 14;
    matches[6] <== eqs[6].out;
    mappingValues[6] <== 4;

    // LUI (15) -> 11
    eqs[7] = IsEqual(); eqs[7].in[0] <== opcode; eqs[7].in[1] <== 15;
    matches[7] <== eqs[7].out;
    mappingValues[7] <== 11;

    // Default -> 0 (always matches)
    matches[8] <== 1;
    mappingValues[8] <== 0;

    for (var i = 0; i < 9; i++) {
        products[i] <== matches[i] * mappingValues[i];
    }

    sums[0] <== products[0];
    for (var i = 1; i < 9; i++) {
        sums[i] <== sums[i-1] + products[i];
    }

    aluOp <== sums[8];
}

/**
 * Zero-extended immediate detection
 * @input opcode 6-bit opcode
 * @output out 1 if opcode requires zero-extended immediate (ANDI=12, ORI=13, XORI=14, LUI=15), else 0
 */
template IsZeroExtImm() {
    signal input opcode;
    signal output out;

    component eq12 = IsEqual(); eq12.in[0] <== opcode; eq12.in[1] <== 12;
    component eq13 = IsEqual(); eq13.in[0] <== opcode; eq13.in[1] <== 13;
    component eq14 = IsEqual(); eq14.in[0] <== opcode; eq14.in[1] <== 14;
    component eq15 = IsEqual(); eq15.in[0] <== opcode; eq15.in[1] <== 15;

    // OR of 4 values: sum works because at most one matches
    out <== eq12.out + eq13.out + eq14.out + eq15.out;
}
