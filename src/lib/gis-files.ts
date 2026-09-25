/** GIS file helpers: detect formats and parse to GeoJSON FeatureCollection. */

import { kml } from "@tmcw/togeojson";
import { readFile } from "@tauri-apps/plugin-fs";
import shp from "shpjs";

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties?: Record<string, unknown> | null;
    geometry?: unknown;
  }>;
};

const GIS_EXT = /\.(geojson|json|kml|kmz|shp|zip)$/i;

export function isGisFileName(name: string): boolean {
  return GIS_EXT.test(name.trim());
}

export function fileStem(name: string): string {
  const base = name.split(/[/\\]/).pop() || name;
  return base.replace(/\.[^.]+$/, "") || base;
}

function fileNameFromPath(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "file";
}

function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[/\\]$/, "")}${sep}${name}`;
}

async function readBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await readFile(path);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function asFeatureCollection(data: unknown): GeoJsonFeatureCollection {
  if (!data || typeof data !== "object") {
    throw new Error("invalid GeoJSON");
  }
  const obj = data as Record<string, unknown>;
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return obj as GeoJsonFeatureCollection;
  }
  if (obj.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [obj as GeoJsonFeatureCollection["features"][number]],
    };
  }
  if (
    typeof obj.type === "string" &&
    ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(
      obj.type,
    )
  ) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: obj }],
    };
  }
  throw new Error("not a GeoJSON Feature/FeatureCollection");
}

async function parseGeoJsonText(text: string): Promise<GeoJsonFeatureCollection> {
  return asFeatureCollection(JSON.parse(text));
}

async function parseKmlBuffer(buf: ArrayBuffer): Promise<GeoJsonFeatureCollection> {
  const text = new TextDecoder().decode(buf);
  const doc = new DOMParser().parseFromString(text, "text/xml");
  return asFeatureCollection(kml(doc));
}

async function parseKmzBuffer(buf: ArrayBuffer): Promise<GeoJsonFeatureCollection> {
  // kmz is zip; shpjs can open zip and returns geojson for shapefiles;
  // for kmz use JSZip-less approach: if shp fails, try decoding as kml only.
  try {
    const geo = await shp(buf);
    if (Array.isArray(geo)) {
      return {
        type: "FeatureCollection",
        features: geo.flatMap((g) => asFeatureCollection(g).features),
      };
    }
    return asFeatureCollection(geo);
  } catch {
    // fall through — plain kmz without shp may need jszip; treat as unsupported
    throw new Error("KMZ 解析失败（请改用 KML，或解压后拖入）");
  }
}

async function parseShapefileZip(buf: ArrayBuffer): Promise<GeoJsonFeatureCollection> {
  const geo = await shp(buf);
  if (Array.isArray(geo)) {
    return {
      type: "FeatureCollection",
      features: geo.flatMap((g) => asFeatureCollection(g).features),
    };
  }
  return asFeatureCollection(geo);
}

async function parseLooseShapefile(shpPath: string): Promise<GeoJsonFeatureCollection> {
  const dir = parentDir(shpPath);
  const stem = fileStem(fileNameFromPath(shpPath));
  const shpBuf = await readBytes(shpPath);
  let dbfBuf: ArrayBuffer | undefined;
  let cpgText: string | undefined;
  try {
    dbfBuf = await readBytes(joinPath(dir, `${stem}.dbf`));
  } catch {
    /* attributes optional */
  }
  try {
    const cpg = await readBytes(joinPath(dir, `${stem}.cpg`));
    cpgText = new TextDecoder().decode(cpg).trim();
  } catch {
    /* optional */
  }

  const geometries = shp.parseShp(shpBuf);
  if (dbfBuf) {
    const parseDbf = shp.parseDbf as unknown as (
      dbf: ArrayBuffer,
      cpg?: string,
    ) => unknown[];
    const properties = parseDbf(dbfBuf, cpgText);
    return asFeatureCollection(
      shp.combine([geometries, properties] as Parameters<typeof shp.combine>[0]),
    );
  }
  return asFeatureCollection({
    type: "FeatureCollection",
    features: (Array.isArray(geometries) ? geometries : []).map((geometry) => ({
      type: "Feature" as const,
      properties: {},
      geometry,
    })),
  });
}

export type ParsedGisLayer = {
  name: string;
  geojson: GeoJsonFeatureCollection;
};

/** Parse GIS content from a browser File (HTML5 drop). */
export async function parseGisFile(file: File): Promise<ParsedGisLayer> {
  const name = file.name;
  const lower = name.toLowerCase();
  const buf = await file.arrayBuffer();
  let geojson: GeoJsonFeatureCollection;
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    geojson = await parseGeoJsonText(new TextDecoder().decode(buf));
  } else if (lower.endsWith(".kml")) {
    geojson = await parseKmlBuffer(buf);
  } else if (lower.endsWith(".kmz")) {
    geojson = await parseKmzBuffer(buf);
  } else if (lower.endsWith(".zip")) {
    geojson = await parseShapefileZip(buf);
  } else if (lower.endsWith(".shp")) {
    throw new Error("单独的 .shp 请从资源管理器拖入（需同目录 .dbf），或打包为 zip");
  } else {
    throw new Error(`不支持的地理格式: ${name}`);
  }
  return { name: fileStem(name), geojson };
}

/**
 * Parse GIS files from OS paths (Tauri drop). Groups shapefile sidecars;
 * skips .dbf/.shx/.prj when a matching .shp is present.
 */
export async function parseGisPaths(paths: string[]): Promise<ParsedGisLayer[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  const skip = new Set<string>();
  const layers: ParsedGisLayer[] = [];
  const errors: string[] = [];

  const byLower = new Map(unique.map((p) => [p.toLowerCase(), p]));

  for (const path of unique) {
    const name = fileNameFromPath(path);
    const lower = name.toLowerCase();
    if (skip.has(path.toLowerCase())) continue;

    if (/\.(dbf|shx|prj|cpg|sbn|sbx|xml)$/i.test(lower)) {
      // sidecar — only used with .shp
      continue;
    }

    try {
      if (lower.endsWith(".shp")) {
        const stem = fileStem(name);
        const dir = parentDir(path);
        for (const ext of ["dbf", "shx", "prj", "cpg", "sbn", "sbx"]) {
          const side = joinPath(dir, `${stem}.${ext}`);
          const found = byLower.get(side.toLowerCase());
          if (found) skip.add(found.toLowerCase());
        }
        const geojson = await parseLooseShapefile(path);
        layers.push({ name: stem, geojson });
      } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
        const text = new TextDecoder().decode(await readBytes(path));
        layers.push({ name: fileStem(name), geojson: await parseGeoJsonText(text) });
      } else if (lower.endsWith(".kml")) {
        layers.push({
          name: fileStem(name),
          geojson: await parseKmlBuffer(await readBytes(path)),
        });
      } else if (lower.endsWith(".kmz") || lower.endsWith(".zip")) {
        const geojson = lower.endsWith(".zip")
          ? await parseShapefileZip(await readBytes(path))
          : await parseKmzBuffer(await readBytes(path));
        layers.push({ name: fileStem(name), geojson });
      } else if (isGisFileName(name)) {
        errors.push(`${name}: 暂不支持`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${message}`);
    }
  }

  if (layers.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return layers;
}

export function partitionDropFiles(files: File[]): { gis: File[]; other: File[] } {
  const gis: File[] = [];
  const other: File[] = [];
  for (const file of files) {
    if (isGisFileName(file.name)) gis.push(file);
    else other.push(file);
  }
  return { gis, other };
}

export function partitionDropPaths(paths: string[]): { gis: string[]; other: string[] } {
  const gis: string[] = [];
  const other: string[] = [];
  for (const path of paths) {
    if (isGisFileName(fileNameFromPath(path))) gis.push(path);
    else other.push(path);
  }
  return { gis, other };
}
