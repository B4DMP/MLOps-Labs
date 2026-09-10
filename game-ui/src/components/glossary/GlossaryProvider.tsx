import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  EMPTY_GLOSSARY,
  fetchGlossary,
  type GlossaryCategory,
  type GlossaryConfig,
  type GlossarySurface,
} from "../../services/api/glossary";
import { buildGlossaryMatcher, type GlossaryMatcher } from "./glossaryMatcher";

interface GlossaryContextValue {
  config: GlossaryConfig;
  matcher: GlossaryMatcher;
  categoryById: (id: string) => GlossaryCategory | undefined;
  /** Whether a given surface should highlight at all. */
  isSurfaceEnabled: (surface: GlossarySurface) => boolean;
  isLoaded: boolean;
}

const FALLBACK_MATCHER = buildGlossaryMatcher(null);

export const GlossaryContext = createContext<GlossaryContextValue>({
  config: EMPTY_GLOSSARY,
  matcher: FALLBACK_MATCHER,
  categoryById: () => undefined,
  isSurfaceEnabled: () => false,
  isLoaded: false,
});

export const useGlossary = () => useContext(GlossaryContext);

interface GlossaryProviderProps {
  children: React.ReactNode;
  /**
   * Skips the network call and uses this configuration instead. The admin config editor passes
   * the draft being edited so the preview reflects unsaved changes.
   */
  overrideConfig?: GlossaryConfig | null;
}

/**
 * Loads the glossary once for the whole app and compiles it into a matcher.
 *
 * Failure is silent by design: if the glossary cannot be fetched the game renders exactly as it
 * did before highlighting existed, which is a far better outcome than an error over a chat.
 */
export default function GlossaryProvider({ children, overrideConfig = null }: GlossaryProviderProps) {
  const [fetched, setFetched] = useState<GlossaryConfig | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (overrideConfig) {
      setIsLoaded(true);
      return;
    }

    let cancelled = false;

    fetchGlossary()
      .then((cfg) => {
        if (!cancelled) setFetched(cfg);
      })
      .catch(() => {
        if (!cancelled) setFetched(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [overrideConfig]);

  const config = overrideConfig ?? fetched ?? EMPTY_GLOSSARY;

  const value = useMemo<GlossaryContextValue>(() => {
    const matcher = buildGlossaryMatcher(config);
    const categories = new Map((config.categories || []).map((c) => [c.id, c]));

    return {
      config,
      matcher,
      categoryById: (id: string) => categories.get(id),
      isSurfaceEnabled: (surface: GlossarySurface) =>
        Boolean(config.settings?.enabled && config.settings?.surfaces?.[surface]),
      isLoaded,
    };
  }, [config, isLoaded]);

  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>;
}
