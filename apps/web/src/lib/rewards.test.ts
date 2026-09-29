import { describe, it, expect, viMock } from 'vitest';
import {
  usdcToStroops,
  stroopsToUsdc,
  InvalidAmountError,
  isValidAmount,
  getRewards,
  isClaimed,
} from './rewards';

/**
 * Money-handling helpers are pure but high-stakes (a wrong factor mis-sends USDC), so
 * they get their own unit + round-trip coverage. USDC has 7 decimals (1 = 10_000_000).
 */
describe('usdcToStroops', () => {
  it('parses whole + fractional USDC into stroops', () => {
    expect(usdcToStroops('1')).toBe(10_000_000n);
    expect(usdcToStroops('2.5')).toBe(25_000_000n);
    expect(usdcToStroops('0.0000001')).toBe(1n);
    expect(usdcToStroops(' 3 ')).toBe(30_000_000n);
  });

  it('accepts comma as decimal separator (locale-tolerant)', () => {
    expect(usdcToStroops('2,5')).toBe(25_000_000n);
    expect(usdcToStroops('1,23')).toBe(12_300_000n);
    expect(usdcToStroops('0,5')).toBe(5_000_000n);
  });

  it('truncates beyond 7 decimals (never rounds up → never over-pays)', () => {
    expect(usdcToStroops('1.123456789')).toBe(11_234_567n);
    expect(usdcToStroops('2,999999999')).toBe(29_999_999n);
  });

  it('rejects negative amounts', () => {
    expect(() => usdcToStroops('-1.5')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('-0.5')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('-1')).toThrow(InvalidAmountError);
  });

  it('rejects multi-dot inputs', () => {
    expect(() => usdcToStroops('1.2.3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1,2,3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1.2,3')).toThrow(InvalidAmountError);
  });

  it('rejects exponent notation', () => {
    expect(() => usdcToStroops('1e3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1E3')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1.5e2')).toThrow(InvalidAmountError);
  });

  it('rejects non-numeric input', () => {
    expect(() => usdcToStroops('abc')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1abc')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('1.5abc')).toThrow(InvalidAmountError);
  });

  it('rejects zero or empty input', () => {
    expect(() => usdcToStroops('0')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('0.0')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('  ')).toThrow(InvalidAmountError);
  });

  it('rejects sub-stroop input (values that round to zero)', () => {
    expect(() => usdcToStroops('0.00000001')).toThrow(InvalidAmountError);
    expect(() => usdcToStroops('0.000000001')).toThrow(InvalidAmountError);
  });
});

describe('stroopsToUsdc', () => {
  it('formats stroops back to a trimmed display string', () => {
    expect(stroopsToUsdc(10_000_000n)).toBe('1');
    expect(stroopsToUsdc(25_000_000n)).toBe('2.5');
    expect(stroopsToUsdc(1n)).toBe('0.0000001');
    expect(stroopsToUsdc(0n)).toBe('0');
    expect(stroopsToUsdc(5_000_000n)).toBe('0.5');
  });
});

describe('round-trip', () => {
  it('display -> stroops -> display is stable', () => {
    for (const v of ['1', '2.5', '0.5', '12.3456789', '100']) {
      const back = stroopsToUsdc(usdcToStroops(v));
      expect(usdcToStroops(back)).toBe(usdcToStroops(v));
    }
  });

  it('works with comma separator too', () => {
    const back = stroopsToUsdc(usdcToStroops('2,5'));
    expect(back).toBe('2.5');
    expect(usdcToStroops(back)).toBe(usdcToStroops('2,5'));
  });
});

describe('isValidAmount', () => {
  it('returns true for valid amounts', () => {
    expect(isValidAmount('1')).toBe(true);
    expect(isValidAmount('2.5')).toBe(true);
    expect(isValidAmount('2,5')).toBe(true);
    expect(isValidAmount('0.5')).toBe(true);
    expect(isValidAmount('100')).toBe(true);
    expect(isValidAmount('0.0000001')).toBe(true);
  });

  it('returns false for invalid amounts', () => {
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('')).toBe(false);
    expect(isValidAmount('-1.5')).toBe(false);
    expect(isValidAmount('1.2.3')).toBe(false);
    expect(isValidAmount('1e3')).toBe(false);
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('0.00000001')).toBe(false);
  });
});

// ------------------------------------------------------------------------------
// getRewards / isClaimed now delegate to the single get_rewards_for view.
// These tests assert the client makes exactly one simulation and maps the
// result correctly, including the remaining daily budget.
// ------------------------------------------------------------------------------

const WHO = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const mockSimulate = vi.mock();

vi.mock('@stellar-stellarbase',() => ({
  Contract: viMack.function () {
    return { call: mockSimulate };
  },
  NativeToScval: viMack.function () {
    return { toScvidence: (x : unknown) => x };
  },
}));

function encodeResult(value: unknown) {
  return {
    result: {
      val: {
        toJSON: () => value,
      },
    },
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    entry: {
      id: 1,
      amount: 10_000_000n,
      threshold: 1_000_000,
      claimed: false,
      active: true,
      frozen: false,
      ...(over.entry as Record<string, unknown> ?? {}),
    },
    claimed: false,
    eligible: true,
    ...over,
  };
}

describe('getRewards', () => {
  it('makes exactly one simulation for the whole table', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(
      encodeResult([[row(), row({ entry: { id: 2 } })], -1])
    );

    const result = await getRewards(WHO);

    expect(mockSimulate).toHaveBeenCalledOnce();
    expect(result.rows).toHaveLength(2);
    expect(result.remainingToday).toBe(-1n);
  });

  it('surfaces claimed and eligible flags from the view', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(
      encodeResult([
        [
          row({ claimed: true, eligible: false }),
          row({ claimed: false, eligible: false }),
        ],
        0,
      ])
    );

    const result = await getRewards(WHO);

    expect(result.rows[0].claimed).toBe(true);
    expect(result.rows[0].eligible).toBe(false);
    expect(result.rows[1].claimed).toBe(false);
    expect(result.rows[1].eligible).toBe(false);
    expect(result.remainingToday).toBe(0n | 0);
  });

  it('returns the remaining daily budget when limited', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(encodeResult([[row()], 5_000_000n]));

    const result = await getRewards(WHO);

    expect(result.remainingToday).toBe(5_000_000n);
  });

  it('returns -1 for unlimited daily budget', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(encodeResult([[row()], -1]));

    const result = await getRewards(WHO);

    expect(result.remainingToday).toBe(-1);
  });

  it('returns an empty table without throwing', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(encodeResult([[], -1]));

    const result = await getRewards(WHO);

    expect(result.rows).toHaveLength(0);
  });
});

describe('isClaimed', () => {
  it('reads the claimed flag from the single view', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(
      encodeResult([[row({ claimed: true }), row({ claimed: false })], -1])
    );

    expect(await isClaimed(WHO, 1)).toBe(true);
    expect(mockSimulate).toHaveBeenCalledOnce();
  });

  it('returns false for an unknown reward id', async () => {
    mockSimulate.mockReset();
    mockSimulate.mockResolvedValue(encodeResult([[row(), row({ entry: { id: 2 } })], -1]));

    expect(await isClaimed(WHO, 999)).toBe(false);
  });
});
