# Token Factory Smart Contract

A Sui Move smart contract for creating and managing fungible tokens.

## Features

- Create new tokens with customizable parameters
- Track all created tokens in a registry
- Mint additional tokens
- Burn tokens
- Update token metadata
- Event emission for token creation

## Contract Structure

- `FactoryAdmin`: Capability object for admin operations
- `TokenRegistry`: Shared object tracking all created tokens
- `TokenCreated`: Event emitted when new tokens are created

## Functions

### create_token
Creates a new token with specified parameters:
- name
- symbol (max 10 characters)
- description
- decimals (max 9)
- icon URL
- initial supply

### mint_tokens
Mint additional tokens (requires treasury cap)

### burn_tokens
Burn existing tokens (requires treasury cap)

### update_token_metadata
Update token metadata (requires treasury cap)

## Usage

1. Deploy the contract:
```bash
sui client publish --gas-budget 100000000
```

2. Initialize token factory:
- Creates FactoryAdmin capability
- Creates shared TokenRegistry

3. Create tokens using the factory:
- Requires FactoryAdmin capability
- Validates input parameters
- Creates token with specified parameters
- Mints initial supply
- Records token in registry
- Transfers treasury cap and coins to creator

## Validation

- Symbol length ≤ 10 characters
- Decimals ≤ 9
- Total supply > 0

## Events

TokenCreated event emitted with:
- Token name
- Symbol
- Decimals
- Description
- Icon URL
- Creator address
- Total supply 