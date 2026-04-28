const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CIRCUITS_DIR = path.join(__dirname, '..', 'src');
const BUILD_DIR = path.join(__dirname, '..', 'build');

// Ensure build directory exists
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// Main circuit to compile
const mainCircuit = 'mips_single_step.circom';
const circuitPath = path.join(CIRCUITS_DIR, mainCircuit);

console.log(`Compiling ${mainCircuit}...`);

try {
  // Compile circuit to R1CS, WASM, and SYM
  // Note: node_modules is at workspace root due to npm workspaces
  const nodeModulesPath = path.join(__dirname, '..', '..', 'node_modules');
  const localNodeModules = path.join(__dirname, '..', 'node_modules');
  const libPath = fs.existsSync(localNodeModules) ? localNodeModules : nodeModulesPath;

  console.log(`Using circomlib from: ${libPath}`);

  execSync(
    `circom ${circuitPath} --r1cs --wasm --sym -o ${BUILD_DIR} -l ${libPath}`,
    { stdio: 'inherit' }
  );

  console.log('Circuit compilation successful!');

  // Show circuit info
  const r1csPath = path.join(BUILD_DIR, 'mips_single_step.r1cs');
  if (fs.existsSync(r1csPath)) {
    execSync(`snarkjs r1cs info ${r1csPath}`, { stdio: 'inherit' });
  }
} catch (error) {
  console.error('Circuit compilation failed:', error.message);
  process.exit(1);
}
