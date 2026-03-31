"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADDRESSES = void 0;
exports.getAddresses = getAddresses;
exports.ADDRESSES = {
    // Anvil local devnet
    31337: {
        zkVerifier: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        clawliaToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        modelRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        captchaGate: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
        marketFactory: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    },
    // Arbitrum Sepolia (testnet)
    421614: {
        clawliaToken: '0x8DD72e134641e0Ef04e8CD1aE97566F21E2f816a',
        modelRegistry: '0xECD445CAd04f6a1ac0f0C3eC0FD48140B4381586',
        marketFactory: '0xC1e8E62021DB22C416Ad41CE9472C1D3f07EAE02',
        captchaGate: '0x30b619BAed6DcD055e28228cA7E113681AeCb6B3',
        zkVerifier: '0x57c0C95f188E787Bc2540BD9903e09b0e7b10440',
    },
    // Arbitrum mainnet — not yet deployed
};
/** Returns addresses for the given chain, throwing if unknown. */
function getAddresses(chainId) {
    const addrs = exports.ADDRESSES[chainId];
    if (!addrs) {
        throw new Error(`No contract addresses for chainId ${chainId}. ` +
            `Supported chains: ${Object.keys(exports.ADDRESSES).join(', ')}`);
    }
    return addrs;
}
//# sourceMappingURL=addresses.js.map