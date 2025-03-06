# $$\mathbf{Auto\color{green}{cator}}$$ 🚗

A server-based allocator for [The Compact](https://github.com/Uniswap/the-compact) that leverages protocol signatures and transactions for authentication. Autocator provides an API for requesting resource lock allocations across multiple blockchains by providing the details of associated compacts with accompanying sponsor signatures or onchain registrations. It also includes a frontend application for interacting directly with the server that also facilitates making deposits into resource locks it oversees.

Autocator is a fork of [Smallocator](https://github.com/uniswap/smallocator) with key differences:

- No "Sign in with Ethereum" authentication component
  - Note that **Autocator does not provide the same privacy guarantees as Smallocator** — allocated token balances and suggested nonces are public. The primary intended mechainism for Autocator is the "deposit and register" flow, where information on the input tokens is already public, with support for retries and early withdrawals when necessary.
- Simplified flow: request nonce => sponsor signs or registers and informs Autocator => Autocator cosigns
- Requires either:
  - a valid sponsor signature with the payload when submitting a compact, or
  - an onchain registration of the compact, in which case there's no attached signature

> ⚠️ Autocator is under development and is intended to serve as a reference for understanding server-based allocator functionality and for testing purposes. Use caution when using Autocator in a production environment.

## Features

- ✍️ EIP-712 Compact message validation and signing with sponsor signature verification
- 🔄 Support for onchain registration verification as an alternative to sponsor signatures
- 🤫 No witness data or signature provided, keeping sponsor intents secret (only the typestring and witness hash is supplied)
- 📊 GraphQL integration with [The Compact Indexer](https://github.com/Uniswap/the-compact-indexer) for multi-chain indexing
- 💾 Persistent storage using PGLite to track attested compacts and used nonces
- 🔎 Comprehensive validation pipeline to ensure resource locks never end up in an overallocated state

## Intentionally Minimal Scope

- ☝️ Single-resource-lock, single-chain compacts only: No `BatchCompact` or `MultichainCompact` attestations
- ❄️ Strict nonce usage: Ensures every attested nonce is unique; no reuse on expirations and no direct onchain nonce consumption
- 🧭 No `attest()` callbacks for ERC6909 transfers: focused solely on attesting compacts
- 🪞 No compact qualification: Attests to the exact compact provided to it without adding qualifiers or extra metadata
- 📡 Limited on-chain awareness: Uses indexer to verify onchain registrations
- ⏳ Straightforward finalization: Uses a simple, time-based approach per chain for determining transaction finality

## UI Usage

A basic frontend is available at the root path (`GET /`), or at `localhost:3001/` when running locally in dev mode. While the primary intended mechanism of interaction with Autocator is via the API, the UI serves as a convenient and direct secondary access point.

It supports:

- viewing the health status of the server
- depositing Native tokens and ERC20 tokens
- viewing allocatable and allocated balances
- performing allocated transfers and withdrawals
- initiating, executing, and disabling forced withdrawals

Note that the frontend is still relatively unstable (any contributions here are welcome).

## API Usage

### Health Check

```http
GET /health
```

Example response:

```json
{
  "status": "healthy",
  "allocatorAddress": "0x1234567890123456789012345678901234567890",
  "signingAddress": "0x9876543210987654321098765432109876543210",
  "timestamp": "2024-03-07T12:00:00.000Z",
  "supportedChains": [
    {
      "chainId": "1",
      "allocatorId": "0x12345678901234567890abcd",
      "finalizationThresholdSeconds": 25
    },
    {
      "chainId": "10",
      "allocatorId": "0x12345678901234567890abcd",
      "finalizationThresholdSeconds": 10
    },
    {
      "chainId": "130",
      "allocatorId": "0x2345678901234567890abcde",
      "finalizationThresholdSeconds": 2
    },
    {
      "chainId": "8453",
      "allocatorId": "0x2345678901234567890abcde",
      "finalizationThresholdSeconds": 2
    }
  ]
}
```

### Compact Operations

1. **Get Suggested Nonce**

   ```http
   GET /suggested-nonce/:chainId/:account
   ```

   Returns the next available unused nonce for the specified account for creating new compacts on a specific chain.

   Example response:

   ```json
   {
     "nonce": "0x70997970C51812dc3A010C7d01b50e0d17dc79C800000000000000000000001"
   }
   ```

2. **Submit Compact**

   ```http
   POST /compact
   ```

   Example request:

   ```json
   {
     "chainId": "10",
     "compact": {
       "arbiter": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
       "sponsor": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
       "nonce": "0x70997970C51812dc3A010C7d01b50e0d17dc79C800000000000000000000001",
       "expires": "1732520000",
       "id": "0x300000000000000000000000000000000000000000000000000000000000001c",
       "amount": "1000000000000000000",
       "witnessTypeString": "ExampleWitness exampleWitness)ExampleWitness(uint256 foo, bytes32 bar)",
       "witnessHash": "0x0000000000000000000000000000000000000000000000000000000123"
     },
     "sponsorSignature": "0x1234...7890"
   }
   ```

   Example response:

   ```json
   {
     "hash": "0x1234567890123456789012345678901234567890123456789012345678901234",
     "signature": "0x1234...7890",
     "nonce": "0x70997970C51812dc3A010C7d01b50e0d17dc79C800000000000000000000001"
   }
   ```

Note that `nonce` is required and must be a valid nonce for the sponsor. Use the `/suggested-nonce/:chainId/:account` endpoint to get a valid nonce. `witnessTypeString` and `witnessHash` can be `null` in which case the attested compact will not incorporate witness data (values must be provided for both or omitted for both to be considered valid).

The `sponsorSignature` is required unless the compact is registered onchain. If the signature is invalid or missing, Autocator will check if the compact is registered onchain, that the registration has not expired, and that the associated compact has not already been claimed. If it is, the compact will be cosigned by Autocator.

3. **Get Compacts by Address**

   ```http
   GET /compacts?sponsor=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
   ```

   Example response:

   ```json
   [
     {
       "chainId": "10",
       "hash": "0x1234567890123456789012345678901234567890123456789012345678901234",
       "compact": {
         "arbiter": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
         "sponsor": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
         "nonce": "0x70997970C51812dc3A010C7d01b50e0d17dc79C800000000000000000000001",
         "expires": "1732520000",
         "id": "0x300000000000000000000000000000000000000000000000000000000000001c",
         "amount": "1000000000000000000",
         "witnessTypeString": "ExampleWitness exampleWitness)ExampleWitness(uint256 foo, bytes32 bar)",
         "witnessHash": "0x0000000000000000000000000000000000000000000000000000000000000123"
       },
       "signature": "0x1234...7890",
       "createdAt": "2024-03-07T12:00:00Z"
     }
   ]
   ```

4. **Get Specific Compact**

   ```http
   GET /compact/:chainId/:claimHash
   ```

   Example response:

   ```json
   {
     "chainId": "10",
     "hash": "0x1234567890123456789012345678901234567890123456789012345678901234",
     "compact": {
       "arbiter": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
       "sponsor": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
       "nonce": "0x70997970C51812dc3A010C7d01b50e0d17dc79C800000000000000000000001",
       "expires": "1732520000",
       "id": "0x300000000000000000000000000000000000000000000000000000000000001c",
       "amount": "1000000000000000000",
       "witnessTypeString": "ExampleWitness exampleWitness)ExampleWitness(uint256 foo, bytes32 bar)",
       "witnessHash": "0x0000000000000000000000000000000000000000000000000000000123"
     },
     "signature": "0x1234...7890",
     "createdAt": "2024-03-07T12:00:00Z"
   }
   ```

5. **Get Resource Lock Balance**

   ```http
   GET /balance/:chainId/:lockId
   ```

   Returns balance information for a specific resource lock. Example response:

   ```json
   {
     "allocatableBalance": "1000000000000000000",
     "allocatedBalance": "500000000000000000",
     "balanceAvailableToAllocate": "500000000000000000",
     "withdrawalStatus": 0
   }
   ```

   The `allocatableBalance` will be the current balance minus the sum of any unfinalized deposits or inbound transfers. The period after which these are considered finalized is configurable for each chain.

   The `allocatedBalance` will be the sum of any submitted compacts that:

   - have not been processed (as confirmed by a `Claim` event with the respective claim hash in a finalized block)
   - have not expired (as confirmed by a finalized block with a timestamp exceeding the `expires` value)

   The `balanceAvailableToAllocate` will be:

   - `"0"` if `withdrawalStatus` is non-zero
   - `"0"` if `allocatedBalance` >= `allocatableBalance`
   - `allocatableBalance - allocatedBalance` otherwise

6. **Get All Resource Lock Balances**

   ```http
   GET /balances
   ```

   Returns balance information for all resource locks managed by this allocator. Example response:

   ```json
   {
     "balances": [
       {
         "chainId": "1",
         "lockId": "0x1234567890123456789012345678901234567890123456789012345678901234",
         "allocatableBalance": "1000000000000000000",
         "allocatedBalance": "500000000000000000",
         "balanceAvailableToAllocate": "500000000000000000",
         "withdrawalStatus": 0
       }
     ]
   }
   ```

   Each balance entry follows the same rules as the single balance endpoint.

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 9.14.1
- TypeScript >= 5.2

### Development

```bash
### Configuration & Installation ###
# 1. Clone this repo and enter cloned directory
git clone git@github.com:Uniswap/autocator.git && cd autocator

# 2. Copy example environment file (modify as needed)
cp .env.example .env

# 3. Install frontend and backend dependencies
pnpm install:all

# 4. Run tests
pnpm test


### Usage ###
# Run both frontend and backend in development mode with hot reload
pnpm dev:all

# Run tests
pnpm test

# Type checking
pnpm type-check

# Linting
pnpm lint

# Format code
pnpm format

# Build frontend and backend for production
pnpm build:all

# Start production server
pnpm start
```

### Testing

The project utilizes Jest to implement various test suites:

- Unit tests for core functionality
- Integration tests for API endpoints
- Validation tests for compact messages

Run all tests with:

```bash
pnpm test
```

### Code Quality

The project uses:

- ESLint for code linting
- Prettier for code formatting
- Husky for git hooks
- lint-staged for pre-commit checks

Pre-commit hooks ensure:

- Code is properly formatted
- Tests pass
- No TypeScript errors
- No ESLint warnings

## License

MIT
