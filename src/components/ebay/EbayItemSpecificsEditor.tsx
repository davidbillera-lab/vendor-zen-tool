import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X, Edit2, Check } from "lucide-react";

interface ItemSpecificsEditorProps {
  itemSpecifics: Record<string, string>;
  onChange: (specifics: Record<string, string>) => void;
}

export function EbayItemSpecificsEditor({ itemSpecifics, onChange }: ItemSpecificsEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange({ ...itemSpecifics, [newKey.trim()]: newValue.trim() });
    setNewKey("");
    setNewValue("");
  };

  const handleRemove = (key: string) => {
    const updated = { ...itemSpecifics };
    delete updated[key];
    onChange(updated);
  };

  const handleEdit = (key: string) => {
    setEditingKey(key);
    setEditValue(itemSpecifics[key]);
  };

  const handleSaveEdit = (key: string) => {
    onChange({ ...itemSpecifics, [key]: editValue });
    setEditingKey(null);
    setEditValue("");
  };

  const entries = Object.entries(itemSpecifics);

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground uppercase">Item Specifics ({entries.length})</Label>
      
      {entries.length > 0 && (
        <div className="grid gap-2 max-h-48 overflow-y-auto">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 bg-secondary/50 rounded px-2 py-1.5 text-sm">
              <span className="font-medium text-foreground min-w-[100px]">{key}:</span>
              {editingKey === key ? (
                <>
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="h-7 flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(key)}
                  />
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleSaveEdit(key)}>
                    <Check className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-muted-foreground truncate">{value || "—"}</span>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(key)}>
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleRemove(key)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Attribute (e.g. Brand)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="Value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!newKey.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
