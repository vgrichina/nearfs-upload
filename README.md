# NEARFS Uploader

A package to upload files to [NEARFS](https://github.com/vgrichina/nearfs) via [near-api-js](https://github.com/near/near-api-js) (Node.js/browser) or [web4](https://github.com/vgrichina/web4) (browser).

[NEARFS](https://github.com/vgrichina/nearfs) is a distributed file system compatible with [IPFS](https://ipfs.io/) that uses the [NEAR blockchain](https://near.org/) as a backend. It allows you to store and retrieve files using the NEAR blockchain infrastructure.

This package is built on top of the following projects:
- [near-api-js](https://github.com/near/near-api-js): NEAR JavaScript API
- [web4](https://github.com/vgrichina/web4): Unstoppable websites onchain
- [nearfs](https://github.com/vgrichina/nearfs): NEAR File System

## Installation

```bash
npm install nearfs-upload
```

## Usage

### Command Line Interface

The package provides a command-line tool for easy uploads. After installation, you can use it directly:

```bash
npx nearfs-upload [options] <path>
```

The CLI automatically detects the type of upload based on the file extension - you can upload individual files, directories, or CAR files (.car extension) using the same command.

Options:
- `-h, --help`: Show help message
- `-n, --network`: NEAR network (default: testnet)
- `-a, --account-id`: NEAR account ID
- `-k, --private-key`: NEAR account private key
- `--gateway-url`: Custom IPFS gateway URL for non-mainnet/testnet networks
- `--node-url`: Custom NEAR RPC node URL

Credentials can be provided in three ways:
1. Command line arguments
2. Environment variables (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY)
3. near-cli credentials (~/.near-credentials/{network}/{accountId}.json)

Examples:

```bash
# Upload a directory
nearfs-upload ./my-files --account-id example.testnet --private-key "ed25519:..."

# Upload a CAR file
nearfs-upload ./my-file.car --account-id example.testnet

# Use environment variables
NEAR_ACCOUNT_ID=example.testnet NEAR_PRIVATE_KEY=ed25519:... nearfs-upload ./my-files

# Custom network configuration
nearfs-upload ./my-files --network custom --gateway-url https://ipfs.custom.example.com
nearfs-upload ./my-files --node-url https://my-custom-near-node.com
```


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

### Accessing Uploaded Files

After uploading files, you can access them through the following public gateways:

- https://ipfs.web4.near.page - Access data stored on NEAR mainnet.
- https://ipfs.web4.testnet.page - Access data stored on NEAR testnet.

These gateways provide IPFS-compatible access to the files stored in NEARFS.

### Subdomain Support

NEARFS supports accessing content via subdomains, allowing you to serve full websites via the NEARFS gateway with isolated security contexts. You can access uploaded content using URLs like:

- `http://<cid>.ipfs.web4.near.page/`
- `http://<cid>.ipfs.web4.near.page/:path`

This provides a more intuitive way to share and access IPFS content through the NEARFS gateway.

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