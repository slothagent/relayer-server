#!/bin/bash

# Build the contract
echo "Building contract..."
sui move build

# Deploy the contract and capture the output
echo "Deploying contract..."
DEPLOY_OUTPUT=$(cd token && sui client publish --gas-budget 1000000000)

# Extract PackageID using grep and sed, and clean up the output
PACKAGE_ID=$(echo "$DEPLOY_OUTPUT" | grep "PackageID:" | sed 's/.*PackageID: \(.*\)/\1/' | sed 's/│//g' | tr -d '[:space:]')

# Output the PackageID for the TypeScript script to capture
echo "PACKAGE_ID:$PACKAGE_ID"

echo "Deployment completed!"