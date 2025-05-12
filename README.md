# Sui Relayer Server

## Overview
The Sui Relayer Server is a comprehensive API service that provides functionality for managing Sui blockchain accounts, creating tokens, and minting NFTs. It supports both mainnet and testnet operations.

## Base URL
```
http://localhost:7777
```

## API Endpoints

### Account Management

#### Create Account
`POST /api/sui/account`

Creates a new Sui account with specified scheme.

**Request Body**:
```json
{
    "scheme": "ed25519" | "secp256k1",
    "user_id": "string",
    "network": "mainnet" | "testnet"
}
```

**Response**:
```json
{
    "status": "success",
    "data": {
        "address": "string",
        "publicKey": "string",
        "mnemonic": "string",
        "scheme": "string",
        "network": "string",
        "exportedKeypair": "object"
    }
}
```

#### Get Account by User ID
`GET /api/sui/account/by-user`

Retrieves account(s) associated with a user ID.

**Query Parameters**:
- `user_id` (required): User identifier
- `privatekey` (optional): Private key for filtering
- `network` (optional): Network to filter by

#### Get Account Details
`GET /api/sui/account/:address`

Retrieves detailed account information including balances and NFTs.

**Query Parameters**:
- `network`: "mainnet" | "testnet"

#### Import Account
`POST /api/sui/account/import`

Imports an existing account using private key or mnemonic.

**Request Body**:
```json
{
    "private_key": "string",
    "mnemonic": "string",
    "user_id": "string",
    "network": "mainnet" | "testnet",
    "scheme": "ed25519" | "secp256k1"
}
```

#### Switch Active Address
`POST /api/sui/account/switch`

Changes the active address for a user.

**Request Body**:
```json
{
    "user_id": "string",
    "address": "string",
    "network": "mainnet" | "testnet"
}
```

### Token Management

#### Create Token
`POST /api/sui/token`

Creates a new token on the Sui blockchain.

**Request Body**:
```json
{
    "name": "string",
    "symbol": "string",
    "description": "string",
    "image_url": "string",
    "init_supply": "number",
    "network": "mainnet" | "testnet",
    "twitter": "string",
    "telegram": "string",
    "website": "string",
    "uri": "string",
    "user_id": "string"
}
```

### NFT Management

#### Create NFT
`POST /api/sui/nft`

Creates a new NFT on the Sui blockchain.

**Request Body**:
```json
{
    "name": "string",
    "description": "string",
    "url": "string",
    "user_id": "string",
    "network": "mainnet" | "testnet"
}
```

## Error Handling
The API returns standardized error responses:

```json
{
    "status": "error",
    "message": "Error description",
    "error": "Detailed error message"
}
```

## Configuration
The server requires the following environment variables:

- `PORT`: Server port (default: 7777)

## CORS
The API supports CORS for cross-origin requests.

## Security
- All sensitive operations require proper authentication
- Private keys and mnemonics are stored securely
- Network validation for all operations
- Input validation for all endpoints

## Development
To run the server locally:

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will start on port 7777 by default.
