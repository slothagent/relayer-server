import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient } from '@mysten/sui.js/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { derivePath } from 'ed25519-hd-key';
import * as bip39 from 'bip39';
import { execSync } from 'child_process';

dotenv.config();

const TESTNET_URL = 'https://fullnode.testnet.sui.io:443';

async function main() {
    // Initialize SuiClient
    const client = new SuiClient({ url: TESTNET_URL });

    // Get mnemonic from environment variables
    const mnemonic = process.env.MNEMONIC;
    if (!mnemonic) {
        throw new Error('Mnemonic not found in environment variables');
    }

    try {
        // Convert mnemonic to seed
        const derivationPath = "m/44'/784'/0'/0'/0'";
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const { key } = derivePath(derivationPath, seed.toString('hex'));
        const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(key));
        const address = keypair.getPublicKey().toSuiAddress();
        console.log('Wallet address:', address);

        // Check wallet balance
        const balance = await client.getBalance({
            owner: address,
            coinType: '0x2::sui::SUI'
        });
        console.log('Wallet balance:', Number(balance.totalBalance) / 1000000000, 'SUI');

        try {
            // Get contract bytecode using sui move build
            const contractURI = path.resolve(__dirname, '../');
            console.log('Building contract from:', contractURI);
            
            const { modules, dependencies } = JSON.parse(
                execSync(`sui move build --dump-bytecode-as-base64 --path ${contractURI}`, {
                    encoding: 'utf-8',
                })
            );

            // Create transaction block
            const tx = new TransactionBlock();
            tx.setSender(address);
            tx.setGasBudget(1000000000);

            // Publish the package
            const [upgradeCap] = tx.publish({
                modules,
                dependencies
            });

            // Transfer upgrade cap to sender
            tx.transferObjects([upgradeCap], tx.pure(address));

            // Build transaction bytes
            const txBytes = await tx.build({ client });
            
            // Sign the transaction
            const signatureData = await keypair.signTransactionBlock(txBytes);
            const signature = [signatureData.signature];

            // Simulate the transaction first
            console.log('Simulating transaction...');
            const simulationResult = await client.dryRunTransactionBlock({
                transactionBlock: txBytes
            });

            if (simulationResult.effects.status.status === "success") {
                console.log('Simulation successful, executing transaction...');
                const result = await client.executeTransactionBlock({
                    transactionBlock: txBytes,
                    signature: signature,
                    requestType: 'WaitForLocalExecution',
                    options: {
                        showEffects: true,
                        showEvents: true,
                        showInput: true,
                    }
                });

                const packageId = result.effects?.created?.find(
                    (obj: any) => obj.owner === 'Immutable'
                )?.reference?.objectId;

                if (!packageId) {
                    throw new Error('Failed to get package ID from transaction');
                }

                console.log('Package published successfully!');
                console.log('Package ID:', packageId);
                console.log('Full result:', JSON.stringify(result, null, 2));
            } else {
                console.log('Simulation failed:', JSON.stringify(simulationResult, null, 2));
                throw new Error(`Simulation failed: ${simulationResult.effects.status.error}`);
            }

        } catch (error: any) {
            console.error('Detailed error:', error);
            throw error;
        }
    } catch (error) {
        console.error('Error creating keypair from mnemonic:', error);
        throw error;
    }
}

main().catch(console.error); 
