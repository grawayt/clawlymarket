/**
 * captcha-generator.ts
 *
 * Generates 100 challenge sets for CaptchaGateV2. Each set contains 6 challenges
 * spanning 5 types: Math (×2), Code Trace (×1), Logic (×1), Pattern (×1), Format (×1).
 *
 * Outputs:
 *   scripts/captcha-data/captcha-challenges.json  — question texts + set IDs (serve from frontend public/)
 *   scripts/captcha-data/captcha-hashes.json      — answer hashes for on-chain loading
 *
 * Usage:
 *   npx ts-node scripts/captcha-generator.ts
 *   # or from the repo root if ts-node is available:
 *   npx tsx scripts/captcha-generator.ts
 *
 * The answer hash for each set is:
 *   keccak256(abi.encodePacked(answer0, answer1, answer2, answer3, answer4, answer5))
 * which in JS/ethers v6 is:
 *   ethers.solidityPackedKeccak256(['string','string','string','string','string','string'], answers)
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// ── Constants ────────────────────────────────────────────────────────────────

const NUM_SETS = 100;
const OUT_DIR = path.join(__dirname, "captcha-data");

// ── Type definitions ─────────────────────────────────────────────────────────

interface Challenge {
  type: string;
  question: string;
  answer: string;
}

interface ChallengeSet {
  setId: number;
  challenges: Challenge[];
}

interface ChallengesFile {
  generatedAt: string;
  totalSets: number;
  challengesPerSet: number;
  sets: ChallengeSet[];
}

interface HashesFile {
  generatedAt: string;
  totalSets: number;
  answerHashes: string[];
}

// ── Challenge Type 1 — Math (mod arithmetic) ─────────────────────────────────

/**
 * Returns { question, answer } for a math challenge of the form:
 *   (a * b + c) mod p
 * Uses deterministic parameters derived from the set index and slot (0 or 1).
 */
function makeMathChallenge(setIndex: number, slot: number): Challenge {
  // Deterministic but varied parameter generation without needing a hash library.
  // We use simple LCG-style mixing so parameters differ across sets.
  const mix = (n: number) => (((n * 6364136223846793005n) + 1442695040888963407n) & 0xFFFFFFFFFFFFn);

  const seed = BigInt(setIndex * 1000 + slot * 100 + 7);
  const a = Number(mix(seed) % 9000n) + 1000;           // [1000, 9999]
  const b = Number(mix(seed + 1n) % 9000n) + 1000;       // [1000, 9999]
  const c = Number(mix(seed + 2n) % 9000n) + 1000;       // [1000, 9999]
  // Use a prime-ish modulus in [7919, 9973] for good spread
  const primes = [7919, 8191, 8209, 8221, 8231, 8233, 8237, 8243, 8263, 8269,
                  8273, 8287, 8291, 8293, 8297, 9001, 9007, 9011, 9013, 9029,
                  9041, 9043, 9049, 9059, 9067, 9091, 9103, 9109, 9127, 9133,
                  9137, 9151, 9157, 9161, 9173, 9181, 9187, 9199, 9203, 9209,
                  9221, 9227, 9239, 9241, 9257, 9277, 9281, 9283, 9293, 9311,
                  9319, 9323, 9337, 9341, 9343, 9349, 9371, 9377, 9391, 9397,
                  9403, 9413, 9419, 9421, 9431, 9433, 9437, 9439, 9461, 9463,
                  9467, 9473, 9479, 9491, 9497, 9511, 9521, 9533, 9539, 9547,
                  9551, 9587, 9601, 9613, 9619, 9623, 9629, 9631, 9643, 9649,
                  9661, 9677, 9679, 9689, 9697, 9719, 9721, 9733, 9739, 9743];
  const p = primes[Number(mix(seed + 3n) % BigInt(primes.length))];

  const answer = ((a * b + c) % p).toString();

  return {
    type: "math",
    question: `Compute: (${a} * ${b} + ${c}) mod ${p}`,
    answer,
  };
}

// ── Challenge Type 2 — Code Trace ────────────────────────────────────────────

/**
 * Generates a code trace challenge by computing f(n) where:
 *   function f(n) { let x = 1; for (let i = 0; i < n; i++) x = (x * m + d) % 100; return x; }
 * Parameters m, d, n vary by set index.
 */
function makeCodeTraceChallenge(setIndex: number): Challenge {
  // Vary the multiplier, addend, and iteration count deterministically.
  const multipliers = [3, 5, 7, 11, 13, 17, 19, 23];
  const addends     = [1, 2, 3, 5, 7, 11, 13, 17];
  const iterations  = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

  const m = multipliers[setIndex % multipliers.length];
  const d = addends[(setIndex * 3 + 1) % addends.length];
  const n = iterations[(setIndex * 7 + 2) % iterations.length];

  // Compute the answer deterministically (same logic as the JS function body).
  let x = 1;
  for (let i = 0; i < n; i++) {
    x = (x * m + d) % 100;
  }
  const answer = x.toString();

  return {
    type: "code_trace",
    question: `function f(n) { let x = 1; for (let i = 0; i < n; i++) x = (x * ${m} + ${d}) % 100; return x; } What does f(${n}) return?`,
    answer,
  };
}

// ── Challenge Type 3 — Logic ──────────────────────────────────────────────────

/**
 * Generates a syllogism challenge.
 * All generated challenges have a definite YES or NO answer.
 */
interface LogicTemplate {
  question: (vars: string[]) => string;
  answer: string;
}

const LOGIC_TEMPLATES: LogicTemplate[] = [
  // "All A are B. No B are C. Can an A be a C?" → NO
  {
    question: ([A, B, C]) => `Given: All ${A}s are ${B}s. No ${B}s are ${C}s. Is it possible for an ${A} to be a ${C}? Answer YES or NO.`,
    answer: "NO",
  },
  // "All A are B. All B are C. Can an A be a C?" → YES
  {
    question: ([A, B, C]) => `Given: All ${A}s are ${B}s. All ${B}s are ${C}s. Is it possible for an ${A} to be a ${C}? Answer YES or NO.`,
    answer: "YES",
  },
  // "No A are B. Some C are A. Can a C be a B?" → NO
  {
    question: ([A, B, C]) => `Given: No ${A}s are ${B}s. Some ${C}s are ${A}s. Can a ${C} be a ${B}? Answer YES or NO.`,
    answer: "NO",
  },
  // "All A are B. Some B are C. Must some A be C?" → NO (but can be) → answer is YES (possible)
  {
    question: ([A, B, C]) => `Given: All ${A}s are ${B}s. Some ${B}s are ${C}s. Is it possible for an ${A} to be a ${C}? Answer YES or NO.`,
    answer: "YES",
  },
  // "No A are B. No B are C. Can an A be a C?" → YES (no constraint between A and C directly)
  {
    question: ([A, B, C]) => `Given: No ${A}s are ${B}s. No ${B}s are ${C}s. Is it necessarily impossible for an ${A} to be a ${C}? Answer YES or NO.`,
    answer: "NO",
  },
];

// Variable name pools (single uppercase letters to keep it readable)
const VAR_SETS: [string, string, string][] = [
  ["X", "Y", "Z"],
  ["P", "Q", "R"],
  ["A", "B", "C"],
  ["M", "N", "O"],
  ["U", "V", "W"],
  ["G", "H", "K"],
  ["D", "E", "F"],
  ["L", "S", "T"],
];

function makeLogicChallenge(setIndex: number): Challenge {
  const template = LOGIC_TEMPLATES[setIndex % LOGIC_TEMPLATES.length];
  const vars = VAR_SETS[(setIndex * 3 + 1) % VAR_SETS.length];
  return {
    type: "logic",
    question: template.question(vars),
    answer: template.answer,
  };
}

// ── Challenge Type 4 — Pattern ────────────────────────────────────────────────

interface PatternTemplate {
  termsFn: (setIndex: number) => number[];
  nextFn:  (setIndex: number) => number;
}

/**
 * Builds sequences using geometric or arithmetic progressions.
 * We vary the base/ratio deterministically by setIndex.
 */
function makePatternChallenge(setIndex: number): Challenge {
  // Alternate between geometric and arithmetic sequences
  const isGeometric = setIndex % 2 === 0;

  let terms: number[];
  let next: number;
  let question: string;

  if (isGeometric) {
    // Geometric: first = (setIndex % 5) + 2, ratio = (setIndex % 4) + 2
    const first = (setIndex % 5) + 2;         // [2..6]
    const ratio = (setIndex % 4) + 2;          // [2..5]
    terms = [first, first * ratio, first * ratio ** 2, first * ratio ** 3];
    next  = first * ratio ** 4;
    question = `What is the next number: ${terms.join(", ")}, ?`;
  } else {
    // Arithmetic: first = (setIndex % 10) + 1, diff = (setIndex % 9) + 2
    const first = (setIndex % 10) + 1;         // [1..10]
    const diff  = (setIndex % 9) + 2;           // [2..10]
    terms = [first, first + diff, first + 2 * diff, first + 3 * diff];
    next  = first + 4 * diff;
    question = `What is the next number: ${terms.join(", ")}, ?`;
  }

  return {
    type: "pattern",
    question,
    answer: next.toString(),
  };
}

// ── Challenge Type 5 — Format ─────────────────────────────────────────────────

/**
 * Generates a JSON-format challenge. The agent must compute three values and
 * output them in a strictly specified JSON format (no extra spaces, exact key order).
 *
 * Template: {"sum":<a+b>,"product":<c*d>,"mod":<e mod f>}
 */
function makeFormatChallenge(setIndex: number): Challenge {
  // Deterministic parameters
  const a = 100 + (setIndex * 37) % 900;      // [100..999]
  const b = 200 + (setIndex * 53) % 800;      // [200..999]
  const c = 10  + (setIndex * 11) % 90;       // [10..99]
  const d = 10  + (setIndex * 17) % 90;       // [10..99]
  const e = 1000 + (setIndex * 97) % 9000;    // [1000..9999]
  const f = 100  + (setIndex * 43) % 900;     // [100..999]

  const sum     = a + b;
  const product = c * d;
  const mod     = e % f;

  const answer = `{"sum":${sum},"product":${product},"mod":${mod}}`;

  return {
    type: "format",
    question: `Output a JSON string with exactly these keys in this order: sum (${a}+${b}), product (${c}*${d}), mod (${e} mod ${f}). No spaces. Example shape: {"sum":0,"product":0,"mod":0}`,
    answer,
  };
}

// ── Hash computation ──────────────────────────────────────────────────────────

/**
 * Computes keccak256(abi.encodePacked(a0, a1, a2, a3, a4, a5))
 * matching the Solidity contract's verification logic exactly.
 */
function computeAnswerHash(answers: string[]): string {
  return ethers.solidityPackedKeccak256(
    answers.map(() => "string"),
    answers
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log(`Generating ${NUM_SETS} challenge sets...`);

  const sets: ChallengeSet[] = [];
  const answerHashes: string[] = [];

  for (let i = 0; i < NUM_SETS; i++) {
    const challenges: Challenge[] = [
      makeMathChallenge(i, 0),        // math 1  (index 0)
      makeMathChallenge(i, 1),        // math 2  (index 1)
      makeCodeTraceChallenge(i),      // code     (index 2)
      makeLogicChallenge(i),          // logic    (index 3)
      makePatternChallenge(i),        // pattern  (index 4)
      makeFormatChallenge(i),         // format   (index 5)
    ];

    const answers = challenges.map((c) => c.answer);
    const hash = computeAnswerHash(answers);

    sets.push({ setId: i, challenges });
    answerHashes.push(hash);

    if ((i + 1) % 10 === 0) {
      console.log(`  Generated sets 0–${i}`);
    }
  }

  // ── Write outputs ──────────────────────────────────────────────────────────

  const now = new Date().toISOString();

  const challengesFile: ChallengesFile = {
    generatedAt: now,
    totalSets: NUM_SETS,
    challengesPerSet: 6,
    sets,
  };

  const hashesFile: HashesFile = {
    generatedAt: now,
    totalSets: NUM_SETS,
    answerHashes,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const challengesPath = path.join(OUT_DIR, "captcha-challenges.json");
  const hashesPath     = path.join(OUT_DIR, "captcha-hashes.json");

  fs.writeFileSync(challengesPath, JSON.stringify(challengesFile, null, 2));
  fs.writeFileSync(hashesPath,     JSON.stringify(hashesFile,     null, 2));

  console.log(`\nWrote ${challengesPath}`);
  console.log(`Wrote ${hashesPath}`);
  console.log(`\nSample set 0 answers:   ${sets[0].challenges.map((c) => c.answer).join(" | ")}`);
  console.log(`Sample set 0 hash:      ${answerHashes[0]}`);
  console.log(`\nTo load on-chain, pass the answerHashes array to CaptchaGateV2.loadChallengeSets().`);
  console.log(`The challenges JSON should be served from frontend/public/captcha-challenges.json`);
  console.log(`so the frontend can fetch it by set ID.`);
}

main();
