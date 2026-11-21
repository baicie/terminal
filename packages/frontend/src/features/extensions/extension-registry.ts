/**
 * The built-in extension registry: registration, activation, deactivation.
 *
 * Guarantees: nothing runs until enabled; a partial activation rolls back; a
 * deactivation settles every registration and bumps the generation so a captured
 * callback is refused; one extension's failure touches no PTY, SSH session or
 * transfer. It owns no terminal, transfer, credential or layout state.
 */

import type { CapabilityGateway, ExtensionCapability } from './capability-gateway'
import {
  ACTIVATION_BUDGET_MS,
  emptyContributions,
  buildExtensionContext,
  type Contributions,
  type ExtensionContext,
  type ExtensionRecord,
  type ExtensionRegistryOptions,
  type ExtensionCommand,
  type ExtensionMenuItem,
} from './extension-registry-types'
import { CleanupLedger } from './cleanup-ledger'
import { runActivation } from './run-activation'
import { settleOwnedContributions } from './settle-owned'
import {
  activeCommands,
  activeMenuItems,
  asLedgerMap,
  collectDiagnostics,
  emitToSubscribers,
} from './registry-diagnostics'
import type { RegistryDiagnostics, RegistryLedgerView } from './registry-diagnostics'
import type { Disposable, SafeEvent } from './extension-types'
import {
  currentExtensionPlatform,
  supportsPlatform,
  validateManifest,
  type BuiltInExtensionManifest,
  type ExtensionPlatform,
  type ManifestProblem,
} from './extension-manifest'

export class ExtensionRegistry {
  private readonly records = new Map<string, ExtensionRecord>()
  private readonly contributions = new Map<string, Contributions>()
  private readonly disposables = new Map<string, Disposable[]>()
  /** Disposers that threw during the last settlement of each extension. */
  private readonly cleanupProblems = new CleanupLedger()
  private readonly factories = new Map<string, (context: ExtensionContext) => Disposable | void>()
  private readonly platform: ExtensionPlatform
  private gateway: CapabilityGateway | null = null

  constructor(private readonly options: ExtensionRegistryOptions = {}) {
    this.platform = options.platform ?? currentExtensionPlatform()
  }

  /**
   * Attach the capability gateway.
   *
   * Separate from the constructor because the gateway needs the *host* — the visible
   * session and current selection — which does not exist until the terminal does.
   */
  attachGateway(gateway: CapabilityGateway): void {
    this.gateway = gateway
  }

  /**
   * Register a manifest and its activation factory.
   *
   * Refuses on any manifest problem, including a duplicate id — two extensions sharing
   * one bucket means deactivating one silently clears the other.
   */
  register(
    manifest: BuiltInExtensionManifest,
    factory: (context: ExtensionContext) => Disposable | void,
  ): ManifestProblem | null {
    const problem = validateManifest(manifest)
    if (problem) return problem
    if (this.records.has(manifest.id)) {
      return { rejection: 'duplicate-id', detail: `"${manifest.id}" is already registered` }
    }
    this.records.set(manifest.id, { manifest, status: 'registered', generation: 0 })
    this.factories.set(manifest.id, factory)
    return null
  }

  /** Every registered extension and its state, for a settings page. */
  list(): ExtensionRecord[] {
    return [...this.records.values()].map(record => ({ ...record }))
  }

  get(extensionId: string): ExtensionRecord | undefined {
    const record = this.records.get(extensionId)
    return record ? { ...record } : undefined
  }

  /** The grant the capability gateway checks against. */
  grantFor(extensionId: string) {
    const record = this.records.get(extensionId)
    if (!record) return undefined
    return {
      extensionId: record.manifest.id,
      capabilities: record.manifest.capabilities as readonly ExtensionCapability[],
      generation: record.generation,
      enabled: record.status === 'active' || record.status === 'activating',
      failed: record.status === 'failed',
    }
  }

  /**
   * Turn an extension on.
   *
   * Returns whether it ended up active. A platform mismatch, a missing factory or a
   * throw during activation all leave it inactive; a throw settles what it registered.
   */
  async enable(extensionId: string): Promise<boolean> {
    const record = this.records.get(extensionId)
    if (!record) return false
    // Already usable: re-enabling must not create a second set of registrations.
    if (record.status === 'active') return true
    // A second activation mid-flight would register twice; while stopping it is worse —
    // the in-flight rollback would clear what the second one just registered.
    if (record.status === 'activating' || record.status === 'deactivating') return false
    if (!supportsPlatform(record.manifest, this.platform)) {
      record.status = 'disabled'
      this.options.onChanged?.()
      return false
    }

    const factory = this.factories.get(extensionId)
    if (!factory) return false

    record.status = 'activating'
    record.generation += 1
    const generation = record.generation
    const contributions = emptyContributions()
    this.contributions.set(extensionId, contributions)
    const bucket: Disposable[] = []
    this.disposables.set(extensionId, bucket)

    const context = buildExtensionContext({
      record,
      generation,
      contributions,
      bucket,
      terminal: this.gateway?.terminalContextFor(record.manifest.id, generation),
      // The gate a late factory hits: this activation is current only while the record
      // still points at its generation.
      isCurrent: () => this.records.get(extensionId)?.generation === generation,
    })

    const outcome = await runActivation({
      factory,
      context,
      budgetMs: ACTIVATION_BUDGET_MS,
      generation,
      currentGeneration: () => record.generation,
      retire: () => {
        if (record.generation === generation) record.generation += 1
      },
    })

    if (outcome.kind !== 'activated') {
      await this.rollback(extensionId, bucket, generation)
      if (outcome.kind === 'failed' && record.status === 'activating') {
        record.status = 'failed'
        record.failure =
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
      }
      this.options.onChanged?.()
      return false
    }
    if (outcome.returned) bucket.push(outcome.returned)

    record.status = 'active'
    delete record.failure
    this.options.setEnabled?.(extensionId, true)
    this.options.onChanged?.()
    return true
  }

  /**
   * Turn an extension off and settle everything it handed out.
   *
   * The generation bumps first, so a callback already in flight finds a stale
   * generation rather than registering into a context being torn down.
   */
  async deactivate(extensionId: string): Promise<void> {
    const record = this.records.get(extensionId)
    if (!record) return
    if (record.status === 'registered' || record.status === 'disabled') return
    const retiredGeneration = record.generation
    record.status = 'deactivating'
    record.generation += 1
    await this.rollback(
      extensionId,
      this.disposables.get(extensionId) ?? [],
      retiredGeneration,
    )
    /*
     * The buckets must be dropped here. `rollback` passes a `clear` callback that
     * `settleOwnedContributions` only calls when `currentGeneration() === generation`,
     * and this method bumps the generation *before* calling it — so `clear` never ran
     * and both ledgers kept one bucket per disabled extension forever.
     *
     * Measured: after one enable+deactivate both maps still had size 1, holding the
     * dead activation's disposers and event handlers. Unconditional deletion is correct
     * because this method owns the transition to `disabled`; a concurrent activation
     * creates its own bucket under a fresh generation.
     */
    this.contributions.delete(extensionId)
    this.disposables.delete(extensionId)
    this.gateway?.clearApprovalsFor(extensionId)
    record.status = 'disabled'
    this.options.setEnabled?.(extensionId, false)
    this.options.onChanged?.()
  }

  /** Emit a safe event. The walk lives in `registry-diagnostics.ts`; this supplies `fail`. */
  emit(event: SafeEvent): void {
    emitToSubscribers(this.ledgerView(), event, (extensionId, error, generation) =>
      this.fail(extensionId, error, generation),
    )
  }

  /** What the ledgers hold. See `registry-diagnostics.ts` for what each number means. */
  diagnostics(): RegistryDiagnostics {
    return collectDiagnostics(
      this.ledgerView(),
      this.gateway?.approvalCount?.() ?? 0,
      this.commands().length,
    )
  }

  /** Commands every active extension registered, for the Command Palette. */
  commands(): ExtensionCommand[] {
    return activeCommands(this.ledgerView()) as ExtensionCommand[]
  }

  /** The ledgers, in the shape `registry-diagnostics.ts` reads. */
  private ledgerView(): RegistryLedgerView {
    return {
      records: this.records,
      contributions: asLedgerMap(this.contributions),
      disposables: this.disposables,
    }
  }

  /** Menu entries at `location`. Dead entries are dropped — see `registry-diagnostics.ts`. */
  menusFor(location: string): ExtensionMenuItem[] {
    return activeMenuItems(
      this.ledgerView(),
      location,
    ) as ExtensionMenuItem[]
  }

  /**
   * Mark failed and settle what it still holds.
   *
   * Guarded by generation: a failure from a retired activation must not tear down its
   * successor.
   */
  private fail(extensionId: string, error: unknown, generation?: number): void {
    const record = this.records.get(extensionId)
    if (!record) return
    if (generation !== undefined && record.generation !== generation) return
    record.status = 'failed'
    record.failure = error instanceof Error ? error.message : String(error)
    // Cannot await (the caller may be a sync emitter). `rollback` records failures.
    void this.rollback(extensionId, this.disposables.get(extensionId) ?? [], record.generation)
    this.options.onChanged?.()
  }

  /** Settle one activation's registrations — see `settle-owned.ts` for why by generation. */
  private async rollback(
    extensionId: string,
    bucket: Disposable[],
    generation: number,
  ): Promise<void> {
    const { problems } = await settleOwnedContributions({
      bucket,
      extensionId,
      generation,
      currentGeneration: () => this.records.get(extensionId)?.generation,
      clear: () => {
        this.contributions.delete(extensionId)
        this.disposables.delete(extensionId)
      },
    })
    this.cleanupProblems.record(extensionId, problems)
  }

  /** Cleanup failures from the last settlement, if any. */
  cleanupProblemsFor(extensionId: string): readonly string[] {
    return this.cleanupProblems.get(extensionId)
  }
}