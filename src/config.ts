import { ethers } from 'ethers';
import { SlothABI, SlothFactoryABI } from './abis/abis';

export const SLOTH_FACTORY_CONTRACT_ADDRESS = '0xe520B9F320Ed91Cf590CF9884d2b051f2ece4C4E'; // Replace with actual contract address
export const NATIVE_TOKEN = "0xfC57492d6569f6F45Ea1b8850e842Bf5F9656EA6";
// Initialize provider and contract
export const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_ANCIENT8);
export const wallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY || '', provider);

// Get relayer address from wallet
export const RELAYER_ADDRESS = wallet.address;

export const slothFactoryContract = new ethers.Contract(
  SLOTH_FACTORY_CONTRACT_ADDRESS,
  SlothFactoryABI,
  wallet
);
