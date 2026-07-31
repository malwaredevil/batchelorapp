import { Link, useLocation } from "wouter";
import { ApplicationHeader } from "@workspace/app-shell";
import { ElaineAvatar, ElaineWordmark } from "@workspace/elaine-ui";
import { cn } from "@/lib/utils";
import { getNavItemsByGroup } from "@/features/registry";

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

/**
 * Elaine supplies only its specialized branding and route navigation.
 * Global account, owner, theme, communication, and sign-out behavior comes
 * from the shared application shell used by every Batchelor App SPA.
 */
export function Header() {
  const [location] = useLocation();
  const mainNav = getNavItemsByGroup().main;

  return (
    <ApplicationHeader
      currentAppId="elaine"
      navigationVisibility="always"
      navigationClassName="justify-end gap-3"
      navigation={
        <>
          <div className="hidden items-center gap-2 sm:flex">
            <ElaineAvatar size={28} />
            <ElaineWordmark className="text-lg" />
          </div>
          <nav className="flex items-center gap-1">
            {mainNav.map((item) => {
              const linkClassName = cn(
                "flex items-center gap-2 rounded-full px-2.5 py-2 text-sm font-medium transition-colors md:px-3.5",
                !item.external && isActive(location, item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              );
              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={linkClassName}
                    data-testid={item.testId}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden lg:inline">{item.label}</span>
                  </a>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={linkClassName}
                  data-testid={item.testId}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden lg:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </>
      }
    />
  );
}
