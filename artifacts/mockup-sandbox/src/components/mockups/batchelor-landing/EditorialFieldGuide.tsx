import React from "react";
import "./_group.css";
import { Menu, User, Search, Settings, Moon, ArrowRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function EditorialFieldGuide() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-border/40">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-5 h-5" />
            <span className="sr-only">Menu</span>
          </Button>
          <span className="font-serif text-xl tracking-wide text-primary">
            Batchelor
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground hidden sm:inline-block">
            Jane Batchelor
          </span>
          <Avatar className="w-9 h-9 border border-border/50">
            <AvatarFallback className="bg-primary/5 text-primary text-xs">
              JB
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-16 md:py-24">
        {/* Brand / Hero */}
        <div className="max-w-2xl mb-16 md:mb-24">
          <h2 className="text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase mb-6">
            A Maker's Field Guide
          </h2>
          <h1 className="text-4xl md:text-6xl font-serif leading-tight tracking-tight text-primary mb-6">
            Two distinct collections.
            <br />
            One unified view.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-xl">
            A consolidated index of your craft. Document your pottery inventory,
            catalogue your quilting fabrics, and plan your next projects with
            quiet confidence.
          </p>
        </div>

        {/* Collections (Plates) */}
        <div className="grid md:grid-cols-2 gap-12 lg:gap-16">
          {/* Plate I: Pottery */}
          <div className="group relative cursor-pointer block">
            <div className="flex items-center justify-between border-b border-primary/20 pb-4 mb-6">
              <span className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
                Plate I
              </span>
              <span className="text-xs font-semibold tracking-[0.15em] text-primary uppercase">
                Ceramics
              </span>
            </div>

            <div className="relative aspect-[4/3] overflow-hidden rounded-sm mb-8 bg-muted">
              <img
                src="/__mockup/images/pottery-editorial.png"
                alt="Handmade ceramic pottery"
                className="object-cover w-full h-full transition-transform duration-700 ease-out group-hover:scale-105"
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-3xl font-serif text-primary">Pottery</h3>
              <p className="text-muted-foreground leading-relaxed">
                A maker's catalogue of finished pieces, glazes, and firing
                notes. Search visually or by semantic tags.
              </p>

              <div className="flex items-center gap-4 py-4">
                <div className="flex flex-col">
                  <span className="text-2xl font-serif text-primary">163</span>
                  <span className="text-xs tracking-wider text-muted-foreground uppercase">
                    Pieces
                  </span>
                </div>
                <div className="w-px h-8 bg-border"></div>
                <div className="flex flex-col">
                  <span className="text-2xl font-serif text-primary">12</span>
                  <span className="text-xs tracking-wider text-muted-foreground uppercase">
                    Categories
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center text-primary font-medium tracking-wide">
                <span>Open collection</span>
                <ArrowRight className="w-4 h-4 ml-2 transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            </div>
          </div>

          {/* Plate II: Quilting */}
          <div className="group relative cursor-pointer block">
            <div className="flex items-center justify-between border-b border-primary/20 pb-4 mb-6">
              <span className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
                Plate II
              </span>
              <span className="text-xs font-semibold tracking-[0.15em] text-primary uppercase">
                Textiles
              </span>
            </div>

            <div className="relative aspect-[4/3] overflow-hidden rounded-sm mb-8 bg-muted">
              <img
                src="/__mockup/images/quilting-editorial.png"
                alt="Quilting fabrics and patterns"
                className="object-cover w-full h-full transition-transform duration-700 ease-out group-hover:scale-105"
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-3xl font-serif text-primary">Quilting</h3>
              <p className="text-muted-foreground leading-relaxed">
                An inventory of fabrics, ongoing patterns, and finished quilts.
                Plan your layouts and manage shopping lists.
              </p>

              <div className="flex items-center gap-4 py-4">
                <div className="flex flex-col">
                  <span className="text-2xl font-serif text-primary">48</span>
                  <span className="text-xs tracking-wider text-muted-foreground uppercase">
                    Fabrics
                  </span>
                </div>
                <div className="w-px h-8 bg-border"></div>
                <div className="flex flex-col">
                  <span className="text-2xl font-serif text-primary">9</span>
                  <span className="text-xs tracking-wider text-muted-foreground uppercase">
                    Patterns
                  </span>
                </div>
                <div className="w-px h-8 bg-border hidden sm:block"></div>
                <div className="flex flex-col hidden sm:flex">
                  <span className="text-2xl font-serif text-primary">5</span>
                  <span className="text-xs tracking-wider text-muted-foreground uppercase">
                    Quilts
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center text-primary font-medium tracking-wide">
                <span>Open collection</span>
                <ArrowRight className="w-4 h-4 ml-2 transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 mt-12 bg-muted/30">
        <div className="max-w-6xl mx-auto px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground tracking-wide flex items-center gap-2">
            <span className="font-serif italic text-primary">Batchelor</span>{" "}
            &copy; {new Date().getFullYear()}
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <button className="flex items-center gap-2 hover:text-primary transition-colors">
              <Search className="w-4 h-4" />
              <span>Global Search</span>
            </button>
            <button className="flex items-center gap-2 hover:text-primary transition-colors">
              <Settings className="w-4 h-4" />
              <span>Account</span>
            </button>
            <button className="flex items-center gap-2 hover:text-primary transition-colors">
              <Moon className="w-4 h-4" />
              <span>Theme</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
