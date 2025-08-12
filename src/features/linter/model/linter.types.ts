import type { ElementContextConfig } from "@/entities/element/model/element-context.types";

// Core contracts per docs/guides/unified-plan.md §5

export type ClassKind = "custom" | "utility" | "combo" | "unknown";

export type ElementRole =
  | "componentRoot"
  | "childGroup"
  | "container"
  | "layout"
  | "content"
  | "title"
  | "text"
  | "actions"
  | "button"
  | "link"
  | "icon"
  | "list"
  | "item"
  | "unknown";

export interface ParsedClass {
  raw: string;
  kind: ClassKind;
  type?: string;
  variation?: string;
  elementToken?: string;
  tokens?: string[];
}

export interface GrammarAdapter {
  id: string;
  parse(name: string): ParsedClass;
  isCustomFirstRequired?: boolean;
  utilityPrefix?: string;
  componentPrefix?: string;
  comboPrefix?: string;
}

export interface RoleResolver {
  id: string;
  mapToRole(parsed: ParsedClass): ElementRole;
  isContainerLike?(parsed: ParsedClass): boolean;
}

export interface RuleResultLite {
  id: string;
  message: string;
  severity: "suggestion" | "warning" | "error";
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface RuleLite {
  id: string;
  meta: {
    defaultSeverity: RuleResultLite["severity"];
    description: string;
    context?: string;
  };
  run(ctx: unknown): RuleResultLite[];
}

export type ComboDetectionPolicy = 
  | 'api-first'      // Use API when available, fallback to heuristic (default)
  | 'api-only'       // Use API only, return false if unavailable  
  | 'heuristic-only' // Always use regex heuristic, ignore API
  | ((apiResult: boolean | null | undefined, heuristicResult: boolean, className: string) => boolean); // Custom function

export interface Preset {
  id: string;
  grammar?: GrammarAdapter;
  roles?: RoleResolver;
  rules: import("./rule.types").Rule[];
  /** Optional element-context classifier configuration for this preset */
  contextConfig?: Partial<ElementContextConfig>;
  ruleConfig?: Record<
    string,
    {
      enabled?: boolean;
      severity?: RuleResultLite["severity"];
      options?: Record<string, unknown>;
    }
  >;
  /** Optional combo class detection strategy override */
  comboDetectionPolicy?: ComboDetectionPolicy;
}

export interface ProjectConfig {
  preset: string;
  opinionMode?: "strict" | "balanced" | "lenient";
  overrides?: {
    grammar?: Partial<GrammarAdapter>;
    roleAliases?: Record<string, ElementRole>;
    rules?: Record<
      string,
      {
        enabled?: boolean;
        severity?: RuleResultLite["severity"];
        options?: Record<string, unknown>;
      }
    >;
  };
}


