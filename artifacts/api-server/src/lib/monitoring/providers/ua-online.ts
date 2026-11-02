import {
  collectConfiguredProject,
  type ProviderConfig,
  type ProviderResult,
} from "../providers";

export function collectUaOnline(config: ProviderConfig): Promise<ProviderResult> {
  return collectConfiguredProject({ ...config, parser: "json" });
}
