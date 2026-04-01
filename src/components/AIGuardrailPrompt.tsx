import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface AIGuardrailPromptProps {
  projectId: string;
  masterPrompt: string;
  onMasterPromptChange: (prompt: string) => void;
}

export function AIGuardrailPrompt({ projectId, masterPrompt, onMasterPromptChange }: AIGuardrailPromptProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(masterPrompt);
  const [saving, setSaving] = useState(false);

  // Sync draft when masterPrompt changes externally
  const handleToggle = () => {
    if (!open) setDraft(masterPrompt);
    setOpen(!open);
  };

  return (
    <div className="border-t border-border pt-3">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <ShieldCheck className="h-4 w-4" />
        AI Guardrail Prompt
        {masterPrompt && <span className="text-xs text-primary">(active)</span>}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Custom instructions injected into every AI call for this project. Use this to keep the AI on track — e.g. "These are all model trains, HO scale, from the 1960s-80s."
          </p>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder='e.g. All items in this project are vintage HO scale model trains. Focus on brand identification (Athearn, Bachmann, Tyco, etc), catalog numbers, and era accuracy.'
            className="min-h-[80px] text-sm"
          />
          <div className="flex gap-2 justify-end">
            {masterPrompt && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  setSaving(true);
                  try {
                    await supabase.from('la_batches').update({ master_prompt: null }).eq('id', projectId);
                    onMasterPromptChange("");
                    setDraft("");
                    toast({ title: "Guardrail prompt cleared" });
                  } catch {
                    toast({ title: "Failed to clear", variant: "destructive" });
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
              >
                Clear
              </Button>
            )}
            <Button
              variant="gold"
              size="sm"
              onClick={async () => {
                if (!draft.trim()) return;
                setSaving(true);
                try {
                  await supabase.from('la_batches').update({ master_prompt: draft.trim() }).eq('id', projectId);
                  onMasterPromptChange(draft.trim());
                  toast({ title: "✅ Guardrail prompt saved", description: "All AI calls for this project will use this prompt" });
                } catch {
                  toast({ title: "Failed to save", variant: "destructive" });
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving || !draft.trim()}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Guardrail"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
