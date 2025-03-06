import {
  useWriteContract,
  useChainId,
  usePublicClient,
  useWaitForTransactionReceipt,
  useAccount,
  useSignTypedData,
} from 'wagmi';
import { type Chain, formatUnits } from 'viem';
import {
  COMPACT_ABI,
  COMPACT_ADDRESS,
  isSupportedChain,
  type BasicTransfer,
} from '../constants/contracts';
import { useNotification } from './useNotification';
import {
  mainnet,
  optimism,
  optimismGoerli,
  sepolia,
  goerli,
  base,
  baseSepolia,
} from 'viem/chains';
import { useState } from 'react';
import { useAllocatorAPI } from './useAllocatorAPI';
import {
  signatureToCompactSignature,
  serializeCompactSignature,
  parseSignature,
} from 'viem';

const chains: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [optimism.id]: optimism,
  [optimismGoerli.id]: optimismGoerli,
  [sepolia.id]: sepolia,
  [goerli.id]: goerli,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
};

// EIP-712 domain for The Compact
const DOMAIN = {
  name: 'The Compact',
  version: '0',
  verifyingContract: COMPACT_ADDRESS,
} as const;

interface TokenInfo {
  decimals: number;
  symbol: string;
}

// Interface for the compact payload
interface CompactPayload {
  arbiter: `0x${string}`;
  sponsor: `0x${string}`;
  nonce: string;
  expires: string;
  id: string;
  amount: string;
}

// Interface for the server response
interface ServerSignatureResponse {
  hash: string;
  signature: string;
  nonce: string;
}

export function useAllocatedTransfer() {
  const chainId = useChainId();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { writeContractAsync } = useWriteContract({
    mutation: {
      onError: (error) => {
        if (
          error instanceof Error &&
          !error.message.toLowerCase().includes('user rejected')
        ) {
          showNotification({
            type: 'error',
            title: 'Transaction Failed',
            message: error.message,
            autoHide: true,
          });
        }
      },
    },
  });
  const { showNotification } = useNotification();
  const { allocatorAddress } = useAllocatorAPI();

  // For signing the compact
  const { signTypedDataAsync } = useSignTypedData();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
      onReplaced: (replacement) => {
        showNotification({
          type: 'info',
          title: 'Transaction Replaced',
          message: `Transaction was ${replacement.reason}. Waiting for new transaction...`,
          txHash: replacement.transaction.hash,
          chainId,
          autoHide: false,
        });
      },
    });

  const allocatedTransfer = async (
    transferParams: Omit<BasicTransfer, 'allocatorSignature' | 'nonce'> & {
      recipient: `0x${string}`;
    },
    tokenInfo?: TokenInfo
  ) => {
    if (!publicClient) throw new Error('Public client not available');
    if (!address) throw new Error('Wallet not connected');
    if (!allocatorAddress) throw new Error('Allocator address not available');

    if (!isSupportedChain(chainId)) {
      throw new Error('Unsupported chain');
    }

    const chain = chains[chainId];
    if (!chain) {
      throw new Error('Chain configuration not found');
    }

    // Generate a temporary transaction ID for linking notifications
    const tempTxId = `pending-${Date.now()}`;

    // Format the amount using the token's decimals and symbol if provided, otherwise use a generic format
    const displayAmount = tokenInfo
      ? `${formatUnits(transferParams.amount, tokenInfo.decimals)} ${tokenInfo.symbol}`
      : `${formatUnits(transferParams.amount, 18)} ETH`; // Default to ETH format

    try {
      // Step 1: Request nonce from the server
      const nonceResponse = await fetch(
        `/suggested-nonce/${chainId}/${address}`
      );
      if (!nonceResponse.ok) {
        throw new Error('Failed to get nonce from server');
      }
      const { nonce } = await nonceResponse.json();

      // Step 2: Build the compact payload
      const compact: CompactPayload = {
        arbiter: allocatorAddress as `0x${string}`,
        sponsor: address,
        nonce,
        expires: transferParams.expires.toString(),
        id: transferParams.id.toString(),
        amount: transferParams.amount.toString(),
      };

      // Step 3: Get user signature
      showNotification({
        type: 'info',
        title: 'Signature Required',
        message: 'Please sign the message in your wallet...',
        stage: 'pre-initiation',
        txHash: tempTxId,
        chainId,
        autoHide: false,
      });

      // Create the EIP-712 payload
      const domain = {
        name: DOMAIN.name,
        version: DOMAIN.version,
        chainId: BigInt(chainId),
        verifyingContract: DOMAIN.verifyingContract as `0x${string}`,
      };

      // Define the types for EIP-712 signing
      const types = {
        Compact: [
          { name: 'arbiter', type: 'address' },
          { name: 'sponsor', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'expires', type: 'uint256' },
          { name: 'id', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      };

      // Prepare the message for signing
      const message = {
        arbiter: compact.arbiter,
        sponsor: compact.sponsor,
        nonce: BigInt(compact.nonce),
        expires: BigInt(compact.expires),
        id: BigInt(compact.id),
        amount: BigInt(compact.amount),
      };

      // Sign the message
      let userSignature;
      try {
        userSignature = await signTypedDataAsync({
          domain,
          message,
          primaryType: 'Compact',
          types,
        });
      } catch (error) {
        // Handle signature rejection
        if (
          error instanceof Error &&
          error.message.toLowerCase().includes('user rejected')
        ) {
          showNotification({
            type: 'error',
            title: 'Signature Rejected',
            message: 'You rejected the signature request',
            txHash: tempTxId,
            chainId,
            autoHide: true,
          });
        }
        throw error;
      }

      // Convert to compact signature if needed
      let compactUserSignature = userSignature;
      if (userSignature.length === 132) {
        const parsedSig = parseSignature(userSignature);
        const compactSig = signatureToCompactSignature(parsedSig);
        compactUserSignature = serializeCompactSignature(compactSig);
      }

      // Step 4: Submit the payload to the server to get the server signature
      const serverResponse = await fetch('/compact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chainId: chainId.toString(),
          compact: {
            arbiter: compact.arbiter,
            sponsor: compact.sponsor,
            nonce: compact.nonce,
            expires: compact.expires,
            id: compact.id,
            amount: compact.amount,
          },
          sponsorSignature: compactUserSignature,
        }),
      });

      if (!serverResponse.ok) {
        const errorData = await serverResponse
          .json()
          .catch(() => ({ error: 'Unknown error' }));
        throw new Error(
          errorData.error || `Server error: ${serverResponse.statusText}`
        );
      }

      const serverData: ServerSignatureResponse = await serverResponse.json();

      // Step 5: Submit the transaction with the server signature
      showNotification({
        type: 'info',
        title: 'Initiating Transfer',
        message: `Waiting for transaction submission of ${displayAmount}...`,
        stage: 'initiated',
        txHash: tempTxId,
        chainId,
        autoHide: false,
      });

      // Create the transfer payload with the server signature
      const transferPayload: BasicTransfer = {
        allocatorSignature: serverData.signature as `0x${string}`,
        nonce: BigInt(serverData.nonce),
        expires: transferParams.expires,
        id: transferParams.id,
        amount: transferParams.amount,
        recipient: transferParams.recipient,
      };

      const newHash = await writeContractAsync({
        address: COMPACT_ADDRESS as `0x${string}`,
        abi: [COMPACT_ABI.find((x) => x.name === 'allocatedTransfer')] as const,
        functionName: 'allocatedTransfer',
        args: [transferPayload],
      });

      showNotification({
        type: 'success',
        title: 'Transaction Submitted',
        message: 'Waiting for confirmation...',
        stage: 'submitted',
        txHash: newHash,
        chainId,
        autoHide: true,
      });

      setHash(newHash);

      // Start watching for confirmation but don't wait for it
      void publicClient
        .waitForTransactionReceipt({
          hash: newHash,
        })
        .then((receipt) => {
          if (receipt.status === 'success') {
            showNotification({
              type: 'success',
              title: 'Transfer Confirmed',
              message: `Successfully transferred ${displayAmount}`,
              stage: 'confirmed',
              txHash: newHash,
              chainId,
              autoHide: false,
            });
          }
        });

      // Return the hash immediately after submission
      return newHash;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('user rejected')
      ) {
        showNotification({
          type: 'error',
          title: 'Transaction Rejected',
          message: 'You rejected the transaction',
          txHash: tempTxId,
          chainId,
          autoHide: true,
        });
      }
      throw error;
    }
  };

  return {
    allocatedTransfer,
    isConfirming,
    isConfirmed,
  };
}
