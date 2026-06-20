import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Home, CheckCircle, Loader2, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function EstateSalesCredentialsCard() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionJson, setSessionJson] = useState("");
  const [hasSession, setHasSession] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_estatesales_credentials" as any)
      // presence only — never pull the session secret into the browser
      .select("estatesales_email, estatesales_storage_state")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmail((data as any).estatesales_email);
          setIsConnected(true);
          setHasSession(!!(data as any).estatesales_storage_state);
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!email || (!isConnected && !password)) {
      toast.error("Enter email and password");
      return;
    }

    const fields: Record<string, string> = { estatesales_email: email.trim() };
    if (password.trim()) fields.estatesales_password = password.trim();

    // Validate the pasted session before saving — guards against the agent's
    // runtime "ES_STORAGE_STATE is not valid session JSON" failure in CI.
    const session = sessionJson.trim();
    if (session) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(session);
      } catch {
        toast.error("Session is not valid JSON — re-copy the full es-session.json contents.");
        return;
      }
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { cookies?: unknown }).cookies)) {
        toast.error("That JSON doesn't look like a Playwright session (missing a 'cookies' array).");
        return;
      }
      fields.estatesales_storage_state = session;
    }

    setIsSaving(true);
    const { error } = await supabase.functions.invoke("save-credentials", {
      body: { platform: "estatesales", fields },
    });
    setIsSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      setIsConnected(true);
      setPassword("");
      if (session) {
        setHasSession(true);
        setSessionJson("");
      }
      toast.success("EstateSales.net credentials saved");
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_estatesales_credentials" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to disconnect: " + error.message);
    } else {
      setEmail("");
      setPassword("");
      setSessionJson("");
      setHasSession(false);
      setIsConnected(false);
      toast.success("EstateSales.net account disconnected");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Home className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">EstateSales.net Account</h3>
          <p className="text-sm text-muted-foreground">
            Used by the EstateSales upload agent to post lots on your behalf.
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
          <Label htmlFor="estatesales_email">EstateSales.net Email</Label>
          <Input
            id="estatesales_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="estatesales_password">EstateSales.net Password</Label>
          <Input
            id="estatesales_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isConnected ? "leave blank to keep current" : "Your EstateSales.net password"}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="estatesales_session">
            EstateSales.net Session{" "}
            <span className="text-xs font-normal text-muted-foreground">(required)</span>
          </Label>
          {hasSession && (
            <span className="inline-flex items-center text-xs text-green-600">
              <CheckCircle className="h-3 w-3 mr-1" /> Session imported
            </span>
          )}
        </div>
        <Textarea
          id="estatesales_session"
          value={sessionJson}
          onChange={(e) => setSessionJson(e.target.value)}
          rows={4}
          className="font-mono text-xs"
          placeholder={
            hasSession
              ? "Session saved — paste new JSON to replace it (e.g. when it expires)."
              : '{ "cookies": [ ... ], "origins": [ ... ] }'
          }
        />
        <p className="text-xs text-muted-foreground">
          EstateSales.net uses Google sign-in, which blocks automated login. The agent
          reuses your captured browser session instead — paste the contents of{" "}
          <code className="text-foreground">es-session.json</code> here.
        </p>

        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={`h-3 w-3 mr-1 transition-transform ${showGuide ? "rotate-180" : ""}`}
          />
          How do I capture my session?
        </button>

        {showGuide && (
          <div className="rounded-md border border-border bg-background/50 p-3 text-xs text-muted-foreground space-y-2">
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Sign in to{" "}
                <code className="text-foreground">estatesales.net</code> in Chrome (the
                normal Google sign-in).
              </li>
              <li>
                Install the <strong>Cookie-Editor</strong> extension, open it on the
                EstateSales tab, and click <strong>Export → JSON</strong>.
              </li>
              <li>
                Run the agent's{" "}
                <code className="text-foreground">convert-cookies.js</code> helper to turn
                that export into Playwright format (produces{" "}
                <code className="text-foreground">es-session.json</code>).
              </li>
              <li>Open that file, copy everything, and paste it above.</li>
            </ol>
            <p>
              The session contains live login cookies — it's encrypted before storage and
              never leaves your account. Re-paste a fresh one whenever uploads start
              failing on the login step.
            </p>
          </div>
        )}
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
