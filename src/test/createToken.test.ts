import { ethers } from 'ethers';
import { SlothFactoryABI } from '../abis/abis';
import { SLOTH_FACTORY_CONTRACT_ADDRESS, RELAYER_ADDRESS, slothFactoryContract, NATIVE_TOKEN, wallet } from '../config';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Define interfaces
interface SlothCreationParams {
    name: string;
    symbol: string;
    tokenId: string | number | bigint;
    initialDeposit: string | bigint;
}

interface CreateTokenRequest {
    type: 'create-token';
    creator: string;
    params: SlothCreationParams;
    deadline: string;
    nonce: string;
    signature: {
        v: number;
        r: string;
        s: string;
    };
}

// Helper function to convert BigInt values to strings
function convertBigIntToString(obj: any): any {
    if (typeof obj === 'bigint') {
        return obj.toString();
    }
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) {
            return obj.map(convertBigIntToString);
        }
        const result: any = {};
        for (const key in obj) {
            result[key] = convertBigIntToString(obj[key]);
        }
        return result;
    }
    return obj;
}

// Utility function to create token signature
async function createTokenSignature(
    signer: ethers.Signer,
    params: {
        creator: string;
    } & SlothCreationParams,
    relayerAddress: string
) {
    const provider = signer.provider;
    if (!provider) {
        throw new Error('Provider not initialized');
    }

    // Get chainId from network
    const { chainId } = await provider.getNetwork();
    console.log("Chain ID:", chainId);
    
    const domain = {
        name: "Sloth Factory",
        version: "1",
        chainId: chainId,
        verifyingContract: SLOTH_FACTORY_CONTRACT_ADDRESS
    };

    const CREATE_TYPE = [
        { name: "creator", type: "address" },
        { name: "name", type: "string" },
        { name: "symbol", type: "string" },
        { name: "tokenId", type: "uint256" },
        { name: "initialDeposit", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "relayer", type: "address" }
    ];

    const slothFactory = new ethers.Contract(
        SLOTH_FACTORY_CONTRACT_ADDRESS,
        SlothFactoryABI,
        provider
    );
    
    // Get nonce for the creator
    const nonce = await slothFactory.nonces(params.creator);
    console.log("Current nonce:", nonce.toString());
    console.log("Creator address:", params.creator);
    const deadline = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    const domainSeparator = await slothFactory.DOMAIN_SEPARATOR();
    console.log("Domain Separator:", domainSeparator);

    // Convert tokenId and initialDeposit to BigInt
    const tokenId = BigInt(params.tokenId);
    const initialDeposit = BigInt(params.initialDeposit || 0);

    const value = {
        creator: params.creator,
        name: params.name,
        symbol: params.symbol,
        tokenId,
        initialDeposit,
        nonce,
        deadline,
        relayer: relayerAddress
    };

    console.log('Signing data:', {
        domain,
        types: CREATE_TYPE,
        value: convertBigIntToString(value)
    });

    const signature = await signer.signTypedData(
        {
            name: "Sloth Factory",
            version: "1",
            chainId,
            verifyingContract: SLOTH_FACTORY_CONTRACT_ADDRESS
        },
        {
            Create: CREATE_TYPE
        },
        value
    );

    // Split signature
    const { v, r, s } = ethers.Signature.from(signature);
    console.log("Signature components:", { v, r, s });

    return {
        signature: { v, r, s },
        deadline,
        nonce,
        tokenId,
        initialDeposit
    };
}

async function createTokenWithPermitRelayer(
    signer: ethers.Signer,
    params: {
        name: string,
        symbol: string,
        tokenId: bigint | number,
        initialDeposit?: bigint | number
    }
) {
    try {
        // Get provider from signer
        const provider = signer.provider;
        if (!provider) {
            throw new Error("Signer must be connected to a provider");
        }

        // Get creator address
        const creatorAddress = await signer.getAddress();
        console.log("Creator address:", creatorAddress);

        // Create signature
        const { signature, deadline, nonce, tokenId, initialDeposit } = await createTokenSignature(
            signer,
            {
                creator: creatorAddress,
                name: params.name,
                symbol: params.symbol,
                tokenId: params.tokenId.toString(),
                initialDeposit: params.initialDeposit?.toString() || "0"
            },
            RELAYER_ADDRESS
        );

        // Convert ETH to WETH and approve
        const wethInterface = new ethers.Interface([
            'function deposit() payable',
            'function approve(address spender, uint256 amount) returns (bool)',
            'function balanceOf(address account) view returns (uint256)'
        ]);

        const wethContract = new ethers.Contract(NATIVE_TOKEN, wethInterface, signer);

        // First deposit ETH to get WETH
        // console.log("\nDepositing ETH to get WETH...");
        // const depositTx = await wethContract.deposit({
        //     value: BigInt(params.initialDeposit || '0')
        // });
        // await depositTx.wait();
        // console.log("ETH deposited to WETH ✅");

        // Check WETH balance
        const wethBalance = await wethContract.balanceOf(creatorAddress);
        console.log("WETH Balance:", ethers.formatEther(wethBalance));

        // Approve WETH spending
        console.log("\nApproving WETH...");
        const approveTx = await wethContract.approve(
            SLOTH_FACTORY_CONTRACT_ADDRESS,
            BigInt(params.initialDeposit || '0')
        );
        console.log("Approval transaction sent:", approveTx.hash);
        
        await approveTx.wait();
        console.log("WETH Approval confirmed ✅");

        // Prepare request body
        const requestBody: CreateTokenRequest = {
            type: 'create-token',
            creator: creatorAddress,
            params: {
                name: params.name,
                symbol: params.symbol,
                tokenId: tokenId.toString(),
                initialDeposit: initialDeposit.toString()
            },
            deadline: deadline.toString(),
            nonce: nonce.toString(),
            signature
        };

        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        // Send request to relayer
        const response = await fetch('http://localhost:4040/relay', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();
        
        if (!response.ok) {
            console.error('Relayer error response:', result);
            throw new Error(`Failed to create token: ${result.error}`);
        }

        console.log('Token creation successful!');
        console.log('Transaction hash:', result.txHash);
        console.log('Token address:', result.token);
        console.log('Sloth address:', result.sloth);
        console.log('Creator:', result.creator);
        console.log('Total supply:', result.totalSupply);
        console.log('Sale amount:', result.saleAmount);
        console.log('Token ID:', result.tokenId);

        return result;
    } catch (error) {
        console.error("Error creating token:", error);
        throw error;
    }
}

// Example usage
async function main() {
    try {
        // Set up provider
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_ANCIENT8);
        
        // Set up signer (token creator)
        const creatorPrivateKey = process.env.PRIVATE_KEY;
        if (!creatorPrivateKey) {
            throw new Error("PRIVATE_KEY not found in environment variables");
        }
        const signer = new ethers.Wallet(creatorPrivateKey, provider);
        console.log("Creator address:", await signer.getAddress());

        const tokenParams = {
            name: "Example Token",
            symbol: "EXT",
            tokenId: BigInt(Math.floor(Math.random() * 1000000)),
            initialDeposit: ethers.parseEther("1")
        };

        console.log("Creating token with parameters:", convertBigIntToString(tokenParams));
        const result = await createTokenWithPermitRelayer(signer, tokenParams);
        console.log("Token creation completed!");
    } catch (error) {
        console.error("Failed to create token:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Run the test
main().catch(console.error);
