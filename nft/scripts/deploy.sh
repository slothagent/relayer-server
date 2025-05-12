#!/bin/bash

# Check if required parameters are provided
if [ "$#" -ne 4 ]; then
    echo "Usage: $0 <name> <description> <url> <wallet_address>"
    exit 1
fi

NAME=$1
DESCRIPTION=$2
URL=$3
WALLET_ADDRESS=$4

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
NFT_DIR="$(dirname "$SCRIPT_DIR")"

# Build the contract
echo "Building contract..."
cd "$NFT_DIR" && sui move build

# Deploy the contract and capture the output
echo "Deploying contract..."
DEPLOY_OUTPUT=$(cd "$NFT_DIR" && sui client publish --gas-budget 1000000000)

# Extract PackageID using grep and sed, and clean up the output
PACKAGE_ID=$(echo "$DEPLOY_OUTPUT" | grep "PackageID:" | sed 's/.*PackageID: \(.*\)/\1/' | sed 's/│//g' | tr -d '[:space:]')

if [ -z "$PACKAGE_ID" ]; then
    echo "Error: Failed to extract Package ID"
    echo "Deployment output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

# Output the PackageID for the TypeScript script to capture
echo "PACKAGE_ID:$PACKAGE_ID"

# Mint the NFT
echo "Minting NFT..."
MINT_OUTPUT=$(cd "$NFT_DIR" && sui client call --package $PACKAGE_ID --module $NAME --function mint_to_sender --args "$NAME" "$DESCRIPTION" "$URL" --gas-budget 1000000000)

# Print mint output for debugging
echo "Mint output:"
echo "$MINT_OUTPUT"

# Extract ObjectID from mint output - look for the first Created Object ID
OBJECT_ID=$(echo "$MINT_OUTPUT" | grep -A 5 "Created Objects:" | grep "ID:" | head -n 1 | sed 's/.*ID: \(.*\)/\1/' | sed 's/│//g' | tr -d '[:space:]')

if [ -z "$OBJECT_ID" ]; then
    echo "Error: Failed to extract Object ID"
    echo "Mint output:"
    echo "$MINT_OUTPUT"
    exit 1
fi

# Output the ObjectID for the TypeScript script to capture
echo "OBJECT_ID:$OBJECT_ID"

echo "Deployment and minting completed!"