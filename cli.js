#!/usr/bin/env node

import mri from 'mri';
import { connect, keyStores, transactions, KeyPair } from 'near-api-js';
import { uploadFiles, uploadCAR } from './index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const argv = mri(process.argv.slice(2), {
    boolean: ['help'],
    string: ['network', 'account-id', 'private-key', 'gateway-url'],
    alias: {
        h: 'help',
        n: 'network',
        a: 'account-id',
        k: 'private-key'
    },
    default: {
        network: 'testnet'
    }
});

const usage = `
  Usage: nearfs-upload <command> [options] <path>

  Commands:
    upload     Upload files or directories to NEARFS
    upload-car Upload a CAR file to NEARFS

  Options:
    -h, --help                Show this help message
    -n, --network            NEAR network (default: testnet)
    -a, --account-id         NEAR account ID (can also use NEAR_ACCOUNT_ID env var)
    -k, --private-key        NEAR account private key (can also use NEAR_PRIVATE_KEY env var)
    --gateway-url            Custom IPFS gateway URL for non-mainnet/testnet networks

  The CLI will look for credentials in the following order:
  1. Command line arguments
  2. Environment variables (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY)
  3. near-cli credentials (~/.near-credentials/{network}/{accountId}.json)

  Examples:
    nearfs-upload upload ./my-files --account-id example.testnet --private-key "ed25519:..."
    nearfs-upload upload-car ./my-file.car --account-id example.testnet
    NEAR_ACCOUNT_ID=example.testnet NEAR_PRIVATE_KEY=ed25519:... nearfs-upload upload ./my-files
    nearfs-upload upload ./my-files --network custom --gateway-url https://ipfs.custom.example.com
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

async function setupNearConnection(networkId, accountId, privateKey) {
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
        nodeUrl: `https://rpc.${networkId}.near.org`,
        logger: false
    };

    const near = await connect(config);
    return {
        account: await near.account(finalAccountId),
        accountId: finalAccountId
    };
}

async function readFilesRecursively(dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await readFilesRecursively(fullPath));
        } else {
            const content = await fs.readFile(fullPath);
            files.push({
                name: path.relative(dir, fullPath),
                content: Buffer.from(content)
            });
        }
    }

    return files;
}

async function main() {
    if (argv.help || argv._.length === 0) {
        console.log(usage);
        process.exit(0);
    }

    const command = argv._[0];
    const filePath = argv._[1];

    if (!filePath) {
        console.error('Error: Missing file path');
        console.log(usage);
        process.exit(1);
    }

    try {
        const { account, accountId } = await setupNearConnection(
            argv.network,
            argv.accountId,
            argv.privateKey
        );
        
        const signAndSendTransaction = async (blockDataArray) => {
            try {
                return await account.signAndSendTransaction({
                    receiverId: accountId,
                    actions: blockDataArray.map(data => 
                        transactions.functionCall('fs_store', data, '30000000000000', '0')
                    ),
                });
            } catch (error) {
                // Ignore MethodNotFound error as it happens during success case
                if (error.type === 'ActionError' && 
                    error.kind?.kind?.FunctionCallError?.MethodResolveError === 'MethodNotFound') {
                    return;
                }
                console.error('Error signing and sending transaction:', error);
                throw error;
            }
        };

        const options = {
            signAndSendTransaction,
            log: console.log,
            statusCallback: ({ currentBlocks, totalBlocks }) => {
                console.log(`Progress: ${currentBlocks}/${totalBlocks} blocks uploaded`);
            }
        };

        let rootCid;
        if (command === 'upload') {
            const stats = await fs.stat(filePath);
            const files = stats.isDirectory() 
                ? await readFilesRecursively(filePath)
                : [{
                    name: path.basename(filePath),
                    content: await fs.readFile(filePath)
                  }];

            rootCid = await uploadFiles(files, options);
        } else if (command === 'upload-car') {
            const carBuffer = await fs.readFile(filePath);
            rootCid = await uploadCAR(carBuffer, options);
        } else {
            console.error('Error: Unknown command');
            console.log(usage);
            process.exit(1);
        }

        console.log('\nUpload complete!');
        let gatewayUrl;
        if (argv.network === 'mainnet') {
            gatewayUrl = 'https://ipfs.web4.near.page';
        } else if (argv.network === 'testnet') {
            gatewayUrl = 'https://ipfs.web4.testnet.page';
        } else if (argv.gatewayUrl) {
            gatewayUrl = argv.gatewayUrl;
        } else {
            throw new Error('Network must be either "mainnet" or "testnet", or provide a custom gateway URL with --gateway-url');
        }
        console.log(`Access your files at: ${gatewayUrl}/ipfs/${rootCid}`);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();