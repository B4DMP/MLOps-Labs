import { describe, expect, it } from 'vitest';
import { colorForStakeholderId, OPEN_PEEPS_CLOTHING_PALETTE } from './StakeholderAvatar';

describe('colorForStakeholderId', () => {
  it('always returns a color from the palette', () => {
    for (const id of ['data_dave', 'model_monica', 'requirements_reuben', 'x', '']) {
      expect(OPEN_PEEPS_CLOTHING_PALETTE).toContain(colorForStakeholderId(id));
    }
  });

  it('is deterministic for the same id', () => {
    expect(colorForStakeholderId('data_dave')).toBe(colorForStakeholderId('data_dave'));
  });

  it('gives different stakeholders different colors more often than not', () => {
    const ids = ['data_dave', 'model_monica', 'requirements_reuben', 'efficiency_emilia', 'automation_alex', 'reliability_ruth'];
    const colors = new Set(ids.map(colorForStakeholderId));
    expect(colors.size).toBeGreaterThan(1);
  });
});
