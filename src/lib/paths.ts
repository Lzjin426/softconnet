import { open } from "@tauri-apps/plugin-dialog";

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

export function pathExample(name: string): string {
  return `例如 ${navigator.platform.startsWith("Win") ? `C:\\workspace\\${name}` : `/Users/you/${name}`}`;
}

export function pickPath(directory: boolean): Promise<string | null> {
  return open({ directory, multiple: false }).then((result) =>
    typeof result === "string" ? result : null,
  );
}
