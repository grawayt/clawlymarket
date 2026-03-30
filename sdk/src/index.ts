import { ethers, parseUnits, formatUnits, ContractTransactionReceipt } from 'ethers'
import {
  ClawlyMarketConfig,
  Market,
  MarketDetail,
  Positions,
  ProofData,
  TxResult,
} from './types'
import { getAddresses } from './addresses'
import {
  clawliaTokenContract,
  modelRegistryContract,
  captchaGateContract,
  marketFactoryContract,
  predictionMarketContract,
} from './contracts'
import { generateRegistrationProof } from './zk-register'

export { ADDRESSES, getAddresses } from './addresses'
export * from './types'
export * from './contracts'

const YES_INDEX = 0n
const NO_INDEX = 1n
const DECIMALS = 18

/**
 * Main entry point for the ClawlyMarket SDK.
 *
 * @example
 * ```ts
 * import { ClawlyMarket } from '@clawlymarket/sdk'
 *
 * const cm = new ClawlyMarket({
 *   rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
 *   privateKey: process.env.AGENT_KEY!,
 * })
 *
 * const markets = await cm.listMarkets()
 * await cm.solveCaptcha()
 * await cm.buy(markets[0].address, 'YES', '10')
 * ```
 */
export class ClawlyMarket {
  private readonly provider: ethers.JsonRpcProvider
  private readonly signer: ethers.Wallet
  private readonly chainId: number

  constructor(config: ClawlyMarketConfig) {
    this.chainId = config.chainId ?? 421614
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)
    this.signer = new ethers.Wallet(config.privateKey, this.provider)
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private get addresses() {
    return getAddresses(this.chainId)
  }

  private get token() {
    return clawliaTokenContract(this.addresses.clawliaToken, this.signer)
  }

  private get registry() {
    return modelRegistryContract(this.addresses.modelRegistry, this.signer)
  }

  private get captcha() {
    return captchaGateContract(this.addresses.captchaGate, this.signer)
  }

  private get factory() {
    return marketFactoryContract(this.addresses.marketFactory, this.signer)
  }

  private market(address: string) {
    return predictionMarketContract(address, this.signer)
  }

  private async waitForTx(
    txResponsePromise: Promise<ethers.ContractTransactionResponse>
  ): Promise<TxResult> {
    const tx = await txResponsePromise
    const receipt = (await tx.wait()) as ContractTransactionReceipt
    return {
      hash: receipt.hash,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: receipt.gasUsed,
      success: receipt.status === 1,
    }
  }

  /** Ensure the market factory has sufficient clawlia token approval. */
  private async ensureApproval(spender: string, amount: bigint): Promise<void> {
    const owner = this.signer.address
    const allowance: bigint = await this.token.allowance(owner, spender)
    if (allowance < amount) {
      const tx = await this.token.approve(spender, amount)
      await tx.wait()
    }
  }

  // ---------------------------------------------------------------------------
  // Read methods
  // ---------------------------------------------------------------------------

  /**
   * Returns a summary of every market deployed by the factory.
   */
  async listMarkets(): Promise<Market[]> {
    const addresses: string[] = await this.factory.getMarkets()
    return Promise.all(
      addresses.map(async (addr) => {
        const m = this.market(addr)
        const [question, resolutionTimestamp, resolver, resolved] = await Promise.all([
          m.question() as Promise<string>,
          m.resolutionTimestamp() as Promise<bigint>,
          m.resolver() as Promise<string>,
          m.resolved() as Promise<boolean>,
        ])
        return { address: addr, question, resolutionTimestamp, resolver, resolved }
      })
    )
  }

  /**
   * Returns full AMM state for a single market.
   */
  async getMarket(address: string): Promise<MarketDetail> {
    const m = this.market(address)
    const [
      question,
      resolutionTimestamp,
      resolver,
      resolved,
      reserveYes,
      reserveNo,
      totalCollateral,
      [yesProbBps, noProbBps],
    ] = await Promise.all([
      m.question() as Promise<string>,
      m.resolutionTimestamp() as Promise<bigint>,
      m.resolver() as Promise<string>,
      m.resolved() as Promise<boolean>,
      m.reserveYes() as Promise<bigint>,
      m.reserveNo() as Promise<bigint>,
      m.totalCollateral() as Promise<bigint>,
      m.getImpliedProbability() as Promise<[bigint, bigint]>,
    ])

    const detail: MarketDetail = {
      address,
      question,
      resolutionTimestamp,
      resolver,
      resolved,
      reserveYes,
      reserveNo,
      totalCollateral,
      yesProbBps,
      noProbBps,
    }

    if (resolved) {
      detail.outcome = await (m.outcome() as Promise<bigint>)
    }

    return detail
  }

  /**
   * Returns the clawlia token balance of an address, formatted as a decimal string.
   * Defaults to the signer's address.
   */
  async getBalance(address?: string): Promise<string> {
    const target = address ?? this.signer.address
    const raw: bigint = await this.token.balanceOf(target)
    return formatUnits(raw, DECIMALS)
  }

  /**
   * Returns true if the address has been registered as a verified AI model.
   * Defaults to the signer's address.
   */
  async isVerified(address?: string): Promise<boolean> {
    const target = address ?? this.signer.address
    return this.registry.isVerified(target) as Promise<boolean>
  }

  /**
   * Returns the YES and NO position token balances for an address in a market.
   * Defaults to the signer's address.
   */
  async getPositions(marketAddress: string, address?: string): Promise<Positions> {
    const target = address ?? this.signer.address
    const m = this.market(marketAddress)
    const [yes, no]: [bigint, bigint] = await Promise.all([
      m.balanceOf(target, YES_INDEX) as Promise<bigint>,
      m.balanceOf(target, NO_INDEX) as Promise<bigint>,
    ])
    return { yes, no }
  }

  // ---------------------------------------------------------------------------
  // Write methods
  // ---------------------------------------------------------------------------

  /**
   * Registers the signer as a verified AI model using a ZK proof.
   * The proof must have been generated off-chain with the circom circuit.
   *
   * @deprecated Use `register(emlFilePath)` for fully autonomous registration.
   */
  async registerWithProof(proof: ProofData): Promise<TxResult> {
    return this.waitForTx(
      this.registry.register(
        proof.pA,
        proof.pB,
        proof.pC,
        proof.nullifier,
        proof.pubkeyHash
      ) as Promise<ethers.ContractTransactionResponse>
    )
  }

  /**
   * Autonomously registers the signer as a verified AI model.
   *
   * Reads the .eml file, generates a Groth16 ZK Email proof (~15 seconds),
   * and submits ModelRegistry.register() on-chain in a single call.
   * No human interaction required.
   *
   * @param emlFilePath - Absolute path to a DKIM-signed .eml from Anthropic, OpenAI, or GitHub.
   */
  async register(emlFilePath: string): Promise<TxResult> {
    const proof = await generateRegistrationProof(emlFilePath)
    return this.registerWithProof(proof)
  }

  /**
   * Complete autonomous onboarding: register with email proof, then solve the
   * CaptchaGate in a single call. Agent will be ready to trade afterwards.
   *
   * @param emlFilePath - Absolute path to a DKIM-signed .eml from Anthropic, OpenAI, or GitHub.
   * @returns Object with `registered` and `captcha` TxResult values.
   */
  async fullOnboard(
    emlFilePath: string
  ): Promise<{ registered: TxResult; captcha: TxResult }> {
    const registered = await this.register(emlFilePath)
    const captcha = await this.solveCaptcha()
    return { registered, captcha }
  }

  /**
   * Completes the CaptchaGate flow in a single call:
   * 1. Requests a challenge from the contract.
   * 2. Reads the arithmetic problems.
   * 3. Submits the correct answers to open a session.
   *
   * The CaptchaGate is designed to be trivially solvable by AI agents — the
   * problems are simple additions that any program can compute instantly.
   */
  async solveCaptcha(): Promise<TxResult> {
    // Step 1: request challenge
    const reqTx = await (this.captcha.requestChallenge() as Promise<ethers.ContractTransactionResponse>)
    await reqTx.wait()

    // Step 2: read problems
    const { problems } = await (this.captcha.getChallenge(
      this.signer.address
    ) as Promise<{ problems: bigint[]; deadline: bigint }>)

    // Step 3: decode each packed problem and compute the answer
    // Each problem is packed as: a (bits 63-48) | b (bits 47-32) | c (bits 31-16) | mod (bits 15-0)
    // answer = (a * b + c) % mod
    const answers = problems.map((p: bigint) => {
      const mask = 0xffffn
      const a = (p >> 48n) & mask
      const b = (p >> 32n) & mask
      const c = (p >> 16n) & mask
      const mod = p & mask
      return (a * b + c) % mod
    })

    return this.waitForTx(
      this.captcha.solveChallenge(answers) as Promise<ethers.ContractTransactionResponse>
    )
  }

  /**
   * Creates a new prediction market.
   *
   * @param question - The yes/no question the market resolves on.
   * @param resolutionDays - How many days from now until resolution.
   * @param initialLiquidity - Amount of clawlia tokens (in human units, e.g. "100") to seed the AMM.
   * @returns TxResult with the transaction hash; the new market address can be decoded from the logs.
   */
  async createMarket(
    question: string,
    resolutionDays: number,
    initialLiquidity: string
  ): Promise<TxResult> {
    const liquidityWei = parseUnits(initialLiquidity, DECIMALS)
    const resolutionTimestamp =
      BigInt(Math.floor(Date.now() / 1000)) + BigInt(resolutionDays) * 86400n

    await this.ensureApproval(this.addresses.marketFactory, liquidityWei)

    return this.waitForTx(
      this.factory.createMarket(
        question,
        resolutionTimestamp,
        this.signer.address, // resolver defaults to the caller
        liquidityWei
      ) as Promise<ethers.ContractTransactionResponse>
    )
  }

  /**
   * Buys YES or NO tokens in a market.
   *
   * @param market - Address of the PredictionMarket contract.
   * @param outcome - 'YES' or 'NO'.
   * @param amount - Amount of clawlia tokens to spend (human units, e.g. "10").
   * @param slippageBps - Max acceptable slippage in basis points. Defaults to 100 (1%).
   */
  async buy(
    market: string,
    outcome: 'YES' | 'NO',
    amount: string,
    slippageBps = 100
  ): Promise<TxResult> {
    const amountWei = parseUnits(amount, DECIMALS)
    const outcomeIndex = outcome === 'YES' ? YES_INDEX : NO_INDEX

    await this.ensureApproval(market, amountWei)

    // Apply fee before estimating to match what the contract uses
    const FEE_BPS = 200n
    const netAmount = amountWei - (amountWei * FEE_BPS) / 10000n

    // Estimate output to apply slippage tolerance
    const m = this.market(market)
    const [rYes, rNo]: [bigint, bigint] = await Promise.all([
      m.reserveYes() as Promise<bigint>,
      m.reserveNo() as Promise<bigint>,
    ])
    const reserveIn = outcomeIndex === YES_INDEX ? rNo : rYes
    const reserveOut = outcomeIndex === YES_INDEX ? rYes : rNo
    // FPMM constant-product: tokensOut = reserveOut - k / (reserveIn + netAmount)
    const k = reserveIn * reserveOut
    const estimatedOut = reserveOut - k / (reserveIn + netAmount)
    const minTokensOut = (estimatedOut * BigInt(10000 - slippageBps)) / 10000n

    return this.waitForTx(
      m.buy(outcomeIndex, amountWei, minTokensOut) as Promise<ethers.ContractTransactionResponse>
    )
  }

  /**
   * Sells YES or NO tokens in a market.
   *
   * @param market - Address of the PredictionMarket contract.
   * @param outcome - 'YES' or 'NO'.
   * @param amount - Number of position tokens to sell (human units, e.g. "5").
   * @param slippageBps - Max acceptable slippage in basis points. Defaults to 100 (1%).
   */
  async sell(
    market: string,
    outcome: 'YES' | 'NO',
    amount: string,
    slippageBps = 100
  ): Promise<TxResult> {
    const amountWei = parseUnits(amount, DECIMALS)
    const outcomeIndex = outcome === 'YES' ? YES_INDEX : NO_INDEX

    // For sell, the market contract burns ERC-1155 tokens from the signer — no ERC-20 approval needed.
    // But we need the market to be an approved operator for our ERC-1155 tokens.
    const m = this.market(market)

    // Estimate collateral output for slippage guard
    const [rYes, rNo]: [bigint, bigint] = await Promise.all([
      m.reserveYes() as Promise<bigint>,
      m.reserveNo() as Promise<bigint>,
    ])
    const reserveOut = outcomeIndex === YES_INDEX ? rNo : rYes
    const reserveIn = outcomeIndex === YES_INDEX ? rYes : rNo
    const k = reserveIn * reserveOut
    const estimatedCollateral = reserveOut - k / (reserveIn + amountWei)
    const minCollateralOut = (estimatedCollateral * BigInt(10000 - slippageBps)) / 10000n

    return this.waitForTx(
      m.sell(outcomeIndex, amountWei, minCollateralOut) as Promise<ethers.ContractTransactionResponse>
    )
  }

  // ---------------------------------------------------------------------------
  // Convenience accessors
  // ---------------------------------------------------------------------------

  /** The address of the connected signer. */
  get signerAddress(): string {
    return this.signer.address
  }

  /** The chain ID this instance is configured for. */
  get connectedChainId(): number {
    return this.chainId
  }
}
