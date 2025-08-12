import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStyleService, resetStyleServiceCache } from '../style.service';
import type { ComboDetectionPolicy } from '@/features/linter/model/linter.types';

// Mock the dependencies
vi.mock('@/features/linter/model/linter.factory', () => ({
  getCurrentPreset: vi.fn(() => 'test-preset')
}));

vi.mock('@/presets', () => ({
  getPresetById: vi.fn((id: string) => {
    if (id === 'api-first-preset') {
      return { id, comboDetectionPolicy: 'api-first' as ComboDetectionPolicy };
    }
    if (id === 'api-only-preset') {
      return { id, comboDetectionPolicy: 'api-only' as ComboDetectionPolicy };
    }
    if (id === 'heuristic-only-preset') {
      return { id, comboDetectionPolicy: 'heuristic-only' as ComboDetectionPolicy };
    }
    if (id === 'custom-policy-preset') {
      return { 
        id, 
        comboDetectionPolicy: (apiResult: boolean | null | undefined, heuristicResult: boolean, className: string) => {
          // Custom logic: only accept API result for classes starting with 'is-api'
          if (className.startsWith('is-api')) return apiResult === true;
          return heuristicResult;
        }
      };
    }
    // Default preset with no policy (should default to api-first)
    return { id };
  })
}));

// Mock the webflow global
const mockWebflow = {
  getAllStyles: vi.fn()
};
global.webflow = mockWebflow;

describe('Style Service Combo Detection', () => {
  const styleService = createStyleService();

  // Clear cache before each test to ensure isolation
  beforeEach(() => {
    resetStyleServiceCache();
    vi.clearAllMocks();
  });

  // Helper to create mock Style objects
  const createMockStyle = (
    id: string, 
    name: string, 
    isComboClassResult?: boolean | null | 'error'
  ) => {
    const style = {
      id,
      getName: vi.fn(() => Promise.resolve(name)),
      getProperties: vi.fn(() => Promise.resolve({}))
    };

    if (isComboClassResult !== undefined) {
      if (isComboClassResult === 'error') {
        style.isComboClass = vi.fn(() => Promise.reject(new Error('API error')));
      } else {
        style.isComboClass = vi.fn(() => Promise.resolve(isComboClassResult));
      }
    }
    // If isComboClassResult is undefined, don't add the method (simulates API not available)

    return style;
  };

  describe('API-first detection (default behavior)', () => {
    it('uses API result when available and not null/undefined', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('api-first-preset');
      
      const comboStyle = createMockStyle('1', 'is-active', true);
      const nonComboStyle = createMockStyle('2', 'is-hidden', false);
      
      mockWebflow.getAllStyles.mockResolvedValue([comboStyle, nonComboStyle]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles).toHaveLength(2);
      expect(styles[0]).toMatchObject({
        name: 'is-active',
        isCombo: true,
        comboDetectionSource: 'api'
      });
      expect(styles[1]).toMatchObject({
        name: 'is-hidden',
        isCombo: false,
        comboDetectionSource: 'api'
      });
    });

    it('falls back to heuristic when API returns null', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('api-first-preset');
      
      const style = createMockStyle('1', 'is-combo', null);
      mockWebflow.getAllStyles.mockResolvedValue([style]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-combo',
        isCombo: true, // heuristic detects this as combo
        comboDetectionSource: 'heuristic'
      });
    });

    it('falls back to heuristic when API method not available', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('api-first-preset');
      
      const style = createMockStyle('1', 'is-visible'); // No isComboClass method
      mockWebflow.getAllStyles.mockResolvedValue([style]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-visible',
        isCombo: true, // heuristic detects this as combo
        comboDetectionSource: 'heuristic'
      });
    });

    it('falls back to heuristic when API throws error', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('api-first-preset');
      
      const style = createMockStyle('1', 'is-error', 'error');
      mockWebflow.getAllStyles.mockResolvedValue([style]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-error',
        isCombo: true, // heuristic detects this as combo
        comboDetectionSource: 'heuristic'
      });
    });
  });

  describe('API-only policy', () => {
    it('only uses API results, returns false when API unavailable', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('api-only-preset');
      
      const styleWithApi = createMockStyle('1', 'is-combo', true);
      const styleNoApi = createMockStyle('2', 'is-other'); // No API method
      
      mockWebflow.getAllStyles.mockResolvedValue([styleWithApi, styleNoApi]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-combo',
        isCombo: true,
        comboDetectionSource: 'api'
      });
      expect(styles[1]).toMatchObject({
        name: 'is-other',
        isCombo: false, // API-only policy returns false when no API
        comboDetectionSource: 'policy'
      });
    });
  });

  describe('Heuristic-only policy', () => {
    it('always uses heuristic, ignores API', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('heuristic-only-preset');
      
      const style = createMockStyle('1', 'is-combo', false); // API says false but heuristic should say true
      mockWebflow.getAllStyles.mockResolvedValue([style]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-combo',
        isCombo: true, // heuristic result, not API
        comboDetectionSource: 'heuristic'
      });
    });
  });

  describe('Custom policy function', () => {
    it('uses custom function for combo detection', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('custom-policy-preset');
      
      const apiStyle = createMockStyle('1', 'is-api-combo', true);
      const heuristicStyle = createMockStyle('2', 'is-normal-combo'); // No API, should use heuristic
      
      mockWebflow.getAllStyles.mockResolvedValue([apiStyle, heuristicStyle]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-api-combo',
        isCombo: true, // Custom policy accepts API result for 'is-api' prefix
        comboDetectionSource: 'policy'
      });
      expect(styles[1]).toMatchObject({
        name: 'is-normal-combo',
        isCombo: true, // Custom policy uses heuristic for non-'is-api' prefix
        comboDetectionSource: 'policy'
      });
    });
  });

  describe('Heuristic pattern matching', () => {
    it('correctly identifies valid combo classes', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('heuristic-only-preset');
      
      const validTestCases = [
        'is-active',
        'is-hidden', 
        'is_visible',
        'isActive',
        'isHidden',
        'is-1234'
      ];

      for (const className of validTestCases) {
        const style = createMockStyle('1', className);
        mockWebflow.getAllStyles.mockResolvedValue([style]);
        
        const styles = await styleService.getAllStylesWithProperties();
        
        expect(styles[0].isCombo).toBe(true);
        expect(styles[0].comboDetectionSource).toBe('heuristic');
      }
    });

    it('correctly identifies non-combo classes', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('heuristic-only-preset');
      
      const invalidTestCases = [
        'is-', // Edge case: just 'is-'
        'is1234', // No dash/underscore, not camelCase
        'component-card',
        'utility-class', 
        'custom-class'
      ];

      for (const className of invalidTestCases) {
        const style = createMockStyle('1', className);
        mockWebflow.getAllStyles.mockResolvedValue([style]);
        
        const styles = await styleService.getAllStylesWithProperties();
        
        expect(styles[0].isCombo).toBe(false);
        expect(styles[0].comboDetectionSource).toBe('heuristic');
      }
    });
  });

  describe('No preset configuration', () => {
    it('defaults to api-first behavior when no preset policy defined', async () => {
      const { getCurrentPreset } = await import('@/features/linter/model/linter.factory');
      
      vi.mocked(getCurrentPreset).mockReturnValue('default-preset');
      
      const style = createMockStyle('1', 'is-combo', true);
      mockWebflow.getAllStyles.mockResolvedValue([style]);
      
      const styles = await styleService.getAllStylesWithProperties();
      
      expect(styles[0]).toMatchObject({
        name: 'is-combo',
        isCombo: true,
        comboDetectionSource: 'api'
      });
    });
  });
});