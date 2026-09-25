import { invoke } from "@tauri-apps/api/core";
import type { GeoJsonFeatureCollection } from "@/lib/gis-files";

export function mapWebviewLabel(tabId: string) {
  return `map-${tabId.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

export type MapAddLayerMessage = {
  type: "addLayer";
  id: string;
  name: string;
  geojson: GeoJsonFeatureCollection;
};

export type MapHostMessage = MapAddLayerMessage;

export async function dispatchToMapWebview(
  tabId: string,
  message: MapHostMessage,
): Promise<void> {
  const label = mapWebviewLabel(tabId);
  // WebView / map page may still be creating — retry longer.
  let lastErr: unknown;
  for (let i = 0; i < 50; i++) {
    try {
      await invoke("map_dispatch", { label, message });
      return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(typeof lastErr === "string" ? lastErr : "map_dispatch failed");
}
