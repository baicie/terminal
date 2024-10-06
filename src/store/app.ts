import { getConfig } from "@/service/config";
import { action, computed, makeObservable, observable } from "mobx";
import { singleton } from "tsyringe";

@singleton()
export class AppStore {
  @observable
  public config = {};
  @observable
  public theme = "dark";
  @observable
  public language = "en";

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
