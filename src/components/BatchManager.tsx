import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Cloud,
  Plus,
  FolderOpen,
  Loader2,
  Check,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Batch {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  lot_count: number;
  is_active: boolean;
}

interface BatchManagerProps {
  selectedBatchId: string | null;
  onSelectBatch: (batch: Batch | null) => void;
}

export function BatchManager({ selectedBatchId, onSelectBatch }: BatchManagerProps) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchBatches = async () => {
    try {
      const { data, error } = await supabase
        .from('la_batches')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setBatches(data || []);
      
      // Auto-select the most recent active batch if none selected
      if (!selectedBatchId && data && data.length > 0) {
        const activeBatch = data.find(b => b.is_active) || data[0];
        onSelectBatch(activeBatch);
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const createBatch = async () => {
    if (!newBatchName.trim()) {
      toast({ title: "Enter a name", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('la_batches')
        .insert({
          name: newBatchName.trim(),
          created_by: user?.id
        })
        .select()
        .single();

      if (error) throw error;

      setBatches(prev => [data, ...prev]);
      onSelectBatch(data);
      setNewBatchName("");
      setOpen(false);
      toast({ title: "Batch Created", description: `"${data.name}" is ready` });
    } catch (error) {
      console.error('Error creating batch:', error);
      toast({ 
        title: "Failed to create batch", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteBatch = async (batchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this batch and all its lots? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('la_batches')
        .delete()
        .eq('id', batchId);

      if (error) throw error;

      setBatches(prev => prev.filter(b => b.id !== batchId));
      if (selectedBatchId === batchId) {
        onSelectBatch(null);
      }
      toast({ title: "Batch Deleted" });
    } catch (error) {
      console.error('Error deleting batch:', error);
      toast({ 
        title: "Delete failed", 
        variant: "destructive" 
      });
    }
  };

  const selectedBatch = batches.find(b => b.id === selectedBatchId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Cloud className="h-4 w-4" />
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : selectedBatch ? (
            <span className="truncate max-w-[150px]">{selectedBatch.name}</span>
          ) : (
            "Select Batch"
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            Project Batches
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Create New Batch */}
          <div className="flex gap-2">
            <Input
              placeholder="New batch name..."
              value={newBatchName}
              onChange={(e) => setNewBatchName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createBatch()}
            />
            <Button onClick={createBatch} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {/* Batch List */}
          <div className="max-h-[300px] overflow-y-auto space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : batches.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No batches yet</p>
                <p className="text-sm">Create one to get started</p>
              </div>
            ) : (
              batches.map((batch) => (
                <div
                  key={batch.id}
                  onClick={() => {
                    onSelectBatch(batch);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedBatchId === batch.id 
                      ? "border-primary bg-primary/10" 
                      : "border-border hover:border-primary/50 hover:bg-secondary/50"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {selectedBatchId === batch.id && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                      <span className="font-medium truncate">{batch.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {batch.lot_count} lots • Updated {new Date(batch.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => deleteBatch(batch.id, e)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
