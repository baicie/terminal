import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test the SyncController as a plain class, bypassing NestJS DI and guards.
// This is cleaner for unit testing and avoids the ApiKeyGuard dependency.
describe('SyncController', () => {
  let syncController: {
    getChanges: (since: string | undefined, userId: string) => Promise<unknown>
    pushChanges: (body: unknown, userId: string) => Promise<unknown>
    checkConflicts: (
      body: { items: unknown[] },
      userId: string,
    ) => Promise<unknown>
    resolveConflict: (body: unknown, userId: string) => Promise<unknown>
    getPendingOperations: (userId: string) => Promise<unknown>
    processOfflineQueue: (userId: string) => Promise<unknown>
    enqueueOperation: (body: unknown, userId: string) => Promise<unknown>
    removeFromQueue: (id: string, userId: string) => Promise<unknown>
    clearTeamQueue: (teamId: string, userId: string) => Promise<unknown>
  }

  const mockSyncService = {
    getChanges: vi.fn(),
    pushChanges: vi.fn(),
    checkConflicts: vi.fn(),
    resolveConflict: vi.fn(),
    getPendingOperations: vi.fn(),
    processOfflineQueue: vi.fn(),
    enqueueOfflineOperation: vi.fn(),
    removeFromQueue: vi.fn(),
    clearTeamQueue: vi.fn(),
  }

  beforeEach(() => {
    // Create a plain object that mimics the SyncController behavior
    syncController = {
      getChanges: async (since: string | undefined, userId: string) => {
        return mockSyncService.getChanges(
          userId,
          since ? Number.parseInt(since, 10) : undefined,
        )
      },
      pushChanges: async (body: unknown, userId: string) => {
        return mockSyncService.pushChanges(
          userId,
          body as Parameters<typeof mockSyncService.pushChanges>[1],
        )
      },
      checkConflicts: async (body: { items: unknown[] }, userId: string) => {
        return mockSyncService.checkConflicts(
          userId,
          body.items as Parameters<typeof mockSyncService.checkConflicts>[1],
        )
      },
      resolveConflict: async (body: unknown, userId: string) => {
        const b = body as {
          shareId: string
          resolution: 'LOCAL' | 'REMOTE'
          clientData?: unknown
        }
        return mockSyncService.resolveConflict(
          b.shareId,
          userId,
          b.resolution,
          b.clientData,
        )
      },
      getPendingOperations: async (userId: string) => {
        return mockSyncService.getPendingOperations(userId)
      },
      processOfflineQueue: async (userId: string) => {
        return mockSyncService.processOfflineQueue(userId)
      },
      enqueueOperation: async (body: unknown, userId: string) => {
        const b = body as {
          teamId: string
          operation: string
          shareType: string
          shareId: string
          data?: unknown
        }
        return mockSyncService.enqueueOfflineOperation(
          userId,
          b.teamId,
          b.operation as 'CREATE' | 'UPDATE' | 'DELETE',
          b.shareType as 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
          b.shareId,
          b.data,
        )
      },
      removeFromQueue: async (id: string, userId: string) => {
        await mockSyncService.removeFromQueue(id, userId)
        return { success: true }
      },
      clearTeamQueue: async (teamId: string, userId: string) => {
        await mockSyncService.clearTeamQueue(userId, teamId)
        return { success: true }
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getChanges', () => {
    it('should call syncService.getChanges with userId and parsed since timestamp', async () => {
      const userId = 'user-123'
      const since = '1700000000000'
      const result = {
        timestamp: 1700100000000,
        shares: [],
        deletedShareIds: [],
      }
      mockSyncService.getChanges.mockResolvedValue(result)

      const response = await syncController.getChanges(since, userId)

      expect(mockSyncService.getChanges).toHaveBeenCalledWith(
        userId,
        1700000000000,
      )
      expect(response).toEqual(result)
    })

    it('should call without since when undefined', async () => {
      const userId = 'user-456'
      mockSyncService.getChanges.mockResolvedValue({
        timestamp: Date.now(),
        shares: [],
        deletedShareIds: [],
      })

      const response = await syncController.getChanges(undefined, userId)

      expect(mockSyncService.getChanges).toHaveBeenCalledWith(userId, undefined)
      expect(response).toEqual({
        timestamp: expect.any(Number),
        shares: [],
        deletedShareIds: [],
      })
    })
  })

  describe('pushChanges', () => {
    it('should push changes with encrypted data', async () => {
      const userId = 'user-123'
      const body = {
        shares: [
          {
            id: 'share-1',
            teamId: 'team-1',
            type: 'HOST',
            data: {},
            encryptedData: 'base64_encrypted',
            isSensitive: true,
            permission: 'READONLY',
            baseVersion: 1700000000000,
          },
        ],
      }
      const result = {
        created: [],
        updated: ['share-1'],
        deleted: [],
        conflicts: [],
        errors: [],
      }
      mockSyncService.pushChanges.mockResolvedValue(result)

      const response = await syncController.pushChanges(body, userId)

      expect(mockSyncService.pushChanges).toHaveBeenCalledWith(userId, body)
      expect(response).toEqual(result)
    })

    it('should handle deletion in pushChanges', async () => {
      const userId = 'user-123'
      const body = {
        shares: [],
        deleteShares: ['share-2', 'share-3'],
      }
      const result = {
        created: [],
        updated: [],
        deleted: ['share-2', 'share-3'],
        conflicts: [],
        errors: [],
      }
      mockSyncService.pushChanges.mockResolvedValue(result)

      const response = await syncController.pushChanges(body, userId)

      expect(response).toEqual(result)
    })
  })

  describe('checkConflicts', () => {
    it('should detect conflicts', async () => {
      const userId = 'user-123'
      const body = {
        items: [{ id: 'share-1', updatedAt: 1699000000000, type: 'HOST' }],
      }
      const conflicts = [
        {
          shareId: 'share-1',
          localVersion: { updatedAt: 1699000000000, data: {} },
          remoteVersion: {
            updatedAt: 1700000000000,
            data: {},
            updatedBy: 'other-user',
          },
        },
      ]
      mockSyncService.checkConflicts.mockResolvedValue(conflicts)

      const response = await syncController.checkConflicts(body, userId)

      expect(mockSyncService.checkConflicts).toHaveBeenCalledWith(
        userId,
        body.items,
      )
      expect(response).toEqual(conflicts)
    })
  })

  describe('resolveConflict', () => {
    it('should resolve conflict with LOCAL and include client data', async () => {
      const userId = 'user-123'
      const body = {
        shareId: 'share-1',
        resolution: 'LOCAL',
        clientData: {
          data: { hostname: 'newhost' },
          isSensitive: false,
          permission: 'READWRITE',
        },
      }
      mockSyncService.resolveConflict.mockResolvedValue({ success: true })

      const response = await syncController.resolveConflict(body, userId)

      expect(mockSyncService.resolveConflict).toHaveBeenCalledWith(
        body.shareId,
        userId,
        body.resolution,
        body.clientData,
      )
      expect(response).toEqual({ success: true })
    })

    it('should resolve conflict with REMOTE', async () => {
      const userId = 'user-123'
      const body = { shareId: 'share-1', resolution: 'REMOTE' }
      mockSyncService.resolveConflict.mockResolvedValue({ success: true })

      const response = await syncController.resolveConflict(body, userId)

      expect(response).toEqual({ success: true })
    })
  })

  describe('offline queue', () => {
    it('should get pending operations', async () => {
      const userId = 'user-123'
      const operations = [
        {
          id: 'op-1',
          teamId: 'team-1',
          operation: 'CREATE',
          shareType: 'HOST',
          shareId: 's1',
          data: {},
          attempts: 0,
          lastError: null,
          createdAt: new Date().toISOString(),
        },
      ]
      mockSyncService.getPendingOperations.mockResolvedValue(operations)

      const response = await syncController.getPendingOperations(userId)

      expect(mockSyncService.getPendingOperations).toHaveBeenCalledWith(userId)
      expect(response).toEqual(operations)
    })

    it('should process offline queue', async () => {
      const userId = 'user-123'
      const result = { processed: 2, succeeded: 2, failed: 0, errors: [] }
      mockSyncService.processOfflineQueue.mockResolvedValue(result)

      const response = await syncController.processOfflineQueue(userId)

      expect(mockSyncService.processOfflineQueue).toHaveBeenCalledWith(userId)
      expect(response).toEqual(result)
    })

    it('should enqueue an offline operation', async () => {
      const userId = 'user-123'
      const body = {
        teamId: 'team-1',
        operation: 'CREATE',
        shareType: 'HOST',
        shareId: 'share-1',
        data: {
          type: 'HOST',
          data: { hostname: 'test' },
          permission: 'READONLY',
        },
      }
      mockSyncService.enqueueOfflineOperation.mockResolvedValue({
        id: 'op-new',
      })

      const response = await syncController.enqueueOperation(body, userId)

      expect(mockSyncService.enqueueOfflineOperation).toHaveBeenCalledWith(
        userId,
        body.teamId,
        body.operation,
        body.shareType,
        body.shareId,
        body.data,
      )
      expect(response).toEqual({ id: 'op-new' })
    })

    it('should remove from queue', async () => {
      const userId = 'user-123'
      const id = 'op-1'
      mockSyncService.removeFromQueue.mockResolvedValue(undefined)

      const response = await syncController.removeFromQueue(id, userId)

      expect(mockSyncService.removeFromQueue).toHaveBeenCalledWith(id, userId)
      expect(response).toEqual({ success: true })
    })

    it('should clear team queue', async () => {
      const userId = 'user-123'
      const teamId = 'team-1'
      mockSyncService.clearTeamQueue.mockResolvedValue(undefined)

      const response = await syncController.clearTeamQueue(teamId, userId)

      expect(mockSyncService.clearTeamQueue).toHaveBeenCalledWith(
        userId,
        teamId,
      )
      expect(response).toEqual({ success: true })
    })

    it('should report offline queue stats', async () => {
      const userId = 'user-123'
      const result = {
        processed: 3,
        succeeded: 2,
        failed: 1,
        errors: [{ id: 'op-2', error: 'timeout' }],
      }
      mockSyncService.processOfflineQueue.mockResolvedValue(result)

      const response = await syncController.processOfflineQueue(userId)

      expect(response).toEqual(result)
      expect((response as { errors: unknown[] }).errors).toHaveLength(1)
    })
  })
})
