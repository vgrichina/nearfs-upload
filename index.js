import { cidToString, packCID, readCID, writePBNode, CODEC_RAW, CODEC_DAG_PB, readCAR, readBlock } from 'fast-ipfs';
import sha256 from 'js-sha256';
import fs from 'fs/promises';
import path from 'path';

const computeHash = (data) => Buffer.from(sha256.arrayBuffer(data));

const DEFAULT_OPTIONS = {
    log: console.log,
    statusCallback: ({ currentBlocks, totalBlocks }) => {},
    timeout: 2500,
    retryCount: 3,
    gatewayUrl: 'https://ipfs.web4.near.page',
    signAndSendTransaction: async () => { throw new Error('signAndSendTransaction not implemented'); },
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function isAlreadyUploaded(cid, options = DEFAULT_OPTIONS) {
    const { log, timeout, retryCount, gatewayUrl } = options;
    const cid32 = cidToString(cid);
    const urlToCheck = `${gatewayUrl}/ipfs/${cid32}`;
    for (let i = 0; i < retryCount; i++) {
        try {
            const res = await fetch(urlToCheck, { method: 'HEAD', signal: AbortSignal.timeout(timeout) });
            if (res.status === 200) {
                log('Block', cid32, 'already exists on chain, skipping');
                return true;
            }

            if (res.status !== 404) {
                throw new Error(`Unexpected status code ${res.status} for ${urlToCheck}`);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                log('Timeout while checking', urlToCheck);
                continue;
            }
            throw e;
        }
    }

    return false;
}

function splitOnBatches(newBlocks) {
    let currentBatch = [];
    const batches = [currentBatch];
    const MAX_BATCH_ACTIONS = 7;
    const MAX_BATCH_BYTES = 256 * 1024;
    for (let { data } of newBlocks) {
        if (currentBatch.length >= MAX_BATCH_ACTIONS || currentBatch.reduce((a, b) => a + b.length, 0) >= MAX_BATCH_BYTES) {
            currentBatch = [];
            batches.push(currentBatch);
        }

        currentBatch.push(data);
    }
    return batches;
}


async function uploadBlocks(blocks, options = DEFAULT_OPTIONS) {
    const { log, statusCallback, signAndSendTransaction } = { ...DEFAULT_OPTIONS, ...options };

    const THROTTLE_MS = 25;
    const blocksAndStatus = (await Promise.all(blocks.map(async ({ data, cid }, i) => ({ data, cid, uploaded: (await sleep(i * THROTTLE_MS), await isAlreadyUploaded(cid, options)) }))));
    const filteredBlocks = blocksAndStatus.filter(({ uploaded }) => !uploaded);
    const batches = splitOnBatches(filteredBlocks);

    let totalBlocks = batches.reduce((a, b) => a + b.length, 0);
    let currentBlocks = 0;

    for (let batch of batches) {
        await signAndSendTransaction(batch);

        currentBlocks += batch.length;
        log(`Uploaded ${currentBlocks} / ${totalBlocks} blocks to NEARFS`);
        statusCallback({ currentBlocks, totalBlocks });
    }
}

export async function uploadFiles(files, options = DEFAULT_OPTIONS) {
    const { log } = options;

    const rootDir = { name: '', links: [] };
    const blocksToUpload = [];    
    for (let { name, content } of files) {
        const path = name.split('/');
        let dir = rootDir;
        for (let i = 0; i < path.length - 1; i++) {
            const dirName = path[i];
            let dirEntry = dir.links.find(({name}) => name === dirName);
            if (!dirEntry) {
                dirEntry = { name: dirName, links: [] };
                dir.links.push(dirEntry);
            }
            dir = dirEntry;
        }

        const fileName = path[path.length - 1];
        const hash = computeHash(content);
        const cid = packCID({ hash, version: 1, codec: CODEC_RAW });
        const fileEntry = { name: fileName, cid, size: content.length };
        dir.links.push(fileEntry);

        blocksToUpload.push({ data: content, cid });
    }

    function addBlocksForDir(dir) {
        for (let entry of dir.links) {
            if (!entry.cid) {
                entry.cid = addBlocksForDir(entry);
            }
        }
        const pbNode = writePBNode({
            links: dir.links,
            data: Buffer.from([8, 1])
        });
        const hash = computeHash(pbNode);
        const cid = packCID({ hash, version: 1, codec: CODEC_DAG_PB });
        blocksToUpload.push({ data: pbNode, cid });
        return cid;
    }        

    log('rootDir', rootDir);
    const rootCid = addBlocksForDir(rootDir);
    log('rootCid', cidToString(rootCid));

    for (let block of blocksToUpload) {
        log('block', cidToString(block.cid));
    }

    await uploadBlocks(blocksToUpload, options);

    return cidToString(rootCid);
}

function readCarRoots(headerBytes) {
    // Minimal CBOR scan for `tag(42) bytes(...)` entries inside the CAR v1 header map.
    // Each CID in the header is encoded as: 0xd8 0x2a (tag 42) + byte string starting with
    // 0x00 (identity multibase prefix) + raw CID bytes. We only need to extract the CIDs.
    const roots = [];
    for (let i = 0; i < headerBytes.length - 2; i++) {
        if (headerBytes[i] !== 0xd8 || headerBytes[i + 1] !== 0x2a) continue;
        let off = i + 2;
        const initialByte = headerBytes[off++];
        const major = initialByte >> 5;
        if (major !== 2) continue; // not a byte string
        const ai = initialByte & 0x1f;
        let len;
        if (ai < 24) { len = ai; }
        else if (ai === 24) { len = headerBytes[off++]; }
        else if (ai === 25) { len = headerBytes.readUInt16BE(off); off += 2; }
        else if (ai === 26) { len = headerBytes.readUInt32BE(off); off += 4; }
        else continue;
        const bs = headerBytes.subarray(off, off + len);
        // Strip leading 0x00 multibase identity prefix.
        const cidBytes = bs[0] === 0x00 ? bs.subarray(1) : bs;
        const { version, codec, hash } = readCID(cidBytes);
        roots.push(packCID({ version, codec, hash }));
    }
    return roots;
}

export async function uploadCAR(carBuffer, options = DEFAULT_OPTIONS) {
    const { log } = options;

    log('Uploading CAR file to NEAR File System...');

    const carEntries = readCAR(carBuffer);
    const roots = carEntries.length > 0 ? readCarRoots(carEntries[0].data) : [];
    const blocks = await blocksToUpload(carBuffer, options);
    await uploadBlocks(blocks, options);
    return roots.length > 0 ? cidToString(roots[0]) : undefined;
}

async function blocksToUpload(carBuffer, options = DEFAULT_OPTIONS) {
    const blocks = readCAR(carBuffer).slice(1).map(b => readBlock(b.data));
    const THROTTLE_MS = 25;
    const blocksAndStatus = await Promise.all(blocks.map(async ({ data, cid }, i) => ({
        data,
        cid,
        uploaded: await sleep(i * THROTTLE_MS).then(() => isAlreadyUploaded(cid, options))
    })));
    return blocksAndStatus.filter(({ uploaded }) => !uploaded);
}

async function readFilesRecursively(dir, rootDir = dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await readFilesRecursively(fullPath, rootDir));
        } else {
            const content = await fs.readFile(fullPath);
            // Always normalize to forward slashes — uploadFiles splits on '/'.
            const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
            files.push({
                name: relPath,
                content: Buffer.from(content)
            });
        }
    }

    return files;
}

function isExpectedNearError(error) {
    // Ignore MethodNotFound error as it happens during success case
    if (error.type === 'ActionError' && 
        error.kind?.kind?.FunctionCallError?.MethodResolveError === 'MethodNotFound') {
        return true;
    }
    
    // Ignore CodeDoesNotExist error as it happens when account has no contract deployed
    if (error.type === 'ActionError' && 
        error.kind?.kind?.FunctionCallError?.CompilationError?.CodeDoesNotExist) {
        return true;
    }
    
    // Handle message-based error patterns
    if (error.message && (
        error.message.includes('Cannot find contract code for account') ||
        error.message.includes('Contract method is not found')
    )) {
        return true;
    }
    
    return false;
}

export async function executeUpload(filePath, nearConnection, options = {}) {
    const { account, accountId } = nearConnection;
    const { network, gatewayUrl: customGatewayUrl, transactions } = options;
    
    // Determine gateway URL first - custom gateway overrides network
    let gatewayUrl;
    if (customGatewayUrl) {
        gatewayUrl = customGatewayUrl;
    } else if (network === 'mainnet') {
        gatewayUrl = 'https://ipfs.web4.near.page';
    } else if (network === 'testnet') {
        gatewayUrl = 'https://ipfs.web4.testnet.page';
    } else {
        throw new Error('Network must be either "mainnet" or "testnet", or provide a custom gateway URL with --gateway-url');
    }
    
    // Create signAndSendTransaction with error handling
    const signAndSendTransaction = async (blockDataArray) => {
        try {
            return await account.signAndSendTransaction({
                receiverId: accountId,
                actions: blockDataArray.map(data => 
                    transactions.functionCall('fs_store', data, '30000000000000', '0')
                ),
            });
        } catch (error) {
            if (isExpectedNearError(error)) {
                return;
            }
            console.error('Error signing and sending transaction:', error);
            throw error;
        }
    };

    const uploadOptions = {
        signAndSendTransaction,
        log: console.log,
        statusCallback: ({ currentBlocks, totalBlocks }) => {
            console.log(`Progress: ${currentBlocks}/${totalBlocks} blocks uploaded`);
        },
        gatewayUrl,
        timeout: 2500,
        retryCount: 3
    };

    let rootCid;
    const isCarFile = path.extname(filePath).toLowerCase() === '.car';

    if (isCarFile) {
        const carBuffer = await fs.readFile(filePath);
        rootCid = await uploadCAR(carBuffer, uploadOptions);
    } else {
        const stats = await fs.stat(filePath);
        const files = stats.isDirectory() 
            ? await readFilesRecursively(filePath)
            : [{
                name: path.basename(filePath),
                content: await fs.readFile(filePath)
              }];

        rootCid = await uploadFiles(files, uploadOptions);
    }

    console.log('\nUpload complete!');
    const isCustomGateway = !!customGatewayUrl;
    console.log(`Access your files at: ${gatewayUrl}/ipfs/${rootCid}`);
    if (!isCustomGateway) {
        const gatewayDomain = gatewayUrl.replace('https://', '');
        console.log(`Or via subdomain: https://${rootCid}.${gatewayDomain}`);
    }

    return { rootCid, gatewayUrl };
}

export {
    isAlreadyUploaded,
    blocksToUpload,
    splitOnBatches,
    uploadBlocks,
    isExpectedNearError,
    readFilesRecursively,
    readCarRoots,
};
