import { GraphQLClient } from 'graphql-request';
import {
  checkOnchainRegistration,
  OnchainRegistrationStatus,
} from '../../validation/onchain-registration';
import { getFinalizationThreshold } from '../../chain-config';

// Create a mock implementation for GraphQLClient.prototype.request
type MockGraphQLResponse = {
  registeredCompact: {
    blockNumber: string;
    timestamp: string;
    typehash: string;
    expires: string;
    sponsor: {
      address: string;
    };
    claim: {
      blockNumber: string;
      timestamp: string;
    } | null;
  } | null;
};

// Store original functions to restore later
const originalGraphQLRequest = GraphQLClient.prototype.request;
const originalDateNow = Date.now;

describe('Onchain Registration Validation', () => {
  // Mock the current time for consistent testing
  const mockCurrentTime = 1740778800; // Fixed timestamp for tests
  let mockGraphQLResponse: MockGraphQLResponse | null = null;

  beforeAll(() => {
    // Mock Date.now to return a fixed timestamp
    Date.now = function () {
      return mockCurrentTime * 1000;
    };

    // Mock GraphQL request
    GraphQLClient.prototype.request = function () {
      return Promise.resolve(mockGraphQLResponse || {});
    };
  });

  afterAll(() => {
    // Restore original functions
    Date.now = originalDateNow;
    GraphQLClient.prototype.request = originalGraphQLRequest;
  });

  beforeEach(() => {
    // Reset mocks before each test
    mockGraphQLResponse = null;
  });

  it('should return NOT_FOUND when no registered compact exists', async () => {
    // Mock GraphQL response with null registeredCompact
    mockGraphQLResponse = {
      registeredCompact: null,
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '1'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.NOT_FOUND);
  });

  it('should return PENDING when registration is not yet finalized', async () => {
    // 25 seconds for Ethereum Mainnet

    // Mock GraphQL response with a recent registration (not yet finalized)
    const registrationTimestamp = mockCurrentTime - 5; // 5 seconds ago
    mockGraphQLResponse = {
      registeredCompact: {
        blockNumber: '10030370',
        timestamp: registrationTimestamp.toString(),
        typehash:
          '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
        expires: '1740779269',
        sponsor: {
          address: '0x5e36b477ce36e46e6e47ea5b348e85b94bd692f9',
        },
        claim: null,
      },
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '1'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.PENDING);
    expect(result.timeUntilFinalized).toBe(getFinalizationThreshold('1') - 5); // Remaining seconds until finalized
    expect(result.registeredCompact).toBeDefined();
  });

  it('should return ACTIVE when registration is finalized and not expired', async () => {
    // 25 seconds for Ethereum Mainnet

    // Mock GraphQL response with a finalized registration
    const registrationTimestamp = mockCurrentTime - 30; // 30 seconds ago (past finalization of 25 seconds)
    mockGraphQLResponse = {
      registeredCompact: {
        blockNumber: '10030370',
        timestamp: registrationTimestamp.toString(),
        typehash:
          '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
        expires: (mockCurrentTime + 3600).toString(), // 1 hour in the future
        sponsor: {
          address: '0x5e36b477ce36e46e6e47ea5b348e85b94bd692f9',
        },
        claim: null,
      },
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '1'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.ACTIVE);
    expect(result.registeredCompact).toBeDefined();
  });

  it('should return EXPIRED when registration is past expiration plus finalization', async () => {
    // 25 seconds for Ethereum Mainnet

    // Mock GraphQL response with an expired registration
    const registrationTimestamp = mockCurrentTime - 3600; // 1 hour ago
    const expirationTimestamp = mockCurrentTime - 30; // 30 seconds ago (past finalization of 25 seconds)
    mockGraphQLResponse = {
      registeredCompact: {
        blockNumber: '10030370',
        timestamp: registrationTimestamp.toString(),
        typehash:
          '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
        expires: expirationTimestamp.toString(),
        sponsor: {
          address: '0x5e36b477ce36e46e6e47ea5b348e85b94bd692f9',
        },
        claim: null,
      },
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '1'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.EXPIRED);
    expect(result.registeredCompact).toBeDefined();
  });

  it('should return CLAIM_PENDING when claim is not yet finalized', async () => {
    // 25 seconds for Ethereum Mainnet

    // Mock GraphQL response with a registration that has a pending claim
    const registrationTimestamp = mockCurrentTime - 3600; // 1 hour ago
    const claimTimestamp = mockCurrentTime - 5; // 5 seconds ago
    mockGraphQLResponse = {
      registeredCompact: {
        blockNumber: '10030370',
        timestamp: registrationTimestamp.toString(),
        typehash:
          '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
        expires: (mockCurrentTime + 3600).toString(), // 1 hour in the future
        sponsor: {
          address: '0x5e36b477ce36e46e6e47ea5b348e85b94bd692f9',
        },
        claim: {
          blockNumber: '10030433',
          timestamp: claimTimestamp.toString(),
        },
      },
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '1'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.CLAIM_PENDING);
    expect(result.timeUntilClaimFinalized).toBe(
      getFinalizationThreshold('1') - 5
    ); // Remaining seconds until claim is finalized
    expect(result.registeredCompact).toBeDefined();
  });

  it('should return CLAIMED when claim is finalized', async () => {
    // 25 seconds for Ethereum Mainnet

    // Mock GraphQL response with a registration that has a finalized claim
    const registrationTimestamp = mockCurrentTime - 3600; // 1 hour ago
    const claimTimestamp = mockCurrentTime - 30; // 30 seconds ago (past finalization of 25 seconds)
    mockGraphQLResponse = {
      registeredCompact: {
        blockNumber: '10030370',
        timestamp: registrationTimestamp.toString(),
        typehash:
          '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
        expires: (mockCurrentTime + 3600).toString(), // 1 hour in the future
        sponsor: {
          address: '0x5e36b477ce36e46e6e47ea5b348e85b94bd692f9',
        },
        claim: {
          blockNumber: '10030433',
          timestamp: claimTimestamp.toString(),
        },
      },
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '1'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.CLAIMED);
    expect(result.registeredCompact).toBeDefined();
  });

  it('should handle GraphQL request errors', async () => {
    // Mock GraphQL request to throw an error
    const originalRequest = GraphQLClient.prototype.request;
    GraphQLClient.prototype.request = function () {
      return Promise.reject(new Error('GraphQL request failed'));
    };

    try {
      await expect(
        checkOnchainRegistration(
          '0x1234567890123456789012345678901234567890123456789012345678901234',
          '1'
        )
      ).rejects.toThrow(
        'Failed to check onchain registration: GraphQL request failed'
      );
    } finally {
      // Restore the request function
      GraphQLClient.prototype.request = originalRequest;
    }
  });

  it('should use chain-specific finalization thresholds', async () => {
    // Get the finalization threshold for chain ID 10
    const finalizationThreshold = getFinalizationThreshold('10'); // 4 seconds for Optimism

    // Mock GraphQL response with a recent registration
    const registrationTimestamp = mockCurrentTime - 3; // 3 seconds ago
    mockGraphQLResponse = {
      registeredCompact: {
        blockNumber: '10030370',
        timestamp: registrationTimestamp.toString(),
        typehash:
          '0x27f09e0bb8ce2ae63380578af7af85055d3ada248c502e2378b85bc3d05ee0b0',
        expires: '1740779269',
        sponsor: {
          address: '0x5e36b477ce36e46e6e47ea5b348e85b94bd692f9',
        },
        claim: null,
      },
    };

    const result = await checkOnchainRegistration(
      '0x1234567890123456789012345678901234567890123456789012345678901234',
      '10'
    );

    expect(result.status).toBe(OnchainRegistrationStatus.PENDING);
    expect(result.timeUntilFinalized).toBe(finalizationThreshold - 3); // Remaining seconds until finalized
  });
});
