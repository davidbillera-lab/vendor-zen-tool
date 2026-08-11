import { Check, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DoaVerifyResult } from "@/lib/doa/verifyLot";

interface DoaVerifyDialogProps {
  result: DoaVerifyResult | null;
  lotLabel: string;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Review step for DOA AI Verify — mirrors the eBay verification dialog so both
 * platforms behave the same: read the audit, then Accept or Reject. Corrections
 * are never applied silently.
 *
 * A dialog (not an inline panel) is deliberate: on mobile an inline report grew
 * the editor body and pushed Save/Cancel off screen, leaving no way out but
 * backing out of the project and losing the edits.
 */
export function DoaVerifyDialog({ result, lotLabel, onAccept, onReject }: DoaVerifyDialogProps) {
  const changes = result ? Object.keys(result.corrected) : [];

  return (
    <Dialog open={!!result} onOpenChange={(open) => { if (!open) onReject(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {result?.passed ? (
              <Check className="h-5 w-5 text-green-500 shrink-0" />
            ) : (
              <Eye className="h-5 w-5 text-yellow-500 shrink-0" />
            )}
            <span className="truncate">AI Verification — {lotLabel}</span>
          </DialogTitle>
        </DialogHeader>

        <div
          className={cn(
            "rounded-lg p-3 text-sm border",
            result?.passed
              ? "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300"
              : "bg-yellow-500/10 border-yellow-500/40 text-yellow-700 dark:text-yellow-300",
          )}
        >
          <p className="leading-snug whitespace-pre-wrap">
            {result?.report || "No report returned."}
          </p>
        </div>

        {changes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Accepting will change: <span className="font-medium text-foreground">{changes.join(", ")}</span>
          </p>
        )}

        {/* Stacked on small screens so neither button is ever off-screen. */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onReject} className="w-full sm:w-auto">
            Reject
          </Button>
          <Button variant="gold" onClick={onAccept} className="w-full sm:w-auto">
            <Check className="h-4 w-4 mr-1" />
            Accept Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
