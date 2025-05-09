import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import dotenv from 'dotenv';

dotenv.config(); 

interface TokenConfig {
    name: string;
    symbol: string;
    decimals: number;
    initialSupply: number;
    description: string;
    url: string;
    twitter: string;
    telegram: string;
    website: string;
    uri: string;
    walletAddress: string;
}

interface DeployResult {
    tokenName: string;
    tokenSymbol: string;
    decimals: number;
    initialSupply: number;
    walletAddress: string;
    packageId: string;
    coinType: string;
}

async function transferTokens(
    coinType: string,
    recipientAddress: string,
    mnemonic: string
) {
    try {
        // Setup client
        const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io' });

        const keypair = Ed25519Keypair.deriveKeypair(mnemonic)

        // Get the sender's address
        const senderAddress = keypair.toSuiAddress();
        console.log('Sender address:', senderAddress);

        // Get coins owned by sender
        const coins = await client.getCoins({
            owner: senderAddress,
            coinType: coinType
        });

        if (coins.data.length === 0) {
            throw new Error('No coins found for transfer');
        }

        // Create transfer transaction
        const tx = new Transaction();
        tx.transferObjects(
            [coins.data[0].coinObjectId],
            recipientAddress
        );

        // Execute transaction
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });

        console.log('Transfer successful!');
        console.log('Transaction digest:', result.digest);
        console.log('Transaction status:', result.effects?.status.status);
        
        return result;
    } catch (error) {
        console.error('Transfer failed:', error);
        throw error;
    }
}

async function deployToken(config: TokenConfig): Promise<DeployResult> {
    try {
        // Update token.move with new configuration
        const tokenMovePath = path.join(__dirname, '../sources/token.move');
        const tokenMoveContent = `module 0x0::${config.name} {
    struct ${config.name.toUpperCase()} has drop {}
    
    fun init(witness: ${config.name.toUpperCase()}, ctx: &mut 0x2::tx_context::TxContext) {
        let (treasury_cap, metadata) = 0x2::coin::create_currency<${config.name.toUpperCase()}>(
            witness,
            ${config.decimals},
            b"${config.symbol}",
            b"${config.name}",
            b"${config.description}",
            0x1::option::some<0x2::url::Url>(0x2::url::new_unsafe_from_bytes(b"${config.uri}")),
            ctx
        );
        
        0x2::transfer::public_freeze_object<0x2::coin::CoinMetadata<${config.name.toUpperCase()}>>(metadata);
        0x2::transfer::public_transfer<0x2::coin::Coin<${config.name.toUpperCase()}>>(
            0x2::coin::mint<${config.name.toUpperCase()}>(&mut treasury_cap, ${config.initialSupply}, ctx),
            0x2::tx_context::sender(ctx)
        );
        0x2::transfer::public_freeze_object<0x2::coin::TreasuryCap<${config.name.toUpperCase()}>>(treasury_cap);
    }
}`;

        // Write updated content to token.move
        fs.writeFileSync(tokenMovePath, tokenMoveContent);
        console.log('Updated token.move with new configuration');

        // Execute deploy.sh and capture output
        const deployScriptPath = path.join(__dirname, 'deploy.sh');
        console.log('Executing deploy script...');
        const deployOutput = execSync(`sh ${deployScriptPath}`, { encoding: 'utf-8' });

        // Extract PackageID from output
        const packageIdMatch = deployOutput.match(/PACKAGE_ID:(.*)/);
        const packageId = packageIdMatch ? packageIdMatch[1].trim() : '';

        // Construct coin type
        const coinType = `${packageId}::${config.name}::${config.name.toUpperCase()}`;

        console.log('Deployment completed successfully!');

        // Transfer tokens after deployment
        console.log('Starting token transfer...');
        await transferTokens(
            coinType,
            config.walletAddress,
            process.env.MNEMONIC || ''
        );

        return {
            tokenName: config.name,
            tokenSymbol: config.symbol,
            decimals: config.decimals,
            initialSupply: config.initialSupply,
            walletAddress: config.walletAddress,
            packageId: packageId,
            coinType: coinType
        };
    } catch (error) {
        console.error('Deployment failed:', error);
        throw error;
    }
}

// Example usage
async function main() {
    const tokenConfig: TokenConfig = {
        name: "TokenFTS",
        symbol: "TFTS",
        decimals: 9,
        initialSupply: 1000000000*10**9,
        description: "TokenFT Custom Token",
        url: "https://example.com",
        twitter: "https://twitter.com/tokenft",
        telegram: "https://t.me/tokenft",
        website: "https://tokenft.com",
        uri: "https://imageio.forbes.com/specials-images/imageserve/6170e01f8d7639b95a7f2eeb/Sotheby-s-NFT-Natively-Digital-1-2-sale-Bored-Ape-Yacht-Club--8817-by-Yuga-Labs/0x0.png?format=png&width=960",
        walletAddress: "0x6c08d876dbae4c122ada495bc78187eebddc9a9f6352589b7fcba4910efbdc6f"
    };

    try {
        const result = await deployToken(tokenConfig);
        console.log('\nDeployment Details:');
        console.log('------------------');
        console.log(`Token Name: ${result.tokenName}`);
        console.log(`Token Symbol: ${result.tokenSymbol}`);
        console.log(`Decimals: ${result.decimals}`);
        console.log(`Initial Supply: ${result.initialSupply}`);
        console.log(`Wallet Address: ${result.walletAddress}`);
        console.log(`Package ID: ${result.packageId}`);
        console.log(`Coin Type: ${result.coinType}`);
        console.log('------------------');
    } catch (error) {
        console.error('Deployment failed:', error);
    }
}

main().catch(console.error); 
