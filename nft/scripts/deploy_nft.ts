import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import dotenv from 'dotenv';

dotenv.config();

interface NFTConfig {
    name: string;
    description: string;
    url: string;
    walletAddress: string;
}

interface DeployResult {
    nftName: string;
    description: string;
    url: string;
    walletAddress: string;
    packageId: string;
    objectId: string;
}

async function deployNFT(config: NFTConfig): Promise<DeployResult> {
    try {
        // Update nft.move with new configuration
        const nftMovePath = path.join(__dirname, '../sources/nft.move');
        const nftMoveContent = `// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

module 0x0::${config.name} {
    use std::string;
    use sui::event;
    use sui::url::{Self, Url};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// An example NFT that can be minted by anybody
    struct ${config.name.toUpperCase()} has key, store {
        id: UID,
        /// Name for the token
        name: string::String,
        /// Description of the token
        description: string::String,
        /// URL for the token
        url: Url,
    }

    // ===== Events =====

    struct NFTMinted has copy, drop {
        // The Object ID of the NFT
        object_id: object::ID,
        // The creator of the NFT
        creator: address,
        // The name of the NFT
        name: string::String,
    }

    // ===== Public view functions =====

    /// Get the NFT's \`name\`
    public fun name(nft: &${config.name.toUpperCase()}): &string::String {
        &nft.name
    }

    /// Get the NFT's \`description\`
    public fun description(nft: &${config.name.toUpperCase()}): &string::String {
        &nft.description
    }

    /// Get the NFT's \`url\`
    public fun url(nft: &${config.name.toUpperCase()}): &Url {
        &nft.url
    }

    // ===== Entrypoints =====

    #[allow(lint(self_transfer))]
    /// Create a new NFT
    public fun mint_to_sender(
        name: vector<u8>,
        description: vector<u8>,
        url: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let nft = ${config.name.toUpperCase()} {
            id: object::new(ctx),
            name: string::utf8(name),
            description: string::utf8(description),
            url: url::new_unsafe_from_bytes(url),
        };

        event::emit(NFTMinted {
            object_id: object::id(&nft),
            creator: sender,
            name: nft.name,
        });

        transfer::public_transfer(nft, sender);
    }

    /// Transfer \`nft\` to \`recipient\`
    public fun transfer(nft: ${config.name.toUpperCase()}, recipient: address, _: &mut TxContext) {
        transfer::public_transfer(nft, recipient)
    }

    /// Update the \`description\` of \`nft\` to \`new_description\`
    public fun update_description(
        nft: &mut ${config.name.toUpperCase()},
        new_description: vector<u8>,
        _: &mut TxContext,
    ) {
        nft.description = string::utf8(new_description)
    }

    /// Permanently delete \`nft\`
    public fun burn(nft: ${config.name.toUpperCase()}, _: &mut TxContext) {
        let ${config.name.toUpperCase()} { id, name: _, description: _, url: _ } = nft;
        object::delete(id)
    }
}`;

        // Write updated content to nft.move
        fs.writeFileSync(nftMovePath, nftMoveContent);
        console.log('Updated nft.move with new configuration');

        // Execute deploy.sh and capture output
        const deployScriptPath = path.join(__dirname, 'deploy.sh');
        console.log('Executing deploy script...');
        const deployOutput = execSync(`sh ${deployScriptPath} "${config.name}" "${config.description}" "${config.url}" "${config.walletAddress}"`, { encoding: 'utf-8' });

        // Extract PackageID from output
        const packageIdMatch = deployOutput.match(/PACKAGE_ID:(.*)/);
        const packageId = packageIdMatch ? packageIdMatch[1].trim() : '';

        // Extract ObjectID from output
        const objectIdMatch = deployOutput.match(/OBJECT_ID:(.*)/);
        const objectId = objectIdMatch ? objectIdMatch[1].trim() : '';

        if (!packageId || !objectId) {
            console.error('Deployment output:', deployOutput);
            throw new Error('Failed to extract Package ID or Object ID from deployment output');
        }

        console.log('Deployment completed successfully!');
        console.log('Package ID:', packageId);
        console.log('Object ID:', objectId);

        // Transfer NFT after deployment
        console.log('Starting NFT transfer...');
        await transferNFT(
            packageId,
            config.name,
            config.walletAddress,
            process.env.MNEMONIC || ''
        );

        return {
            nftName: config.name,
            description: config.description,
            url: config.url,
            walletAddress: config.walletAddress,
            packageId: packageId,
            objectId: objectId
        };
    } catch (error) {
        console.error('Deployment failed:', error);
        throw error;
    }
}

async function transferNFT(
    packageId: string,
    nftName: string,
    recipientAddress: string,
    mnemonic: string
) {
    try {
        // Setup client
        const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io' });

        const keypair = Ed25519Keypair.deriveKeypair(mnemonic);

        // Get the sender's address
        const senderAddress = keypair.toSuiAddress();
        console.log('Sender address:', senderAddress);

        // Get objects owned by sender
        const objects = await client.getOwnedObjects({
            owner: senderAddress,
            filter: {
                MatchAll: [{
                    StructType: `${packageId}::${nftName}::${nftName.toUpperCase()}`
                }]
            }
        });

        if (objects.data.length === 0 || !objects.data[0].data) {
            throw new Error('No NFTs found for transfer');
        }

        const objectId = objects.data[0].data.objectId;
        console.log('Found NFT with Object ID:', objectId);

        // Create transfer transaction
        const tx = new Transaction();
        tx.transferObjects(
            [objectId],
            recipientAddress
        );

        // Execute transaction
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });

        console.log('NFT Transfer successful!');
        console.log('Transaction digest:', result.digest);
        console.log('Transaction status:', result.effects?.status.status);
        
        return result;
    } catch (error) {
        console.error('NFT Transfer failed:', error);
        throw error;
    }
}

// Example usage
async function main() {
    const nftConfig: NFTConfig = {
        name: "TestnetNFT",
        description: "A test NFT for the Sui blockchain",
        url: "https://example.com/nft-image.png",
        walletAddress: "0x6c08d876dbae4c122ada495bc78187eebddc9a9f6352589b7fcba4910efbdc6f"
    };

    try {
        const result = await deployNFT(nftConfig);
        console.log('\nDeployment Details:');
        console.log('------------------');
        console.log(`NFT Name: ${result.nftName}`);
        console.log(`Description: ${result.description}`);
        console.log(`URL: ${result.url}`);
        console.log(`Package ID: ${result.packageId}`);
        console.log(`Object ID: ${result.objectId}`);
        console.log('------------------');
    } catch (error) {
        console.error('Deployment failed:', error);
    }
}

main().catch(console.error);