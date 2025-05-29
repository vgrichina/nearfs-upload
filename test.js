import assert from 'assert';
import { uploadFiles, uploadBlocks, splitOnBatches, isAlreadyUploaded, uploadCAR, executeUpload, isExpectedNearError } from './index.js';
import { packCID } from 'fast-ipfs';
import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HELLO_CAR_FILE = path.join(__dirname, 'test/data', 'hello.car');

// Helper function to run CLI commands and capture output
async function runCLI(args, options = {}) {
  const { spawn } = await import('child_process');
  const { timeout = 30000, env = {} } = options;
  
  return new Promise((resolve) => {
    const child = spawn('./bin/nearfs-upload', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, ...env }
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      resolve({ 
        code, 
        stdout: stdout.trim(), 
        stderr: stderr.trim(),
        success: code === 0
      });
    });
    
    child.on('error', (error) => {
      resolve({ 
        code: -1, 
        stdout: stdout.trim(), 
        stderr: error.message,
        success: false,
        error
      });
    });
  });
}

describe('NEARFS Uploader', () => {
  describe('splitOnBatches', () => {
    it('should split blocks into batches', () => {
      const blocks = [
        { data: Buffer.alloc(100000) },
        { data: Buffer.alloc(100000) },
        { data: Buffer.alloc(100000) },
      ];
      const batches = splitOnBatches(blocks);
      assert.strictEqual(batches.length, 1);
      assert.strictEqual(batches[0].length, 3);
    });
  });

  describe('isAlreadyUploaded', () => {
    it('should return true for existing CID', async () => {
      const mockFetch = (url, options) => Promise.resolve({ status: 200 });
      global.fetch = mockFetch;
      
      const cid = packCID({ hash: Buffer.alloc(32), version: 1, codec: 0x55 });
      const mockLog = jest.fn();
      const result = await isAlreadyUploaded(cid, { timeout: 1000, retryCount: 1, log: mockLog });
      assert.strictEqual(result, true);
      expect(mockLog).toHaveBeenCalledWith('Block', expect.any(String), 'already exists on chain, skipping');
    });

    it('should return false for non-existing CID', async () => {
      const mockFetch = (url, options) => Promise.resolve({ status: 404 });
      global.fetch = mockFetch;
      
      const cid = packCID({ hash: Buffer.alloc(32), version: 1, codec: 0x55 });
      const mockLog = jest.fn();
      const result = await isAlreadyUploaded(cid, { timeout: 1000, retryCount: 1, log: mockLog });
      assert.strictEqual(result, false);
      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe('uploadFiles', () => {
    it('should upload files and return root CID', async () => {
      const submittedBuffers = [];
      const mockSignAndSendTransaction = async (buffers) => {
        submittedBuffers.push(...buffers);
      };
      const mockLog = jest.fn();

      const files = [
        { name: 'file1.txt', content: Buffer.from('Hello, world!') },
        { name: 'folder/file2.txt', content: Buffer.from('Nested file') },
      ];

      const rootCid = await uploadFiles(files, {
        signAndSendTransaction: mockSignAndSendTransaction,
        log: mockLog,
      });

      assert(rootCid, 'Root CID should be returned');
      
      // Verify the structure and content of the submitted buffers
      assert(submittedBuffers.length > 0, 'At least one buffer should be submitted');
      submittedBuffers.forEach(buffer => {
        assert(Buffer.isBuffer(buffer), 'Each submitted item should be a Buffer');
      });

      // Check if the submitted buffers contain the original file contents
      assert(submittedBuffers.some(buffer => buffer.includes('Hello, world!')), 'Submitted buffers should contain content of file1.txt');
      assert(submittedBuffers.some(buffer => buffer.includes('Nested file')), 'Submitted buffers should contain content of file2.txt');

      // Verify mockLog calls
      expect(mockLog).toHaveBeenCalledWith('rootDir', expect.any(Object));
      expect(mockLog).toHaveBeenCalledWith('rootCid', expect.any(String));
      expect(mockLog).toHaveBeenCalledWith('block', expect.any(String));
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

      const mockLog = jest.fn();
      const mockStatusCallback = jest.fn();
      await uploadBlocks(blocks, {
        signAndSendTransaction: mockSignAndSendTransaction,
        log: mockLog,
        statusCallback: mockStatusCallback,
      });

      assert.strictEqual(uploadedBlocks, 2, 'All blocks should be uploaded');
      expect(mockLog).toHaveBeenCalledWith('Uploaded 2 / 2 blocks to NEARFS');
      expect(mockStatusCallback).toHaveBeenCalledWith({ currentBlocks: 2, totalBlocks: 2 });
    });

  });

  describe('uploadCAR', () => {
    it('should upload CAR file and return', async () => {
      const submittedBuffers = [];
      const mockSignAndSendTransaction = async (buffers) => {
        submittedBuffers.push(...buffers);
      };
      const mockLog = jest.fn();
      const mockStatusCallback = jest.fn();

      // Read the sample CAR file
      const carData = await fs.readFile(HELLO_CAR_FILE);

      // Use the real uploadCAR function
      await uploadCAR(carData, {
        signAndSendTransaction: mockSignAndSendTransaction,
        log: mockLog,
        statusCallback: mockStatusCallback,
      });

      // Verify the structure of the submitted buffers
      assert(submittedBuffers.length > 0, 'At least one buffer should be submitted');
      submittedBuffers.forEach(buffer => {
        assert(Buffer.isBuffer(buffer), 'Each submitted item should be a Buffer');
      });

      // Verify that the log and statusCallback were called
      expect(mockLog).toHaveBeenCalledWith('Uploading CAR file to NEAR File System...');
      expect(mockLog).toHaveBeenCalledWith('Uploaded 1 / 1 blocks to NEARFS');
      expect(mockStatusCallback).toHaveBeenCalledWith({ currentBlocks: 1, totalBlocks: 1 });

      // Verify that the submitted buffers contain the "Hello World!" content
      const helloWorldBuffer = Buffer.from('Hello, World\n');
      const containsHelloWorld = submittedBuffers.some(buffer => buffer.includes(helloWorldBuffer));
      assert(containsHelloWorld, 'Submitted buffers should contain "Hello, World" content');
    });
  });

  describe('Error Handling', () => {
    it('should identify CodeDoesNotExist as expected error', () => {
      const error = new Error('ServerTransactionError');
      error.type = 'ActionError';
      error.kind = {
        index: 0,
        kind: {
          FunctionCallError: {
            CompilationError: {
              CodeDoesNotExist: {
                account_id: 'test.near'
              }
            }
          }
        }
      };
      
      expect(isExpectedNearError(error)).toBe(true);
    });

    it('should identify MethodNotFound as expected error', () => {
      const error = new Error('ServerTransactionError');
      error.type = 'ActionError';
      error.kind = {
        index: 0,
        kind: {
          FunctionCallError: {
            MethodResolveError: 'MethodNotFound'
          }
        }
      };
      
      expect(isExpectedNearError(error)).toBe(true);
    });

    it('should identify message-based errors as expected', () => {
      const error1 = new Error('Cannot find contract code for account');
      expect(isExpectedNearError(error1)).toBe(true);
      
      const error2 = new Error('Contract method is not found');
      expect(isExpectedNearError(error2)).toBe(true);
    });

    it('should not identify other errors as expected', () => {
      const error = new Error('Some other error');
      error.type = 'ActionError';
      expect(isExpectedNearError(error)).toBe(false);
    });

    it('should handle CodeDoesNotExist error gracefully in executeUpload', async () => {
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      // Create fake NEAR connection with account that throws CodeDoesNotExist
      const fakeNearConnection = {
        account: {
          signAndSendTransaction: jest.fn(() => {
            const error = new Error('ServerTransactionError');
            error.type = 'ActionError';
            error.kind = {
              index: 0,
              kind: {
                FunctionCallError: {
                  CompilationError: {
                    CodeDoesNotExist: {
                      account_id: 'test.near'
                    }
                  }
                }
              }
            };
            throw error;
          })
        },
        accountId: 'test.near'
      };

      const mockTransactions = {
        functionCall: jest.fn(() => 'mock-action')
      };

      // Should complete without throwing
      const result = await executeUpload(
        'package.json', // Use existing file
        fakeNearConnection,
        { 
          network: 'testnet',
          transactions: mockTransactions
        }
      );

      expect(result.rootCid).toBeDefined();
      expect(result.gatewayUrl).toBe('https://ipfs.web4.testnet.page');
      
      // Verify console.error was NOT called with transaction error
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        'Error signing and sending transaction:', 
        expect.any(Object)
      );

      mockConsoleError.mockRestore();
      mockConsoleLog.mockRestore();
    });
  });

  describe('CLI Integration Tests', () => {
    it('should display help when --help flag is used', async () => {
      const result = await runCLI(['--help']);
      
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Usage: nearfs-upload');
      expect(result.stdout).toContain('Options:');
    });

    it('should display help when no arguments provided', async () => {
      const result = await runCLI([]);
      
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Usage: nearfs-upload');
    });

    it('should successfully upload to testnet with vg account', async () => {
      const result = await runCLI([
        'package.json', 
        '--account-id', 'vg', 
        '--network', 'testnet'
      ]);
      
      console.log('=== Real Upload Test Results ===');
      console.log('Exit Code:', result.code);
      console.log('Success:', result.success);
      console.log('STDOUT:\n', result.stdout);
      if (result.stderr) {
        console.log('STDERR:\n', result.stderr);
      }
      console.log('================================');
      
      // Assert successful upload
      expect(result.success).toBe(true);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Upload complete!');
      expect(result.stdout).toContain('https://ipfs.web4.testnet.page/ipfs/');
      expect(result.stdout).toContain('Uploaded 2 / 2 blocks to NEARFS');
    });

    it('should handle missing credentials gracefully', async () => {
      const result = await runCLI([
        'package.json', 
        '--network', 'testnet'
      ]);
      
      expect(result.success).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Missing credentials');
    });

    it('should handle invalid network', async () => {
      const result = await runCLI([
        'package.json', 
        '--account-id', 'test.near',
        '--private-key', 'ed25519:test',
        '--network', 'invalidnetwork'
      ]);
      
      expect(result.success).toBe(false);
      expect(result.code).toBe(1);
      // Should error about network not being mainnet/testnet or missing gateway URL
    });

    it('should handle help flag with short alias', async () => {
      const result = await runCLI(['-h']);
      
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Usage: nearfs-upload');
    });

    it('should test environment variable fallback', async () => {
      const result = await runCLI(['package.json'], {
        env: {
          NEAR_ACCOUNT_ID: 'env.testnet',
          NEAR_PRIVATE_KEY: 'ed25519:fake'
        }
      });
      
      // Should attempt to use env vars and fail at NEAR connection
      // but not at credential validation stage
      expect(result.success).toBe(false);
      expect(result.stderr).not.toContain('Missing credentials');
    });
  });
});
