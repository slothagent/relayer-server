import { Hono } from 'hono';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui.js/keypairs/secp256k1';
import { SuiClient } from '@mysten/sui.js/client';
import { bcs } from '@mysten/sui.js/bcs';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { cors } from 'hono/cors';
import { db } from './src/db';
import { accounts } from './src/db/schema';
import { and, eq } from 'drizzle-orm';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const app = new Hono();

// Setup CORS for API access
app.use('/*', cors());
// Configure Sui client for testnet


// API Routes
app.get('/', (c) => {
  return c.json({ status: 'success', message: 'Sui Relayer API is running' });
});

// Create a new Sui account
app.post('/api/sui/account', async (c) => {
  try {
    const body = await c.req.json();
    const { scheme = 'ed25519', user_id, network } = body;
    
    // Validate required parameters
    if (!user_id) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter'
      }, 400);
    }

    if (!network) {
      return c.json({
        status: 'error',
        message: 'Missing network parameter'
      }, 400);
    }

    // Validate network value
    if (!['mainnet', 'testnet'].includes(network)) {
      return c.json({
        status: 'error',
        message: 'Invalid network parameter. Must be either "mainnet" or "testnet"'
      }, 400);
    }
    
    let keypair;
    // Generate a new mnemonic using bip39
    const mnemonic = bip39.generateMnemonic();
    
    // Generate keypair from mnemonic
    if (scheme.toLowerCase() === 'ed25519') {
      // Derive keypair from mnemonic using standard Sui derivation path
      const derivationPath = "m/44'/784'/0'/0'/0'";
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const { key } = derivePath(derivationPath, seed.toString('hex'));
      keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(key));
    } else if (scheme.toLowerCase() === 'secp256k1') {
      keypair = Secp256k1Keypair.deriveKeypair(mnemonic);
    } else {
      return c.json({ 
        status: 'error', 
        message: 'Unsupported scheme. Supported schemes: ed25519, secp256k1' 
      }, 400);
    }
    
    const address = keypair.getPublicKey().toSuiAddress();
    const publicKey = keypair.getPublicKey().toBase64();
    const privateKey = keypair.export().privateKey;

    // Save to database
    try {
      await db.insert(accounts).values({
        address,
        publicKey,
        privateKey,
        mnemonic,
        scheme,
        user_id,
        network
      });
    } catch (dbError: any) {
      // If duplicate, ignore, else throw
      if (dbError.code !== '23505') { // 23505 is unique_violation in Postgres
        throw dbError;
      }
    }
    
    return c.json({
      status: 'success',
      data: {
        address,
        publicKey,
        mnemonic,
        scheme,
        network,
        exportedKeypair: keypair.export()
      }
    });
  } catch (error: any) {
    console.error('Error creating Sui account:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to create Sui account',
      error: error.message
    }, 500);
  }
});



// Get account(s) by user_id and optional privatekey
app.get('/api/sui/account/by-user', async (c) => {
  try {
    const user_id = c.req.query('user_id');
    const privatekey = c.req.query('privatekey');
    const network = c.req.query('network')

    if (!user_id) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter'
      }, 400);
    }

    // Build base query with user_id
    let conditions = [eq(accounts.user_id, user_id)];

    // Add network condition if provided
    if (network) {
      conditions.push(eq(accounts.network, network));
    }

    // Add privatekey condition if provided
    if (privatekey) {
      conditions.push(eq(accounts.privateKey, privatekey));
    }

    // Execute query with all conditions
    const result = await db.select()
      .from(accounts)
      .where(and(...conditions));

    return c.json({
      status: 'success',
      data: result
    });
  } catch (error: any) {
    console.error('Error fetching account by user_id:', error);
    return c.json({
      status: 'error',
      message: 'Failed to fetch account',
      error: error.message
    }, 500);
  }
});

// Get account details
app.get('/api/sui/account/:address', async (c) => {
  try {
    const address = c.req.param('address');
    const network = c.req.query('network')
    // Validate address format
    if (!address) {
      return c.json({
        status: 'error',
        message: 'Invalid Sui address format'
      }, 400);
    }
    const suiClient = new SuiClient({
      url: network == "mainnet" ? 'https://fullnode.mainnet.sui.io:443' :  "https://fullnode.testnet.sui.io:443",
    });

    const balance = await suiClient.getBalance({owner: address})
    // Get all token balances
    const allBalances = await suiClient.getAllBalances({ owner: address });
    // Enrich with metadata (symbol, decimals)
    const tokens = await Promise.all(
      allBalances.map(async (bal) => {
        const meta = await suiClient.getCoinMetadata({ coinType: bal.coinType });
        return {
          coinType: bal.coinType,
          balance: bal.totalBalance,
          symbol: meta?.symbol || null,
          decimals: meta?.decimals || null,
        };
      })
    );

    // Get all owned objects (NFTs/assets)
    const nfts = await suiClient.getOwnedObjects({
      owner: address,
      options: { showType: true, showContent: true },
    });
    // You can add more logic to filter/format NFT data as needed

    return c.json({
      status: 'success',
      data: {
        balance,
        address,
        tokens,
        nfts: nfts.data,
      }
    });
  } catch (error: any) {
    console.error('Error fetching Sui account:', error);
    return c.json({ 
      status: 'error', 
      message: 'Failed to fetch Sui account',
      error: error.message 
    }, 500);
  }
});

// Delete account by user_id and network
app.delete('/api/sui/account', async (c) => {
  try {
    const user_id = c.req.query('user_id');
    const network = c.req.query('network');
    const address = c.req.query('address');

    // Validate required parameters
    if (!user_id) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter'
      }, 400);
    }

    // Build where conditions
    let conditions = [
      eq(accounts.user_id, user_id)
    ];

    // Add network condition if provided
    if (network) {
      conditions.push(eq(accounts.network, network));
    }

    // Add address condition if provided
    if (address) {
      conditions.push(eq(accounts.address, address));
    }

    // Delete account(s) matching conditions
    await db.delete(accounts)
      .where(and(...conditions));

    return c.json({
      status: 'success',
      message: 'Account(s) deleted successfully'
    });

  } catch (error: any) {
    console.error('Error deleting account:', error);
    return c.json({
      status: 'error',
      message: 'Failed to delete account',
      error: error.message
    }, 500);
  }
});

// Create a new token on Sui blockchain
app.post('/api/sui/token', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      name, 
      symbol, 
      description, 
      image_url, 
      init_supply, 
      wallet_address,
      network 
    } = body;

    // Validate required parameters
    if (!name || !symbol || !init_supply || !wallet_address || !network) {
      return c.json({
        status: 'error',
        message: 'Missing required parameters: name, symbol, init_supply, wallet_address, and network are required'
      }, 400);
    }

    // Validate network value
    if (!['mainnet', 'testnet'].includes(network)) {
      return c.json({
        status: 'error',
        message: 'Invalid network parameter. Must be either "mainnet" or "testnet"'
      }, 400);
    }

    // Get the account from database
    const account = await db.select()
      .from(accounts)
      .where(and(
        eq(accounts.address, wallet_address),
        eq(accounts.network, network)
      ))
      .limit(1);

    if (!account || account.length === 0) {
      return c.json({
        status: 'error',
        message: 'Account not found or not authorized'
      }, 404);
    }

    // Initialize Sui client
    const suiClient = new SuiClient({
      url: network === "mainnet" ? 'https://fullnode.mainnet.sui.io:443' : 'https://fullnode.testnet.sui.io:443',
    });

    // Create transaction block for token creation
    const tx = new TransactionBlock();

    // Create new coin with custom parameters
    const [treasury_cap, metadata] = tx.moveCall({
      target: '0x2::coin::create_currency',
      arguments: [
        tx.pure(Buffer.from(name).toString('hex')), // Name as bytes
        tx.pure(Buffer.from(symbol).toString('hex')), // Symbol as bytes
        tx.pure(Buffer.from(description || '').toString('hex')), // Description as bytes
        tx.pure(9), // Decimals
      ],
    });

    // Mint initial supply
    const coin = tx.moveCall({
      target: '0x2::coin::mint',
      arguments: [
        treasury_cap,
        tx.pure(BigInt(init_supply))
      ],
    });

    // Transfer the minted coins to the creator
    tx.transferObjects([coin], tx.pure(wallet_address));

    // If image URL is provided, update the icon URL
    if (image_url) {
      tx.moveCall({
        target: '0x2::coin::update_icon_url',
        arguments: [
          metadata,
          tx.pure(image_url)
        ],
      });
    }

    // Sign and execute transaction
    const keypair = Ed25519Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(account[0].privateKey, 'base64').slice(0, 32))
    );
    
    const result = await suiClient.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });

    return c.json({
      status: 'success',
      data: {
        transaction: result,
        token: {
          name,
          symbol,
          description,
          image_url,
          init_supply: Number(init_supply),
          decimals: 9,
          creator: wallet_address,
          network
        }
      }
    });

  } catch (error: any) {
    console.error('Error creating token:', error);
    return c.json({
      status: 'error',
      message: 'Failed to create token',
      error: error.message
    }, 500);
  }
});

// Import account using private key or mnemonic
app.post('/api/sui/account/import', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      private_key, 
      mnemonic, 
      user_id, 
      network, 
      scheme = 'ed25519' 
    } = body;

    // Validate required parameters
    if (!user_id) {
      return c.json({
        status: 'error',
        message: 'Missing user_id parameter'
      }, 400);
    }

    if (!network) {
      return c.json({
        status: 'error',
        message: 'Missing network parameter'
      }, 400);
    }

    // Validate network value
    if (!['mainnet', 'testnet'].includes(network)) {
      return c.json({
        status: 'error',
        message: 'Invalid network parameter. Must be either "mainnet" or "testnet"'
      }, 400);
    }

    // Check if at least one of private_key or mnemonic is provided
    if (!private_key && !mnemonic) {
      return c.json({
        status: 'error',
        message: 'Either private_key or mnemonic must be provided'
      }, 400);
    }

    let keypair;

    if (private_key) {
      // Import from private key
      try {
        if (scheme.toLowerCase() === 'ed25519') {
          keypair = Ed25519Keypair.fromSecretKey(
            Uint8Array.from(Buffer.from(private_key, 'base64').slice(0, 32))
          );
        } else if (scheme.toLowerCase() === 'secp256k1') {
          keypair = Secp256k1Keypair.fromSecretKey(
            Uint8Array.from(Buffer.from(private_key, 'base64'))
          );
        } else {
          throw new Error('Unsupported scheme');
        }
      } catch (error) {
        return c.json({
          status: 'error',
          message: 'Invalid private key format'
        }, 400);
      }
    } else if (mnemonic) {
      // Validate mnemonic (12 words)
      const words = mnemonic.trim().split(' ');
      if (words.length !== 12) {
        return c.json({
          status: 'error',
          message: 'Mnemonic must be exactly 12 words'
        }, 400);
      }

      // Import from mnemonic
      try {
        if (scheme.toLowerCase() === 'ed25519') {
          keypair = Ed25519Keypair.deriveKeypair(mnemonic);
        } else if (scheme.toLowerCase() === 'secp256k1') {
          keypair = Secp256k1Keypair.deriveKeypair(mnemonic);
        } else {
          throw new Error('Unsupported scheme');
        }
      } catch (error) {
        return c.json({
          status: 'error',
          message: 'Invalid mnemonic phrase'
        }, 400);
      }
    }

    // Ensure keypair was created
    if (!keypair) {
      return c.json({
        status: 'error',
        message: 'Failed to create keypair'
      }, 500);
    }

    const address = keypair.getPublicKey().toSuiAddress();
    const publicKey = keypair.getPublicKey().toBase64();
    const privateKey = keypair.export().privateKey;

    // Check if account already exists
    const existingAccount = await db.select()
      .from(accounts)
      .where(and(
        eq(accounts.address, address),
        eq(accounts.network, network)
      ))
      .limit(1);

    if (existingAccount && existingAccount.length > 0) {
      return c.json({
        status: 'error',
        message: 'Account already exists for this network'
      }, 400);
    }

    // Save to database
    await db.insert(accounts).values({
      address,
      publicKey,
      privateKey,
      scheme,
      user_id,
      mnemonic,
      network
    });

    return c.json({
      status: 'success',
      data: {
        address,
        publicKey,
        scheme,
        network
      }
    });

  } catch (error: any) {
    console.error('Error importing account:', error);
    return c.json({
      status: 'error',
      message: 'Failed to import account',
      error: error.message
    }, 500);
  }
});

// Start the server
const port = parseInt(process.env.PORT || '7777', 10);
console.log(`Server is running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
