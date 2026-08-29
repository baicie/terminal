import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import {
  ConflictCheckDto,
  EnqueueOperationDto,
  PushChangesDto,
  ResolveConflictDto,
  SyncQueryDto,
} from './sync.dto'

describe('Sync DTO validation', () => {
  it('validates and bounds incremental-sync queries', () => {
    expect(
      validateSync(plainToInstance(SyncQueryDto, { since: '1234' })),
    ).toEqual([])
    expect(
      validateSync(plainToInstance(SyncQueryDto, { since: 'invalid' })),
    ).not.toEqual([])
  })

  it('validates nested share fields and caps each sync batch', () => {
    const share = {
      id: 'share-1',
      teamId: 'team-1',
      type: 'HOST',
      data: {},
      permission: 'READONLY',
    }
    expect(
      validateSync(plainToInstance(PushChangesDto, { shares: [share] })),
    ).toEqual([])
    expect(
      validateSync(
        plainToInstance(PushChangesDto, {
          shares: [{ ...share, permission: 'OWNER' }],
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(PushChangesDto, {
          shares: Array.from({ length: 501 }).fill(share),
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(PushChangesDto, {
          shares: [{ ...share, isSensitive: true }],
        }),
      ),
    ).not.toEqual([])
  })

  it('requires local conflict data and bounds conflict batches', () => {
    expect(
      validateSync(
        plainToInstance(ResolveConflictDto, {
          shareId: 'share-1',
          resolution: 'LOCAL',
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(ConflictCheckDto, {
          items: Array.from({ length: 501 }, () => ({
            id: 'share-1',
            updatedAt: 0,
            type: 'HOST',
          })),
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(ResolveConflictDto, {
          shareId: 'share-1',
          resolution: 'LOCAL',
          clientData: { data: {} },
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(ResolveConflictDto, {
          shareId: 'share-1',
          resolution: 'LOCAL',
          clientData: { data: {}, isSensitive: true },
        }),
      ),
    ).not.toEqual([])
  })

  it('requires queue data for create and update operations', () => {
    expect(
      validateSync(
        plainToInstance(EnqueueOperationDto, {
          teamId: 'team-1',
          operation: 'CREATE',
          shareType: 'HOST',
          shareId: 'share-1',
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(EnqueueOperationDto, {
          teamId: 'team-1',
          operation: 'DELETE',
          shareType: 'HOST',
          shareId: 'share-1',
        }),
      ),
    ).toEqual([])

    expect(
      validateSync(
        plainToInstance(EnqueueOperationDto, {
          teamId: 'team-1',
          operation: 'CREATE',
          shareType: 'HOST',
          shareId: 'share-1',
          data: {
            id: 'share-1',
            teamId: 'team-1',
            type: 'HOST',
            data: {},
            permission: 'OWNER',
          },
        }),
      ),
    ).not.toEqual([])
  })
})
