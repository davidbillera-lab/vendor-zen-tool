import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import Inventory from "./pages/Inventory";
import CreateListing from "./pages/CreateListing";
import Orders from "./pages/Orders";
import Platforms from "./pages/Platforms";
import Settings from "./pages/Settings";
import DenverBatches from "./pages/DenverBatches";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { AIChatPanel } from "@/components/AIChatPanel";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/create-listing" element={<ProtectedRoute><CreateListing /></ProtectedRoute>} />
            <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
            <Route path="/platforms" element={<ProtectedRoute><Platforms /></ProtectedRoute>} />
            <Route path="/denver-batches" element={<ProtectedRoute><DenverBatches /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <AIChatPanel />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
