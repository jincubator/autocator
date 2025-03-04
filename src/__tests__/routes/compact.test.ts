import { FastifyInstance } from 'fastify';
import {
  createTestServer,
  validPayload,
  getFreshCompact,
  cleanupTestServer,
  compactToAPI,
  generateSignature,
} from '../utils/test-server';
import {
  graphqlClient,
  AccountDeltasResponse,
  AccountResponse,
  fetchAndCacheSupportedChains,
} from '../../graphql';
import { RequestDocument, Variables, RequestOptions } from 'graphql-request';
import { hexToBytes, getAddress } from 'viem/utils';
import { signMessage } from 'viem/accounts';

// Test private key (do not use in production)
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('Compact Routes', () => {
  let server: FastifyInstance;
  let originalRequest: typeof graphqlClient.request;

  beforeEach(async () => {
    server = await createTestServer();

    // Store original function
    originalRequest = graphqlClient.request;

    // Initialize chain config cache
    await fetchAndCacheSupportedChains(process.env.ALLOCATOR_ADDRESS!);

    // Mock GraphQL response
    graphqlClient.request = async <
      V extends Variables = Variables,
      T = AccountDeltasResponse & AccountResponse,
    >(
      _documentOrOptions: RequestDocument | RequestOptions<V, T>,
      ..._variablesAndRequestHeaders: unknown[]
    ): Promise<AccountDeltasResponse & AccountResponse> => ({
      accountDeltas: {
        items: [],
      },
      account: {
        resourceLocks: {
          items: [
            {
              withdrawalStatus: 0,
              balance: '1000000000000000000000',
            },
          ],
        },
        claims: {
          items: [],
        },
      },
    });
  });

  afterEach(async () => {
    await cleanupTestServer();
    // Restore original function
    graphqlClient.request = originalRequest;
  });

  // Helper to generate sponsor signature for a compact
  async function generateSponsorSignature(compact: any, chainId: string): Promise<string> {
    // Create a message that includes the compact details
    const message = `I am signing this compact with:
Arbiter: ${compact.arbiter}
Sponsor: ${compact.sponsor}
ID: ${compact.id}
Amount: ${compact.amount}
Expires: ${compact.expires}
Chain ID: ${chainId}`;
    
    return await generateSignature(message);
  }

  describe('GET /suggested-nonce/:chainId', () => {
    it('should return a valid nonce for a sponsor', async () => {
      const sponsorAddress = validPayload.address;
      const response = await server.inject({
        method: 'GET',
        url: `/suggested-nonce/1?sponsor=${sponsorAddress}`,
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('nonce');
      expect(result.nonce).toMatch(/^0x[0-9a-f]{64}$/i);

      // Verify nonce format: first 20 bytes should match sponsor address
      const nonceHex = BigInt(result.nonce).toString(16).padStart(64, '0');
      const sponsorHex = sponsorAddress.toLowerCase().slice(2);
      expect(nonceHex.slice(0, 40)).toBe(sponsorHex);
    });

    it('should reject request without sponsor', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/suggested-nonce/1',
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Sponsor address is required');
    });
  });

  describe('POST /compact', () => {
    it('should submit valid compact with sponsor signature', async () => {
      const freshCompact = getFreshCompact();
      const compactData = compactToAPI(freshCompact);
      const sponsorSignature = await generateSponsorSignature(compactData, '1');
      
      const compactPayload = {
        chainId: '1',
        compact: compactData,
        sponsorSignature,
      };

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: compactPayload,
      });

      if (response.statusCode !== 200) {
        console.error('Error submitting compact:', response.payload);
      }

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('nonce');
      expect(result.nonce).toBe(
        '0x' + freshCompact.nonce.toString(16).padStart(64, '0')
      );
    });

    it('should reject request without sponsor signature', async () => {
      const freshCompact = getFreshCompact();
      const compactPayload = {
        chainId: '1',
        compact: compactToAPI(freshCompact),
      };

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: compactPayload,
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Sponsor signature is required');
    });

    // New test for base 10 numeric string id
    it('should submit valid compact with base 10 numeric string id', async () => {
      const freshCompact = getFreshCompact();
      const compactData = {
        ...compactToAPI(freshCompact),
        id: freshCompact.id.toString(10), // Convert id to base 10 string
      };
      
      const sponsorSignature = await generateSponsorSignature(compactData, '1');

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: { 
          chainId: '1', 
          compact: compactData,
          sponsorSignature,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('nonce');
    });

    // New test for hex inputs
    it('should submit valid compact with hex inputs', async () => {
      const freshCompact = getFreshCompact();
      const hexCompact = {
        ...compactToAPI(freshCompact),
        id: '0x' + freshCompact.id.toString(16),
        expires: '0x' + freshCompact.expires.toString(16),
        amount: '0x' + BigInt(freshCompact.amount).toString(16),
        nonce: '0x' + freshCompact.nonce.toString(16),
      };
      
      const sponsorSignature = await generateSponsorSignature(hexCompact, '1');

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: { 
          chainId: '1', 
          compact: hexCompact,
          sponsorSignature,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('nonce');
    });

    // New test for mixed decimal and hex inputs
    it('should submit valid compact with mixed decimal and hex inputs', async () => {
      const freshCompact = getFreshCompact();
      const mixedCompact = {
        ...compactToAPI(freshCompact),
        id: '0x' + freshCompact.id.toString(16),
        expires: freshCompact.expires.toString(),
        amount: '0x' + BigInt(freshCompact.amount).toString(16),
        nonce: freshCompact.nonce.toString(),
      };
      
      const sponsorSignature = await generateSponsorSignature(mixedCompact, '1');

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: { 
          chainId: '1', 
          compact: mixedCompact,
          sponsorSignature,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('nonce');
    });

    // New test for invalid hex format
    it('should reject invalid hex format', async () => {
      const freshCompact = getFreshCompact();
      const invalidHexCompact = {
        ...compactToAPI(freshCompact),
        id: '0xInvalidHex',
      };
      
      const sponsorSignature = await generateSponsorSignature(
        { ...invalidHexCompact, id: '0x123' }, // Use valid ID for signature
        '1'
      );

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: { 
          chainId: '1', 
          compact: invalidHexCompact,
          sponsorSignature,
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.error).toContain('Failed to convert id');
    });

    it('should handle null nonce by generating one', async () => {
      const freshCompact = getFreshCompact();
      const compactData = {
        ...compactToAPI(freshCompact),
        nonce: null,
      };
      
      const sponsorSignature = await generateSponsorSignature(compactData, '1');
      
      const compactPayload = {
        chainId: '1',
        compact: compactData,
        sponsorSignature,
      };

      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: compactPayload,
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('nonce');
      // Verify nonce format: first 20 bytes should match sponsor address
      const nonceHex = BigInt(result.nonce).toString(16).padStart(64, '0');
      const sponsorHex = freshCompact.sponsor.toLowerCase().slice(2);
      expect(nonceHex.slice(0, 40)).toBe(sponsorHex);
    });

    it('should store nonce after successful submission', async (): Promise<void> => {
      const freshCompact = getFreshCompact();
      const chainId = '1';
      const compactData = compactToAPI(freshCompact);
      const sponsorSignature = await generateSponsorSignature(compactData, chainId);

      // Submit compact
      const response = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: { 
          chainId, 
          compact: compactData,
          sponsorSignature,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);

      // Extract nonce components
      const nonceHex = BigInt(result.nonce).toString(16).padStart(64, '0');
      const fragmentPart = nonceHex.slice(40); // last 12 bytes (24 hex chars)
      const fragmentBigInt = BigInt('0x' + fragmentPart);
      const nonceLow = Number(fragmentBigInt & BigInt(0xffffffff));
      const nonceHigh = Number(fragmentBigInt >> BigInt(32));

      // Verify nonce was stored with correct high and low values
      const dbResult = await server.db.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM nonces WHERE chain_id = $1 AND sponsor = $2 AND nonce_high = $3 AND nonce_low = $4',
        [
          chainId,
          hexToBytes(freshCompact.sponsor as `0x${string}`),
          nonceHigh,
          nonceLow,
        ]
      );
      expect(dbResult.rows[0].count).toBe(1);
    });
  });

  describe('GET /compacts', () => {
    it('should return compacts for a specific sponsor', async () => {
      // First submit a compact to ensure there's data
      const freshCompact = getFreshCompact();
      const compactData = compactToAPI(freshCompact);
      const sponsorSignature = await generateSponsorSignature(compactData, '1');
      
      await server.inject({
        method: 'POST',
        url: '/compact',
        payload: {
          chainId: '1',
          compact: compactData,
          sponsorSignature,
        },
      });

      // Now get compacts for this sponsor
      const response = await server.inject({
        method: 'GET',
        url: `/compacts?sponsor=${freshCompact.sponsor}`,
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should reject request without sponsor', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/compacts',
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Sponsor address is required');
    });
  });

  describe('GET /compact/:chainId/:claimHash', () => {
    it('should return specific compact', async () => {
      const freshCompact = getFreshCompact();
      const compactData = compactToAPI(freshCompact);
      const sponsorSignature = await generateSponsorSignature(compactData, '1');
      
      // First submit a compact
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: {
          chainId: '1',
          compact: compactData,
          sponsorSignature,
        },
      });

      const submitResult = JSON.parse(submitResponse.payload);
      if (submitResponse.statusCode !== 200 || !submitResult?.hash) {
        console.error('Failed to submit compact:', submitResponse.payload);
        throw new Error('Failed to submit compact');
      }

      const { hash } = submitResult;

      const response = await server.inject({
        method: 'GET',
        url: `/compact/1/${hash}`,
      });

      if (response.statusCode === 500) {
        console.error('Got 500 error:', {
          payload: response.payload,
          hash,
        });
      }

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('chainId', '1');
      expect(result).toHaveProperty('hash', hash);
      expect(result).toHaveProperty('compact');
      expect(result.compact).toHaveProperty('nonce');
    });

    it('should return error for non-existent compact', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/compact/1/0x0000000000000000000000000000000000000000000000000000000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
