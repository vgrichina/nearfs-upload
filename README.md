# NEARFS Uploader

A package to upload files to NEARFS via NEAR transactions or web4.

## Installation

```bash
npm install nearfs-upload
```

## Usage

### Uploading Files

```javascript
import { uploadFiles } from 'nearfs-upload';

// NEAR transaction implementation
const signAndSendTransactionNEAR = async (blockDataArray) => {
  // Implement NEAR transaction logic here
};

// Web4 implementation
const signAndSendTransactionWeb4 = async (blockDataArray) => {
  // Implement Web4 upload logic here
};

const files = [
  { name: 'file1.txt', content: Buffer.from('Hello, world!') },
  { name: 'folder/file2.txt', content: Buffer.from('Nested file') },
];

// Upload using NEAR transaction
const rootCidNEAR = await uploadFiles(files, {
  signAndSendTransaction: signAndSendTransactionNEAR,
  // other options...
});

// Upload using Web4
const rootCidWeb4 = await uploadFiles(files, {
  signAndSendTransaction: signAndSendTransactionWeb4,
  // other options...
});
```

### Uploading CAR Files

```javascript
import { uploadCAR } from 'nearfs-upload';
import fs from 'fs';

const carBuffer = fs.readFileSync('your-file.car');

await uploadCAR(carBuffer, {
  signAndSendTransaction: signAndSendTransactionNEAR, // or signAndSendTransactionWeb4
  // other options...
});
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
