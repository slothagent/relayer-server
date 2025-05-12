import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import dotenv from 'dotenv';

dotenv.config();

export async function transferTokens(
    coinType: string,
    recipientAddress: string
) {
    try {
        // Setup client
        const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io' });

        const keypair = Ed25519Keypair.deriveKeypair(process.env.MNEMONIC || '')

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
        
        return result;
    } catch (error) {
        console.error('Transfer failed:', error);
        throw error;
    }
}

export async function transferNFT(
    packageId: string,
    nftName: string,
    recipientAddress: string
) {
    try {
        // Setup client
        const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io' });

        const keypair = Ed25519Keypair.deriveKeypair(process.env.MNEMONIC || '');

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