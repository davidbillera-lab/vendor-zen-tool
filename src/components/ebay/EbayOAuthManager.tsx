import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
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
  const [authCode, setAuthCode] = useState("");
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState("");
  const [authUrl, setAuthUrl] = useState("");

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
    setLoading("authUrl");
    try {
      const result = await callOAuth("get_auth_url", {});
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
      });
      if (result.error) {
        toast.error(`${result.error}: ${result.details || ""}`);
        return;
      }
      toast.success("eBay account connected!");
      setAuthCode("");
      setTestResult({
        success: true,
        message: "eBay account connected successfully.",
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
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold text-foreground">eBay OAuth 2.0 Setup</h3>
          <p className="text-sm text-muted-foreground">
            Generate a proper OAuth 2.0 refresh token (not Auth'n'Auth)
          </p>
        </div>
      </div>

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
          <h4 className="font-medium text-foreground">Step 3: Generate New OAuth 2.0 Token</h4>
        </div>
        <p className="text-sm text-muted-foreground">
          If your token is Auth'n'Auth or expired, use this flow to get a proper OAuth 2.0 refresh token.
        </p>

        <div className="space-y-2">
          <Button
            onClick={handleGetAuthUrl}
            disabled={loading === "authUrl"}
            variant="outline"
          >
            {loading === "authUrl" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Get eBay Auth URL
          </Button>
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

      </div>
    </div>
  );
}
