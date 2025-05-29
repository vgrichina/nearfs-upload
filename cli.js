#!/usr/bin/env node

import mri from 'mri';
import { connect, keyStores, transactions, KeyPair } from 'near-api-js';
import { executeUpload } from './index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const defaultMriConfig = {
    boolean: ['help'],
    string: ['network', 'accountId', 'privateKey', 'gatewayUrl', 'nodeUrl'],
    alias: {
        h: 'help',
        n: 'network',
        a: 'accountId',
        k: 'privateKey',
        'account-id': 'accountId',
        'private-key': 'privateKey', 
        'gateway-url': 'gatewayUrl',
        'node-url': 'nodeUrl'
    },
    default: {
        network: 'testnet'
    }
};

const usage = `
  Usage: nearfs-upload [options] <path>

  Upload files, directories, or CAR files to NEARFS. CAR files are detected by .car extension.

  Options:
    -h, --help                Show this help message
    -n, --network            NEAR network (default: testnet)
    -a, --account-id         NEAR account ID (can also use NEAR_ACCOUNT_ID env var)
    -k, --private-key        NEAR account private key (can also use NEAR_PRIVATE_KEY env var)
    --gateway-url            Custom IPFS gateway URL for non-mainnet/testnet networks
    --node-url              Custom NEAR RPC node URL (default: https://rpc.{network}.near.org)

  The CLI will look for credentials in the following order:
  1. Command line arguments
  2. Environment variables (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY)
  3. near-cli credentials (~/.near-credentials/{network}/{accountId}.json)

  Examples:
    nearfs-upload ./my-files --account-id example.testnet --private-key "ed25519:..."
    nearfs-upload ./my-file.car --account-id example.testnet
    NEAR_ACCOUNT_ID=example.testnet NEAR_PRIVATE_KEY=ed25519:... nearfs-upload ./my-files
    nearfs-upload ./my-files --network custom --gateway-url https://ipfs.custom.example.com
    nearfs-upload ./my-files --node-url https://my-custom-near-node.com
`;

async function loadNearCliCredentials(networkId, accountId) {
    try {
        const credentialsPath = path.join(
            os.homedir(),
            '.near-credentials',
            networkId,
            `${accountId}.json`
        );
        const credentialsStr = await fs.readFile(credentialsPath, 'utf8');
        return JSON.parse(credentialsStr);
    } catch (error) {
        return null;
    }
}

async function setupNearConnection(networkId, accountId, privateKey, nodeUrl) {
    // Try to get credentials in order of precedence
    let finalAccountId = accountId || process.env.NEAR_ACCOUNT_ID;
    let finalPrivateKey = privateKey || process.env.NEAR_PRIVATE_KEY;

    // Try near-cli credentials if we have an account ID
    if (finalAccountId) {
        console.log('Loading near-cli credentials', networkId, finalAccountId);
        const credentials = await loadNearCliCredentials(networkId, finalAccountId);
        if (credentials) {
            finalPrivateKey = finalPrivateKey || credentials.private_key;
        }
    }

    // Validate we have all required credentials
    if (!finalAccountId || !finalPrivateKey) {
        throw new Error(
            'Missing credentials. Please provide them via command line arguments, ' +
            'environment variables, or ensure near-cli credentials exist.'
        );
    }

    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(finalPrivateKey);
    await keyStore.setKey(networkId, finalAccountId, keyPair);

    const config = {
        networkId,
        keyStore,
        nodeUrl: nodeUrl || `https://rpc.${networkId}.near.org`,
        logger: false
    };

    const near = await connect(config);
    return {
        account: await near.account(finalAccountId),
        accountId: finalAccountId
    };
}


async function main(rawArgv = process.argv.slice(2)) {
    const argv = mri(rawArgv, defaultMriConfig);
    
    if (argv.help || argv._.length === 0) {
        console.log(usage);
        process.exit(0);
    }

    const filePath = argv._[0];

    if (!filePath) {
        console.error('Error: Missing file path');
        console.log(usage);
        process.exit(1);
    }

    try {
        const nearConnection = await setupNearConnection(
            argv.network,
            argv.accountId,
            argv.privateKey,
            argv.nodeUrl
        );
        
        const { rootCid, gatewayUrl } = await executeUpload(
            filePath,
            nearConnection,
            { 
                network: argv.network, 
                gatewayUrl: argv.gatewayUrl,
                transactions 
            }
        );
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

export { main };
