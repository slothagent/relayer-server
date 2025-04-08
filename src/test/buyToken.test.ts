import { ethers } from 'ethers';
import { SlothABI } from '../abis/abis';
import { RELAYER_ADDRESS, NATIVE_TOKEN } from '../config';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Define signatures for token functions
const SIGNATURES = {
    allowance: '0xdd62ed3e',  // allowance(address,address)
    approve: '0x095ea7b3',    // approve(address,uint256)
};

// Define interfaces
interface BuyRequest {
    type: 'buy';
    slothContractAddress: string;
    buyer: string;
    recipient: string;
    nativeAmount: string;
    nonce: string;
    deadline: string;
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

async function ethCall(to: string, data: string) {
    try {
        const result = await makeRpcCall("eth_call", [{
            to,
            data
        }, "latest"]);

        if (!result || !result.startsWith('0x')) {
            console.error("Invalid eth_call result:", result);
            throw new Error("Invalid eth_call result");
        }

        return result;
    } catch (error) {
        console.error("eth_call failed for contract:", to);
        console.error("with data:", data);
        throw error;
    }
}

// Encode function call with parameters
function encodeFunction(signature: string, ...params: bigint[]) {
    const abiCoder = new ethers.AbiCoder();
    const encodedParams = params.length > 0 ? abiCoder.encode(params.map(() => 'uint256'), params).slice(2) : '';
    return signature + encodedParams;
}

// Utility function to create buy signature
async function createBuySignature(
    signer: ethers.Signer,
    slothAddress: string,
    params: {
        buyer: string;
        recipient: string;
        nativeAmount: bigint;
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
    
    // Get nonce for the buyer
    const nonce = await slothContract.nonces(params.buyer);
    console.log("Current nonce:", nonce.toString());
    console.log("Creator address:", params.buyer);
    const deadline = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    const buyTypeHash = await slothContract.BUY_TYPEHASH();
    console.log("Buy Type Hash:", buyTypeHash);

    const domain = {
        name: "Sloth Factory",
        version: "1",
        chainId: chainId,
        verifyingContract: slothAddress
    };

    // Match the exact order in the contract's structHash
    const BUY_TYPE = [
        { name: "buyer", type: "address" },
        { name: "recipient", type: "address" },
        { name: "nativeAmount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "relayer", type: "address" }
    ];

    // Match the exact order in the contract's structHash
    const value = {
        buyer: params.buyer,
        recipient: params.recipient,
        nativeAmount: BigInt(params.nativeAmount),
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
        relayer: RELAYER_ADDRESS
    };

    console.log('Signing data:', {
        domain,
        types: { Buy: BUY_TYPE },
        value: value
    });

    // Log the exact data being signed for verification
    console.log('Signing with parameters:', {
        buyer: params.buyer,
        recipient: params.recipient,
        nativeAmount: params.nativeAmount.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        relayer: RELAYER_ADDRESS,
        verifyingContract: slothAddress
    });

    const signature = await signer.signTypedData(
        domain,
        { Buy: BUY_TYPE },
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



// Modify buyTokenWithPermitRelayer to use client-side verification
async function buyTokenWithPermitRelayer(
    signer: ethers.Signer,
    slothAddress: string,
    params: {
        recipient: string;
        nativeAmount: bigint;
    }
) {
    try {
        // Get provider from signer
        const provider = signer.provider;
        if (!provider) {
            throw new Error("Signer must be connected to a provider");
        }

        // Get buyer address
        const buyerAddress = await signer.getAddress();
        console.log("Buyer address:", buyerAddress);

        // Get chainId
        const { chainId } = await provider.getNetwork();

        // Create signature
        const { signature, deadline, nonce } = await createBuySignature(
            signer,
            slothAddress,
            {
                buyer: buyerAddress,
                recipient: params.recipient,
                nativeAmount: params.nativeAmount
            }
        );

        // Check allowance using RPC
        const allowanceData = encodeFunction(
            SIGNATURES.allowance,
            BigInt(buyerAddress),
            BigInt(NATIVE_TOKEN)
        );
        const allowanceHex = await ethCall(NATIVE_TOKEN, allowanceData);
        const allowance = BigInt(allowanceHex);
        console.log("Current allowance:", ethers.formatEther(allowance));

        if (allowance < params.nativeAmount) {
            console.log("\nApproving native token...");
            const approveData = encodeFunction(
                SIGNATURES.approve,
                BigInt(slothAddress),
                params.nativeAmount
            );
            
            const approveTx = await signer.sendTransaction({
                to: NATIVE_TOKEN,
                data: approveData
            });
            console.log("Approval transaction sent:", approveTx.hash);
            
            await approveTx.wait();
            console.log("Approval confirmed ✅");
        }

        // Prepare request body
        const requestBody: BuyRequest = {
            type: 'buy',
            slothContractAddress: slothAddress,
            buyer: buyerAddress,
            recipient: params.recipient,
            nativeAmount: params.nativeAmount.toString(),
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
            throw new Error(`Failed to buy token: ${result.error}`);
        }

        console.log('Buy transaction successful!');
        console.log('Transaction hash:', result.txHash);

        return result;
    } catch (error) {
        console.error("Error buying token:", error);
        throw error;
    }
}

// Example usage
async function main() {
    try {
        // Set up provider
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_ANCIENT8);
        
        // Set up signer (buyer)
        const buyerPrivateKey = process.env.PRIVATE_KEY  ;
        if (!buyerPrivateKey) {
            throw new Error("PRIVATE_KEY not found in environment variables");
        }
        const signer = new ethers.Wallet(buyerPrivateKey, provider);
        console.log("Buyer address:", await signer.getAddress());

        const buyParams = {
            recipient: await signer.getAddress(), // Buying for self
            nativeAmount: ethers.parseEther("1") // Buying with 1 native token
        };

        const SLOTH_ADDRESS = "0x77D450C60c4746B16513b2aFb334Be77786ed27a"; // Example Sloth contract address

        console.log("Buying token with parameters:", convertBigIntToString(buyParams));
        const result = await buyTokenWithPermitRelayer(signer, SLOTH_ADDRESS, buyParams);
        console.log("Buy transaction completed!");
    } catch (error) {
        console.error("Failed to buy token:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Run the test
main().catch(console.error); 