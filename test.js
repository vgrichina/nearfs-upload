import assert from 'assert';
import { uploadFiles, uploadBlocks, splitOnBatches, isAlreadyUploaded } from './index.js';
import { packCID } from 'fast-ipfs';

describe('NEARFS Uploader', () => {
  describe('splitOnBatches', () => {
    it('should split blocks into batches', () => {
      const blocks = [
        { data: Buffer.alloc(100000) },
        { data: Buffer.alloc(100000) },
        { data: Buffer.alloc(100000) },
      ];
      const batches = splitOnBatches(blocks);
      assert.strictEqual(batches.length, 2);
      assert.strictEqual(batches[0].length, 2);
      assert.strictEqual(batches[1].length, 1);
    });
  });

  describe('isAlreadyUploaded', () => {
    it('should return true for existing CID', async () => {
      const mockFetch = (url, options) => Promise.resolve({ status: 200 });
      global.fetch = mockFetch;
      
      const cid = packCID({ hash: Buffer.alloc(32), version: 1, codec: 0x55 });
      const result = await isAlreadyUploaded(cid, { timeout: 1000, retryCount: 1 });
      assert.strictEqual(result, true);
    });

    it('should return false for non-existing CID', async () => {
      const mockFetch = (url, options) => Promise.resolve({ status: 404 });
      global.fetch = mockFetch;
      
      const cid = packCID({ hash: Buffer.alloc(32), version: 1, codec: 0x55 });
      const result = await isAlreadyUploaded(cid, { timeout: 1000, retryCount: 1 });
      assert.strictEqual(result, false);
    });
  });

  describe('uploadFiles', () => {
    it('should upload files and return root CID', async () => {
      const mockSignAndSendTransaction = async (blockDataArray) => {
        // Mock implementation
      };

      const files = [
        { name: 'file1.txt', content: Buffer.from('Hello, world!') },
        { name: 'folder/file2.txt', content: Buffer.from('Nested file') },
      ];

      const rootCid = await uploadFiles(files, {
        signAndSendTransaction: mockSignAndSendTransaction,
      });

      assert(rootCid, 'Root CID should be returned');
    });
  });

  describe('uploadBlocks', () => {
    it('should upload blocks', async () => {
      let uploadedBlocks = 0;
      const mockSignAndSendTransaction = async (blockDataArray) => {
        uploadedBlocks += blockDataArray.length;
      };

      const blocks = [
        { data: Buffer.from('Block 1'), cid: packCID({ hash: Buffer.alloc(32), version: 1, codec: 0x55 }) },
        { data: Buffer.from('Block 2'), cid: packCID({ hash: Buffer.alloc(32), version: 1, codec: 0x55 }) },
      ];

      await uploadBlocks(blocks, {
        signAndSendTransaction: mockSignAndSendTransaction,
      });

      assert.strictEqual(uploadedBlocks, 2, 'All blocks should be uploaded');
    });
  });
});
