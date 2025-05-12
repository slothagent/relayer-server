import { Hono } from 'hono';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui.js/keypairs/secp256k1';
import { SuiClient } from '@mysten/sui.js/client';
import { cors } from 'hono/cors';
import { db } from './src/db';
import { accounts } from './src/db/schema';
import { and, eq } from 'drizzle-orm';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { transferNFT, transferTokens } from 'lib/sui';

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
        network,
        isActive: true
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
    console.log(body)
    const { 
      name, 
      symbol, 
      description, 
      image_url, 
      init_supply, 
      network,
      twitter,
      telegram,
      website,
      uri,
      user_id
    } = body;

    // Validate required parameters
    if (!name || !symbol || !init_supply || !network) {
      return c.json({
        status: 'error',
        message: 'Missing required parameters: name, symbol, init_supply, and network are required'
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
        eq(accounts.network, network),
        eq(accounts.user_id, user_id)
      ))
      .limit(1);

    if (!account || account.length === 0) {
      return c.json({
        status: 'error',
        message: 'Account not found or not authorized'
      }, 404);
    }

    // Create token configuration
    const tokenConfig = {
      name,
      symbol,
      decimals: 9,
      initialSupply: init_supply,
      description: description || '',
      url: website || '',
      twitter: twitter || '',
      telegram: telegram || '',
      website: website || '',
      uri: uri || image_url || ''
    };

    // Update token.move with new configuration
    const tokenMovePath = path.join(__dirname, 'token/sources/token.move');
    const tokenMoveContent = `module 0x0::${name} {
    struct ${name.toUpperCase()} has drop {}
    
    fun init(witness: ${name.toUpperCase()}, ctx: &mut 0x2::tx_context::TxContext) {
        let (treasury_cap, metadata) = 0x2::coin::create_currency<${name.toUpperCase()}>(
            witness,
            ${tokenConfig.decimals},
            b"${symbol}",
            b"${name}",
            b"${description}",
            0x1::option::some<0x2::url::Url>(0x2::url::new_unsafe_from_bytes(b"${uri || image_url}")),
            ctx
        );
        
        0x2::transfer::public_freeze_object<0x2::coin::CoinMetadata<${name.toUpperCase()}>>(metadata);
        0x2::transfer::public_transfer<0x2::coin::Coin<${name.toUpperCase()}>>(
            0x2::coin::mint<${name.toUpperCase()}>(&mut treasury_cap, ${init_supply}, ctx),
            0x2::tx_context::sender(ctx)
        );
        0x2::transfer::public_freeze_object<0x2::coin::TreasuryCap<${name.toUpperCase()}>>(treasury_cap);
    }
}`;

    // Write updated content to token.move
    fs.writeFileSync(tokenMovePath, tokenMoveContent);

    // Execute deploy script
    const deployScriptPath = path.join(__dirname, 'token/scripts/deploy.sh');
    const deployOutput = execSync(`sh ${deployScriptPath}`, { encoding: 'utf-8' });

    // Extract PackageID from output
    const packageIdMatch = deployOutput.match(/PACKAGE_ID:(.*)/);
    const packageId = packageIdMatch ? packageIdMatch[1].trim() : '';

    // Validate package ID
    if (!packageId) {
      return c.json({
        status: 'error',
        message: 'Failed to deploy token: No package ID received from deployment'
      }, 500);
    }

    // Construct coin type
    const coinType = `${packageId}::${name}::${name.toUpperCase()}`;

    // Validate coin type
    if (coinType === `::${name}::${name.toUpperCase()}`) {
      return c.json({
        status: 'error',
        message: 'Failed to deploy token: Invalid coin type generated'
      }, 500);
    }

    // Transfer tokens to the account
    await transferTokens(
      coinType,
      account[0].address
    );

    return c.json({
      status: 'success',
      data: {
        name,
        symbol,
        description,
        image_url: uri || image_url,
        init_supply: Number(init_supply),
        decimals: 9,
        network,
        packageId,
        coinType,
        twitter,
        telegram,
        website,
        explorerCoinType: `https://suiscan.xyz/${network.toLowerCase()}/coin/${coinType}/txs`
      }
    });

  } catch (error: any) {
    console.error('Error creating token:', error);
    // Check if error is from deployment script
    if (error.message && error.message.includes('deploy.sh')) {
      return c.json({
        status: 'error',
        message: 'Failed to deploy token: Deployment script execution failed',
        error: error.message
      }, 500);
    }
    return c.json({
      status: 'error',
      message: 'Failed to create token',
      error: error.message
    }, 500);
  }
});

// Create a new NFT on Sui blockchain
app.post('/api/sui/nft', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      name, 
      description, 
      url, 
      user_id,
      network
    } = body;

    // Validate required parameters
    if (!name || !description || !url || !network || !user_id) {
      return c.json({
        status: 'error',
        message: 'Missing required parameters: name, description, url, network, and user_id are required'
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
        eq(accounts.network, network),
        eq(accounts.user_id, user_id),
        eq(accounts.isActive, true)
      ))
      .limit(1);

    if (!account || account.length === 0) {
      return c.json({
        status: 'error',
        message: 'Account not found or not authorized'
      }, 404);
    }

    // Update nft.move with new configuration
    const nftMovePath = path.join(__dirname, 'nft/sources/nft.move');
    const nftMoveContent = `// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

module 0x0::${name} {
    use std::string;
    use sui::event;
    use sui::url::{Self, Url};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// An example NFT that can be minted by anybody
    struct ${name.toUpperCase()} has key, store {
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
    public fun name(nft: &${name.toUpperCase()}): &string::String {
        &nft.name
    }

    /// Get the NFT's \`description\`
    public fun description(nft: &${name.toUpperCase()}): &string::String {
        &nft.description
    }

    /// Get the NFT's \`url\`
    public fun url(nft: &${name.toUpperCase()}): &Url {
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
        let nft = ${name.toUpperCase()} {
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
    public fun transfer(nft: ${name.toUpperCase()}, recipient: address, _: &mut TxContext) {
        transfer::public_transfer(nft, recipient)
    }

    /// Update the \`description\` of \`nft\` to \`new_description\`
    public fun update_description(
        nft: &mut ${name.toUpperCase()},
        new_description: vector<u8>,
        _: &mut TxContext,
    ) {
        nft.description = string::utf8(new_description)
    }

    /// Permanently delete \`nft\`
    public fun burn(nft: ${name.toUpperCase()}, _: &mut TxContext) {
        let ${name.toUpperCase()} { id, name: _, description: _, url: _ } = nft;
        object::delete(id)
    }
}`;

    // Write updated content to nft.move
    fs.writeFileSync(nftMovePath, nftMoveContent);

    // Execute deploy script with the account's mnemonic
    const deployScriptPath = path.join(__dirname, 'nft/scripts/deploy.sh');
    const deployOutput = execSync(`sh ${deployScriptPath} "${name}" "${description}" "${url}" "${account[0].address}"`, { 
      encoding: 'utf-8',
      env: {
        ...process.env,
        MNEMONIC: account[0].mnemonic
      }
    });

    // Extract PackageID from output
    const packageIdMatch = deployOutput.match(/PACKAGE_ID:(.*)/);
    const packageId = packageIdMatch ? packageIdMatch[1].trim() : '';

    // Extract ObjectID from output
    const objectIdMatch = deployOutput.match(/OBJECT_ID:(.*)/);
    const objectId = objectIdMatch ? objectIdMatch[1].trim() : '';

    // Validate package ID and object ID
    if (!packageId || !objectId) {
      return c.json({
        status: 'error',
        message: 'Failed to deploy NFT: No package ID or object ID received from deployment',
        deployOutput
      }, 500);
    }

    await transferNFT(
      packageId,
      name,
      account[0].address
    );

    return c.json({
      status: 'success',
      data: {
        name,
        description,
        url,
        network,
        packageId,
        objectId,
        explorerUrl: `https://suiscan.xyz/${network.toLowerCase()}/object/${objectId}`
      }
    });

  } catch (error: any) {
    console.error('Error creating NFT:', error);
    // Check if error is from deployment script
    if (error.message && error.message.includes('deploy.sh')) {
      return c.json({
        status: 'error',
        message: 'Failed to deploy NFT: Deployment script execution failed',
        error: error.message
      }, 500);
    }
    return c.json({
      status: 'error',
      message: 'Failed to create NFT',
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
      network,      isActive: true
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

// Switch active address for a user
app.post('/api/sui/account/switch', async (c) => {
  try {
    const body = await c.req.json();
    const { user_id, address, network } = body;

    // Validate required parameters
    if (!user_id || !address || !network) {
      return c.json({
        status: 'error',
        message: 'Missing required parameters: user_id, address, and network are required'
      }, 400);
    }

    // Validate network value
    if (!['mainnet', 'testnet'].includes(network)) {
      return c.json({
        status: 'error',
        message: 'Invalid network parameter. Must be either "mainnet" or "testnet"'
      }, 400);
    }

    // First, set all addresses for this user to inactive (regardless of network)
    await db.update(accounts)
      .set({ isActive: false })
      .where(eq(accounts.user_id, user_id));

    // Then, set the specified address to active
    const result = await db.update(accounts)
      .set({ isActive: true })
      .where(and(
        eq(accounts.user_id, user_id),
        eq(accounts.network, network),
        eq(accounts.address, address)
      ))
      .returning();

    if (!result || result.length === 0) {
      return c.json({
        status: 'error',
        message: 'Address not found for this user and network'
      }, 404);
    }

    return c.json({
      status: 'success',
      data: {
        message: 'Active address switched successfully',
        activeAddress: result[0]
      }
    });

  } catch (error: any) {
    console.error('Error switching active address:', error);
    return c.json({
      status: 'error',
      message: 'Failed to switch active address',
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
