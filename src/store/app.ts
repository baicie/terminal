import { getConfig } from "@/service/config";
import { getAppSettings } from "@/service/database";
import { makeAutoObservable, runInAction } from "mobx";
import { singleton } from "tsyringe";
import type { Tab, SplitGroup } from "@/types";

type NewTab = Omit<Tab, "id">;

export type AppThemeMode = "light" | "dark" | "system";

@singleton()
export class AppStore {
  config = {};
  theme: AppThemeMode = "dark";
  language = "en";
  tabs: Tab[] = [];
  splitGroups: SplitGroup[] = [];
  activeTabId: string | null = null;
  sidebarVisible = true;

  constructor() {
    makeAutoObservable(this);
  }

  setTheme(theme: AppThemeMode) {
    this.theme = theme;
  }

  setLanguage(language: string) {
    this.language = language;
  }

  /** 从 SQLite 同步主题与语言（启动时调用） */
  async hydrateFromDatabase() {
    try {
      const s = await getAppSettings();
      runInAction(() => {
        this.theme = s.theme;
        this.language = s.language;
      });
    } catch (e) {
      console.error("hydrateFromDatabase failed:", e);
    }
  }

  addTab(tab: NewTab) {
    const id = `${tab.type}-${Date.now()}`;
    const newTab: Tab = { ...tab, id };
    this.tabs.push(newTab);
    this.activeTabId = id;
    return newTab;
  }

  removeTab(id: string) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    // Handle split groups when removing a tab
    const tab = this.tabs[index];
    if (tab.splitId) {
      this.removeTabFromSplit(id);
    }

    this.tabs.splice(index, 1);

    if (this.activeTabId === id) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(index, this.tabs.length - 1);
        this.activeTabId = this.tabs[newIndex].id;
      } else {
        this.activeTabId = null;
      }
    }
  }

  splitTab(id: string, direction: 'horizontal' | 'vertical'): string | null {
    const tabIndex = this.tabs.findIndex((t) => t.id === id);
    if (tabIndex === -1) return null;

    const sourceTab = this.tabs[tabIndex];
    const splitId = sourceTab.splitId || `split-${Date.now()}`;

    // Create new tab for the split
    const newTabId = `${sourceTab.type}-split-${Date.now()}`;
    const newTab: Tab = {
      ...sourceTab,
      id: newTabId,
      splitMode: direction,
      splitId,
      splitChildren: [],
    };

    // Update source tab
    if (!sourceTab.splitId) {
      sourceTab.splitMode = direction;
      sourceTab.splitId = splitId;
      sourceTab.splitChildren = [newTabId];
    } else {
      // Add to existing split group
      sourceTab.splitChildren = [...(sourceTab.splitChildren || []), newTabId];
    }

    // Create or update split group
    const existingGroup = this.splitGroups.find((g) => g.id === splitId);
    if (existingGroup) {
      existingGroup.tabs.push(newTabId);
    } else {
      this.splitGroups.push({
        id: splitId,
        mode: direction,
        tabs: [id, newTabId],
        sizes: [50, 50],
      });
    }

    // Add new tab
    this.tabs.push(newTab);
    this.activeTabId = newTabId;

    return newTabId;
  }

  removeTabFromSplit(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab?.splitId) return;

    const group = this.splitGroups.find((g) => g.id === tab.splitId);
    if (!group) return;

    // Remove tab from group
    group.tabs = group.tabs.filter((id) => id !== tabId);

    // Update remaining tabs in the group
    const remainingTabs = this.tabs.filter((t) => group.tabs.includes(t.id));
    remainingTabs.forEach((t) => {
      t.splitChildren = group.tabs;
      if (group.tabs.length <= 1) {
        t.splitMode = 'none';
        t.splitId = undefined;
        t.splitChildren = undefined;
      }
    });

    // Remove empty group
    if (group.tabs.length <= 1) {
      this.splitGroups = this.splitGroups.filter((g) => g.id !== tab.splitId);
    }
  }

  closeSplit(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab?.splitId) return;

    const group = this.splitGroups.find((g) => g.id === tab.splitId);
    if (!group) return;

    // Close all tabs in the split group
    const tabsToRemove = [...group.tabs];
    tabsToRemove.forEach((id) => {
      const t = this.tabs.find((tab) => tab.id === id);
      if (t) {
        t.splitMode = 'none';
        t.splitId = undefined;
        t.splitChildren = undefined;
      }
    });

    // Remove group
    this.splitGroups = this.splitGroups.filter((g) => g.id !== tab.splitId);
  }

  setActiveTab(id: string) {
    this.activeTabId = id;
  }

  updateTab(id: string, updates: Partial<Tab>) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) {
      Object.assign(tab, updates);
    }
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
  }

  setConfig(config: any) {
    this.config = config;
  }

  async queryConfig() {
    const res = await getConfig();
    runInAction(() => {
      this.config = res;
    });
  }

  get env() {
    return this.config;
  }

  get activeTab() {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  getActiveSplitGroup(): SplitGroup | undefined {
    const tab = this.activeTab;
    if (!tab?.splitId) return undefined;
    return this.splitGroups.find((g) => g.id === tab.splitId);
  }
}
