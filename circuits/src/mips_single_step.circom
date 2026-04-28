pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";
include "./mips_alu.circom";
include "./mips_utils.circom";
include "./mips_memory.circom";

/**
 * @title MIPS Single Step Verification Circuit
 * @notice Cannon FPVM compatible single MIPS instruction execution verification
 * @dev Used for disputed single step verification after off-chain bisection protocol completion
 *
 * Public inputs:
 * - preStateHash: State hash before instruction execution
 * - postStateHash: State hash after instruction execution
 *
 * Verification:
 * 1. preStateHash matches hash of private inputs
 * 2. MIPS instruction executes correctly
 * 3. postStateHash matches hash of post-execution state
 */

// Memory Merkle tree depth (simplified for POC)
// Actual: 27 (4GB address space), POC: 20 (4MB address space)
// circom 2.x: passed as template parameter

/**
 * MIPS State Hash Calculation (Poseidon)
 */
template MipsStateHash() {
    signal input pc;
    signal input nextPC;
    signal input registers[32];
    signal input hi;
    signal input lo;
    signal input memoryRoot;
    signal input step;

    signal output stateHash;

    // Step 1: Register hash (groups of 8)
    component regHash[4];
    for (var g = 0; g < 4; g++) {
        regHash[g] = Poseidon(8);
        for (var i = 0; i < 8; i++) {
            regHash[g].inputs[i] <== registers[g * 8 + i];
        }
    }

    // Step 2: Combine register hashes
    component regHashFinal = Poseidon(4);
    for (var i = 0; i < 4; i++) {
        regHashFinal.inputs[i] <== regHash[i].out;
    }

    // Step 3: Full state hash
    component finalHash = Poseidon(7);
    finalHash.inputs[0] <== pc;
    finalHash.inputs[1] <== nextPC;
    finalHash.inputs[2] <== regHashFinal.out;
    finalHash.inputs[3] <== hi;
    finalHash.inputs[4] <== lo;
    finalHash.inputs[5] <== memoryRoot;
    finalHash.inputs[6] <== step;

    stateHash <== finalHash.out;
}

/**
 * MIPS Instruction Decoder
 */
template MipsDecoder() {
    signal input instruction;

    signal output opcode;      // bits 31-26
    signal output rs;          // bits 25-21
    signal output rt;          // bits 20-16
    signal output rd;          // bits 15-11
    signal output shamt;       // bits 10-6
    signal output funct;       // bits 5-0
    signal output immediate;   // bits 15-0
    signal output jumpTarget;  // bits 25-0

    // Instruction type
    signal output isRType;
    signal output isIType;
    signal output isJType;

    component bits = Num2Bits(32);
    bits.in <== instruction;

    // opcode (bits 31-26)
    component opcodeNum = Bits2Num(6);
    for (var i = 0; i < 6; i++) {
        opcodeNum.in[i] <== bits.out[26 + i];
    }
    opcode <== opcodeNum.out;

    // rs (bits 25-21)
    component rsNum = Bits2Num(5);
    for (var i = 0; i < 5; i++) {
        rsNum.in[i] <== bits.out[21 + i];
    }
    rs <== rsNum.out;

    // rt (bits 20-16)
    component rtNum = Bits2Num(5);
    for (var i = 0; i < 5; i++) {
        rtNum.in[i] <== bits.out[16 + i];
    }
    rt <== rtNum.out;

    // rd (bits 15-11)
    component rdNum = Bits2Num(5);
    for (var i = 0; i < 5; i++) {
        rdNum.in[i] <== bits.out[11 + i];
    }
    rd <== rdNum.out;

    // shamt (bits 10-6)
    component shamtNum = Bits2Num(5);
    for (var i = 0; i < 5; i++) {
        shamtNum.in[i] <== bits.out[6 + i];
    }
    shamt <== shamtNum.out;

    // funct (bits 5-0)
    component functNum = Bits2Num(6);
    for (var i = 0; i < 6; i++) {
        functNum.in[i] <== bits.out[i];
    }
    funct <== functNum.out;

    // immediate (bits 15-0)
    component immNum = Bits2Num(16);
    for (var i = 0; i < 16; i++) {
        immNum.in[i] <== bits.out[i];
    }
    immediate <== immNum.out;

    // jumpTarget (bits 25-0)
    component jumpNum = Bits2Num(26);
    for (var i = 0; i < 26; i++) {
        jumpNum.in[i] <== bits.out[i];
    }
    jumpTarget <== jumpNum.out;

    // Instruction type detection
    component typeCheck = InstructionType();
    typeCheck.opcode <== opcode;
    isRType <== typeCheck.isRType;
    isIType <== typeCheck.isIType;
    isJType <== typeCheck.isJType;
}

/**
 * MIPS Single Step Verification Main Circuit
 * @param memDepth Memory Merkle tree depth (default: 20)
 */
template MipsSingleStep(memDepth) {
    // ========== Public Inputs ==========
    signal input preStateHash;
    signal input postStateHash;

    // ========== Private Inputs: Pre-execution State ==========
    signal input prePC;
    signal input preNextPC;
    signal input preRegisters[32];
    signal input preHi;
    signal input preLo;
    signal input preMemoryRoot;
    signal input preStep;

    // ========== Private Inputs: Instruction ==========
    signal input instruction;

    // ========== Private Inputs: Memory Access (if needed) ==========
    signal input memAddress;
    signal input memValue;
    signal input memProof[memDepth];

    // ========== Private Inputs: Post-execution State ==========
    signal input postPC;
    signal input postNextPC;
    signal input postRegisters[32];
    signal input postHi;
    signal input postLo;
    signal input postMemoryRoot;
    signal input postStep;

    // ========== Outputs ==========
    signal output valid;

    // ========== Step 1: State Hash Verification ==========

    component preHash = MipsStateHash();
    preHash.pc <== prePC;
    preHash.nextPC <== preNextPC;
    preHash.hi <== preHi;
    preHash.lo <== preLo;
    preHash.memoryRoot <== preMemoryRoot;
    preHash.step <== preStep;
    for (var i = 0; i < 32; i++) {
        preHash.registers[i] <== preRegisters[i];
    }

    component postHash = MipsStateHash();
    postHash.pc <== postPC;
    postHash.nextPC <== postNextPC;
    postHash.hi <== postHi;
    postHash.lo <== postLo;
    postHash.memoryRoot <== postMemoryRoot;
    postHash.step <== postStep;
    for (var i = 0; i < 32; i++) {
        postHash.registers[i] <== postRegisters[i];
    }

    // State hash match verification
    component preHashCheck = IsEqual();
    preHashCheck.in[0] <== preHash.stateHash;
    preHashCheck.in[1] <== preStateHash;

    component postHashCheck = IsEqual();
    postHashCheck.in[0] <== postHash.stateHash;
    postHashCheck.in[1] <== postStateHash;

    signal hashesValid;
    hashesValid <== preHashCheck.out * postHashCheck.out;

    // ========== Step 2: Instruction Decoding ==========

    component decoder = MipsDecoder();
    decoder.instruction <== instruction;

    // ========== Step 3: Register Value Reading ==========

    component rsSelect = RegMux();
    component rtSelect = RegMux();

    for (var i = 0; i < 32; i++) {
        rsSelect.regs[i] <== preRegisters[i];
        rtSelect.regs[i] <== preRegisters[i];
    }
    rsSelect.sel <== decoder.rs;
    rtSelect.sel <== decoder.rt;

    signal rsValue;
    signal rtValue;
    rsValue <== rsSelect.out;
    rtValue <== rtSelect.out;

    // ========== Step 4: ALU Operation ==========

    // ALU opcode determination
    component functToAlu = FunctToAluOp();
    functToAlu.funct <== decoder.funct;

    // ALU opcode mapping for I-Type instructions
    signal aluOpcodeRType;
    signal aluOpcodeIType;
    aluOpcodeRType <== functToAlu.aluOp;

    // I-Type opcode to ALU op mapping
    component opcodeToAlu = OpcodeToAluOp();
    opcodeToAlu.opcode <== decoder.opcode;
    aluOpcodeIType <== opcodeToAlu.aluOp;

    // ALU opcode selection based on instruction type
    component aluOpSelect = Select();
    aluOpSelect.cond <== decoder.isRType;
    aluOpSelect.ifTrue <== aluOpcodeRType;
    aluOpSelect.ifFalse <== aluOpcodeIType;

    // I-Type immediate sign extension
    component signExt = SignExtend16();
    signExt.in <== decoder.immediate;

    // Immediate value mux: zero-ext (raw 16-bit) vs sign-ext
    component isZeroExt = IsZeroExtImm();
    isZeroExt.opcode <== decoder.opcode;
    component immSelect = Select();
    immSelect.cond <== isZeroExt.out;
    immSelect.ifTrue <== decoder.immediate;   // raw 16-bit (zero-extended)
    immSelect.ifFalse <== signExt.out;        // sign-extended

    // ALU operand B selection (R-Type: rt, I-Type: immSelect)
    component operandBSelect = Select();
    operandBSelect.cond <== decoder.isRType;
    operandBSelect.ifTrue <== rtValue;
    operandBSelect.ifFalse <== immSelect.out;

    // Variable shift detection: SLLV (funct=4) / SRLV (funct=6)
    // For variable shifts, use rsValue[4:0] as shamt instead of decoder.shamt
    component isVarShiftA = IsEqual();
    isVarShiftA.in[0] <== decoder.funct;
    isVarShiftA.in[1] <== 4;
    component isVarShiftB = IsEqual();
    isVarShiftB.in[0] <== decoder.funct;
    isVarShiftB.in[1] <== 6;
    signal isVarShift;
    isVarShift <== (isVarShiftA.out + isVarShiftB.out) * decoder.isRType;

    // Extract lower 5 bits of rsValue
    component rsValueBits = Num2Bits(32);
    rsValueBits.in <== rsValue;
    component rsLow5 = Bits2Num(5);
    for (var i = 0; i < 5; i++) {
        rsLow5.in[i] <== rsValueBits.out[i];
    }

    // Shamt mux: variable shift -> rsValue[4:0], else -> decoder.shamt
    component shamtMux = Select();
    shamtMux.cond <== isVarShift;
    shamtMux.ifTrue <== rsLow5.out;
    shamtMux.ifFalse <== decoder.shamt;

    // ALU execution
    component alu = MipsAlu();
    alu.opcode <== aluOpSelect.out;
    alu.a <== rsValue;
    alu.b <== operandBSelect.out;
    alu.shamt <== shamtMux.out;

    // ========== Step 4b: Branch/Jump Detection ==========

    // Branch opcode detection (I-Type: opcodes 4-7)
    component isBEQ = IsEqual(); isBEQ.in[0] <== decoder.opcode; isBEQ.in[1] <== 4;
    component isBNE = IsEqual(); isBNE.in[0] <== decoder.opcode; isBNE.in[1] <== 5;
    component isBLEZ = IsEqual(); isBLEZ.in[0] <== decoder.opcode; isBLEZ.in[1] <== 6;
    component isBGTZ = IsEqual(); isBGTZ.in[0] <== decoder.opcode; isBGTZ.in[1] <== 7;

    signal isBranch;
    isBranch <== isBEQ.out + isBNE.out + isBLEZ.out + isBGTZ.out;

    // J/JAL detection (J-Type)
    component isJ = IsEqual(); isJ.in[0] <== decoder.opcode; isJ.in[1] <== 2;
    component isJAL = IsEqual(); isJAL.in[0] <== decoder.opcode; isJAL.in[1] <== 3;

    // JR detection (R-Type, funct=8)
    component isJRfunct = IsEqual(); isJRfunct.in[0] <== decoder.funct; isJRfunct.in[1] <== 8;
    signal isJR;
    isJR <== isJRfunct.out * decoder.isRType;

    // Branch condition evaluation
    // BEQ: rs == rt
    component beqCond = IsEqual();
    beqCond.in[0] <== rsValue;
    beqCond.in[1] <== rtValue;

    // BNE: rs != rt
    signal bneCondVal;
    bneCondVal <== 1 - beqCond.out;

    // BLEZ: rs <= 0 (signed) — sign bit set OR value is zero
    // rsValueBits already computed in Step 4 (Num2Bits(32))
    signal rsSignBit;
    rsSignBit <== rsValueBits.out[31];

    component rsIsZero = IsZero();
    rsIsZero.in <== rsValue;

    // OR(signBit, isZero) = signBit + isZero - signBit * isZero
    signal blezOr;
    blezOr <== rsSignBit * rsIsZero.out;
    signal blezCondVal;
    blezCondVal <== rsSignBit + rsIsZero.out - blezOr;

    // BGTZ: NOT signBit AND NOT isZero
    signal bgtzCondVal;
    bgtzCondVal <== (1 - rsSignBit) * (1 - rsIsZero.out);

    // Branch taken = sum of (opcode match * condition)
    signal beqTaken;
    signal bneTaken;
    signal blezTaken;
    signal bgtzTaken;
    beqTaken <== isBEQ.out * beqCond.out;
    bneTaken <== isBNE.out * bneCondVal;
    blezTaken <== isBLEZ.out * blezCondVal;
    bgtzTaken <== isBGTZ.out * bgtzCondVal;

    signal branchTaken;
    branchTaken <== beqTaken + bneTaken + blezTaken + bgtzTaken;

    // ========== Step 4c: Multiply/Divide Detection ==========
    component isMULT = IsEqual(); isMULT.in[0] <== decoder.funct; isMULT.in[1] <== 24;
    component isMULTU = IsEqual(); isMULTU.in[0] <== decoder.funct; isMULTU.in[1] <== 25;
    component isDIV = IsEqual(); isDIV.in[0] <== decoder.funct; isDIV.in[1] <== 26;
    component isDIVU = IsEqual(); isDIVU.in[0] <== decoder.funct; isDIVU.in[1] <== 27;

    signal isMul;
    isMul <== (isMULT.out + isMULTU.out) * decoder.isRType;
    signal isDiv;
    isDiv <== (isDIV.out + isDIVU.out) * decoder.isRType;
    signal isMulDiv;
    isMulDiv <== isMul + isDiv;

    // ========== Step 4d: Memory Operation Detection ==========
    component isLWcheck = IsEqual();
    isLWcheck.in[0] <== decoder.opcode;
    isLWcheck.in[1] <== 35;  // LW opcode
    signal isLW;
    isLW <== isLWcheck.out;

    component isSWcheck = IsEqual();
    isSWcheck.in[0] <== decoder.opcode;
    isSWcheck.in[1] <== 43;  // SW opcode
    signal isSW;
    isSW <== isSWcheck.out;

    signal isMemOp;
    isMemOp <== isLW + isSW;

    // ========== Memory Verification ==========

    // Word address = alu.result / 4 (byte→word index)
    // alu.result already computes rsValue + signExtImm for LW/SW (OpcodeToAluOp defaults to ADD)
    signal memWordAddress;
    signal memRemainder;
    memWordAddress <-- alu.result \ 4;
    memRemainder <-- alu.result % 4;
    signal memWordAddrX4;
    memWordAddrX4 <== memWordAddress * 4;
    memRemainder === alu.result - memWordAddrX4;

    // Range check remainder [0,3]
    component memRemRange = LessThan(3);
    memRemRange.in[0] <== memRemainder;
    memRemRange.in[1] <== 4;
    memRemRange.out === 1;

    // Safe address: 0 for non-memory ops (prevents Num2Bits(20) overflow in MemoryWriteVerify)
    signal safeMemWordAddress;
    safeMemWordAddress <== isMemOp * memWordAddress;

    // New value: SW→rtValue, LW/other→memValue (identity write)
    component memNewValueSelect = Select();
    memNewValueSelect.cond <== isSW;
    memNewValueSelect.ifTrue <== rtValue;
    memNewValueSelect.ifFalse <== memValue;

    // Instantiate MemoryWriteVerify — handles both read-verify and write
    component memVerify = MemoryWriteVerify(memDepth);
    memVerify.address <== safeMemWordAddress;
    memVerify.oldValue <== memValue;
    memVerify.newValue <== memNewValueSelect.out;
    for (var i = 0; i < memDepth; i++) {
        memVerify.pathElements[i] <== memProof[i];
    }
    memVerify.oldRoot <== preMemoryRoot;

    // ========== Step 5: PC Update Verification ==========

    // PC always advances via delay slot
    signal expectedPC;
    expectedPC <== preNextPC;

    // Default nextPC
    signal defaultNextPC;
    defaultNextPC <== preNextPC + 4;

    // Branch target: preNextPC + signedOffset * 4
    // signedOffset = immediate - signBit * 65536 (two's complement)
    // branchTarget = preNextPC + immediate * 4 - signBit * 262144
    component immSignBits = Num2Bits(16);
    immSignBits.in <== decoder.immediate;
    signal immSign;
    immSign <== immSignBits.out[15];

    signal branchTarget;
    branchTarget <== preNextPC + decoder.immediate * 4 - immSign * 262144;

    // Jump target: (preNextPC & 0xF0000000) | (jumpTarget << 2)
    component preNextPCbits = Num2Bits(32);
    preNextPCbits.in <== preNextPC;
    component pcUpper4 = Bits2Num(4);
    for (var i = 0; i < 4; i++) {
        pcUpper4.in[i] <== preNextPCbits.out[28 + i];
    }
    signal jumpAddr;
    jumpAddr <== pcUpper4.out * 268435456 + decoder.jumpTarget * 4;

    // NextPC mux chain (layered Select, mutually exclusive conditions)
    // Layer 1: branch taken -> branchTarget, else -> default
    component nextPcBranch = Select();
    nextPcBranch.cond <== branchTaken;
    nextPcBranch.ifTrue <== branchTarget;
    nextPcBranch.ifFalse <== defaultNextPC;

    // Layer 2: J-type -> jumpAddr
    component nextPcJump = Select();
    nextPcJump.cond <== decoder.isJType;
    nextPcJump.ifTrue <== jumpAddr;
    nextPcJump.ifFalse <== nextPcBranch.out;

    // Layer 3: JR -> rsValue
    component nextPcJR = Select();
    nextPcJR.cond <== isJR;
    nextPcJR.ifTrue <== rsValue;
    nextPcJR.ifFalse <== nextPcJump.out;

    signal expectedNextPC;
    expectedNextPC <== nextPcJR.out;

    // PC verification
    component pcCheck = IsEqual();
    pcCheck.in[0] <== postPC;
    pcCheck.in[1] <== expectedPC;

    component nextPcCheck = IsEqual();
    nextPcCheck.in[0] <== postNextPC;
    nextPcCheck.in[1] <== expectedNextPC;

    signal pcValid;
    pcValid <== pcCheck.out * nextPcCheck.out;

    // ========== Step 6: Register Update Verification ==========

    // Destination register: R-Type -> rd, I-Type -> rt, JAL -> 31
    component destRegSelect = Select();
    destRegSelect.cond <== decoder.isRType;
    destRegSelect.ifTrue <== decoder.rd;
    destRegSelect.ifFalse <== decoder.rt;

    component destRegJalOverride = Select();
    destRegJalOverride.cond <== isJAL.out;
    destRegJalOverride.ifTrue <== 31;
    destRegJalOverride.ifFalse <== destRegSelect.out;

    signal destReg;
    destReg <== destRegJalOverride.out;

    // Read destination register from post-state
    component destRegValue = RegMux();
    for (var i = 0; i < 32; i++) {
        destRegValue.regs[i] <== postRegisters[i];
    }
    destRegValue.sel <== destReg;

    // MFHI/MFLO detection (R-type only)
    component isMfhiCheck = IsEqual();
    isMfhiCheck.in[0] <== decoder.funct;
    isMfhiCheck.in[1] <== 16; // 0x10
    signal isMFHI;
    isMFHI <== isMfhiCheck.out * decoder.isRType;

    component isMfloCheck = IsEqual();
    isMfloCheck.in[0] <== decoder.funct;
    isMfloCheck.in[1] <== 18; // 0x12
    signal isMFLO;
    isMFLO <== isMfloCheck.out * decoder.isRType;

    // Write value mux: MFHI -> preHi, MFLO -> preLo, else -> alu.result
    component writeValMflo = Select();
    writeValMflo.cond <== isMFLO;
    writeValMflo.ifTrue <== preLo;
    writeValMflo.ifFalse <== alu.result;

    component writeValMfhi = Select();
    writeValMfhi.cond <== isMFHI;
    writeValMfhi.ifTrue <== preHi;
    writeValMfhi.ifFalse <== writeValMflo.out;

    // JAL write value override: r31 = preNextPC + 4 (return address)
    signal jalRetAddr;
    jalRetAddr <== preNextPC + 4;

    component writeValJal = Select();
    writeValJal.cond <== isJAL.out;
    writeValJal.ifTrue <== jalRetAddr;
    writeValJal.ifFalse <== writeValMfhi.out;

    // LW: register write value = memValue (loaded word)
    component writeValLW = Select();
    writeValLW.cond <== isLW;
    writeValLW.ifTrue <== memValue;
    writeValLW.ifFalse <== writeValJal.out;

    signal writeValue;
    writeValue <== writeValLW.out;

    component aluResultCheck = IsEqual();
    aluResultCheck.in[0] <== destRegValue.out;
    aluResultCheck.in[1] <== writeValue;

    // writeEnable: 0 for branches, J, JR (no register write)
    signal isNoWrite;
    isNoWrite <== isBranch + isJ.out + isJR + isMulDiv + isSW;
    signal writeEnable;
    writeEnable <== 1 - isNoWrite;

    // Gate register check: if writeEnable=0, skip check (always pass)
    component gatedRegCheck = Select();
    gatedRegCheck.cond <== writeEnable;
    gatedRegCheck.ifTrue <== aluResultCheck.out;
    gatedRegCheck.ifFalse <== 1;

    // $0 register is always 0
    component reg0Check = IsZero();
    reg0Check.in <== postRegisters[0];

    signal regUpdateValid;
    regUpdateValid <== gatedRegCheck.out * reg0Check.out;

    // ========== Step 7: Step Counter Verification ==========

    component stepCheck = IsEqual();
    stepCheck.in[0] <== postStep;
    stepCheck.in[1] <== preStep + 1;

    // ========== Step 8: Memory Root Verification ==========

    // Expected memory root: SW→computed newRoot, else→unchanged
    component expectedMemRoot = Select();
    expectedMemRoot.cond <== isSW;
    expectedMemRoot.ifTrue <== memVerify.newRoot;
    expectedMemRoot.ifFalse <== preMemoryRoot;

    component memRootCheck = IsEqual();
    memRootCheck.in[0] <== postMemoryRoot;
    memRootCheck.in[1] <== expectedMemRoot.out;

    // Gate Merkle proof validity: only require valid proof for memory ops
    // Non-memory ops may have garbage proofs (all zeros) — skip check
    component gatedMemCheck = Select();
    gatedMemCheck.cond <== isMemOp;
    gatedMemCheck.ifTrue <== memVerify.valid;
    gatedMemCheck.ifFalse <== 1;

    // ========== Step 9: HI/LO Verification ==========

    // --- Multiplication: postHi * 2^32 + postLo == rsValue * rtValue ---
    signal mulProduct;
    mulProduct <== rsValue * rtValue;
    signal mulExpected;
    mulExpected <== postHi * 4294967296 + postLo;
    component mulCheck = IsEqual();
    mulCheck.in[0] <== mulExpected;
    mulCheck.in[1] <== mulProduct;

    // --- Division: postLo * rtValue + postHi == rsValue, postHi < rtValue ---
    signal divReconstructed;
    divReconstructed <== postLo * rtValue + postHi;
    component divCheck = IsEqual();
    divCheck.in[0] <== divReconstructed;
    divCheck.in[1] <== rsValue;
    component remCheck = LessThan(33);
    remCheck.in[0] <== postHi;
    remCheck.in[1] <== rtValue;
    signal divValid;
    divValid <== divCheck.out * remCheck.out;

    // --- Unchanged (default for non-mul/div) ---
    component hiUnchanged = IsEqual();
    hiUnchanged.in[0] <== postHi;
    hiUnchanged.in[1] <== preHi;
    component loUnchanged = IsEqual();
    loUnchanged.in[0] <== postLo;
    loUnchanged.in[1] <== preLo;
    signal unchangedValid;
    unchangedValid <== hiUnchanged.out * loUnchanged.out;

    // --- Three-way mux: isMul -> mulCheck, isDiv -> divValid, else -> unchanged ---
    component hiLoMul = Select();
    hiLoMul.cond <== isMul;
    hiLoMul.ifTrue <== mulCheck.out;
    hiLoMul.ifFalse <== unchangedValid;

    component hiLoDiv = Select();
    hiLoDiv.cond <== isDiv;
    hiLoDiv.ifTrue <== divValid;
    hiLoDiv.ifFalse <== hiLoMul.out;

    signal hiLoValid;
    hiLoValid <== hiLoDiv.out;

    // ========== Final Verification ==========

    // Sequential multiplication for quadratic constraints
    signal valid1;
    signal valid2;
    signal valid3;
    signal valid4;
    signal valid5;

    valid1 <== hashesValid * pcValid;
    valid2 <== valid1 * regUpdateValid;
    valid3 <== valid2 * stepCheck.out;
    signal memValid;
    memValid <== memRootCheck.out * gatedMemCheck.out;
    valid4 <== valid3 * memValid;
    valid5 <== valid4 * hiLoValid;

    valid <== valid5;
}

// 메인 컴포넌트 (memDepth = 20 for POC)
component main {public [preStateHash, postStateHash]} = MipsSingleStep(20);
