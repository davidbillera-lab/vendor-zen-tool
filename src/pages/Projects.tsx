import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FolderOpen,
  Plus,
  Search,
  Calendar,
  Package,
  Trash2,
  MoreVertical,
  Clock,
  Users,
  Gavel,
  Store,
  Loader2,
  Layers
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

interface Project {
  id: string;
  name: string;
  consignor_name: string | null;
  consignor_email: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  is_active: boolean;
  lot_count: number;
  platforms: string[];
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newConsignorName, setNewConsignorName] = useState("");
  const [newConsignorEmail, setNewConsignorEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConsignorProject, setEditConsignorProject] = useState<Project | null>(null);
  const [editConsignorName, setEditConsignorName] = useState("");
  const [editConsignorEmail, setEditConsignorEmail] = useState("");
  const [savingConsignor, setSavingConsignor] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('la_batches')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      
      // Fetch counts for each project
      const projectsWithCounts = await Promise.all((data || []).map(async (project) => {
        const [laRows, denverRows, ebayRows] = await Promise.all([
          supabase.from('la_batch_rows').select('id', { count: 'exact' }).eq('batch_id', project.id),
          supabase.from('denver_batch_rows').select('id', { count: 'exact' }).eq('batch_id', project.id),
          supabase.from('ebay_batch_rows').select('id', { count: 'exact' }).eq('batch_id', project.id),
        ]);
        
        const laCount = laRows.count || 0;
        const denverCount = denverRows.count || 0;
        const ebayCount = ebayRows.count || 0;
        
        const platforms: string[] = [];
        if (laCount > 0) platforms.push('liveauctioneers');
        if (denverCount > 0) platforms.push('denver');
        if (ebayCount > 0) platforms.push('ebay');
        
        return {
          ...project,
          lot_count: laCount + denverCount + ebayCount,
          platforms
        };
      }));
      
      setProjects(projectsWithCounts);
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast({ title: "Failed to load projects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

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
          consignor_name: newConsignorName.trim() || null,
          consignor_email: newConsignorEmail.trim() || null,
          created_by: user?.id,
          platforms: []
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Project Created", description: `"${data.name}" is ready` });
      setNewProjectName("");
      setNewConsignorName("");
      setNewConsignorEmail("");
      setDialogOpen(false);
      
      // Navigate to the create listing page with this project
      navigate(`/create-listing?project=${data.id}`);
    } catch (error) {
      console.error('Error creating project:', error);
      toast({ 
        title: "Failed to create project", 
        variant: "destructive" 
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string, projectName: string) => {
    if (!confirm(`Delete "${projectName}" and ALL its data? This cannot be undone.`)) return;

    try {
      const { error } = await supabase
        .from('la_batches')
        .delete()
        .eq('id', projectId);

      if (error) throw error;

      setProjects(prev => prev.filter(p => p.id !== projectId));
      toast({ title: "Project Deleted" });
    } catch (error) {
      console.error('Error deleting project:', error);
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const openEditConsignor = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditConsignorProject(project);
    setEditConsignorName(project.consignor_name || "");
    setEditConsignorEmail(project.consignor_email || "");
  };

  const saveConsignor = async () => {
    if (!editConsignorProject) return;
    setSavingConsignor(true);
    try {
      const { error } = await supabase
        .from('la_batches')
        .update({
          consignor_name: editConsignorName.trim() || null,
          consignor_email: editConsignorEmail.trim() || null,
        })
        .eq('id', editConsignorProject.id);
      if (error) throw error;
      setProjects(prev => prev.map(p =>
        p.id === editConsignorProject.id
          ? { ...p, consignor_name: editConsignorName.trim() || null, consignor_email: editConsignorEmail.trim() || null }
          : p
      ));
      toast({ title: "Consignor updated" });
      setEditConsignorProject(null);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSavingConsignor(false);
    }
  };

  const openProject = (projectId: string) => {
    navigate(`/create-listing?project=${projectId}`);
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'liveauctioneers':
        return <Gavel className="h-3 w-3" />;
      case 'denver':
        return <Gavel className="h-3 w-3" />;
      case 'ebay':
        return <Store className="h-3 w-3" />;
      default:
        return <Package className="h-3 w-3" />;
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'liveauctioneers':
        return 'bg-orange-500/20 text-orange-600';
      case 'denver':
        return 'bg-blue-500/20 text-blue-600';
      case 'ebay':
        return 'bg-yellow-500/20 text-yellow-600';
      default:
        return 'bg-gray-500/20 text-gray-600';
    }
  };

  return (
    <MainLayout title="Projects" subtitle="Manage your listing projects across all platforms">
      <div className="space-y-6">
        {/* Actions */}
        <div className="flex justify-end">
          
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-2" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Project Name</label>
                  <Input
                    placeholder="e.g., January Estate Sale, Antique Collection..."
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createProject()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Consignor Name <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <Input
                    placeholder="e.g., Smith Family Estate"
                    value={newConsignorName}
                    onChange={(e) => setNewConsignorName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Consignor Email <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <Input
                    type="email"
                    placeholder="consignor@email.com"
                    value={newConsignorEmail}
                    onChange={(e) => setNewConsignorEmail(e.target.value)}
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={createProject}
                  disabled={creating || !newProjectName.trim()}
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Create Project
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Projects Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-lg border border-border">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {searchQuery ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery 
                ? 'Try a different search term' 
                : 'Create your first project to start organizing your listings'
              }
            </p>
            {!searchQuery && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => openProject(project.id)}
                className={cn(
                  "group relative bg-card border border-border rounded-xl p-5 cursor-pointer",
                  "hover:border-primary/50 hover:shadow-lg transition-all duration-200",
                  "hover:bg-gradient-to-br hover:from-primary/5 hover:to-transparent"
                )}
              >
                {/* Folder Icon & Name */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <FolderOpen className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                        {project.name}
                      </h3>
                      {project.consignor_name && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {project.consignor_name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(project.updated_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          openProject(project.id);
                        }}
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Open Project
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => openEditConsignor(project, e)}
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Edit Consignor
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteProject(project.id, project.name);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Package className="h-4 w-4" />
                    <span>{project.lot_count} lots</span>
                  </div>
                </div>

                {/* Platforms */}
                {project.platforms.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {project.platforms.map((platform) => (
                      <span
                        key={platform}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                          getPlatformColor(platform)
                        )}
                      >
                        {getPlatformIcon(platform)}
                        {platform === 'liveauctioneers' ? 'LA' : platform}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No platforms yet</p>
                )}

                {/* Bulk Intake shortcut */}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/bulk-intake?project=${project.id}`);
                  }}
                >
                  <Layers className="h-3 w-3" />
                  Bulk Intake
                </Button>

                {/* Hover indicator */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-b-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Consignor Dialog */}
      <Dialog open={!!editConsignorProject} onOpenChange={(open) => !open && setEditConsignorProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Consignor — {editConsignorProject?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Consignor Name</label>
              <Input
                placeholder="e.g., Smith Family Estate"
                value={editConsignorName}
                onChange={(e) => setEditConsignorName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Consignor Email</label>
              <Input
                type="email"
                placeholder="consignor@email.com"
                value={editConsignorEmail}
                onChange={(e) => setEditConsignorEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditConsignorProject(null)}>Cancel</Button>
            <Button onClick={saveConsignor} disabled={savingConsignor}>
              {savingConsignor ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
