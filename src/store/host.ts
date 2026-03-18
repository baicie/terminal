import { action, makeAutoObservable, runInAction } from "mobx";
import { singleton } from "tsyringe";
import type { Host, Group, AuthType } from "@/types";
import { executeQuery, select } from "@/service/database";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface HostRow {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: string;
  password: string | null;
  private_key: string | null;
  group_id: string | null;
  is_favorite: number;
  color: string | null;
  tags: string | null;
  port_forwards: string | null;
  startup_command: string | null;
  environment: string | null;
  created_at: number;
  updated_at: number;
}

interface GroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  inherit_settings: number;
  settings: string | null;
  order: number;
}

function rowToHost(row: HostRow): Host {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    authType: row.auth_type as AuthType,
    password: row.password ?? undefined,
    privateKey: row.private_key ?? undefined,
    groupId: row.group_id ?? undefined,
    isFavorite: row.is_favorite === 1,
    color: row.color ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    portForwards: row.port_forwards ? JSON.parse(row.port_forwards) : [],
    startupCommand: row.startup_command ?? undefined,
    environment: row.environment ? JSON.parse(row.environment) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    color: row.color ?? undefined,
    inheritSettings: row.inherit_settings === 1,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    order: row.order,
  };
}

@singleton()
export class HostStore {
  hosts: Host[] = [];
  groups: Group[] = [];
  selectedHostId: string | null = null;
  selectedGroupId: string | null = null;
  loading = false;

  constructor() {
    makeAutoObservable(this, {
      loadHosts: action,
      loadGroups: action,
    });
  }

  async loadHosts() {
    this.loading = true;
    try {
      const rows = await select<HostRow>("SELECT * FROM hosts ORDER BY name");
      runInAction(() => {
        this.hosts = rows.map(rowToHost);
      });
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  async loadGroups() {
    const rows = await select<GroupRow>("SELECT * FROM groups ORDER BY \"order\"");
    runInAction(() => {
      this.groups = rows.map(rowToGroup);
    });
  }

  async addHost(host: Omit<Host, "id" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const id = generateId();
    const newHost: Host = {
      ...host,
      id,
      createdAt: now,
      updatedAt: now,
    };

    await executeQuery(
      `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newHost.id,
        newHost.name,
        newHost.hostname,
        newHost.port,
        newHost.username,
        newHost.authType,
        newHost.password ?? null,
        newHost.privateKey ?? null,
        newHost.groupId ?? null,
        newHost.isFavorite ? 1 : 0,
        newHost.color ?? null,
        newHost.tags ? JSON.stringify(newHost.tags) : null,
        JSON.stringify(newHost.portForwards),
        newHost.startupCommand ?? null,
        newHost.environment ? JSON.stringify(newHost.environment) : null,
        newHost.createdAt,
        newHost.updatedAt,
      ]
    );

    runInAction(() => {
      this.hosts.push(newHost);
    });

    return newHost;
  }

  async updateHost(id: string, updates: Partial<Host>) {
    const existing = this.hosts.find((h) => h.id === id);
    if (!existing) return;

    const updated: Host = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, updated_at = ? WHERE id = ?`,
      [
        updated.name,
        updated.hostname,
        updated.port,
        updated.username,
        updated.authType,
        updated.password ?? null,
        updated.privateKey ?? null,
        updated.groupId ?? null,
        updated.isFavorite ? 1 : 0,
        updated.color ?? null,
        updated.tags ? JSON.stringify(updated.tags) : null,
        JSON.stringify(updated.portForwards),
        updated.startupCommand ?? null,
        updated.environment ? JSON.stringify(updated.environment) : null,
        updated.updatedAt,
        id,
      ]
    );

    runInAction(() => {
      const index = this.hosts.findIndex((h) => h.id === id);
      if (index !== -1) {
        this.hosts[index] = updated;
      }
    });
  }

  async deleteHost(id: string) {
    await executeQuery("DELETE FROM hosts WHERE id = ?", [id]);
    runInAction(() => {
      this.hosts = this.hosts.filter((h) => h.id !== id);
    });
  }

  async toggleFavorite(id: string) {
    const host = this.hosts.find((h) => h.id === id);
    if (host) {
      await this.updateHost(id, { isFavorite: !host.isFavorite });
    }
  }

  async addGroup(group: Omit<Group, "id">) {
    const id = generateId();
    const newGroup: Group = { ...group, id };

    await executeQuery(
      `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newGroup.id,
        newGroup.name,
        newGroup.parentId ?? null,
        newGroup.color ?? null,
        newGroup.inheritSettings ? 1 : 0,
        newGroup.settings ? JSON.stringify(newGroup.settings) : null,
        newGroup.order,
      ]
    );

    runInAction(() => {
      this.groups.push(newGroup);
    });

    return newGroup;
  }

  async updateGroup(id: string, updates: Partial<Group>) {
    const existing = this.groups.find((g) => g.id === id);
    if (!existing) return;

    const updated: Group = { ...existing, ...updates };

    await executeQuery(
      `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
      [
        updated.name,
        updated.parentId ?? null,
        updated.color ?? null,
        updated.inheritSettings ? 1 : 0,
        updated.settings ? JSON.stringify(updated.settings) : null,
        updated.order,
        id,
      ]
    );

    runInAction(() => {
      const index = this.groups.findIndex((g) => g.id === id);
      if (index !== -1) {
        this.groups[index] = updated;
      }
    });
  }

  async deleteGroup(id: string) {
    await executeQuery("DELETE FROM groups WHERE id = ?", [id]);
    runInAction(() => {
      this.groups = this.groups.filter((g) => g.id !== id);
    });
  }

  get favoriteHosts() {
    return this.hosts.filter((h) => h.isFavorite);
  }

  getHostsByGroup(groupId: string | null) {
    if (!groupId) {
      return this.hosts.filter((h) => !h.groupId);
    }
    return this.hosts.filter((h) => h.groupId === groupId);
  }

  getGroupChildren(parentId: string | null) {
    return this.groups.filter((g) => g.parentId === parentId);
  }

  get selectedHost() {
    return this.hosts.find((h) => h.id === this.selectedHostId);
  }

  setSelectedHost(id: string | null) {
    this.selectedHostId = id;
  }

  setSelectedGroup(id: string | null) {
    this.selectedGroupId = id;
  }
}
