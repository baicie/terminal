/**
 * The built-in extension registry: registration, activation, deactivation.
 *
 * Guarantees: nothing runs until enabled; a partial activation rolls back; a
 * deactivation settles every registration it handed out and bumps the generation so
 * a captured callback is refused; one extension's failure lands in `failed` and
 * touches no PTY, SSH session or transfer.
 *
 * It owns no terminal, transfer, credential or layout state, so no code path here
 * could close a session even if an extension asked.
 */

import type { CapabilityGateway, ExtensionCapability } from './capability-gateway'
import {
  ACTIVATION_BUDGET_MS,
  addHandler,
  emptyContributions,
  track,
  withBudget,
  type Contributions,
  type ExtensionContext,
  type ExtensionRecord,
  type ExtensionRegistryOptions,
  type ExtensionCommand,
} from './extension-registry-types'
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
  private readonly factories = new Map<string, (context: ExtensionContext) => Disposable | void>()
  private readonly platform: ExtensionPlatform
  private gateway: CapabilityGateway | null = null

  constructor(private readonly options: ExtensionRegistryOptions = {}) {
    this.platform = options.platform ?? currentExtensionPlatform()
  }

  /**
   * Attach the capability gateway.
   *
   * Separate from the constructor because the gateway needs the *host* — the
   * visible session and the current selection — which does not exist until the
   * terminal does. Attaching later keeps the registry constructible in tests that
   * care only about lifecycle.
   */
  attachGateway(gateway: CapabilityGateway): void {
    this.gateway = gateway
  }

  /**
   * Register a manifest and its activation factory.
   *
   * Refuses on any manifest problem, including a duplicate id — the failure that
   * would otherwise give two extensions one disposable bucket, so deactivating one
   * silently clears the other.
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
   * throw during activation all leave it inactive; a throw additionally disposes
   * whatever it had already registered.
   */
  async enable(extensionId: string): Promise<boolean> {
    const record = this.records.get(extensionId)
    if (!record) return false
    // Already usable: re-enabling must not create a second set of registrations.
    if (record.status === 'active' || record.status === 'activating') return true
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

    const context = this.buildContext(record, generation, contributions, bucket)

    try {
      const returned = await withBudget(
        Promise.resolve().then(() => factory(context)),
        ACTIVATION_BUDGET_MS,
      )
      if (returned) bucket.push(returned)
    } catch (error) {
      await this.rollback(extensionId, bucket)
      // Only mark failed if this activation is still the current one: a deactivate
      // racing an activation must not be overwritten by its outcome.
      if (record.generation === generation) {
        record.status = 'failed'
        record.failure = error instanceof Error ? error.message : String(error)
      }
      this.options.onChanged?.()
      return false
    }

    // A deactivate that landed while the factory was awaiting wins.
    if (record.generation !== generation) {
      await this.rollback(extensionId, bucket)
      return false
    }

    record.status = 'active'
    delete record.failure
    this.options.setEnabled?.(extensionId, true)
    this.options.onChanged?.()
    return true
  }

  /**
   * Turn an extension off and settle everything it handed out.
   *
   * The generation bump happens first, so a callback already in flight finds a stale
   * generation rather than registering into a context being torn down.
   */
  async deactivate(extensionId: string): Promise<void> {
    const record = this.records.get(extensionId)
    if (!record) return
    if (record.status === 'registered' || record.status === 'disabled') return

    record.status = 'deactivating'
    record.generation += 1
    await this.rollback(extensionId, this.disposables.get(extensionId) ?? [])

    this.gateway?.clearApprovalsFor(extensionId)
    record.status = 'disabled'
    this.options.setEnabled?.(extensionId, false)
    this.options.onChanged?.()
  }

  /** Emit a safe event to every active subscriber. A throwing handler is contained. */
  emit(event: SafeEvent): void {
    for (const [extensionId, record] of this.records) {
      if (record.status !== 'active') continue
      const handlers = this.contributions.get(extensionId)?.events.get(event.type)
      if (!handlers) continue
      for (const handler of handlers) {
        try {
          // Not awaited: one slow handler must not delay the others, and the design
          // forbids an extension callback from blocking the shell.
          void Promise.resolve(handler(event)).catch(error => this.fail(extensionId, error))
        } catch (error) {
          this.fail(extensionId, error)
        }
      }
    }
  }

  /** Commands every active extension registered, for the Command Palette. */
  commands(): ExtensionCommand[] {
    const result: ExtensionCommand[] = []
    for (const [extensionId, record] of this.records) {
      if (record.status !== 'active') continue
      for (const [id, command] of this.contributions.get(extensionId)?.commands ?? []) {
        result.push({ extensionId, id, titleKey: command.titleKey, run: command.run })
      }
    }
    return result
  }

  /**
   * Mark an extension failed without going through deactivate.
   *
   * Used when a callback throws: it still holds registrations, and leaving it
   * `active` would keep invoking a handler that just failed.
   */
  private fail(extensionId: string, error: unknown): void {
    const record = this.records.get(extensionId)
    if (!record) return
    record.status = 'failed'
    record.failure = error instanceof Error ? error.message : String(error)
    this.options.onChanged?.()
  }

  private buildContext(
    record: ExtensionRecord,
    generation: number,
    contributions: Contributions,
    bucket: Disposable[],
  ): ExtensionContext {
    return {
      extensionId: record.manifest.id,
      apiVersion: 1,
      subscriptions: bucket,
      commands: {
        register: def => {
          contributions.commands.set(def.id, def)
          return track(bucket, () => contributions.commands.delete(def.id))
        },
      },
      menus: {
        register: def => {
          contributions.menus.push(def)
          return track(bucket, () => {
            const index = contributions.menus.indexOf(def)
            if (index >= 0) contributions.menus.splice(index, 1)
          })
        },
      },
      views: {
        register: def => {
          contributions.views.set(def.id, def)
          return track(bucket, () => contributions.views.delete(def.id))
        },
      },
      events: {
        on: (event, handler) => {
          addHandler(contributions, event, handler)
          return track(bucket, () => {
            contributions.events.get(event)?.delete(handler)
          })
        },
      },
      terminal:
        this.gateway?.terminalContextFor(record.manifest.id, generation) ??
        // No gateway attached: every call fails closed. A no-op would let an
        // extension believe it read something it did not.
        noGatewayTerminal(),
    }
  }

  private async rollback(extensionId: string, bucket: Disposable[]): Promise<void> {
    // Reverse order: a later registration may depend on an earlier one.
    for (const disposable of [...bucket].reverse()) {
      try {
        await disposable.dispose()
      } catch {
        // One failed cleanup must not strand the rest. The extension is going down
        // either way, and leaving the remaining disposables unrun leaks more.
      }
    }
    bucket.length = 0
    this.contributions.delete(extensionId)
    this.disposables.delete(extensionId)
  }
}

/** The terminal context when no gateway is attached: refuse everything. */
function noGatewayTerminal(): ExtensionContext['terminal'] {
  const refuse = async (): Promise<never> => {
    throw new Error('the capability gateway is not attached')
  }
  return { readSelectedText: refuse, requestSendText: refuse }
}
