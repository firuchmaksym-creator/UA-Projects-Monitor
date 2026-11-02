import {
  collectConfiguredProject,
  type ProviderConfig,
  type ProviderResult,
} from "../providers";

export function collectTridentMobile(config: ProviderConfig): Promise<ProviderResult> {
  return collectConfiguredProject({ ...config, parser: "json" });
}
