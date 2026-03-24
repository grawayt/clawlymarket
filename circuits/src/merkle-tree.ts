/**
 * PoseidonMerkleTree — a full binary Merkle tree using Poseidon hashing,
 * matching the circom circuit in api-key-email.circom exactly.
 *
 * Tree structure:
 *   - 10 levels, 2^10 = 1024 leaves
 *   - Leaf value = Poseidon(secret)         (1 input)
 *   - Internal nodes = Poseidon(left, right) (2 inputs)
 *   - Zero leaves start at 0; zero[i] = Poseidon(zero[i-1], zero[i-1])
 *   - pathIndices bits: 0 = node is left child, 1 = node is right child
 */

import { buildPoseidon } from 'circomlibjs';

type PoseidonFn = (inputs: bigint[] | Uint8Array[]) => Uint8Array;
interface PoseidonLib {
  (inputs: bigint[]): Uint8Array;
  F: {
    toObject(x: Uint8Array): bigint;
  };
}

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
}

export interface TreeJSON {
  levels: number;
  leaves: string[];    // bigint as decimal strings
  nextIndex: number;
}

export class PoseidonMerkleTree {
  private levels: number;
  private capacity: number;
  private poseidon!: PoseidonLib;
  private F!: PoseidonLib['F'];

  /** All stored leaf hashes (length = capacity, unfilled = zero[0] = 0n) */
  private leaves: bigint[];
  /** Next free leaf slot */
  private nextIndex: number;

  /** Cached zero values: zero[i] is the hash of an empty subtree at level i */
  private zeros!: bigint[];
  /** Internal node cache: nodes[level][index] */
  private nodes: Map<number, Map<number, bigint>> = new Map();

  constructor(levels: number = 10) {
    this.levels = levels;
    this.capacity = 1 << levels; // 2^levels
    this.leaves = new Array(this.capacity).fill(0n);
    this.nextIndex = 0;
  }

  /** Must be called before any other method. */
  async init(): Promise<void> {
    this.poseidon = (await buildPoseidon()) as unknown as PoseidonLib;
    this.F = this.poseidon.F;
    this._computeZeros();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Hash the secret with Poseidon(1) to produce a leaf, then insert it.
   * Returns the index of the newly inserted leaf.
   */
  insert(secret: bigint): number {
    this._assertInitialized();
    if (this.nextIndex >= this.capacity) {
      throw new Error(`Tree is full (capacity ${this.capacity})`);
    }
    const leafHash = this.getLeafHash(secret);
    const index = this.nextIndex;
    this.leaves[index] = leafHash;
    this._updatePath(index);
    this.nextIndex++;
    return index;
  }

  /** Current Merkle root. */
  getRoot(): bigint {
    this._assertInitialized();
    return this._getNode(this.levels, 0);
  }

  /**
   * Generate a Merkle proof for the leaf at leafIndex.
   * pathIndices[i] = 0 means the current node is the LEFT child at level i.
   * pathIndices[i] = 1 means the current node is the RIGHT child at level i.
   */
  getProof(leafIndex: number): MerkleProof {
    this._assertInitialized();
    if (leafIndex < 0 || leafIndex >= this.capacity) {
      throw new Error(`leafIndex ${leafIndex} out of range [0, ${this.capacity})`);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.levels; level++) {
      const isRight = currentIndex & 1; // 1 if right child, 0 if left child
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      pathIndices.push(isRight);
      pathElements.push(this._getNode(level, siblingIndex));
      currentIndex >>= 1;
    }

    return { pathElements, pathIndices };
  }

  /**
   * Poseidon(secret) — this is both the leaf value and the circuit nullifier.
   * The circuit uses the same Poseidon(1) operation for both.
   */
  getNullifier(secret: bigint): bigint {
    this._assertInitialized();
    return this._poseidon1(secret);
  }

  /** Poseidon(secret) — the leaf value stored in the tree. */
  getLeafHash(secret: bigint): bigint {
    this._assertInitialized();
    return this._poseidon1(secret);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  toJSON(): TreeJSON {
    return {
      levels: this.levels,
      leaves: this.leaves.map((l) => l.toString(10)),
      nextIndex: this.nextIndex,
    };
  }

  static async fromJSON(data: TreeJSON): Promise<PoseidonMerkleTree> {
    const tree = new PoseidonMerkleTree(data.levels);
    await tree.init();
    tree.leaves = data.leaves.map((s) => BigInt(s));
    tree.nextIndex = data.nextIndex;
    // Rebuild internal node cache from scratch
    tree._rebuildNodes();
    return tree;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _assertInitialized(): void {
    if (!this.poseidon) {
      throw new Error('Tree not initialized — call await tree.init() first');
    }
  }

  /** Poseidon hash of a single input (for leaf/nullifier computation). */
  private _poseidon1(input: bigint): bigint {
    const hash = this.poseidon([input]);
    return this.F.toObject(hash);
  }

  /** Poseidon hash of two inputs (for internal nodes). */
  private _poseidon2(left: bigint, right: bigint): bigint {
    const hash = this.poseidon([left, right]);
    return this.F.toObject(hash);
  }

  /**
   * Precompute zero[i]: the hash of a fully-empty subtree at level i.
   *   zero[0] = 0n  (empty leaf)
   *   zero[i] = Poseidon(zero[i-1], zero[i-1])
   */
  private _computeZeros(): void {
    this.zeros = new Array(this.levels + 1);
    this.zeros[0] = 0n;
    for (let i = 1; i <= this.levels; i++) {
      this.zeros[i] = this._poseidon2(this.zeros[i - 1], this.zeros[i - 1]);
    }
  }

  /** Get (or compute) the node at (level, index). Level 0 = leaves. */
  private _getNode(level: number, index: number): bigint {
    if (level === 0) {
      return this.leaves[index] ?? 0n;
    }
    const levelMap = this.nodes.get(level);
    if (levelMap) {
      const cached = levelMap.get(index);
      if (cached !== undefined) return cached;
    }
    // Not cached — compute from children or fall back to zero
    const leftChild = this._getNode(level - 1, index * 2);
    const rightChild = this._getNode(level - 1, index * 2 + 1);
    const isLeftZero = leftChild === this.zeros[level - 1];
    const isRightZero = rightChild === this.zeros[level - 1];
    if (isLeftZero && isRightZero) {
      return this.zeros[level];
    }
    return this._poseidon2(leftChild, rightChild);
  }

  /** Update all internal nodes on the path from leafIndex to the root. */
  private _updatePath(leafIndex: number): void {
    let currentIndex = leafIndex;
    for (let level = 1; level <= this.levels; level++) {
      const parentIndex = currentIndex >> 1;
      const leftChildIndex = parentIndex * 2;
      const rightChildIndex = leftChildIndex + 1;
      const leftChild = this._getNode(level - 1, leftChildIndex);
      const rightChild = this._getNode(level - 1, rightChildIndex);
      const parentHash = this._poseidon2(leftChild, rightChild);
      if (!this.nodes.has(level)) {
        this.nodes.set(level, new Map());
      }
      this.nodes.get(level)!.set(parentIndex, parentHash);
      currentIndex = parentIndex;
    }
  }

  /** Rebuild the entire internal node cache from leaves (used after deserialization). */
  private _rebuildNodes(): void {
    this.nodes = new Map();
    for (let i = 0; i < this.nextIndex; i++) {
      this._updatePath(i);
    }
  }
}
