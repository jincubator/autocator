import { FastifyInstance } from 'fastify';
import {
  createTestServer,
  validPayload,
  getFreshCompact,
  cleanupTestServer,
  generateSignature,
  compactToAPI,
} from '../utils/test-server';
import {
  graphqlClient,
  AccountDeltasResponse,
  AccountResponse,
  fetchAndCacheSupportedChains,
} from '../../graphql';
import { signMessage } from 'viem/accounts';

describe('Integration Tests', () => {
  let server: FastifyInstance;
  let originalRequest: typeof graphqlClient.request;
  const sponsorAddress = validPayload.address;

  beforeEach(async () => {
    server = await createTestServer();
    originalRequest = graphqlClient.request;

    // Initialize chain config cache
    await fetchAndCacheSupportedChains(process.env.ALLOCATOR_ADDRESS!);
  });

  afterEach(async () => {
    await cleanupTestServer();
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

  describe('Allocation Flow', () => {
    it('should handle complete allocation flow: compact -> balance -> nonce', async () => {
      // Mock GraphQL response with zero allocated balance
      graphqlClient.request = async (): Promise<
        AccountDeltasResponse & AccountResponse
      > => ({
        accountDeltas: {
          items: [],
        },
        account: {
          resourceLocks: {
            items: [
              {
                withdrawalStatus: 0,
                balance: '1000000000000000000000', // 1000 ETH total
              },
            ],
          },
          claims: {
            items: [],
          },
        },
      });

      // 1. Get initial balance
      const freshCompact = getFreshCompact();
      const initialBalanceResponse = await server.inject({
        method: 'GET',
        url: `/balance/1/${freshCompact.id}?sponsor=${sponsorAddress}`,
      });
      expect(initialBalanceResponse.statusCode).toBe(200);
      const initialBalance = JSON.parse(initialBalanceResponse.payload);
      expect(initialBalance.allocatedBalance).toBe('0');

      // 2. Get initial suggested nonce
      const initialNonceResponse = await server.inject({
        method: 'GET',
        url: `/suggested-nonce/1?sponsor=${sponsorAddress}`,
      });
      expect(initialNonceResponse.statusCode).toBe(200);
      const { nonce: initialNonce } = JSON.parse(initialNonceResponse.payload);

      // 3. Submit compact
      const compactData = compactToAPI(freshCompact);
      const sponsorSignature = await generateSponsorSignature(compactData, '1');
      
      const compactPayload = {
        chainId: '1',
        compact: compactData,
        sponsorSignature,
      };

      const submitResponse = await server.inject({
        method: 'POST',
        url: '/compact',
        payload: compactPayload,
      });
      expect(submitResponse.statusCode).toBe(200);
      const submitResult = JSON.parse(submitResponse.payload);
      expect(submitResult).toHaveProperty('hash');

      // Query compacts table
      await server.db.query(`
        SELECT 
          id::text,
          chain_id,
          encode(claim_hash, 'hex') as claim_hash,
          encode(arbiter, 'hex') as arbiter,
          encode(sponsor, 'hex') as sponsor,
          encode(nonce, 'hex') as nonce,
          expires,
          encode(lock_id, 'hex') as lock_id,
          encode(amount, 'hex') as amount,
          witness_type_string,
          encode(witness_hash, 'hex') as witness_hash,
          encode(signature, 'hex') as signature,
          created_at
        FROM compacts
      `);

      // 4. Verify updated balance
      const updatedBalanceResponse = await server.inject({
        method: 'GET',
        url: `/balance/1/${freshCompact.id}?sponsor=${sponsorAddress}`,
      });
      expect(updatedBalanceResponse.statusCode).toBe(200);
      const updatedBalance = JSON.parse(updatedBalanceResponse.payload);
      expect(updatedBalance.allocatedBalance).toBe(
        freshCompact.amount.toString()
      );

      // 5. Verify next suggested nonce is incremented
      const nextNonceResponse = await server.inject({
        method: 'GET',
        url: `/suggested-nonce/1?sponsor=${sponsorAddress}`,
      });
      expect(nextNonceResponse.statusCode).toBe(200);
      const { nonce: nextNonce } = JSON.parse(nextNonceResponse.payload);
      expect(nextNonce).not.toBe(initialNonce);

      // Convert hex strings to BigInts for comparison
      const initialNonceBigInt = BigInt(initialNonce);
      const nextNonceBigInt = BigInt(nextNonce);
      expect(nextNonceBigInt).toBeGreaterThan(initialNonceBigInt);
    });
  });
});
