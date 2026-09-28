import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface UnavailableFeature {
  title: string;
  /** One plain sentence: what it would do, or what to use instead today. */
  description: string;
}

/**
 * An honest list of what this module cannot do YET.
 *
 * Used instead of fake buttons or empty "coming soon" pages: the shopkeeper
 * sees what is missing and, where there is one, what to use today. These
 * features have no backend behind them, so nothing here is clickable.
 */
export function NotAvailable({
  features,
  title = "Not available yet",
  className,
}: {
  features: UnavailableFeature[];
  title?: string;
  className?: string;
}) {
  if (features.length === 0) return null;
  return (
    <Card className={cn("border-dashed bg-muted/30 shadow-none", className)} data-print-hide>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature.title} className="min-w-0">
              <p className="text-sm font-medium text-foreground">{feature.title}</p>
              <p className="text-xs text-muted-foreground">{feature.description}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
