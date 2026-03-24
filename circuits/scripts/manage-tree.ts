#!/usr/bin/env ts-node
/**
 * manage-tree.ts — CLI admin tool for the Poseidon Merkle tree.
 *
 * Usage:
 *   npx ts-node circuits/scripts/manage-tree.ts <command> [args]
 *
 * Commands:
 *   add <secret>          Insert a secret (bigint) into the tree stored at TREE_PATH
 *   root                  Print the current Merkle root
 *   proof <index>         Print the Merkle proof for the leaf at <index>
 *   export <file>         Serialize the tree to <file> (JSON)
 *   import <file>         Load a previously exported tree from <file>
 *
 * Environment:
 *   TREE_PATH             Path to the JSON file used for persistent storage
 *                         (default: ./tree-state.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PoseidonMerkleTree, TreeJSON } from '../src/merkle-tree';

const DEFAULT_TREE_PATH = path.resolve(process.cwd(), 'tree-state.json');
const TREE_PATH = process.env.TREE_PATH ?? DEFAULT_TREE_PATH;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadTree(): Promise<PoseidonMerkleTree> {
  if (fs.existsSync(TREE_PATH)) {
    const raw = fs.readFileSync(TREE_PATH, 'utf8');
    const data: TreeJSON = JSON.parse(raw);
    console.error(`Loaded tree from ${TREE_PATH} (nextIndex=${data.nextIndex})`);
    return PoseidonMerkleTree.fromJSON(data);
  }
  // Fresh tree
  console.error(`No existing tree at ${TREE_PATH} — creating a new 10-level tree`);
  const tree = new PoseidonMerkleTree(10);
  await tree.init();
  return tree;
}

function saveTree(tree: PoseidonMerkleTree): void {
  const data = tree.toJSON();
  fs.writeFileSync(TREE_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.error(`Tree saved to ${TREE_PATH}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdAdd(secretStr: string): Promise<void> {
  let secret: bigint;
  try {
    secret = BigInt(secretStr);
  } catch {
    console.error(`Error: "${secretStr}" is not a valid bigint (try a decimal or 0x-prefixed hex)`);
    process.exit(1);
    return; // unreachable but satisfies definite-assignment
  }

  const tree = await loadTree();
  const index = tree.insert(secret);
  const root = tree.getRoot();
  const nullifier = tree.getNullifier(secret);
  saveTree(tree);

  console.log(JSON.stringify({
    leafIndex: index,
    nullifier: nullifier.toString(10),
    root: root.toString(10),
  }, null, 2));
}

async function cmdRoot(): Promise<void> {
  const tree = await loadTree();
  const root = tree.getRoot();
  console.log(root.toString(10));
}

async function cmdProof(indexStr: string): Promise<void> {
  const leafIndex = parseInt(indexStr, 10);
  if (isNaN(leafIndex) || leafIndex < 0) {
    console.error(`Error: "${indexStr}" is not a valid non-negative integer`);
    process.exit(1);
  }

  const tree = await loadTree();
  const proof = tree.getProof(leafIndex);
  const root = tree.getRoot();

  console.log(JSON.stringify({
    leafIndex,
    root: root.toString(10),
    pathElements: proof.pathElements.map((e) => e.toString(10)),
    pathIndices: proof.pathIndices,
  }, null, 2));
}

async function cmdExport(destFile: string): Promise<void> {
  const tree = await loadTree();
  const data = tree.toJSON();
  const dest = path.resolve(process.cwd(), destFile);
  fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Tree exported to ${dest}`);
}

async function cmdImport(srcFile: string): Promise<void> {
  const src = path.resolve(process.cwd(), srcFile);
  if (!fs.existsSync(src)) {
    console.error(`Error: file not found: ${src}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(src, 'utf8');
  const data: TreeJSON = JSON.parse(raw);
  const tree = await PoseidonMerkleTree.fromJSON(data);
  saveTree(tree);
  console.log(`Imported tree from ${src} (nextIndex=${data.nextIndex}, root=${tree.getRoot().toString(10)})`);
}

function printUsage(): void {
  console.log(`
manage-tree — Poseidon Merkle tree admin tool

Usage:
  npx ts-node circuits/scripts/manage-tree.ts <command> [args]

Commands:
  add <secret>      Insert a secret (bigint) and print { leafIndex, nullifier, root }
  root              Print the current Merkle root
  proof <index>     Print the Merkle proof for the leaf at <index>
  export <file>     Export tree state to JSON <file>
  import <file>     Import (replace) tree state from JSON <file>

Environment:
  TREE_PATH         Path to persistent tree JSON (default: ./tree-state.json)

Examples:
  npx ts-node circuits/scripts/manage-tree.ts add 123456789
  npx ts-node circuits/scripts/manage-tree.ts root
  npx ts-node circuits/scripts/manage-tree.ts proof 0
  npx ts-node circuits/scripts/manage-tree.ts export backup.json
  npx ts-node circuits/scripts/manage-tree.ts import backup.json
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'add':
      if (!args[1]) { console.error('Usage: add <secret>'); process.exit(1); }
      await cmdAdd(args[1]);
      break;
    case 'root':
      await cmdRoot();
      break;
    case 'proof':
      if (!args[1]) { console.error('Usage: proof <index>'); process.exit(1); }
      await cmdProof(args[1]);
      break;
    case 'export':
      if (!args[1]) { console.error('Usage: export <file>'); process.exit(1); }
      await cmdExport(args[1]);
      break;
    case 'import':
      if (!args[1]) { console.error('Usage: import <file>'); process.exit(1); }
      await cmdImport(args[1]);
      break;
    default:
      printUsage();
      if (command) process.exit(1);
      break;
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
