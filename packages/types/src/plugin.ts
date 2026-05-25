export interface PluginManifest {
  name: string;
  version: string;
  author: string;
  entry: string;
  permissions: string[];
  ui?: {
    widget?: string;
    page?: string;
  };
}

export interface Plugin {
  id: string;
  name: string;
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
}
