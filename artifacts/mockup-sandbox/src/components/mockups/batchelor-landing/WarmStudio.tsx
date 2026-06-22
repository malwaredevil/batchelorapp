import React from "react";
import { Menu, User, ArrowRight, Search, Settings, Palette } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import "./_group.css";

export function WarmStudio() {
  return (
    <div className="dark">
      <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Batchelor</h1>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium hidden sm:inline-block text-muted-foreground">Jane Batchelor</span>
              <Avatar className="h-9 w-9 border border-border/50">
                <AvatarImage src="https://api.dicebear.com/7.x/notionists/svg?seed=Jane&backgroundColor=1B3A5C" />
                <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12 relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

          <div className="w-full max-w-5xl z-10 flex flex-col gap-12">
            
            {/* Brand Intro */}
            <div className="text-center space-y-4 max-w-2xl mx-auto">
              <Badge variant="outline" className="px-3 py-1 rounded-full border-primary/20 text-primary-foreground bg-primary/10 backdrop-blur-sm mb-2">
                The Maker's Field Guide
              </Badge>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
                Your Studio, Consolidated.
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground">
                One login. Both collections. A quiet place to organize your craft, from clay to cloth.
              </p>
            </div>

            {/* Collection Tiles */}
            <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
              
              {/* Pottery Card */}
              <Card className="group overflow-hidden rounded-2xl border-border/40 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 cursor-pointer flex flex-col">
                <div className="relative h-64 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent z-10" />
                  <img 
                    src="/__mockup/images/pottery-warm.png" 
                    alt="Handmade Pottery" 
                    className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute bottom-4 left-6 z-20">
                    <h3 className="text-3xl font-bold text-foreground">Pottery</h3>
                  </div>
                </div>
                
                <CardContent className="p-6 flex-1 flex flex-col justify-between gap-6">
                  <div className="flex flex-wrap gap-3">
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70">163 pieces</Badge>
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70">12 categories</Badge>
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70">Photo Match</Badge>
                  </div>
                  
                  <p className="text-muted-foreground leading-relaxed">
                    Your complete ceramic catalogue. Track pieces, glazes, and firings in one place.
                  </p>
                  
                  <div className="mt-auto pt-4 flex items-center text-primary font-medium group-hover:translate-x-1 transition-transform">
                    Open collection <ArrowRight className="ml-2 h-4 w-4" />
                  </div>
                </CardContent>
              </Card>

              {/* Quilting Card */}
              <Card className="group overflow-hidden rounded-2xl border-border/40 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 cursor-pointer flex flex-col">
                <div className="relative h-64 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent z-10" />
                  <img 
                    src="/__mockup/images/quilting-warm.png" 
                    alt="Quilting Fabrics" 
                    className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute bottom-4 left-6 z-20">
                    <h3 className="text-3xl font-bold text-foreground">Quilting</h3>
                  </div>
                </div>
                
                <CardContent className="p-6 flex-1 flex flex-col justify-between gap-6">
                  <div className="flex flex-wrap gap-3">
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70">48 fabrics</Badge>
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70">9 patterns</Badge>
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70">5 quilts</Badge>
                  </div>
                  
                  <p className="text-muted-foreground leading-relaxed">
                    Stash management and project planning. From raw yardage to finished heirloom.
                  </p>
                  
                  <div className="mt-auto pt-4 flex items-center text-primary font-medium group-hover:translate-x-1 transition-transform">
                    Open collection <ArrowRight className="ml-2 h-4 w-4" />
                  </div>
                </CardContent>
              </Card>

            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border/30 bg-background/50 py-6 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <span>© {new Date().getFullYear()} Batchelor Studio</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <button className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Search className="h-4 w-4" /> Global Search
              </button>
              <button className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Settings className="h-4 w-4" /> Account
              </button>
              <button className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Palette className="h-4 w-4" /> Theme
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
