# NEARFS Uploader

A package to upload files to NEARFS via near-api-js (Node.js) or web4 (browser).

This package is built on top of the following projects:
- [near-api-js](https://github.com/near/near-api-js): NEAR JavaScript API
- [web4](https://github.com/vgrichina/web4): Web3 + Web 2.0 = Web4
- [nearfs](https://github.com/vgrichina/nearfs): NEAR File System

## Installation

```bash
npm install nearfs-upload
```

## Usage

### Uploading Files

```javascript
import { uploadFiles } from 'nearfs-upload';
import { connect, keyStores, transactions } from 'near-api-js';

async function main() {
  // Set up NEAR connection
  const keyStore = new keyStores.InMemoryKeyStore();
  const nearConnection = await connect({
    networkId: 'testnet',
    keyStore,
    nodeUrl: 'https://rpc.testnet.near.org',
  });

  // Access NEAR account
  const accountId = 'your-account.testnet';
  const account = await nearConnection.account(accountId);

  const signAndSendTransaction = async (blockDataArray) => {
    return await account.signAndSendTransaction({
      receiverId: accountId,
      actions: blockDataArray.map(data => 
        transactions.functionCall('fs_store', data, '30000000000000', '0')
      ),
    });
  };

  // Prepare files for upload
  const files = [
    { name: 'file1.txt', content: Buffer.from('Hello, world!') },
    { name: 'folder/file2.txt', content: Buffer.from('Nested file') },
  ];

  // Upload files
  const rootCid = await uploadFiles(files, {
    signAndSendTransaction,
    log: console.log,
    statusCallback: ({ currentBlocks, totalBlocks }) => {
      console.log(`Progress: ${currentBlocks}/${totalBlocks} blocks uploaded`);
    },
  });

  console.log('Upload complete. Root CID:', rootCid);
}

main().catch(console.error);
```

### Uploading CAR Files

To upload a pre-made CAR file, use the `uploadCAR` function:

```javascript
import { uploadCAR } from 'nearfs-upload';
import fs from 'fs';

async function uploadCarFile(signAndSendTransaction) {
  const carBuffer = fs.readFileSync('your-file.car');

  await uploadCAR(carBuffer, {
    signAndSendTransaction,
    log: console.log,
  });

  console.log('CAR file upload complete');
}
```

## API

### `uploadFiles(files, options)`

Uploads multiple files to NEARFS.

- `files`: An array of file objects with `name` and `content` properties.
- `options`: An object containing upload options.

Returns a Promise that resolves to the root CID of the uploaded files.

### `uploadCAR(carBuffer, options)`

Uploads a CAR file to NEARFS.

- `carBuffer`: A Buffer containing the CAR file data.
- `options`: An object containing upload options.

Returns a Promise that resolves when the upload is complete.

### Options

- `signAndSendTransaction`: A function that implements the upload logic (required).
- `log`: A function for logging (default: `console.log`).
- `statusCallback`: A function called with upload progress (default: no-op).
- `timeout`: Timeout for checking if a block is already uploaded (default: 2500ms).
- `retryCount`: Number of retries for checking if a block is already uploaded (default: 3).
- `gatewayUrl`: URL of the IPFS gateway (default: 'https://ipfs.web4.near.page').

## Testing

To run the tests:

```bash
npm test
```

## License

MIT