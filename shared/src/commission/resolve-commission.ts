import { roundHalfUp } from '../money';

export type AttributionSource = 'SELF_SOURCED' | 'ASSIGNED';

export interface CommissionRule {
  id: string;
  scope: 'DEFAULT' | 'TIER' | 'FRANCHISE';
  tierId?: string | null;
  franchiseId?: string | null;
  categoryId?: string | null;
  source: AttributionSource | 'ANY';
  type: 'PERCENT' | 'FLAT';
  /** A percentage for PERCENT; paise for FLAT, paid once per order. */
  value: number;
  maxPerOrderPaise?: number | null;
  priority: number;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  isActive: boolean;
}

export interface CommissionOrderLine {
  categoryId: string;
  /** Line value after its share of the order discount, before GST. */
  taxablePaise: number;
  installationPaise: number;
}

export interface CommissionOrder {
  franchiseId: string;
  tierId?: string | null;
  source: AttributionSource;
  paidAt: Date | string;
  lines: CommissionOrderLine[];
  includeInstallation?: boolean;
}

export interface CommissionLine {
  categoryId: string;
  ruleId: string;
  basePaise: number;
  amountPaise: number;
}

export interface CommissionResult {
  basePaise: number;
  amountPaise: number;
  lines: CommissionLine[];
  appliedRuleIds: string[];
  considered: { id: string; score: number }[];
}

/** More specific rules score higher: franchise over tier over default, then category, then source. */
export function ruleScore(rule: CommissionRule): number {
  const scope = rule.scope === 'FRANCHISE' ? 300 : rule.scope === 'TIER' ? 200 : 100;
  return scope + (rule.categoryId ? 20 : 0) + (rule.source !== 'ANY' ? 10 : 0) + rule.priority;
}

/** Returns null when no active rule applies, e.g. for orders that no franchise brought in. */
export function resolveCommission(order: CommissionOrder, rules: CommissionRule[]): CommissionResult | null {
  const lines: CommissionLine[] = [];
  const considered = new Map<string, number>();
  const flatRulesPaid = new Set<string>();

  for (const line of order.lines) {
    const candidates = rules.filter((rule) => appliesTo(rule, order, line.categoryId));
    for (const rule of candidates) considered.set(rule.id, ruleScore(rule));
    if (candidates.length === 0) continue;

    const rule = candidates.reduce((best, r) => (ruleScore(r) > ruleScore(best) ? r : best));
    const base = Math.max(0, line.taxablePaise - (order.includeInstallation ? 0 : line.installationPaise));

    let amount = 0;
    if (rule.type === 'PERCENT') {
      amount = roundHalfUp((base * rule.value) / 100);
    } else if (!flatRulesPaid.has(rule.id)) {
      amount = rule.value;
      flatRulesPaid.add(rule.id);
    }
    lines.push({ categoryId: line.categoryId, ruleId: rule.id, basePaise: base, amountPaise: amount });
  }

  if (lines.length === 0) return null;

  const appliedRuleIds = [...new Set(lines.map((l) => l.ruleId))];
  const caps = rules
    .filter((r) => appliedRuleIds.includes(r.id) && r.maxPerOrderPaise != null)
    .map((r) => r.maxPerOrderPaise as number);
  const uncapped = lines.reduce((sum, l) => sum + l.amountPaise, 0);

  return {
    basePaise: lines.reduce((sum, l) => sum + l.basePaise, 0),
    amountPaise: caps.length ? Math.min(uncapped, ...caps) : uncapped,
    lines,
    appliedRuleIds,
    considered: [...considered].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score),
  };
}

function appliesTo(rule: CommissionRule, order: CommissionOrder, categoryId: string): boolean {
  if (!rule.isActive) return false;

  const paidAt = new Date(order.paidAt).getTime();
  if (new Date(rule.effectiveFrom).getTime() > paidAt) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < paidAt) return false;

  if (rule.scope === 'FRANCHISE' && rule.franchiseId !== order.franchiseId) return false;
  if (rule.scope === 'TIER' && (!order.tierId || rule.tierId !== order.tierId)) return false;
  if (rule.categoryId && rule.categoryId !== categoryId) return false;
  return rule.source === 'ANY' || rule.source === order.source;
}
