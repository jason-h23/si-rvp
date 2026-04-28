const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const CIRCUIT_NAME = 'mips_single_step';

// Helper to run snarkjs via npx (cross-platform compatible)
function snarkjs(args) {
  execSync(`npx snarkjs ${args}`, { stdio: 'inherit' });
}

// Download file with redirect support
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        file.close();
        fs.unlinkSync(destPath);
        console.log('Following redirect...');
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = totalSize ? ((downloaded / totalSize) * 100).toFixed(1) : '?';
        process.stdout.write(`\rDownloading: ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('\nDownload complete!');
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function setup() {
  console.log('Starting trusted setup...\n');

  const r1csPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`);

  if (!fs.existsSync(r1csPath)) {
    console.error('R1CS file not found. Run "npm run compile" first.');
    process.exit(1);
  }

  // Phase 1: Powers of Tau (use existing or generate new)
  // Using 2^16 (65536) to accommodate memory operations (~37K wires)
  const ptauPath = path.join(BUILD_DIR, 'powersOfTau28_hez_final_16.ptau');

  if (!fs.existsSync(ptauPath) || fs.statSync(ptauPath).size < 1000000) {
    // Delete incomplete file if exists
    if (fs.existsSync(ptauPath)) {
      fs.unlinkSync(ptauPath);
    }

    console.log('Downloading Powers of Tau file (2^16, ~80MB)...');
    await downloadFile(
      'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau',
      ptauPath
    );
  } else {
    console.log('Powers of Tau file already exists.');
  }

  // Phase 2: Circuit-specific setup
  console.log('\nGenerating zkey (Phase 2)...');
  const zkey0Path = path.join(BUILD_DIR, `${CIRCUIT_NAME}_0000.zkey`);
  const zkeyPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}_final.zkey`);

  snarkjs(`groth16 setup "${r1csPath}" "${ptauPath}" "${zkey0Path}"`);

  // Contribute to phase 2
  console.log('\nContributing to Phase 2...');
  snarkjs(`zkey contribute "${zkey0Path}" "${zkeyPath}" --name="SI-RVP POC" -v -e="random entropy for si-rvp"`);

  // Export verification key
  console.log('\nExporting verification key...');
  const vkeyPath = path.join(BUILD_DIR, 'verification_key.json');
  snarkjs(`zkey export verificationkey "${zkeyPath}" "${vkeyPath}"`);

  // Generate Solidity verifier
  console.log('\nGenerating Solidity verifier...');
  const verifierPath = path.join(__dirname, '..', '..', 'contracts', 'src', 'Groth16Verifier.sol');
  snarkjs(`zkey export solidityverifier "${zkeyPath}" "${verifierPath}"`);

  console.log('\n✅ Trusted setup complete!');
  console.log(`   - zkey: ${zkeyPath}`);
  console.log(`   - vkey: ${vkeyPath}`);
  console.log(`   - verifier: ${verifierPath}`);

  // Cleanup intermediate files
  if (fs.existsSync(zkey0Path)) {
    fs.unlinkSync(zkey0Path);
    console.log('   - Cleaned up intermediate zkey');
  }
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
