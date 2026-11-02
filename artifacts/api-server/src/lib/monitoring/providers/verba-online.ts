import {
  collectConfiguredProject,
  type ProviderConfig,
  type ProviderResult,
} from "../providers";

export function collectVerbaOnline(config: ProviderConfig): Promise<ProviderResult> {
  return collectConfiguredProject({ ...config, parser: "official-html" });
}
