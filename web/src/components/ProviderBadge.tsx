import { providerLabel } from "../lib/format";
import type { ProviderId } from "../lib/types";
import { Pill } from "./ui";

export function ProviderBadge({ provider, label }: { provider: ProviderId; label?: string }) {
  return (
    <Pill tone={provider === "claude-code" ? "iris" : "teal"}>
      {label ?? providerLabel(provider)}
    </Pill>
  );
}
