import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Store,
  Facebook,
  Gavel,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  lot_count: number;
  is_active: boolean;
  platforms: string[];
  master_prompt?: string | null;
}

interface ProjectManagerProps {
  selectedProjectId: string | null;
  onSelectProject: (project: Project | null) => void;
}

const platformIcons: Record<string, React.ReactNode> = {
  liveauctioneers: <Gavel className="h-3 w-3" />,
  denver: <Gavel className="h-3 w-3" />,
  ebay: <Store className="h-3 w-3" />,
  facebook: <Facebook className="h-3 w-3" />,
};

const platformColors: Record<string, string> = {
  liveauctioneers: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  denver: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  ebay: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  facebook: "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

export function ProjectManager({ selectedProjectId, onSelectProject }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('la_batches')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      
      // Fetch counts for each project - include ebay_batch_rows
      const projectsWithCounts = await Promise.all((data || []).map(async (project) => {
        const [laRows, denverRows, ebayRows, listings] = await Promise.all([
          supabase.from('la_batch_rows').select('id', { count: 'exact' }).eq('batch_id', project.id),
          supabase.from('denver_batch_rows').select('id', { count: 'exact' }).eq('batch_id', project.id),
          supabase.from('ebay_batch_rows').select('id', { count: 'exact' }).eq('batch_id', project.id),
          supabase.from('listings').select('id, platform', { count: 'exact' }).eq('project_id', project.id)
        ]);
        
        const laCount = laRows.count || 0;
        const denverCount = denverRows.count || 0;
        const ebayBatchCount = ebayRows.count || 0;
        const fbCount = (listings.data || []).filter(l => l.platform === 'facebook').length;
        
        const platforms: string[] = [];
        if (laCount > 0) platforms.push('liveauctioneers');
        if (denverCount > 0) platforms.push('denver');
        if (ebayBatchCount > 0) platforms.push('ebay');
        if (fbCount > 0) platforms.push('facebook');
        
        return {
          ...project,
          lot_count: laCount + denverCount + ebayBatchCount + fbCount,
          platforms
        };
      }));
      
      setProjects(projectsWithCounts);
      
      // DON'T auto-select - require explicit project selection to prevent data mixing
      // Only update the currently selected project with latest data
      if (selectedProjectId) {
        const updated = projectsWithCounts.find(p => p.id === selectedProjectId);
        if (updated) onSelectProject(updated);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const createProject = async () => {
    if (!newProjectName.trim()) {
      toast({ title: "Enter a project name", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('la_batches')
        .insert({
          name: newProjectName.trim(),
          created_by: user?.id,
          platforms: []
        })
        .select()
        .single();

      if (error) throw error;

      const newProject = { ...data, lot_count: 0, platforms: [] };
      setProjects(prev => [newProject, ...prev]);
      onSelectProject(newProject);
      setNewProjectName("");
      setOpen(false);
      toast({ title: "Project Created", description: `"${data.name}" is ready for all platforms` });
    } catch (error) {
      console.error('Error creating project:', error);
      toast({ 
        title: "Failed to create project", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project and ALL its data across all platforms? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('la_batches')
        .delete()
        .eq('id', projectId);

      if (error) throw error;

      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (selectedProjectId === projectId) {
        onSelectProject(null);
      }
      toast({ title: "Project Deleted" });
    } catch (error) {
      console.error('Error deleting project:', error);
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 h-auto py-2">
          <Cloud className="h-4 w-4 text-primary" />
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : selectedProject ? (
            <div className="flex flex-col items-start">
              <span className="truncate max-w-[120px] font-medium">{selectedProject.name}</span>
              <span className="text-xs text-muted-foreground">{selectedProject.lot_count} items</span>
            </div>
          ) : (
            "Select Project"
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            Projects (All Platforms)
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Important Notice */}
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-sm text-amber-200">
              <strong>Important:</strong> Select the correct project before adding items. 
              Each project keeps data separate to prevent mixing between sales.
            </p>
          </div>
          
          {/* Create New Project - More prominent */}
          <div className="p-4 border-2 border-dashed border-primary/50 rounded-lg bg-primary/5">
            <h4 className="font-medium mb-2 text-sm">Start a New Project</h4>
            <div className="flex gap-2">
              <Input
                placeholder="Project name (e.g., Marina Estate Sale)..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                className="flex-1"
              />
              <Button onClick={createProject} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </Button>
            </div>
          </div>

          {/* Project List */}
          <div className="max-h-[350px] overflow-y-auto space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No projects yet</p>
                <p className="text-sm">Create one to start listing on any platform</p>
              </div>
            ) : (
              projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedProjectId === project.id 
                      ? "border-primary bg-primary/10" 
                      : "border-border hover:border-primary/50 hover:bg-secondary/50"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {selectedProjectId === project.id && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                      <span className="font-medium truncate">{project.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {project.lot_count} items
                      </span>
                      {project.platforms.length > 0 && (
                        <div className="flex gap-1">
                          {project.platforms.map(platform => (
                            <Badge 
                              key={platform} 
                              variant="outline" 
                              className={cn("text-[10px] px-1.5 py-0 h-5 gap-1", platformColors[platform])}
                            >
                              {platformIcons[platform]}
                              {platform === 'liveauctioneers' ? 'LA' : platform === 'facebook' ? 'FB' : platform.charAt(0).toUpperCase() + platform.slice(1)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Updated {new Date(project.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => deleteProject(project.id, e)}
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

// Re-export for backward compatibility
export { ProjectManager as BatchManager };
