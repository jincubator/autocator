import { generateClaimHash } from '../crypto';
import { type StoredCompactMessage } from '../compact';

// Test suite for cryptographic functions used in Autocator
describe('crypto', () => {
  // Ensure environment variables are set before tests run
  beforeAll(() => {
    if (!process.env.ALLOCATOR_ADDRESS || !process.env.SIGNING_ADDRESS) {
      process.env.ALLOCATOR_ADDRESS =
        '0x2345678901234567890123456789012345678901';
      process.env.SIGNING_ADDRESS =
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    }
  });
  describe('generateClaimHash', () => {
    it('should generate consistent hash for a compact message', async () => {
      const testCompact: StoredCompactMessage = {
        arbiter: '0x1234567890123456789012345678901234567890',
        sponsor: '0x2345678901234567890123456789012345678901',
        nonce: BigInt(1),
        expires: BigInt(1234567890),
        id: BigInt(1),
        amount: '1000000000000000000',
        witnessTypeString: null,
        witnessHash: null,
      };

      const hash = await generateClaimHash(testCompact);

      // Verify it's a valid hex string of correct length (32 bytes = 64 chars + '0x')
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
    });
  });
});
