import type { FastifyInstance } from 'fastify';
import { getCachedSupportedChains } from '../graphql';

interface HealthResponse {
  status: string;
  allocatorAddress: string;
  signingAddress: string;
  timestamp: string;
  supportedChains: Array<{
    chainId: string;
    allocatorId: string;
    finalizationThresholdSeconds: number;
  }>;
}

export async function setupHealthRoutes(
  server: FastifyInstance
): Promise<void> {
  // Health check endpoint
  server.get('/health', async (_request): Promise<HealthResponse> => {
    // In test environment, use default values if environment variables are not set
    const allocatorAddress = process.env.ALLOCATOR_ADDRESS || '0x2345678901234567890123456789012345678901';
    const signingAddress = process.env.SIGNING_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    
    // In production, we still want to throw an error if environment variables are not set
    if (process.env.NODE_ENV !== 'test' && (!process.env.ALLOCATOR_ADDRESS || !process.env.SIGNING_ADDRESS)) {
      throw new Error('Required environment variables are not set');
    }

    const supportedChains = getCachedSupportedChains();
    if (!supportedChains) {
      throw new Error('Supported chains data not initialized');
    }

    const response = {
      status: 'healthy',
      allocatorAddress,
      signingAddress,
      timestamp: new Date().toISOString(),
      supportedChains,
    };

    return response;
  });
}
