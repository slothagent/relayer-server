# Sloth Relayer API Documentation

## Overview
The Sloth Relayer API is a service that handles gasless transactions for the Sloth protocol. It supports token creation, buying, and selling operations through meta-transactions.

## Base URL
```
http://localhost:4040
```

## Endpoints

### POST /relay
This endpoint handles all relayer operations through a unified interface. The operation type is determined by the `type` field in the request body.

## Supported Operations

### 1. Create Token
Creates a new token through the Sloth Factory contract.

**Type**: `create-token`

**Request Body**:
```json
{
    "type": "create-token",
    "creator": "string (address)",
    "params": {
        "name": "string",
        "symbol": "string",
        "tokenId": "string",
        "initialDeposit": "string",
        "twitter": "string",
        "telegram": "string",
        "website": "string",
        "categories": "string[]",
        "image": "string",
        "network": "string",
        "description": "string"
    },
    "deadline": "string",
    "nonce": "string",
    "signature": {
        "v": "number",
        "r": "string",
        "s": "string"
    }
}
```

**Response**:
```json
{
    "success": true,
    "txHash": "string",
    "token": "string (address)",
    "sloth": "string (address)",
    "creator": "string (address)",
    "totalSupply": "string",
    "saleAmount": "string",
    "tokenOffset": "string",
    "nativeOffset": "string",
    "tokenId": "string",
    "whitelistEnabled": "boolean",
    "factory": "string (address)",
    "blockNumber": "number"
}
```

### 2. Buy Tokens
Executes a token purchase through a Sloth contract.

**Type**: `buy`

**Request Body**:
```json
{
    "type": "buy",
    "slothContractAddress": "string (address)",
    "buyer": "string (address)",
    "recipient": "string (address)",
    "nativeAmount": "string",
    "nonce": "string",
    "deadline": "string",
    "signature": {
        "v": "number",
        "r": "string",
        "s": "string"
    }
}
```

**Response**:
```json
{
    "success": true,
    "txHash": "string"
}
```

### 3. Sell Tokens
Executes a token sale through a Sloth contract.

**Type**: `sell`

**Request Body**:
```json
{
    "type": "sell",
    "slothContractAddress": "string (address)",
    "seller": "string (address)",
    "recipient": "string (address)",
    "tokenAmount": "string",
    "nonce": "string",
    "deadline": "string",
    "signature": {
        "v": "number",
        "r": "string",
        "s": "string"
    }
}
```

**Response**:
```json
{
    "success": true,
    "txHash": "string"
}
```

## Error Handling
In case of errors, the API will return a 400 status code with an error message:

```json
{
    "success": false,
    "error": "Error message description"
}
```

## Configuration
The relayer service requires the following environment variables:

- `RPC_URL_ANCIENT8`: RPC URL for the Ancient8 network
- `RELAYER_PRIVATE_KEY`: Private key for the relayer account
- `API_URL`: Base URL for the API service

## CORS Configuration
The API supports CORS for the following origins:
- https://www.slothai.xyz
- http://localhost:5173
- https://api.slothai.xyz
- https://slothai.xyz

## Contract Addresses
- Sloth Factory: `0xe520B9F320Ed91Cf590CF9884d2b051f2ece4C4E`
- Native Token: `0xfC57492d6569f6F45Ea1b8850e842Bf5F9656EA6`
