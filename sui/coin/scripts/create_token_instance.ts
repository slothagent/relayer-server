import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient } from '@mysten/sui.js/client';
import * as dotenv from 'dotenv';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { derivePath } from 'ed25519-hd-key';
import * as bip39 from 'bip39';

dotenv.config();

const TESTNET_URL = 'https://fullnode.testnet.sui.io:443';
const PACKAGE_ID = '0x11e365822e184f59832959a7b53a63be5cc01c6d389c9fbc8b23fea5eec6b80d';

// Token configuration
const TOKEN_CONFIG = {
    decimals: 9,
    symbol: "MTK",
    name: "My Token",
    description: "My custom token on Sui"
};

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

        // Create transaction block
        const tx = new TransactionBlock();
        tx.setSender(address);
        tx.setGasBudget(100000000);

        console.log([
            TOKEN_CONFIG.decimals,
            Array.from(new TextEncoder().encode(TOKEN_CONFIG.symbol)),
            Array.from(new TextEncoder().encode(TOKEN_CONFIG.name)),
            Array.from(new TextEncoder().encode(TOKEN_CONFIG.description)),
            Array.from(new TextEncoder().encode('https://imgs.search.brave.com/igK8GPcS7Hp8LHpbM345dZjqAeuoe0C-MzytIP4NuEM/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pbWcuZnJlZXBpay5jb20vcHJlbWl1bS1waG90by9hbmltZS1naXJsLWxvb2tpbmctY2l0eXNjYXBlLTNkLWlsbHVzdHJhdGlvbi1nZW5lcmF0aXZlLWFpXzE3MDk4NC01NTczLmpwZz9zZW10PWFpc19oeWJyaWQmdz03NDA')),
            1_000_000
          ]);

        // Call create_token function (no TokenFactoryCapability needed)
        tx.moveCall({
            target: `${PACKAGE_ID}::token_factory::create_token`,
            arguments: [
                tx.pure(TOKEN_CONFIG.decimals, 'u8'),
                tx.pure(Array.from(new TextEncoder().encode(TOKEN_CONFIG.symbol)), 'vector<u8>'),
                tx.pure(Array.from(new TextEncoder().encode(TOKEN_CONFIG.name)), 'vector<u8>'),
                tx.pure(Array.from(new TextEncoder().encode(TOKEN_CONFIG.description)), 'vector<u8>'),
                tx.pure(Array.from(new TextEncoder().encode('https://imgs.search.brave.com/igK8GPcS7Hp8LHpbM345dZjqAeuoe0C-MzytIP4NuEM/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pbWcuZnJlZXBpay5jb20vcHJlbWl1bS1waG90by9hbmltZS1naXJsLWxvb2tpbmctY2l0eXNjYXBlLTNkLWlsbHVzdHJhdGlvbi1nZW5lcmF0aXZlLWFpXzE3MDk4NC01NTczLmpwZz9zZW10PWFpc19oeWJyaWQmdz03NDA')), 'vector<u8>'),
                tx.pure(1_000_000, 'u64')
            ]
        });

        // Build transaction bytes
        const txBytes = await tx.build({ client });
        // Sign the transaction
        const signatureData = await keypair.signTransactionBlock(txBytes);
        const signature = [signatureData.signature];

        console.log('Creating token...');
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

        console.log('Token created successfully!');
        console.log('Transaction result:', JSON.stringify(result, null, 2));

        // Find and print the CreateTokenEvent from the transaction events
        const createTokenEvent = result.events?.find(
            (e: any) => e.type === `${PACKAGE_ID}::token_factory::CreateTokenEvent`
        );
        if (createTokenEvent) {
            console.log('CreateTokenEvent:', createTokenEvent.parsedJson);
        } else {
            console.log('No CreateTokenEvent found in transaction events.');
        }

    } catch (error) {
        console.error('Error creating token:', error);
        throw error;
    }
}

main().catch(console.error); 