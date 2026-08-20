import type { StrPolicy } from "@/lib/mock/types";
import { StatusChip } from "@/components/primitives/status-chip";

/** yes → gold, negotiable → outline, no → muted red with warning icon. */
export function StrPolicyChip({ policy }: { policy: StrPolicy }) {
  if (policy === "yes") return <StatusChip tone="gold">Yes</StatusChip>;
  if (policy === "negotiable") {
    return <StatusChip tone="outline">Negotiable</StatusChip>;
  }
  return <StatusChip tone="neg">No</StatusChip>;
}
