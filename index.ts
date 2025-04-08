import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { slothFactoryContract, RELAYER_ADDRESS, wallet, NATIVE_TOKEN } from './src/config';
import type { Context } from 'hono';
import { ethers } from 'ethers';
import { SlothABI } from './src/abis/abis';

const app = new Hono();

app.use('/*', cors());

// Define interfaces
interface CreateTokenRequest {
    type: 'create-token';
    creator: string;
    params: {
        name: string;
        symbol: string;
        tokenId: string;
        initialDeposit: string;
    };
    deadline: string;
    nonce: string;
    signature: {
        v: number;
        r: string;
        s: string;
    };
}

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

type RelayRequest = CreateTokenRequest | BuyRequest | SellRequest;

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

app.post('/relay', async (c: Context) => {
    try {
        const request = await c.req.json<RelayRequest>();
        console.log('Received request:', JSON.stringify(request, null, 2));

        let tx;
        switch (request.type) {
            case 'create-token': {
                // Create params struct
                const paramsStruct = {
                    name: request.params.name,
                    symbol: request.params.symbol,
                    tokenId: BigInt(request.params.tokenId),
                    initialDeposit: BigInt(request.params.initialDeposit)
                };

                console.log("Verification params:", {
                    creator: request.creator,
                    params: {
                        name: request.params.name,
                        symbol: request.params.symbol,
                        tokenId: paramsStruct.tokenId.toString(),
                        initialDeposit: paramsStruct.initialDeposit.toString()
                    },
                    deadline: request.deadline,
                    nonce: request.nonce,
                    signature: request.signature,
                    relayer: RELAYER_ADDRESS
                });

                // Verify signature on-chain with struct format
                const isValid = await slothFactoryContract.verifyCreateSignatureWithRelayer(
                    request.creator,
                    paramsStruct,
                    request.deadline,
                    request.signature.v,
                    request.signature.r,
                    request.signature.s,
                    RELAYER_ADDRESS,
                    BigInt(request.nonce)
                );

                console.log("Signature verification result:", isValid);

                if (!isValid) {
                    throw new Error('Invalid signature');
                }

                console.log("Creating token...");
                tx = await slothFactoryContract.createWithPermitRelayer(
                    request.creator,
                    paramsStruct,
                    request.deadline,
                    request.signature.v,
                    request.signature.r,
                    request.signature.s,
                    BigInt(request.nonce),
                    { 
                        gasLimit: 5000000
                    }
                );

                console.log("Transaction sent:", tx.hash);

                const receipt = await tx.wait();
                console.log("Transaction mined:", receipt.blockNumber);
                console.log("Transaction logs:", receipt.logs);

                // Get token and sloth addresses from event
                const createEvent = receipt.logs.find(
                    (log: ethers.Log) => {
                        try {
                            return log.topics[0] === ethers.id("SlothCreated(address,address,address,uint256,uint256,uint256,uint256,uint256,bool,address)");
                        } catch (e) {
                            console.error("Error checking log topic:", e);
                            return false;
                        }
                    }
                );

                if (!createEvent) {
                    console.error("All transaction logs:", JSON.stringify(receipt.logs, null, 2));
                    throw new Error("SlothCreated event not found in transaction logs");
                }

                console.log("Found create event:", createEvent);

                let parsedEvent;
                try {
                    parsedEvent = slothFactoryContract.interface.parseLog({
                        topics: createEvent.topics,
                        data: createEvent.data
                    });
                } catch (e: unknown) {
                    console.error("Error parsing event:", e);
                    console.error("Event data:", {
                        topics: createEvent.topics,
                        data: createEvent.data
                    });
                    throw new Error(`Failed to parse SlothCreated event: ${e instanceof Error ? e.message : String(e)}`);
                }

                if (!parsedEvent) {
                    throw new Error("Failed to parse SlothCreated event - parsed event is null");
                }

                if (!parsedEvent.args || parsedEvent.args.length < 10) {
                    console.error("Invalid event args:", parsedEvent);
                    throw new Error("Invalid event arguments - expected at least 10 arguments");
                }

                const result = {
                    success: true,
                    txHash: tx.hash,
                    token: parsedEvent.args[0],
                    sloth: parsedEvent.args[1],
                    creator: parsedEvent.args[2],
                    totalSupply: parsedEvent.args[3].toString(),
                    saleAmount: parsedEvent.args[4].toString(),
                    tokenOffset: parsedEvent.args[5].toString(),
                    nativeOffset: parsedEvent.args[6].toString(),
                    tokenId: parsedEvent.args[7].toString(),
                    whitelistEnabled: parsedEvent.args[8],
                    factory: parsedEvent.args[9],
                    blockNumber: receipt.blockNumber
                };

                console.log("Token created successfully:", result);
                return c.json(result);
            }

            case 'buy': {
                const buyRequest = request as BuyRequest;
                console.log('Processing buy request:', buyRequest);

                const slothContract = new ethers.Contract(
                    buyRequest.slothContractAddress,
                    SlothABI,
                    wallet
                );

                console.log("relayer address:", wallet.address );

                // Log parameters in the exact order they should be hashed
                console.log('Verifying buy signature with parameters:', {
                    buyer: buyRequest.buyer,
                    recipient: buyRequest.recipient,
                    nativeAmount: BigInt(buyRequest.nativeAmount),
                    nonce: BigInt(buyRequest.nonce),
                    deadline: BigInt(buyRequest.deadline),
                    relayer: RELAYER_ADDRESS,
                    verifyingContract: buyRequest.slothContractAddress
                });

                // Verify signature with parameters in the exact order from the contract
                const signature = await slothContract.verifyBuySignatureWithRelayer(
                    buyRequest.buyer,
                    buyRequest.recipient,
                    BigInt(buyRequest.nativeAmount),
                    BigInt(buyRequest.nonce),
                    BigInt(buyRequest.deadline),
                    RELAYER_ADDRESS,
                    buyRequest.signature.v,
                    buyRequest.signature.r,
                    buyRequest.signature.s
                );
                console.log("isValidBuySignature:", signature);

                if (!signature) {
                    console.error('Invalid buy signature');
                    return c.json({ error: 'Invalid buy signature' }, 400);
                }

                console.log('Buy signature verified successfully');

                // Execute buy transaction with parameters in the same order
                const buyTx = await slothContract.buyWithPermitRelayer(
                    buyRequest.buyer,
                    buyRequest.recipient,
                    BigInt(buyRequest.nativeAmount),
                    BigInt(buyRequest.nonce),
                    BigInt(buyRequest.deadline),
                    RELAYER_ADDRESS,
                    buyRequest.signature.v,
                    buyRequest.signature.r,
                    buyRequest.signature.s,
                    { gasLimit: 5000000 }
                );

                console.log('Buy transaction sent:', buyTx.hash);
                const buyReceipt = await buyTx.wait();
                console.log('Buy transaction confirmed');

                return c.json({
                    success: true,
                    txHash: buyTx.hash
                });
            }

            case 'sell': {
                const sellRequest = request as SellRequest;
                console.log('Processing sell request:', sellRequest);

                const slothContract = new ethers.Contract(
                    sellRequest.slothContractAddress,
                    SlothABI,
                    wallet
                );

                // Log parameters in the exact order they should be hashed
                console.log('Verifying sell signature with parameters:', {
                    seller: sellRequest.seller,
                    recipient: sellRequest.recipient,
                    tokenAmount: BigInt(sellRequest.tokenAmount),
                    nonce: BigInt(sellRequest.nonce),
                    deadline: BigInt(sellRequest.deadline),
                    relayer: RELAYER_ADDRESS,
                    verifyingContract: sellRequest.slothContractAddress
                });

                // Verify signature with parameters in the exact order from the contract
                const signature = await slothContract.verifySellSignatureWithRelayer(
                    sellRequest.seller,
                    sellRequest.recipient,
                    BigInt(sellRequest.tokenAmount),
                    BigInt(sellRequest.nonce),
                    BigInt(sellRequest.deadline),
                    RELAYER_ADDRESS,
                    sellRequest.signature.v,
                    sellRequest.signature.r,
                    sellRequest.signature.s
                );
                console.log("isValidSellSignature:", signature);

                if (!signature) {
                    console.error('Invalid sell signature');
                    return c.json({ error: 'Invalid sell signature' }, 400);
                }

                console.log('Sell signature verified successfully');

                // Execute sell transaction with parameters in the same order
                const sellTx = await slothContract.sellWithPermitRelayer(
                    sellRequest.seller,
                    sellRequest.recipient,
                    BigInt(sellRequest.tokenAmount),
                    BigInt(sellRequest.nonce),
                    BigInt(sellRequest.deadline),
                    RELAYER_ADDRESS,
                    sellRequest.signature.v,
                    sellRequest.signature.r,
                    sellRequest.signature.s,
                    { gasLimit: 5000000 }
                );

                console.log('Sell transaction sent:', sellTx.hash);
                const sellReceipt = await sellTx.wait();
                console.log('Sell transaction confirmed');

                return c.json({
                    success: true,
                    txHash: sellTx.hash
                });
            }

            default:
                throw new Error('Invalid request type');
        }
    } catch (error) {
        console.error('Error processing request:', error);
        return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
});

const port = 4040;
console.log(`Server is running on port ${port}`);

export default {
    port,
    fetch: app.fetch,
};