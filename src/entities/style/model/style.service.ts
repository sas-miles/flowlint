import { getCurrentPreset } from "@/features/linter/model/linter.factory";
import { getPresetById } from "@/presets";
import type { Preset } from "@/features/linter/model/linter.types";

// Declare webflow global
declare const webflow: {
  getAllStyles: () => Promise<Style[]>;
};

interface Style {
  id: string;
  getName: () => Promise<string>;
  getProperties: (options?: { breakpoint: string }) => Promise<any>;
  // Webflow Designer API: style.isComboClass(): Promise<boolean>
  // Optional at type level to allow graceful fallback in non-supporting contexts
  isComboClass?: () => Promise<boolean>;
}

export type ComboDetectionSource = 'api' | 'heuristic' | 'policy';

export interface StyleInfo {
  id: string;
  name: string;
  properties: any;
  order: number;
  // True when Webflow marks this style as a combo class; fallback to name prefix when API unavailable
  isCombo: boolean;
  // Diagnostic field: tracks how combo classification was determined
  comboDetectionSource?: ComboDetectionSource;
}

export interface ElementStyleInfo {
  elementId: string;
  styles: StyleInfo[];
}

export interface StyleWithElement extends StyleInfo {
  elementId: string;
}

/**
 * Detects if a class is a combo class using API-first approach with preset policy support
 */
async function detectComboClass(
  style: Style,
  className: string,
  preset?: Preset
): Promise<{ isCombo: boolean; source: ComboDetectionSource }> {
  const DEBUG = false;
  
  // Existing heuristic logic as fallback
  const heuristicResult = /^(?:is-[A-Za-z0-9]|is_[A-Za-z0-9]|is[A-Z]).*/.test(className);
  
  let apiResult: boolean | null | undefined;
  let hasApiMethod = false;
  
  // Try to get API result if method is available
  if (typeof style.isComboClass === 'function') {
    hasApiMethod = true;
    try {
      apiResult = await style.isComboClass();
      if (DEBUG) console.log(`API result for "${className}": ${apiResult}`);
    } catch (error) {
      if (DEBUG) console.warn(`API error for "${className}":`, error);
      apiResult = null;
    }
  }
  
  // Apply preset policy if defined
  const policy = preset?.comboDetectionPolicy ?? 'api-first';
  
  if (typeof policy === 'function') {
    const result = policy(apiResult, heuristicResult, className);
    return { isCombo: result, source: 'policy' };
  }
  
  switch (policy) {
    case 'api-only':
      // Only use API, return false if unavailable
      return { 
        isCombo: apiResult === true, 
        source: hasApiMethod ? 'api' : 'policy' 
      };
    
    case 'heuristic-only':
      // Always use heuristic, ignore API
      return { isCombo: heuristicResult, source: 'heuristic' };
    
    case 'api-first':
    default:
      // Use API when available and not null/undefined, otherwise fallback to heuristic
      if (apiResult !== null && apiResult !== undefined) {
        return { isCombo: apiResult, source: 'api' };
      }
      return { isCombo: heuristicResult, source: 'heuristic' };
  }
}

// Module-level cache for site-wide styles (memoized for the session)
let cachedAllStylesPromise: Promise<StyleInfo[]> | null = null;
const DEBUG = false;

export const createStyleService = () => {
  const getAllStylesWithProperties = (): Promise<StyleInfo[]> => {
    if (!cachedAllStylesPromise) {
      if (DEBUG) console.log('Fetching ALL styles from the entire Webflow site...');
      cachedAllStylesPromise = (async () => {
        const allStyles = await webflow.getAllStyles();
        if (DEBUG) console.log(`Retrieved ${allStyles.length} styles from webflow.getAllStyles()`);

        if (DEBUG) console.log('Extracting names and properties from all styles...');
        
        // Get current preset for combo detection policy
        let currentPreset: Preset | undefined;
        try {
          const presetId = getCurrentPreset();
          currentPreset = getPresetById(presetId);
        } catch (error) {
          if (DEBUG) console.warn('Could not get current preset:', error);
        }
        
        const allStylesWithProperties = await Promise.all(
          allStyles.map(async (style, index) => {
            try {
              const name = await style.getName();
              let properties = {};
              
              // Use new API-first combo detection
              const comboDetection = await detectComboClass(style, name || "", currentPreset);
              const isCombo = comboDetection.isCombo;
              const comboDetectionSource = comboDetection.source;

              if (name && name.startsWith('u-')) {
                try {
                  properties = await style.getProperties({ breakpoint: 'main' });
                } catch (err) {
                  if (DEBUG) console.error(`Error getting properties for style ${name}:`, err);
                }
              }

              return {
                id: style.id,
                name: name?.trim() || "",
                properties,
                index,
                isCombo,
                comboDetectionSource
              };
            } catch (err) {
              if (DEBUG) console.error(`Error getting name for style at index ${index}, ID ${style.id}:`, err);
              return { 
                id: style.id, 
                name: "", 
                properties: {}, 
                index, 
                isCombo: false,
                comboDetectionSource: 'heuristic' as ComboDetectionSource
              };
            }
          })
        );

        const validStyles = allStylesWithProperties.filter(style => style.name);
        if (DEBUG) console.log(`Found ${validStyles.length} valid styles with names out of ${allStyles.length} total styles`);

        return validStyles.map((style, index) => ({
          ...style,
          order: index
        }));
      })();
    }

    return cachedAllStylesPromise as Promise<StyleInfo[]>;
  };

  const getAppliedStyles = async (element: any): Promise<StyleInfo[]> => {
    if (DEBUG) console.log('Getting styles applied to the selected element...');

    if (!element || typeof element.getStyles !== 'function') {
      console.error('Element does not have getStyles method', element);
      return [];
    }
    
    let appliedStyles: Style[] = [];
    try {
      appliedStyles = await element.getStyles();
      if (DEBUG) console.log(`Retrieved ${appliedStyles?.length || 0} styles applied to the selected element`);
    } catch (err) {
      console.error('Error calling element.getStyles():', err);
      return [];
    }
    
    if (!appliedStyles?.length) {
      return [];
    }

    // Get current preset for combo detection policy
    let currentPreset: Preset | undefined;
    try {
      const presetId = getCurrentPreset();
      currentPreset = getPresetById(presetId);
    } catch (error) {
      if (DEBUG) console.warn('Could not get current preset:', error);
    }

    const seenIds = new Set<string>();
    const uniqueStyles: StyleInfo[] = [];

    if (DEBUG) console.log('Processing applied styles...');
    for (let i = 0; i < appliedStyles.length; i++) {
      try {
        const style = appliedStyles[i];
        const id = style.id;
        const name = await style.getName();
        const trimmedName = name?.trim() || "";
        
        // Use new API-first combo detection
        const comboDetection = await detectComboClass(style, trimmedName, currentPreset);
        const isCombo = comboDetection.isCombo;
        const comboDetectionSource = comboDetection.source;
        
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          
          let properties = {};
          if (trimmedName.startsWith('u-')) {
            try {
              properties = await style.getProperties({ breakpoint: 'main' });
            } catch (err) {
              console.error(`Error getting properties for style ${trimmedName}:`, err);
            }
          }

          uniqueStyles.push({ 
            id, 
            name: trimmedName, 
            properties, 
            order: i, 
            isCombo, 
            comboDetectionSource 
          });
          if (DEBUG) console.log(`Added unique style: ${trimmedName} (ID: ${id}, combo: ${isCombo}, source: ${comboDetectionSource})`);
        }
      } catch (err) {
        console.error(`Error processing applied style at index ${i}:`, err);
      }
    }

    return uniqueStyles;
  };

  // Lightweight helper: only fetch class names for an element (no properties)
  const getAppliedClassNames = async (element: any): Promise<string[]> => {
    if (!element || typeof element.getStyles !== 'function') {
      return [];
    }
    let styles: Style[] = [];
    try {
      styles = await element.getStyles();
    } catch {
      return [];
    }
    if (!styles?.length) return [];

    const seen = new Set<string>();
    const names = await Promise.all(
      styles.map(async (s) => {
        try {
          const n = await s.getName();
          const t = n?.trim() || "";
          return t;
        } catch {
          return "";
        }
      })
    );
    const deduped: string[] = [];
    for (const n of names) {
      if (n && !seen.has(n)) {
        seen.add(n);
        deduped.push(n);
      }
    }
    return deduped;
  };

  const getAppliedStylesWithElementId = async (
    element: any
  ): Promise<StyleWithElement[]> => {
    const styles = await getAppliedStyles(element);
    return styles.map(style => ({
      ...style,
      elementId: element.id
    }));
  };

  const sortStylesByType = (styles: StyleInfo[]): StyleInfo[] => {
    return [...styles].sort((a, b) => {
      const aIsCombo = a.isCombo === true;
      const bIsCombo = b.isCombo === true;
      if (aIsCombo !== bIsCombo) return aIsCombo ? 1 : -1;
      return a.order - b.order;
    });
  };

  return {
    getAllStylesWithProperties,
    getAppliedStyles,
    getAppliedStylesWithElementId,
    sortStylesByType,
    getAppliedClassNames
  } as const;
};

export type StyleService = ReturnType<typeof createStyleService>;

// Optional: allow manual cache reset if the site styles materially change
export function resetStyleServiceCache() {
  cachedAllStylesPromise = null;
}


