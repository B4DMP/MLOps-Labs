import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  fetchGlossaries,
  type GlossaryConfig,
  type GlossarySurface,
} from "../../services/api/glossary";
import { buildGlossaryMatcher, type GlossaryMatcher } from "./glossaryMatcher";

interface GlossaryContextValue {
  /** Every loaded glossary: the MLOps practice, and the world the game is set in. */
  configs: GlossaryConfig[];
  /** The matcher for one surface, compiled over the glossaries that surface has switched on. */
  matcherFor: (surface: GlossarySurface) => GlossaryMatcher;
  /** Whether a given surface should highlight at all, in any glossary. */
  isSurfaceEnabled: (surface: GlossarySurface) => boolean;
  isLoaded: boolean;
}

const FALLBACK_MATCHER = buildGlossaryMatcher(null);
/** Stable identity, so "nothing loaded yet" does not recompile the matchers every render. */
const NO_GLOSSARIES: GlossaryConfig[] = [];

export const GlossaryContext = createContext<GlossaryContextValue>({
  configs: [],
  matcherFor: () => FALLBACK_MATCHER,
  isSurfaceEnabled: () => false,
  isLoaded: false,
});

export const useGlossary = () => useContext(GlossaryContext);

interface GlossaryProviderProps {
  children: React.ReactNode;
  /**
   * Skips the network call and uses this configuration instead. The admin config editor passes
   * the draft being edited so the preview reflects unsaved changes. One config or several.
   */
  overrideConfig?: GlossaryConfig | GlossaryConfig[] | null;
}

/**
 * Loads the glossaries once for the whole app and compiles them into matchers.
 *
 * Failure is silent by design: if they cannot be fetched the game renders exactly as it did
 * before highlighting existed, which is a far better outcome than an error over a chat.
 */
export default function GlossaryProvider({ children, overrideConfig = null }: GlossaryProviderProps) {
  const [fetched, setFetched] = useState<GlossaryConfig[] | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (overrideConfig) {
      setIsLoaded(true);
      return;
    }

    let cancelled = false;

    fetchGlossaries()
      .then((cfgs) => {
        if (!cancelled) setFetched(cfgs);
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

  const override = overrideConfig
    ? Array.isArray(overrideConfig)
      ? overrideConfig
      : [overrideConfig]
    : null;
  const configs = override ?? fetched ?? NO_GLOSSARIES;

  const value = useMemo<GlossaryContextValue>(() => {
    // A matcher per surface, because the two glossaries are switched on in different places and
    // a term of a glossary that is off here must not be matched at all. There are a handful of
    // surfaces and they are compiled on first use, so this stays cheap.
    const cache = new Map<GlossarySurface, GlossaryMatcher>();

    const isSurfaceEnabled = (surface: GlossarySurface) =>
      configs.some((c) => Boolean(c.settings?.enabled && c.settings?.surfaces?.[surface]));

    return {
      configs,
      matcherFor: (surface: GlossarySurface) => {
        const cached = cache.get(surface);
        if (cached) return cached;
        const matcher = buildGlossaryMatcher(configs, surface);
        cache.set(surface, matcher);
        return matcher;
      },
      isSurfaceEnabled,
      isLoaded,
    };
  }, [configs, isLoaded]);

  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>;
}
