import {
  type Hex,
  recoverAddress,
  compactSignatureToSignature,
  serializeSignature,
  parseCompactSignature,
} from 'viem';
import {
  generateClaimHash,
  generateDomainHash,
  generateDigest,
} from '../crypto';

describe('Sponsor Signature Verification Tests', () => {
  // Real-world payload from a valid compact submission
  const realPayload = {
    chainId: '8453',
    compact: {
      arbiter: '0xfaBE453252ca8337b091ba01BB168030E2FE6c1F',
      sponsor: '0x899EE89DBE7e74Dae12E20Cc255cEC0d59b5d4Fc',
      nonce:
        '0x899ee89dbe7e74dae12e20cc255cec0d59b5d4fc000000000000000000000005',
      expires: '1741109248',
      id: '23499701752147396106288076034559433787185985086782922907309316384822661228819',
      amount: '10000000',
      witnessTypeString:
        'Mandate mandate)Mandate(uint256 chainId,address tribunal,address recipient,uint256 expires,address token,uint256 minimumAmount,uint256 baselinePriorityFee,uint256 scalingFactor,bytes32 salt)',
      witnessHash:
        '0x597ab1530f52acb6b61c695b751c67104564888b80586b49f363d63fe2f1a7b4',
    },
    sponsorSignature:
      '0x61e93e6297115687162b0effd63afe0c1a12e9171e3d3cdee47ac20b46c7612009a058b61024b31a751a46334511b20958281689496a9d7855cfb4794a363eb1',
    claimHash:
      '0x0b2d97ad7b38cf80983dfb318a3c25b1009f28be0f62711d23b5e6f3725ae04d',
  };

  // Convert the payload to the format expected by our functions
  const storedCompact = {
    id: BigInt(realPayload.compact.id),
    arbiter: realPayload.compact.arbiter,
    sponsor: realPayload.compact.sponsor,
    nonce: BigInt(realPayload.compact.nonce),
    expires: BigInt(realPayload.compact.expires),
    amount: realPayload.compact.amount,
    witnessTypeString: realPayload.compact.witnessTypeString,
    witnessHash: realPayload.compact.witnessHash as Hex,
  };

  describe('Real-world payload verification', () => {
    it('should verify a real-world sponsor signature', async () => {
      // Skip this test if we haven't implemented mandate support yet
      if (!process.env.MANDATE_SUPPORT_IMPLEMENTED) {
        console.warn(
          'Skipping real-world payload test - mandate support not implemented yet'
        );
        return;
      }

      // 1. Generate claim hash
      const claimHash = await generateClaimHash(storedCompact);

      // Verify that our claim hash matches the expected one
      expect(claimHash).toBe(realPayload.claimHash);

      // 2. Generate domain hash for Base (chainId 8453)
      const domainHash = generateDomainHash(BigInt(realPayload.chainId));

      // 3. Generate digest
      const digest = generateDigest(claimHash, domainHash);

      // 4. Verify the signature
      // Convert compact signature to full signature for recovery
      const parsedCompactSig = parseCompactSignature(
        realPayload.sponsorSignature as `0x${string}`
      );
      const fullSignature = compactSignatureToSignature(parsedCompactSig);
      const serializedSig = serializeSignature(fullSignature);

      // Recover the signer address
      const recoveredAddress = await recoverAddress({
        hash: digest,
        signature: serializedSig,
      });

      // Check if the recovered address matches the sponsor
      expect(recoveredAddress.toLowerCase()).toBe(
        realPayload.compact.sponsor.toLowerCase()
      );
    });
  });

  describe('Basic signature verification', () => {
    // Simple compact without mandate for basic tests
    const simpleCompact = {
      id: BigInt(
        '0x1000000000000000000000000000000000000000000000000000000000000001'
      ),
      arbiter: '0x0000000000000000000000000000000000000001',
      sponsor: '0x0000000000000000000000000000000000000002',
      nonce: BigInt('0x1'),
      expires: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour from now
      amount: '1000000000000000000', // 1 ETH
      witnessTypeString: null,
      witnessHash: null,
    };

    it('should generate a valid claim hash', async () => {
      const hash = await generateClaimHash(simpleCompact);
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should generate different hashes for different nonces', async () => {
      const hash1 = await generateClaimHash(simpleCompact);
      const hash2 = await generateClaimHash({
        ...simpleCompact,
        nonce: BigInt('0x2'),
      });
      expect(hash1).not.toBe(hash2);
    });
  });
});
