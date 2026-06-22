import "./_group.css";
import { 
  Menu, 
  Search, 
  Plus, 
  Camera, 
  ShoppingBag, 
  ArrowRight, 
  Activity, 
  Settings,
  Palette
} from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AppLauncher() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="text-foreground">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold font-serif text-lg">
              B
            </div>
            <span className="font-semibold text-xl tracking-tight text-primary">Batchelor</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" className="hidden md:flex items-center gap-2 text-muted-foreground border-border">
            <Search className="w-4 h-4" />
            <span>Global search...</span>
            <kbd className="hidden lg:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 ml-2">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
          <div className="flex items-center gap-3 pl-4 border-l border-border">
            <div className="flex flex-col items-end hidden sm:flex">
              <span className="text-sm font-medium leading-none">Jane Batchelor</span>
              <span className="text-xs text-muted-foreground">Maker Account</span>
            </div>
            <Avatar className="h-9 w-9 border border-border">
              <AvatarImage src="https://i.pravatar.cc/150?u=jane" />
              <AvatarFallback className="bg-primary text-primary-foreground">JB</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto p-6 md:p-8 lg:p-12 space-y-10">
        
        {/* Brand Intro & Quick Actions */}
        <div className="flex flex-col lg:flex-row gap-8 justify-between items-start">
          <div className="max-w-2xl space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Welcome back, Jane.</h1>
            <p className="text-lg text-muted-foreground">
              Your maker's field guide. One login, all your collections.
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
            <Button variant="secondary" className="bg-secondary text-secondary-foreground shadow-sm">
              <Camera className="w-4 h-4 mr-2" />
              Do I own this?
            </Button>
            <Button variant="outline" className="shadow-sm">
              <ShoppingBag className="w-4 h-4 mr-2" />
              Shopping List
            </Button>
          </div>
        </div>

        {/* Primary Tiles */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          
          {/* Pottery Tile */}
          <Card className="group overflow-hidden border-border bg-card shadow-sm hover:shadow-md transition-all duration-200 flex flex-col cursor-pointer">
            <div className="h-48 md:h-64 w-full relative overflow-hidden bg-muted">
              <img 
                src="/__mockup/images/pottery-collection.png" 
                alt="Pottery Collection" 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
              <div className="absolute bottom-4 left-6 right-6 flex justify-between items-end">
                <h2 className="text-3xl font-bold text-white tracking-tight">Pottery</h2>
                <Badge className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-md border-0">
                  Updated 2h ago
                </Badge>
              </div>
            </div>
            
            <CardContent className="p-6 flex-1">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="flex flex-col space-y-1 p-3 rounded-lg bg-secondary/50">
                  <span className="text-3xl font-bold text-primary">163</span>
                  <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Pieces</span>
                </div>
                <div className="flex flex-col space-y-1 p-3 rounded-lg bg-secondary/50">
                  <span className="text-3xl font-bold text-primary">12</span>
                  <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Categories</span>
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Your complete catalogue of handmade ceramics. Features AI semantic search and photo comparison tools.
              </p>
            </CardContent>
            
            <CardFooter className="p-6 pt-0 border-t border-border mt-auto bg-muted/20">
              <div className="w-full flex items-center justify-between text-primary font-medium pt-4 group-hover:text-primary/80 transition-colors">
                <span>Open collection</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </div>
            </CardFooter>
          </Card>

          {/* Quilting Tile */}
          <Card className="group overflow-hidden border-border bg-card shadow-sm hover:shadow-md transition-all duration-200 flex flex-col cursor-pointer">
            <div className="h-48 md:h-64 w-full relative overflow-hidden bg-muted">
              <img 
                src="/__mockup/images/quilting-collection.png" 
                alt="Quilting Collection" 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
              <div className="absolute bottom-4 left-6 right-6 flex justify-between items-end">
                <h2 className="text-3xl font-bold text-white tracking-tight">Quilting</h2>
                <Badge className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-md border-0">
                  Updated 1d ago
                </Badge>
              </div>
            </div>
            
            <CardContent className="p-6 flex-1">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="flex flex-col space-y-1 p-3 rounded-lg bg-secondary/50">
                  <span className="text-2xl font-bold text-primary">48</span>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Fabrics</span>
                </div>
                <div className="flex flex-col space-y-1 p-3 rounded-lg bg-secondary/50">
                  <span className="text-2xl font-bold text-primary">9</span>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Patterns</span>
                </div>
                <div className="flex flex-col space-y-1 p-3 rounded-lg bg-secondary/50">
                  <span className="text-2xl font-bold text-primary">5</span>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Quilts</span>
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Manage your fabric stash, organize patterns, plan layouts, and track your finished projects.
              </p>
            </CardContent>
            
            <CardFooter className="p-6 pt-0 border-t border-border mt-auto bg-muted/20">
              <div className="w-full flex items-center justify-between text-primary font-medium pt-4 group-hover:text-primary/80 transition-colors">
                <span>Open collection</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </div>
            </CardFooter>
          </Card>

        </div>

        {/* Recent Activity Strip */}
        <section className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <Activity className="w-5 h-5 text-primary" />
              <h3 className="text-lg">Recent Activity</h3>
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground">View all</Button>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Added 'Speckled Mug'", cat: "Pottery", time: "2 hours ago", color: "bg-orange-100 text-orange-800" },
              { title: "Updated Fabric Stash", cat: "Quilting", time: "Yesterday", color: "bg-blue-100 text-blue-800" },
              { title: "Added 'Large Serving Bowl'", cat: "Pottery", time: "2 days ago", color: "bg-orange-100 text-orange-800" },
              { title: "Completed 'Star Pattern'", cat: "Quilting", time: "Last week", color: "bg-blue-100 text-blue-800" }
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg ${item.color}`}>
                  {item.title.charAt(item.title.indexOf("'") !== -1 ? item.title.indexOf("'")+1 : 0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-medium text-primary">{item.cat}</span>
                    <span className="text-[10px] text-muted-foreground">• {item.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-6 mt-auto">
        <div className="max-w-[1280px] mx-auto px-6 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-sm bg-primary/20 flex items-center justify-center text-primary font-bold font-serif text-[10px]">
              B
            </div>
            <span>Batchelor Collection Manager v2.1.0</span>
          </div>
          
          <div className="flex items-center gap-6">
            <button className="hover:text-foreground transition-colors flex items-center gap-1">
              <Search className="w-3.5 h-3.5" />
              Global Search
            </button>
            <button className="hover:text-foreground transition-colors flex items-center gap-1">
              <Settings className="w-3.5 h-3.5" />
              Account Settings
            </button>
            <button className="hover:text-foreground transition-colors flex items-center gap-1">
              <Palette className="w-3.5 h-3.5" />
              Theme
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
