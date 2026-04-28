/**
 * Test Real ZK Prover
 */
import * as path from 'path';
import { ZKProver, PoseidonHasher } from './src/common/prover';
import { MipsExecutor } from './src/common/mips';

// Correct paths for circuits
const CIRCUITS_DIR = path.join(__dirname, '..', 'circuits', 'build');
const WASM_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(CIRCUITS_DIR, 'verification_key.json');

async function test() {
  try {
    console.log('=== Testing Real ZK Prover ===\n');

    // Initialize
    console.log('1. Initializing prover...');
    console.log(`   WASM: ${WASM_PATH}`);
    const prover = new ZKProver(WASM_PATH, ZKEY_PATH, VKEY_PATH);
    await prover.initialize();

    console.log('2. Initializing Poseidon hasher...');
    const hasher = new PoseidonHasher();
    await hasher.initialize();

    // Create states
    console.log('3. Creating MIPS states...');
    const executor = new MipsExecutor();
    const preState = MipsExecutor.createInitialState();
    const instruction = BigInt(0x20010064); // addi $1, $0, 100
    const postState = executor.executeStep(preState, instruction);

    console.log(`   Pre-state:  PC=${preState.pc}, r1=${preState.registers[1]}`);
    console.log(`   Post-state: PC=${postState.pc}, r1=${postState.registers[1]}`);

    // Generate hashes
    console.log('4. Generating state hashes...');
    const preHash = hasher.hashMipsState(preState);
    const postHash = hasher.hashMipsState(postState);

    console.log(`   Pre-hash:  ${preHash.toString(16).slice(0,20)}...`);
    console.log(`   Post-hash: ${postHash.toString(16).slice(0,20)}...`);

    // Generate proof
    console.log('5. Generating ZK proof (this may take a while)...');
    const input = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);
    const startTime = Date.now();
    const proof = await prover.generateProof(input);
    const proofTime = Date.now() - startTime;

    console.log(`   Proof generated in ${proofTime}ms`);
    console.log(`   Proof.a: [${proof.proof.a[0].slice(0,20)}...]`);

    // Verify proof
    console.log('6. Verifying proof...');
    const valid = await prover.verifyProof(proof);
    console.log(`   Proof valid: ${valid}`);

    console.log('\n=== Test Complete ===');
    console.log(`Result: ${valid ? '✅ SUCCESS' : '❌ FAILED'}`);

  } catch (e: any) {
    console.error('\n❌ Error:', e.message);
    if (e.message.includes('not found')) {
      console.log('\nMissing files. Run: cd circuits && ./compile.sh');
    }
  }
}

test();
