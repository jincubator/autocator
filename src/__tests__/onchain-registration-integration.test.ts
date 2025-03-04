import { FastifyInstance } from 'fastify';
import { createTestServer, getFreshCompact, compactToAPI, generateValidCompactSignature, cleanupTestServer } from './utils/test-server';
import { submitCompact } from '../compact';
import { OnchainRegistrationStatus, RegisteredCompactResponse } from '../validation';
import { GraphQLClient } from 'graphql-request';
import { RequestDocument, Variables, RequestOptions } from 'graphql-request';
import { dbManager } from './setup';
import { randomUUID } from 'crypto';

describe('Onchain Registration Integration', () => {
  let server: FastifyInstance;
  let originalGraphQLRequest: typeof GraphQLClient.prototype.request;

  beforeEach(async () => {
    // Create the test server (this will initialize the database)
    server = await createTestServer();
    
    // Store original GraphQL request method
    originalGraphQLRequest = GraphQLClient.prototype.request;
    
    // Ensure the nonces table exists and has the necessary structure
    const db = await dbManager.getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS nonces (
        id UUID PRIMARY KEY,
        chain_id bigint NOT NULL,
        sponsor bytea NOT NULL CHECK (length(sponsor) = 20),
        nonce_high bigint NOT NULL,
        nonce_low integer NOT NULL,
        consumed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chain_id, sponsor, nonce_high, nonce_low)
      )
    `);
    
    // Create index on nonces table
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_nonces_chain_sponsor ON nonces(chain_id, sponsor)
    `);
  });

  afterEach(async () => {
    // Restore original GraphQL request method
    GraphQLClient.prototype.request = originalGraphQLRequest;
    await cleanupTestServer();
  });

  it('should accept a compact with valid sponsor signature', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Generate a valid signature
    const sponsorSignature = await generateValidCompactSignature(freshCompact, chainId);
    
    // Submit the compact
    const result = await submitCompact(
      server,
      { chainId, compact: apiCompact },
      sponsorAddress,
      sponsorSignature
    );
    
    // Verify the result
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('signature');
    expect(result).toHaveProperty('nonce');
  });

  it('should accept a compact with valid onchain registration', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Use an invalid signature
    const invalidSignature = '0x1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    
    // Mock GraphQL response for onchain registration check
    GraphQLClient.prototype.request = async <T = any>(
      _document: RequestDocument | RequestOptions,
      ..._variablesAndRequestHeaders: any[]
    ): Promise<T> => {
      // Get current time in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Return a valid active registration (finalized and not expired)
      return {
        registeredCompact: {
          blockNumber: '10030370',
          timestamp: (currentTime - 3600).toString(), // 1 hour ago (finalized)
          typehash: '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
          expires: (currentTime + 3600).toString(), // Expires in 1 hour (not expired)
          sponsor: {
            address: sponsorAddress.toLowerCase(),
          },
          claim: null,
        },
      } as T;
    };
    
    // Submit the compact with invalid signature
    const result = await submitCompact(
      server,
      { chainId, compact: apiCompact },
      sponsorAddress,
      invalidSignature
    );
    
    // Verify the result
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('signature');
    expect(result).toHaveProperty('nonce');
  });

  it('should reject a compact with invalid signature and no onchain registration', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Use an invalid signature
    const invalidSignature = '0x1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    
    // Mock GraphQL response for onchain registration check
    GraphQLClient.prototype.request = async <T = any>(
      _document: RequestDocument | RequestOptions,
      ..._variablesAndRequestHeaders: any[]
    ): Promise<T> => {
      // Return null for registeredCompact (not found)
      return {
        registeredCompact: null,
      } as T;
    };
    
    // Submit the compact with invalid signature
    await expect(
      submitCompact(
        server,
        { chainId, compact: apiCompact },
        sponsorAddress,
        invalidSignature
      )
    ).rejects.toThrow('Invalid sponsor signature and compact not found onchain');
  });

  it('should reject a compact with invalid signature and pending onchain registration', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Use an invalid signature
    const invalidSignature = '0x1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    
    // Mock GraphQL response for onchain registration check
    GraphQLClient.prototype.request = async <T = any>(
      _document: RequestDocument | RequestOptions,
      ..._variablesAndRequestHeaders: any[]
    ): Promise<T> => {
      // Get current time in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Return a registration with a timestamp that's very recent (not yet finalized)
      return {
        registeredCompact: {
          blockNumber: '10030370',
          timestamp: (currentTime - 5).toString(), // 5 seconds ago
          typehash: '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
          expires: '1740779269',
          sponsor: {
            address: sponsorAddress.toLowerCase(),
          },
          claim: null,
        },
      } as T;
    };
    
    // Submit the compact with invalid signature
    await expect(
      submitCompact(
        server,
        { chainId, compact: apiCompact },
        sponsorAddress,
        invalidSignature
      )
    ).rejects.toThrow('Onchain registration is pending finalization');
  });

  it('should reject a compact with invalid signature and expired onchain registration', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Use an invalid signature
    const invalidSignature = '0x1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    
    // Mock GraphQL response for onchain registration check
    GraphQLClient.prototype.request = async <T = any>(
      _document: RequestDocument | RequestOptions,
      ..._variablesAndRequestHeaders: any[]
    ): Promise<T> => {
      // Get current time in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Return a registration with an expired timestamp
      return {
        registeredCompact: {
          blockNumber: '10030370',
          timestamp: (currentTime - 3600).toString(), // 1 hour ago
          typehash: '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
          expires: (currentTime - 60).toString(), // Expired 1 minute ago
          sponsor: {
            address: sponsorAddress.toLowerCase(),
          },
          claim: null,
        },
      } as T;
    };
    
    // Submit the compact with invalid signature
    await expect(
      submitCompact(
        server,
        { chainId, compact: apiCompact },
        sponsorAddress,
        invalidSignature
      )
    ).rejects.toThrow('Onchain registration has expired');
  });

  it('should reject a compact with invalid signature and claimed onchain registration', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Use an invalid signature
    const invalidSignature = '0x1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    
    // Mock GraphQL response for onchain registration check
    GraphQLClient.prototype.request = async <T = any>(
      _document: RequestDocument | RequestOptions,
      ..._variablesAndRequestHeaders: any[]
    ): Promise<T> => {
      // Get current time in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Return a registration with a claim that's already finalized
      return {
        registeredCompact: {
          blockNumber: '10030370',
          timestamp: (currentTime - 3600).toString(), // 1 hour ago
          typehash: '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
          expires: (currentTime + 3600).toString(), // Expires in 1 hour
          sponsor: {
            address: sponsorAddress.toLowerCase(),
          },
          claim: {
            blockNumber: '10030433',
            timestamp: (currentTime - 3500).toString(), // 58 minutes ago
          },
        },
      } as T;
    };
    
    // Submit the compact with invalid signature
    await expect(
      submitCompact(
        server,
        { chainId, compact: apiCompact },
        sponsorAddress,
        invalidSignature
      )
    ).rejects.toThrow('Onchain registration has been claimed');
  });

  it('should reject a compact with invalid signature and mismatched sponsor in onchain registration', async () => {
    // Get a fresh compact
    const freshCompact = getFreshCompact();
    const apiCompact = compactToAPI(freshCompact);
    const chainId = freshCompact.chainId.toString();
    const sponsorAddress = freshCompact.sponsor;
    
    // Use an invalid signature
    const invalidSignature = '0x1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    
    // Mock GraphQL response for onchain registration check
    GraphQLClient.prototype.request = async <T = any>(
      _document: RequestDocument | RequestOptions,
      ..._variablesAndRequestHeaders: any[]
    ): Promise<T> => {
      // Get current time in seconds
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Return a registration with a different sponsor
      return {
        registeredCompact: {
          blockNumber: '10030370',
          timestamp: (currentTime - 3600).toString(), // 1 hour ago
          typehash: '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
          expires: (currentTime + 3600).toString(), // Expires in 1 hour
          sponsor: {
            address: '0x1234567890123456789012345678901234567890', // Different sponsor
          },
          claim: null,
        },
      } as T;
    };
    
    // Submit the compact with invalid signature
    await expect(
      submitCompact(
        server,
        { chainId, compact: apiCompact },
        sponsorAddress,
        invalidSignature
      )
    ).rejects.toThrow('Onchain registration sponsor does not match the provided sponsor');
  });
});
