import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function MercariCredentialsCard() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_mercari_credentials" as any)
      .select("mercari_email")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmail((data as any).mercari_email);
          setIsConnected(true);
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!email || (!isConnected && !password)) {
      toast.error("Enter both email and password");
      return;
    }
    setIsSaving(true);
    const fields: Record<string, string> = { mercari_email: email.trim() };
    if (password.trim()) fields.mercari_password = password.trim();
    const { error } = await supabase.functions.invoke("save-credentials", {
      body: { platform: "mercari", fields },
    });
    setIsSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      setIsConnected(true);
      setPassword("");
      toast.success("Mercari credentials saved");
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_mercari_credentials" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to disconnect: " + error.message);
    } else {
      setEmail("");
      setPassword("");
      setIsConnected(false);
      toast.success("Mercari account disconnected");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingBag className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Mercari Account</h3>
          <p className="text-sm text-muted-foreground">
            Listings post to your Mercari account.
          </p>
        </div>
        {isConnected && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="h-3 w-3 mr-1" /> Connected
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mercari_email">Email</Label>
          <Input
            id="mercari_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mercari_password">Password</Label>
          <Input
            id="mercari_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isConnected ? "leave blank to keep current" : "Your Mercari password"}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {isConnected && (
          <Button variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
        <Button variant="gold" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {isConnected ? "Update Credentials" : "Save Credentials"}
        </Button>
      </div>
    </div>
  );
}
