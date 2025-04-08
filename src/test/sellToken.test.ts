import { ethers } from 'ethers';
import { SlothABI, SlothTokenABI } from '../abis/abis';
import { RELAYER_ADDRESS } from '../config';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Define interfaces
interface SellRequest {
    type: 'sell';
    slothContractAddress: string;
    seller: string;
    recipient: string;
    tokenAmount: string;
    nonce: string;
    deadline: string;
    signature: {
        v: number;
        r: string;
        s: string;
    };
}

// Define signatures for token functions
const SIGNATURES = {
    allowance: '0xdd62ed3e',  // allowance(address,address)
    approve: '0x095ea7b3',    // approve(address,uint256)
};

// Encode function call with parameters
function encodeFunction(signature: string, ...params: bigint[]) {
    const abiCoder = new ethers.AbiCoder();
    const encodedParams = params.length > 0 ? abiCoder.encode(params.map(() => 'uint256'), params).slice(2) : '';
    return signature + encodedParams;
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

// RPC helper functions
async function makeRpcCall(method: string, params: any[]) {
    try {
        const response = await axios.post(process.env.RPC_URL_ANCIENT8 || '', {
            jsonrpc: "2.0",
            id: Math.floor(Math.random() * 1000),
            method,
            params
        });

        if (!response.data || response.data.error) {
            console.error("RPC Error:", response.data?.error || "No response data");
            throw new Error("RPC call failed");
        }

        return response.data.result;
    } catch (error) {
        console.error("RPC call failed:", error instanceof Error ? error.message : String(error));
        throw error;
    }
}

// Utility function to create sell signature
async function createSellSignature(
    signer: ethers.Signer,
    slothAddress: string,
    params: {
        seller: string;
        recipient: string;
        tokenAmount: bigint;
    }
) {
    const provider = signer.provider;
    if (!provider) {
        throw new Error('Provider not initialized');
    }

    // Get chainId from network
    const { chainId } = await provider.getNetwork();
    console.log("Chain ID:", chainId);
    
    const slothContract = new ethers.Contract(slothAddress, SlothABI, provider);
    
    // Get nonce for the seller
    const nonce = await slothContract.nonces(params.seller);
    console.log("Current nonce:", nonce.toString());
    console.log("Seller address:", params.seller);
    
    const deadline = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    const sellTypeHash = await slothContract.SELL_TYPEHASH();
    console.log("Sell Type Hash:", sellTypeHash);

    const domain = {
        name: "Sloth Factory",
        version: "1",
        chainId: chainId,
        verifyingContract: slothAddress
    };

    // Match the exact order in the contract's SELL_TYPEHASH
    const SELL_TYPE = [
        { name: "seller", type: "address" },
        { name: "recipient", type: "address" },
        { name: "tokenAmount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "relayer", type: "address" }
    ];

    // Match the exact order in the contract's structHash
    const value = {
        seller: params.seller,
        recipient: params.recipient,
        tokenAmount: params.tokenAmount,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
        relayer: RELAYER_ADDRESS
    };

    console.log('Signing data:', {
        domain,
        types: { Sell: SELL_TYPE },
        value: convertBigIntToString(value)
    });

    // Log the exact data being signed for verification
    console.log('Signing with parameters:', {
        seller: params.seller,
        recipient: params.recipient,
        tokenAmount: params.tokenAmount.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        relayer: RELAYER_ADDRESS,
        verifyingContract: slothAddress
    });

    const signature = await signer.signTypedData(
        domain,
        { Sell: SELL_TYPE },
        value
    );

    // Split signature
    const { v, r, s } = ethers.Signature.from(signature);
    console.log("Signature components:", { v, r, s });

    return {
        signature: { v, r, s },
        deadline,
        nonce
    };
}

async function sellTokenWithPermitRelayer(
    signer: ethers.Signer,
    slothAddress: string,
    params: {
        recipient: string;
        tokenAmount: bigint;
    }
) {
    try {
        // Get provider from signer
        const provider = signer.provider;
        if (!provider) {
            throw new Error("Signer must be connected to a provider");
        }

        // Get seller address
        const sellerAddress = await signer.getAddress();
        console.log("Seller address:", sellerAddress);

        // Get token address from Sloth contract
        const slothContract = new ethers.Contract(slothAddress, SlothABI, provider);
        const tokenAddress = await slothContract.token();
        console.log("Token address:", tokenAddress);

        // Check token balance
        const tokenContract = new ethers.Contract(tokenAddress, SlothTokenABI, provider);
        const balance = await tokenContract.balanceOf(sellerAddress);
        console.log("Current token balance:", balance.toString());

        if (balance < params.tokenAmount) {
            throw new Error("Insufficient token balance");
        }

        // Check allowance and approve if needed
        const allowance = await tokenContract.allowance(sellerAddress, slothAddress);
        console.log("Current allowance:", allowance.toString());

        if (allowance < params.tokenAmount) {
            console.log("\nApproving token transfer...");
            const approveData = encodeFunction(
                SIGNATURES.approve,
                BigInt(slothAddress),
                BigInt(params.tokenAmount)
            );
            
            const approveTx = await signer.sendTransaction({
                to: tokenAddress,
                data: approveData
            });
            console.log("Approval transaction sent:", approveTx.hash);
            
            await approveTx.wait();
            console.log("Approval confirmed ✅");
        }

        // Create signature
        const { signature, deadline, nonce } = await createSellSignature(
            signer,
            slothAddress,
            {
                seller: sellerAddress,
                recipient: params.recipient,
                tokenAmount: params.tokenAmount
            }
        );

        // Prepare request body
        const requestBody: SellRequest = {
            type: 'sell',
            slothContractAddress: slothAddress,
            seller: sellerAddress,
            recipient: params.recipient,
            tokenAmount: params.tokenAmount.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
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
            throw new Error(`Failed to sell token: ${result.error}`);
        }

        console.log('Sell transaction successful!');
        console.log('Transaction hash:', result.txHash);

        return result;
    } catch (error) {
        console.error("Error selling token:", error);
        throw error;
    }
}

// Example usage
async function main() {
    try {
        // Set up provider
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_ANCIENT8);
        
        // Set up signer (seller)
        const sellerPrivateKey = process.env.PRIVATE_KEY;
        if (!sellerPrivateKey) {
            throw new Error("PRIVATE_KEY not found in environment variables");
        }
        const signer = new ethers.Wallet(sellerPrivateKey, provider);
        console.log("Seller address:", await signer.getAddress());

        const sellParams = {
            recipient: await signer.getAddress(), // Receiving native tokens to self
            tokenAmount: ethers.parseEther("1") // Selling 1 token
        };

        const SLOTH_ADDRESS = "0x77D450C60c4746B16513b2aFb334Be77786ed27a"; // Example Sloth contract address

        console.log("Selling token with parameters:", convertBigIntToString(sellParams));
        const result = await sellTokenWithPermitRelayer(signer, SLOTH_ADDRESS, sellParams);
        console.log("Sell transaction completed!");
    } catch (error) {
        console.error("Failed to sell token:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Run the test
main().catch(console.error); 