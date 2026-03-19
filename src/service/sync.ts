import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { select } from "@/service/database";

export interface ExportData {
  version: string;
  exportedAt: number;
  hosts: unknown[];
  groups: unknown[];
  snippets: unknown[];
  snippetPackages: unknown[];
  workspaces: unknown[];
  settings: Record<string, unknown>;
}

export interface SyncService {
  exportData(): Promise<ExportData>;
  importData(data: ExportData): Promise<void>;
  exportToFile(): Promise<string | null>;
  importFromFile(): Promise<void>;
}

// Collect all data for export
async function collectExportData(): Promise<ExportData> {
  const [hosts, groups, snippets, snippetPackages] = await Promise.all([
    select("SELECT * FROM hosts"),
    select("SELECT * FROM groups"),
    select("SELECT * FROM snippets"),
    select("SELECT * FROM snippet_packages"),
    select("SELECT * FROM settings"),
  ]);

  return {
    version: "1.0.0",
    exportedAt: Date.now(),
    hosts,
    groups,
    snippets,
    snippetPackages,
    workspaces: [], // TODO: Add workspace support
    settings: {}, // TODO: Add settings export
  };
}

// Export data to a JSON file
export async function exportDataToFile(): Promise<string | null> {
  try {
    const data = await collectExportData();
    const jsonContent = JSON.stringify(data, null, 2);

    const filePath = await save({
      defaultPath: `terminal-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (filePath) {
      await writeTextFile(filePath, jsonContent);
      return filePath;
    }

    return null;
  } catch (error) {
    console.error("Export failed:", error);
    throw error;
  }
}

// Import data from a JSON file
export async function importDataFromFile(content: string, mergeMode: "replace" | "merge" = "merge"): Promise<void> {
  try {
    const data = JSON.parse(content) as ExportData;

    // Validate data structure
    if (!data.version || !data.exportedAt) {
      throw new Error("Invalid export file format");
    }

    // TODO: Implement actual import logic
    // For now, just log what would be imported
    console.log("Would import:", {
      hosts: data.hosts.length,
      groups: data.groups.length,
      snippets: data.snippets.length,
      snippetPackages: data.snippetPackages.length,
      mergeMode,
    });

    // This is a placeholder for the actual import implementation
    // In a real implementation, we would:
    // 1. Parse the JSON data
    // 2. If merge mode, check for duplicates
    // 3. Insert/update records in the database
    // 4. Handle conflicts (e.g., same host name)

  } catch (error) {
    console.error("Import failed:", error);
    throw error;
  }
}

// Generate a preview of what would be imported
export function previewImportData(content: string): ExportData | null {
  try {
    const data = JSON.parse(content) as ExportData;
    return {
      ...data,
      hosts: data.hosts || [],
      groups: data.groups || [],
      snippets: data.snippets || [],
      snippetPackages: data.snippetPackages || [],
      workspaces: data.workspaces || [],
      settings: data.settings || {},
    };
  } catch {
    return null;
  }
}
