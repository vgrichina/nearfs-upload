import timeoutSignal from 'timeout-signal';
import { cidToString, packCID, writePBNode, CODEC_RAW, CODEC_DAG_PB } from 'fast-ipfs';
import sha256 from 'js-sha256';

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
            const res = await fetch(urlToCheck, { method: 'HEAD', signal: timeoutSignal(timeout) });
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

function isExpectedUploadError(e) {
    return e.message.includes('Cannot find contract code for account') || e.message.includes('Contract method is not found');
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
        try {
            await signAndSendTransaction(batch.map(({ data }) => data));
        } catch (e) {
            if (!isExpectedUploadError(e)) {
                throw e;
            }
        }

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

export async function uploadCAR(carBuffer, options = DEFAULT_OPTIONS) {
    const { log } = options;

    log('Uploading CAR file to NEAR File System...');

    const blocks = await blocksToUpload(carBuffer, options);
    return await uploadBlocks(blocks, options);
}

async function blocksToUpload(carBuffer, options = DEFAULT_OPTIONS) {
    const blocks = readCAR(carBuffer).slice(1).map(b => readBlock(b.data));
    const THROTTLE_MS = 25;
    const blocksAndStatus = (await Promise.all(blocks.map(async ({ data, cid }, i) => ({ data, cid, uploaded: (await sleep(i * THROTTLE_MS), await isAlreadyUploaded(cid, options)) }))));
    const filteredBlocks = blocksAndStatus.filter(({ uploaded }) => !uploaded);
    return filteredBlocks;
}

export {
    isAlreadyUploaded,
    blocksToUpload,
    splitOnBatches,
    uploadBlocks,
};
