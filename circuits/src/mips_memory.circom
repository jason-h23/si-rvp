pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";

/**
 * @title MIPS Memory Verification Circuits
 * @notice Merkle tree based memory access verification
 * @dev Compatible with Cannon FPVM memory structure, circom 2.x compatible
 *
 * Memory structure:
 * - 32-bit address space
 * - 4-byte (32-bit) word unit
 * - Merkle tree depth: variable (POC: 20)
 */

/**
 * Poseidon-based 2-to-1 hash
 */
template PoseidonHash2() {
    signal input left;
    signal input right;
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    out <== hasher.out;
}

/**
 * Merkle Proof Verification (Poseidon Hash)
 * @param depth Tree depth
 * @input leaf Leaf value
 * @input pathElements[depth] Sibling nodes
 * @input pathIndices[depth] Path (0=left, 1=right)
 * @output root Computed root
 */
template MerkleProof(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component selectLeft[depth];
    component selectRight[depth];

    signal intermediate[depth + 1];
    intermediate[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // Verify pathIndices[i] is 0 or 1
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        // Determine hash order (pathIndices[i] = 0 means current is left)
        hashers[i] = PoseidonHash2();

        // pathIndices[i] = 0: hash(current, sibling)
        // pathIndices[i] = 1: hash(sibling, current)
        selectLeft[i] = Mux1();
        selectLeft[i].c[0] <== intermediate[i];
        selectLeft[i].c[1] <== pathElements[i];
        selectLeft[i].s <== pathIndices[i];

        selectRight[i] = Mux1();
        selectRight[i].c[0] <== pathElements[i];
        selectRight[i].c[1] <== intermediate[i];
        selectRight[i].s <== pathIndices[i];

        hashers[i].left <== selectLeft[i].out;
        hashers[i].right <== selectRight[i].out;

        intermediate[i + 1] <== hashers[i].out;
    }

    root <== intermediate[depth];
}

/**
 * Memory Read Verification
 * @param depth Merkle tree depth
 * @input address Memory address (word-aligned)
 * @input value Value read
 * @input pathElements[depth] Merkle proof
 * @input expectedRoot Expected memory root
 * @output valid Verification result
 */
template MemoryReadVerify(depth) {
    signal input address;
    signal input value;
    signal input pathElements[depth];
    signal input expectedRoot;
    signal output valid;

    // Extract path indices from address
    component addressBits = Num2Bits(depth);
    addressBits.in <== address;

    // Merkle proof verification
    component merkle = MerkleProof(depth);
    merkle.leaf <== value;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== addressBits.out[depth - 1 - i];
    }

    // Root comparison
    component rootCheck = IsEqual();
    rootCheck.in[0] <== merkle.root;
    rootCheck.in[1] <== expectedRoot;
    valid <== rootCheck.out;
}

/**
 * Memory Write Verification
 * Verify read with old value, then calculate new root with new value
 * @param depth Merkle 트리 깊이
 */
template MemoryWriteVerify(depth) {
    signal input address;
    signal input oldValue;
    signal input newValue;
    signal input pathElements[depth];
    signal input oldRoot;
    signal output newRoot;
    signal output valid;

    // Extract path indices from address
    component addressBits = Num2Bits(depth);
    addressBits.in <== address;

    // 1. Verify oldRoot with old value
    component readVerify = MerkleProof(depth);
    readVerify.leaf <== oldValue;
    for (var i = 0; i < depth; i++) {
        readVerify.pathElements[i] <== pathElements[i];
        readVerify.pathIndices[i] <== addressBits.out[depth - 1 - i];
    }

    component oldRootCheck = IsEqual();
    oldRootCheck.in[0] <== readVerify.root;
    oldRootCheck.in[1] <== oldRoot;
    valid <== oldRootCheck.out;

    // 2. 새 값으로 newRoot 계산
    component writeProof = MerkleProof(depth);
    writeProof.leaf <== newValue;
    for (var i = 0; i < depth; i++) {
        writeProof.pathElements[i] <== pathElements[i];
        writeProof.pathIndices[i] <== addressBits.out[depth - 1 - i];
    }

    newRoot <== writeProof.root;
}

/**
 * 바이트 추출 (32비트 워드에서)
 * @input word 32비트 워드
 * @input byteIndex 바이트 인덱스 (0-3, big-endian)
 * @output out 추출된 바이트
 */
template ExtractByte() {
    signal input word;
    signal input byteIndex;
    signal output out;

    component wordBits = Num2Bits(32);
    wordBits.in <== word;

    // 각 바이트 추출 - 컴포넌트 배열 선언
    component byteBits[4];
    signal bytes[4];

    for (var b = 0; b < 4; b++) {
        byteBits[b] = Bits2Num(8);
        for (var i = 0; i < 8; i++) {
            byteBits[b].in[i] <== wordBits.out[(3 - b) * 8 + i];
        }
        bytes[b] <== byteBits[b].out;
    }

    // byteIndex에 따라 선택
    component eqs[4];
    signal selected[4];
    signal sums[4];

    for (var i = 0; i < 4; i++) {
        eqs[i] = IsEqual();
        eqs[i].in[0] <== byteIndex;
        eqs[i].in[1] <== i;
        selected[i] <== eqs[i].out * bytes[i];
    }

    sums[0] <== selected[0];
    for (var i = 1; i < 4; i++) {
        sums[i] <== sums[i-1] + selected[i];
    }

    out <== sums[3];
}

/**
 * 하프워드 추출 (32비트 워드에서)
 * @input word 32비트 워드
 * @input halfIndex 하프워드 인덱스 (0 또는 1, big-endian)
 * @output out 추출된 하프워드
 */
template ExtractHalfword() {
    signal input word;
    signal input halfIndex;
    signal output out;

    component wordBits = Num2Bits(32);
    wordBits.in <== word;

    // 각 하프워드 추출
    component halfBits[2];
    signal halves[2];

    for (var h = 0; h < 2; h++) {
        halfBits[h] = Bits2Num(16);
        for (var i = 0; i < 16; i++) {
            halfBits[h].in[i] <== wordBits.out[(1 - h) * 16 + i];
        }
        halves[h] <== halfBits[h].out;
    }

    // halfIndex에 따라 선택
    component mux = Mux1();
    mux.c[0] <== halves[0];
    mux.c[1] <== halves[1];
    mux.s <== halfIndex;

    out <== mux.out;
}

/**
 * 바이트 삽입 (32비트 워드에)
 * @input word 원본 32비트 워드
 * @input byteValue 삽입할 바이트
 * @input byteIndex 바이트 인덱스 (0-3)
 * @output out 수정된 워드
 */
template InsertByte() {
    signal input word;
    signal input byteValue;
    signal input byteIndex;
    signal output out;

    component wordBits = Num2Bits(32);
    wordBits.in <== word;

    component valueBits = Num2Bits(8);
    valueBits.in <== byteValue;

    // 각 바이트에 대한 isTarget 체크
    component isTarget[4];
    for (var b = 0; b < 4; b++) {
        isTarget[b] = IsEqual();
        isTarget[b].in[0] <== byteIndex;
        isTarget[b].in[1] <== b;
    }

    // 출력 비트 계산
    component muxBits[32];
    signal outBits[32];

    for (var b = 0; b < 4; b++) {
        for (var i = 0; i < 8; i++) {
            var bitIdx = (3 - b) * 8 + i;
            muxBits[bitIdx] = Mux1();
            muxBits[bitIdx].c[0] <== wordBits.out[bitIdx];
            muxBits[bitIdx].c[1] <== valueBits.out[i];
            muxBits[bitIdx].s <== isTarget[b].out;
            outBits[bitIdx] <== muxBits[bitIdx].out;
        }
    }

    component toNum = Bits2Num(32);
    for (var i = 0; i < 32; i++) {
        toNum.in[i] <== outBits[i];
    }
    out <== toNum.out;
}

/**
 * 메모리 로드 연산 (LW, LH, LHU, LB, LBU)
 * 간소화된 POC 버전 - LW만 지원
 * @param depth Merkle 트리 깊이
 */
template MemoryLoad(depth) {
    signal input memRoot;
    signal input address;
    signal input loadType; // 0=LW (POC: LW만 지원)
    signal input pathElements[depth];
    signal input wordValue;
    signal output result;
    signal output valid;

    // 워드 정렬 주소 (간소화: address >> 2)
    signal wordAddress;
    wordAddress <-- address \ 4;

    // Integer division verification
    signal rem;
    rem <-- address % 4;
    rem * 1 === address - wordAddress * 4;

    // Merkle verification
    component verify = MemoryReadVerify(depth);
    verify.address <== wordAddress;
    verify.value <== wordValue;
    for (var i = 0; i < depth; i++) {
        verify.pathElements[i] <== pathElements[i];
    }
    verify.expectedRoot <== memRoot;
    valid <== verify.valid;

    // POC 간소화: LW만 지원
    result <== wordValue;
}

/**
 * 메모리 스토어 연산 (SW, SH, SB)
 * 간소화된 POC 버전 - SW만 지원
 * @param depth Merkle 트리 깊이
 */
template MemoryStore(depth) {
    signal input oldMemRoot;
    signal input address;
    signal input storeType; // 0=SW (POC: SW만 지원)
    signal input storeValue;
    signal input pathElements[depth];
    signal input oldWordValue;
    signal output newMemRoot;
    signal output valid;

    // 워드 정렬 주소
    signal wordAddress;
    wordAddress <-- address \ 4;

    signal rem;
    rem <-- address % 4;
    rem * 1 === address - wordAddress * 4;

    // POC 간소화: SW만 지원 - 전체 워드 교체
    signal newWordValue;
    newWordValue <== storeValue;

    // Memory write verification
    component writeVerify = MemoryWriteVerify(depth);
    writeVerify.address <== wordAddress;
    writeVerify.oldValue <== oldWordValue;
    writeVerify.newValue <== newWordValue;
    for (var i = 0; i < depth; i++) {
        writeVerify.pathElements[i] <== pathElements[i];
    }
    writeVerify.oldRoot <== oldMemRoot;

    newMemRoot <== writeVerify.newRoot;
    valid <== writeVerify.valid;
}
