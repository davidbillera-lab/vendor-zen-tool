import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Copy,
  RefreshCw,
  Save,
} from "lucide-react";

interface DiagnoseResult {
  credentials: Record<string, string>;
  required_scopes: string[];
  next_steps: string;
}

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  error_description?: string;
  guidance?: string;
  token_type_hint?: string;
  environment?: string;
}

export function EbayOAuthManager() {
  const { user } = useAuth();
  const [ruName, setRuName] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState("");
  const [authUrl, setAuthUrl] = useState("");

  // Per-user credential fields
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(false);

  // Load existing per-user credentials on mount
  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_ebay_credentials' as any)
      .select('client_id, client_secret, refresh_token')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setClientId((data as any).client_id || "");
          setClientSecret((data as any).client_secret || "");
          setRefreshToken((data as any).refresh_token || "");
          setCredsSaved(true);
        }
      });
  }, [user]);

  const handleSaveCreds = async () => {
    if (!user) return;
    if (!clientId || !clientSecret || !refreshToken) {
      toast.error("Fill in Client ID, Client Secret, and Refresh Token");
      return;
    }
    setLoadingCreds(true);
    const { error } = await supabase
      .from('user_ebay_credentials' as any)
      .upsert({
        user_id: user.id,
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        refresh_token: refreshToken.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    setLoadingCreds(false);
    if (error) {
      toast.error("Failed to save credentials: " + error.message);
    } else {
      setCredsSaved(true);
      toast.success("eBay credentials saved to your account");
    }
  };

  const callOAuth = async (action: string, extra: Record<string, string> = {}) => {
    const { data, error } = await supabase.functions.invoke("ebay-oauth", {
      body: { action, ...extra },
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const handleDiagnose = async () => {
    setLoading("diagnose");
    try {
      const result = await callOAuth("diagnose");
      setDiagnosis(result);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading("");
    }
  };

  const handleTest = async () => {
    setLoading("test");
    try {
      const result = await callOAuth("test_credentials");
      setTestResult(result);
      if (result.success) {
        toast.success("eBay OAuth credentials are valid!");
      } else {
        toast.error(result.guidance || result.error_description || "Test failed");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading("");
    }
  };

  const handleGetAuthUrl = async () => {
    if (!ruName.trim()) {
      toast.error("Enter your RuName (Redirect URL Name) from eBay Developer Portal");
      return;
    }
    setLoading("authUrl");
    try {
      const result = await callOAuth("get_auth_url", {
        redirect_uri: ruName.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setAuthUrl(result.authUrl);
      toast.success("Auth URL generated. Click the link to authorize.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading("");
    }
  };

  const handleExchangeCode = async () => {
    if (!authCode.trim()) {
      toast.error("Paste the authorization code from the redirect URL");
      return;
    }
    setLoading("exchange");
    try {
      const result = await callOAuth("exchange_code", {
        code: authCode.trim(),
        redirect_uri: ruName.trim(),
      });
      if (result.error) {
        toast.error(`${result.error}: ${result.details || ""}`);
        return;
      }
      if (result.refresh_token) {
        setRefreshToken(result.refresh_token);
        setAuthCode(result.refresh_token);
        toast.success("Refresh token received — save it to your account below.");
      }
      setTestResult({
        success: true,
        message: `Refresh token received (${result.refresh_token?.length || 0} chars). Click Save Credentials below.`,
        token_type_hint: "✅ OAuth 2.0 User Token",
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="space-y-6">

      {/* Your Credentials — saves to DB per user */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Your eBay Credentials</h3>
            <p className="text-sm text-muted-foreground">
              Saved to your account — listings push to your eBay store only.
            </p>
          </div>
          {credsSaved && (
            <Badge variant="outline" className="ml-auto text-green-600 border-green-600">
              <CheckCircle className="h-3 w-3 mr-1" /> Saved
            </Badge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="client_id">Client ID (App ID)</Label>
            <Input
              id="client_id"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              placeholder="YourApp-xxxx-PRD-xxxxxxx"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client_secret">Client Secret (Cert ID)</Label>
            <Input
              id="client_secret"
              type="password"
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              placeholder="PRD-xxxxxxxx"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="refresh_token_field">Refresh Token</Label>
          <div className="flex gap-2">
            <Input
              id="refresh_token_field"
              type="password"
              value={refreshToken}
              onChange={e => setRefreshToken(e.target.value)}
              placeholder="Paste your OAuth 2.0 refresh token (use Step 3 below to generate one)"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="gold" onClick={handleSaveCreds} disabled={loadingCreds}>
            {loadingCreds ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Credentials
          </Button>
        </div>
      </div>

      <Separator />

      {/* Step 1: Diagnose */}
      <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-foreground">Step 1: Diagnose Current Credentials</h4>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiagnose}
            disabled={loading === "diagnose"}
          >
            {loading === "diagnose" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Diagnose
          </Button>
        </div>

        {diagnosis && (
          <div className="space-y-2 text-sm">
            {Object.entries(diagnosis.credentials).map(([key, value]) => (
              <div key={key} className="flex justify-between items-center">
                <span className="text-muted-foreground font-mono">{key}</span>
                <span className={value.includes("❌") ? "text-destructive" : value.includes("⚠️") ? "text-warning" : "text-success"}>
                  {value}
                </span>
              </div>
            ))}
            <Separator />
            <p className="text-muted-foreground">{diagnosis.next_steps}</p>
          </div>
        )}
      </div>

      {/* Step 2: Test existing credentials */}
      <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-foreground">Step 2: Test Stored Credentials</h4>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={loading === "test"}
          >
            {loading === "test" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            Test Credentials
          </Button>
        </div>

        {testResult && (
          <div className={`rounded-md p-3 text-sm ${testResult.success ? "bg-success/10 border border-success/30" : "bg-destructive/10 border border-destructive/30"}`}>
            <div className="flex items-start gap-2">
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 text-success mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="font-medium">{testResult.message || testResult.error_description}</p>
                {testResult.guidance && (
                  <p className="text-muted-foreground">{testResult.guidance}</p>
                )}
                {testResult.token_type_hint && (
                  <Badge variant={testResult.token_type_hint.includes("Auth'n'Auth") ? "destructive" : "outline"}>
                    {testResult.token_type_hint}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step 3: OAuth Consent Flow */}
      <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <h4 className="font-medium text-foreground">Step 3: Generate New OAuth 2.0 Refresh Token</h4>
        </div>
        <p className="text-sm text-muted-foreground">
          Use this to generate a fresh refresh token. After exchange, paste it into the Refresh Token field above and save.
        </p>

        <div className="space-y-2">
          <Label htmlFor="runame">RuName (Redirect URL Name from eBay Developer Portal)</Label>
          <div className="flex gap-2">
            <Input
              id="runame"
              placeholder="e.g. Your_App_Name-YourNam-SBX-abc123-defg"
              value={ruName}
              onChange={(e) => setRuName(e.target.value)}
            />
            <Button
              onClick={handleGetAuthUrl}
              disabled={loading === "authUrl"}
              variant="outline"
            >
              {loading === "authUrl" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get URL"}
            </Button>
          </div>
        </div>

        {authUrl && (
          <div className="space-y-2">
            <Label>Authorization URL (open in browser, sign in, authorize)</Label>
            <div className="flex gap-2">
              <Input value={authUrl} readOnly className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(authUrl);
                  toast.success("Copied to clipboard");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => window.open(authUrl, "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              After authorizing, eBay will redirect you. Copy the <code>code=</code> parameter from the redirect URL.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="authcode">Authorization Code (from redirect URL)</Label>
          <div className="flex gap-2">
            <Input
              id="authcode"
              placeholder="Paste the code= parameter here"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              onClick={handleExchangeCode}
              disabled={loading === "exchange" || !authCode}
            >
              {loading === "exchange" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Exchange
            </Button>
          </div>
        </div>

        {authCode && authCode.length > 100 && (
          <div className="rounded-md bg-success/10 border border-success/30 p-3 text-sm">
            <p className="font-medium text-success flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Refresh token ready — it's been pre-filled above. Click Save Credentials.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
