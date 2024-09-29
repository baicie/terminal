import { axios } from "@/utils/axios";
import Database from "@tauri-apps/plugin-sql";

export function getConfig() {
  return axios.get("/config");
}

const db = Database.get("sqlite:test.db");
