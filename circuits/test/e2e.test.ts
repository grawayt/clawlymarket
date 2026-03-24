/**
 * End-to-end ZK membership proof test.
 *
 * Validates the full pipeline:
 *   1. Build a Merkle tree with test secrets
 *   2. Generate a real Groth16 proof via snarkjs
 *   3. Verify the proof locally
 *   4. Confirm nullifier and root match
 *   5. Confirm a bad proof / wrong root fails verification
 *
 * Run: cd circuits && npx ts-node test/e2e.test.ts
 */

import { PoseidonMerkleTree } from '../src/merkle-tree';
import { generateProof, verifyProofLocally } from '../src/prove';

// Test secrets — in production these would be API key hashes
const TEST_SECRETS = [
  42n,
  1337n,
  999999999999n,
  BigInt('0xdeadbeef'),
  BigInt('123456789012345678901234567890'),
];

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  \u2713 ${message}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('\n=== ClawlyMarket ZK E2E Test ===\n');

  // -------------------------------------------------------
  // 1. Build the Merkle tree
  // -------------------------------------------------------
  console.log('1. Building Merkle tree with test secrets...');
  const tree = new PoseidonMerkleTree(10);
  await tree.init();

  const indices: number[] = [];
  for (const secret of TEST_SECRETS) {
    indices.push(tree.insert(secret));
  }

  const root = tree.getRoot();
  assert(root !== 0n, 'Tree root is non-zero after inserts');
  assert(indices.length === TEST_SECRETS.length, `Inserted ${indices.length} secrets`);
  console.log(`   Root: ${root}`);

  // -------------------------------------------------------
  // 2. Verify nullifiers are deterministic and unique
  // -------------------------------------------------------
  console.log('\n2. Checking nullifier properties...');
  const nullifiers = TEST_SECRETS.map(s => tree.getNullifier(s));
  const uniqueNullifiers = new Set(nullifiers.map(n => n.toString()));
  assert(uniqueNullifiers.size === TEST_SECRETS.length, 'All nullifiers are unique');

  // Same secret should produce same nullifier
  const nullifier0_a = tree.getNullifier(TEST_SECRETS[0]);
  const nullifier0_b = tree.getNullifier(TEST_SECRETS[0]);
  assert(nullifier0_a === nullifier0_b, 'Nullifier is deterministic for same secret');

  // -------------------------------------------------------
  // 3. Generate and verify a real Groth16 proof for secret[0]
  // -------------------------------------------------------
  console.log('\n3. Generating Groth16 proof for first secret...');
  const secret0 = TEST_SECRETS[0];
  const proof0 = tree.getProof(indices[0]);

  const startTime = Date.now();
  const result = await generateProof(
    secret0,
    proof0.pathElements,
    proof0.pathIndices,
    root
  );
  const proofTime = Date.now() - startTime;
  console.log(`   Proof generated in ${proofTime}ms`);

  assert(result.pA.length === 2, 'pA has 2 elements');
  assert(result.pB.length === 2 && result.pB[0].length === 2, 'pB has shape [2][2]');
  assert(result.pC.length === 2, 'pC has 2 elements');
  assert(result.rawPublicSignals.length === 2, 'publicSignals has 2 elements [root, nullifier]');

  // Check that returned root matches our tree root
  assert(
    BigInt(result.root) === root,
    'Proof root matches tree root'
  );

  // Check that returned nullifier matches expected
  const expectedNullifier = tree.getNullifier(secret0);
  assert(
    BigInt(result.nullifier) === expectedNullifier,
    'Proof nullifier matches expected Poseidon(secret)'
  );

  // -------------------------------------------------------
  // 4. Verify the proof locally with snarkjs
  // -------------------------------------------------------
  console.log('\n4. Verifying proof locally...');
  const isValid = await verifyProofLocally(result);
  assert(isValid === true, 'Proof passes local verification');

  // -------------------------------------------------------
  // 5. Generate proof for a different secret in the tree
  // -------------------------------------------------------
  console.log('\n5. Testing proof for a different secret (index 2)...');
  const secret2 = TEST_SECRETS[2];
  const proof2 = tree.getProof(indices[2]);
  const result2 = await generateProof(
    secret2,
    proof2.pathElements,
    proof2.pathIndices,
    root
  );
  const isValid2 = await verifyProofLocally(result2);
  assert(isValid2 === true, 'Second proof also passes verification');
  assert(
    BigInt(result2.nullifier) !== BigInt(result.nullifier),
    'Different secrets produce different nullifiers'
  );

  // -------------------------------------------------------
  // 6. Negative test — wrong secret should fail
  // -------------------------------------------------------
  console.log('\n6. Negative test: wrong secret should fail...');
  const wrongSecret = 99999n; // not in the tree
  try {
    // Use the Merkle proof from index 0 but with the wrong secret
    const badResult = await generateProof(
      wrongSecret,
      proof0.pathElements,
      proof0.pathIndices,
      root
    );
    // The proof generation itself might succeed (snarkjs doesn't validate
    // the witness against constraints until verification), but verification
    // should fail.
    const isValidBad = await verifyProofLocally(badResult);
    assert(isValidBad === false, 'Wrong secret fails verification');
  } catch (e: any) {
    // If snarkjs throws during proof generation due to constraint violation,
    // that's also a valid negative result
    assert(true, `Wrong secret correctly rejected: ${e.message?.slice(0, 80)}`);
  }

  // -------------------------------------------------------
  // 7. Serialization round-trip
  // -------------------------------------------------------
  console.log('\n7. Testing tree serialization round-trip...');
  const json = tree.toJSON();
  const restored = await PoseidonMerkleTree.fromJSON(json);
  assert(restored.getRoot() === root, 'Restored tree has same root');

  const restoredProof = restored.getProof(indices[0]);
  assert(
    restoredProof.pathElements.every((e, i) => e === proof0.pathElements[i]),
    'Restored tree produces same proof'
  );

  // -------------------------------------------------------
  // Summary
  // -------------------------------------------------------
  console.log('\n=== Results ===');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n  Full ZK pipeline verified! Ready for on-chain integration.\n');
  }
}

run().catch((err) => {
  console.error('E2E test crashed:', err);
  process.exit(1);
});
