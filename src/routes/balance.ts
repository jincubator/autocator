import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAddress } from 'viem/utils';
import { getAllocatedBalance } from '../balance';
import {
  getCompactDetails,
  getAllResourceLocks,
  getCachedSupportedChains,
} from '../graphql';
import { toBigInt } from '../utils/encoding';

interface Balance {
  chainId: string;
  lockId: string;
  allocatableBalance: string;
  allocatedBalance: string;
  balanceAvailableToAllocate: string;
  withdrawalStatus: number;
}

export async function setupBalanceRoutes(
  server: FastifyInstance
): Promise<void> {
  // Get balance for all resource locks for a specific sponsor
  server.get<{
    Querystring: { sponsor: string };
  }>(
    '/balances',
    async (
      request: FastifyRequest<{
        Querystring: { sponsor: string };
      }>,
      reply: FastifyReply
    ): Promise<
      | {
          balances: Array<Balance>;
        }
      | { error: string }
    > => {
      try {
        const { sponsor } = request.query;

        if (!sponsor) {
          reply.code(400);
          return { error: 'Sponsor address is required' };
        }

        let normalizedSponsor: string;
        try {
          normalizedSponsor = getAddress(sponsor);
        } catch {
          reply.code(400);
          return { error: 'Invalid sponsor address format' };
        }

        // Get all resource locks for the sponsor
        const response = await getAllResourceLocks(normalizedSponsor);

        // Add defensive checks
        if (!response?.account?.resourceLocks?.items) {
          return { balances: [] };
        }

        // Filter locks to only include those managed by this allocator
        const ourLocks = response.account.resourceLocks.items.filter((item) => {
          try {
            return (
              getAddress(item?.resourceLock?.allocatorAddress) ===
              getAddress(process.env.ALLOCATOR_ADDRESS!)
            );
          } catch {
            return false;
          }
        });

        // Get balance details for each lock
        const balances = (
          await Promise.all(
            ourLocks.map(async (lock) => {
              // Get details from GraphQL
              const lockDetails = await getCompactDetails({
                allocator: process.env.ALLOCATOR_ADDRESS!,
                sponsor: normalizedSponsor,
                lockId: lock.resourceLock.lockId,
                chainId: lock.chainId,
              });

              // Add defensive check for lockDetails
              if (!lockDetails?.account?.resourceLocks?.items?.[0]) {
                return null; // This lock will be filtered out
              }

              const resourceLock = lockDetails.account.resourceLocks.items[0];
              if (!resourceLock) {
                return null; // Skip if lock no longer exists
              }

              // Calculate pending balance (unfinalized deposits)
              const pendingBalance = lockDetails.accountDeltas.items.reduce(
                (sum, delta) => sum + BigInt(delta.delta),
                BigInt(0)
              );
              // Unfinalized deposits calculation

              // The balance from GraphQL includes unfinalized deposits
              // So we need to subtract them to get the finalized balance
              const currentBalance = BigInt(resourceLock.balance);
              // If pending balance exceeds current balance, set finalized balance to 0
              const finalizedBalance =
                pendingBalance > currentBalance
                  ? BigInt(0)
                  : currentBalance - pendingBalance;
              // This is our allocatable balance (only includes finalized amounts)
              const allocatableBalance = finalizedBalance;

              // Balance calculation

              // Convert lockId to BigInt
              const lockIdBigInt = toBigInt(lock.resourceLock.lockId, 'lockId');
              if (lockIdBigInt === null) {
                throw new Error('Invalid lockId format');
              }

              // Get allocated balance
              const allocatedBalance = await getAllocatedBalance(
                server.db,
                normalizedSponsor,
                lock.chainId,
                lockIdBigInt,
                lockDetails.account.claims.items.map((claim) => claim.claimHash)
              );
              // Allocated balance calculation

              // Calculate available balance
              let balanceAvailableToAllocate = BigInt(0);
              if (resourceLock.withdrawalStatus === 0) {
                if (allocatedBalance < allocatableBalance) {
                  balanceAvailableToAllocate =
                    allocatableBalance - allocatedBalance;
                }
              }

              return {
                chainId: lock.chainId,
                lockId: lock.resourceLock.lockId,
                allocatableBalance: allocatableBalance.toString(),
                allocatedBalance: allocatedBalance.toString(),
                balanceAvailableToAllocate:
                  balanceAvailableToAllocate.toString(),
                withdrawalStatus: resourceLock.withdrawalStatus,
              } as Balance;
            })
          )
        ).filter((balance): balance is Balance => balance !== null);

        // Filter out any null results and return
        return {
          balances,
        };
      } catch (error) {
        reply.code(500);
        return {
          error: `Failed to fetch balances: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
  );

  // Get available balance for a specific lock
  server.get<{
    Params: { chainId: string; lockId: string };
    Querystring: { sponsor: string };
  }>(
    '/balance/:chainId/:lockId',
    async (
      request: FastifyRequest<{
        Params: { chainId: string; lockId: string };
        Querystring: { sponsor: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { chainId, lockId } = request.params;
        const { sponsor } = request.query;

        if (!sponsor) {
          reply.code(400);
          return { error: 'Sponsor address is required' };
        }

        let normalizedSponsor: string;
        try {
          normalizedSponsor = getAddress(sponsor);
        } catch {
          reply.code(400);
          return { error: 'Invalid sponsor address format' };
        }

        // Get details from GraphQL
        const response = await getCompactDetails({
          allocator: process.env.ALLOCATOR_ADDRESS!,
          sponsor: normalizedSponsor,
          lockId,
          chainId,
        });

        // Verify the resource lock exists
        const resourceLock = response.account.resourceLocks.items[0];
        if (!resourceLock) {
          reply.code(404);
          return { error: 'Resource lock not found' };
        }

        // Extract allocatorId from the lockId
        const lockIdBigInt = toBigInt(lockId, 'lockId');
        if (lockIdBigInt === null) {
          throw new Error('Invalid lockId format');
        }

        const allocatorId =
          (lockIdBigInt >> BigInt(160)) &
          ((BigInt(1) << BigInt(92)) - BigInt(1));

        // Get the cached chain config to verify allocatorId
        const chainConfig = getCachedSupportedChains()?.find(
          (chain) => chain.chainId === chainId
        );

        // Verify allocatorId matches
        if (!chainConfig || BigInt(chainConfig.allocatorId) !== allocatorId) {
          reply.code(400);
          return { error: 'Invalid allocator ID' };
        }

        // Calculate pending balance (unfinalized deposits)
        const pendingBalance = response.accountDeltas.items.reduce(
          (sum, delta) => sum + BigInt(delta.delta),
          BigInt(0)
        );

        // The balance from GraphQL includes unfinalized deposits
        // So we need to subtract them to get the finalized balance
        const currentBalance = BigInt(resourceLock.balance);
        // If pending balance exceeds current balance, set finalized balance to 0
        const finalizedBalance =
          pendingBalance > currentBalance
            ? BigInt(0)
            : currentBalance - pendingBalance;
        // This is our allocatable balance (only includes finalized amounts)
        const allocatableBalance = finalizedBalance;

        // Get allocated balance from database
        const allocatedBalance = await getAllocatedBalance(
          server.db,
          normalizedSponsor,
          chainId,
          lockIdBigInt,
          response.account.claims.items.map((claim) => claim.claimHash)
        );

        // Calculate balance available to allocate
        let balanceAvailableToAllocate = BigInt(0);
        if (resourceLock.withdrawalStatus === 0) {
          if (allocatedBalance < allocatableBalance) {
            balanceAvailableToAllocate = allocatableBalance - allocatedBalance;
          }
        }

        return {
          allocatableBalance: allocatableBalance.toString(),
          allocatedBalance: allocatedBalance.toString(),
          balanceAvailableToAllocate: balanceAvailableToAllocate.toString(),
          withdrawalStatus: resourceLock.withdrawalStatus,
        };
      } catch (error) {
        reply.code(500);
        return {
          error:
            error instanceof Error ? error.message : 'Failed to get balance',
        };
      }
    }
  );
}
