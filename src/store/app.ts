import { getConfig } from "@/service/config";
import { action, computed, makeObservable, observable } from "mobx";
import { singleton } from "tsyringe";

interface BTab {
  label: string;
  type: "local" | "remote";
  key?: string;
}

@singleton()
export class AppStore {
  @observable
  public config = {};
  @observable
  public theme = "dark";
  @observable
  public language = "en";
  @observable
  public tabs: BTab[] = [];

  @action
  public addTab(tab: BTab) {
    this.tabs.push({
      ...tab,
      key: `${tab.type}-${this.tabs.length}`,
    });
  }

  @action
  public setConfig(config: any) {
    this.config = config;
  }

  @action
  public async queryConfig() {
    const res = await getConfig();
    this.config = res;
  }

  @computed
  get env() {
    return this.config;
  }

  constructor() {
    makeObservable(this);
  }
}
