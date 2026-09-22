import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { Container } from "./section-heading";
import { CTA, LEGAL_LINKS, NAV_LINKS, SITE } from "./site-config";

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            {link.href.includes("#") ? (
              <a
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/70 bg-muted/30">
      <Container className="py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            <BrandMark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {SITE.description}
            </p>
          </div>

          <FooterColumn title="Product" links={NAV_LINKS} />
          <FooterColumn
            title="Account"
            links={[
              { label: "Login", href: CTA.login },
              { label: "Get Started", href: CTA.getStarted },
            ]}
          />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border/70 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {SITE.brand}. All rights reserved.
          </p>
          <p>Made for shop owners and small businesses.</p>
        </div>
      </Container>
    </footer>
  );
}
