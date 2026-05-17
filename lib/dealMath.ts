/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * EXTENDED — now supports all deal types end-to-end:
 *
 *   1. flat                 — $X guaranteed, optional sellout bonus
 *   2. percentage_of_gross  — X% of gross, no expense deductions
 *   3. vs                   — guarantee vs % of net (standard, walkout,
 *                             ratchet, and vs-gross variants)
 *   4. percentage_of_net    — % of net after capped expenses, no guarantee
 *   5. door                 — artist gets door minus capped expenses
 *
 * Every calculation returns a full audit trail: every input used, every
 * decision made, every bonus evaluated (triggered or not). The tour manager
 * should be able to follow the math line by line without a separate spreadsheet.
 */

import type { Deal, Expense, TicketSale, Bonus } from "@/db/schema";

// ─── Result types ──────────────────────────────────────────────────────────

export type AuditStep = {
  label: string;
  value: number;
  note?: string;
  isSubtotal?: boolean;
  isDeduction?: boolean;
};

export type BonusEval = {
  label: string;
  amount: number;
  triggered: boolean;
  reason: string;
};

export type VsDealFlavor = "standard" | "walkout" | "ratchet" | "vs_gross";

export type SettlementCalculation =
  | {
      supported: true;
      dealType: Deal["dealType"];
      flavor?: VsDealFlavor;

      // Key inputs (for the audit header)
      grossBoxOffice: number;
      netBoxOffice: number;
      totalFees: number;
      totalExpenses: number;
      expenseCap: number | null;
      cappedExpenses: number;

      // The answer
      totalToArtist: number;

      // The full audit trail — every line of math
      steps: AuditStep[];

      // Human-readable formula summary
      finalFormula: string;

      // Bonus evaluation (all bonuses, triggered or not)
      bonusesApplied: BonusEval[];
      bonusesNotTriggered: BonusEval[];

      // For Vs deals: which path won?
      vsGuarantee?: number;
      vsPercentagePayout?: number;
      vsWinner?: "guarantee" | "percentage";
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
    };

// ─── Inputs ────────────────────────────────────────────────────────────────

interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  venueCapacity?: number;
  ticketsSold?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function capExpenses(totalExpenses: number, cap: number | null): number {
  if (cap == null) return totalExpenses;
  return Math.min(totalExpenses, cap);
}

function evaluateBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number }
): { applied: BonusEval[]; notTriggered: BonusEval[] } {
  const applied: BonusEval[] = [];
  const notTriggered: BonusEval[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      const hit = ctx.gross >= b.threshold;
      const eval_: BonusEval = {
        label: b.label,
        amount: b.amount,
        triggered: hit,
        reason: hit
          ? `Gross $${ctx.gross.toLocaleString()} ≥ threshold $${b.threshold.toLocaleString()}`
          : `Gross $${ctx.gross.toLocaleString()} < threshold $${b.threshold.toLocaleString()} — not triggered`,
      };
      (hit ? applied : notTriggered).push(eval_);
    } else if (b.type === "sellout") {
      if (ctx.capacity == null) {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          triggered: false,
          reason: "Venue capacity unknown — cannot evaluate sellout bonus",
        });
      } else {
        const hit = ctx.tickets >= ctx.capacity * 0.95;
        const pct = ((ctx.tickets / ctx.capacity) * 100).toFixed(1);
        const eval_: BonusEval = {
          label: b.label,
          amount: b.amount,
          triggered: hit,
          reason: hit
            ? `${ctx.tickets} sold of ${ctx.capacity} cap (${pct}%) — sellout threshold met`
            : `${ctx.tickets} sold of ${ctx.capacity} cap (${pct}%) — sellout needs ≥95%`,
        };
        (hit ? applied : notTriggered).push(eval_);
      }
    } else if (b.type === "attendance_threshold") {
      const hit = ctx.tickets >= b.threshold;
      const eval_: BonusEval = {
        label: b.label,
        amount: b.amount,
        triggered: hit,
        reason: hit
          ? `${ctx.tickets} tickets ≥ ${b.threshold} threshold`
          : `${ctx.tickets} tickets < ${b.threshold} threshold — not triggered`,
      };
      (hit ? applied : notTriggered).push(eval_);
    } else if (b.type === "tier_ratchet") {
      // Ratchet bonuses change the percentage structure — handled in vs calc
      notTriggered.push({
        label: b.label,
        amount: 0,
        triggered: false,
        reason:
          "Tier ratchet is applied as a percentage modifier — see calculation steps above",
      });
    }
  }

  return { applied, notTriggered };
}

// ─── Main calculator ────────────────────────────────────────────────────────

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);
  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  const bonuses = parseBonuses(deal);

  // ── Flat guarantee ────────────────────────────────────────────────────────
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
      };
    }

    const bonusResult = evaluateBonuses(bonuses, {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });
    const bonusTotal = bonusResult.applied.reduce((s, b) => s + b.amount, 0);
    const total = deal.guaranteeAmount + bonusTotal;

    const steps: AuditStep[] = [
      {
        label: "Flat guarantee",
        value: deal.guaranteeAmount,
        note: "Fixed guarantee — no expense deductions apply to flat deals.",
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
      {
        label: "Total to artist",
        value: total,
        isSubtotal: true,
      },
    ];

    return {
      supported: true,
      dealType: deal.dealType,
      grossBoxOffice,
      netBoxOffice,
      totalFees,
      totalExpenses,
      expenseCap: deal.expenseCap ?? null,
      cappedExpenses: 0,
      totalToArtist: total,
      steps,
      finalFormula: bonusTotal
        ? `$${deal.guaranteeAmount.toLocaleString()} flat + $${bonusTotal.toLocaleString()} bonus(es) = $${total.toLocaleString()}`
        : `$${deal.guaranteeAmount.toLocaleString()} flat guarantee`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ── Percentage of gross ──────────────────────────────────────────────────
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }

    const pct = deal.percentage;
    const pctPayout = grossBoxOffice * pct;
    const bonusResult = evaluateBonuses(bonuses, {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });
    const bonusTotal = bonusResult.applied.reduce((s, b) => s + b.amount, 0);
    const total = pctPayout + bonusTotal;

    const steps: AuditStep[] = [
      {
        label: "Gross box office",
        value: grossBoxOffice,
        note: "Total ticket revenue before fees.",
      },
      {
        label: `Artist share (${(pct * 100).toFixed(0)}% of gross)`,
        value: pctPayout,
        note: `$${grossBoxOffice.toLocaleString()} × ${(pct * 100).toFixed(0)}% — no expense deductions on % of gross deals`,
        isSubtotal: true,
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
      { label: "Total to artist", value: total, isSubtotal: true },
    ];

    return {
      supported: true,
      dealType: deal.dealType,
      grossBoxOffice,
      netBoxOffice,
      totalFees,
      totalExpenses,
      expenseCap: null,
      cappedExpenses: 0,
      totalToArtist: total,
      steps,
      finalFormula: `$${grossBoxOffice.toLocaleString()} gross × ${(pct * 100).toFixed(0)}% = $${pctPayout.toLocaleString()}${bonusTotal ? ` + $${bonusTotal.toLocaleString()} bonus(es)` : ""}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ── Vs deal ──────────────────────────────────────────────────────────────
  if (deal.dealType === "vs") {
    if (deal.guaranteeAmount == null || deal.percentage == null) {
      return {
        supported: false,
        reason:
          "Vs deal is missing either a guarantee amount or a percentage. Check the deal notes.",
        dealType: deal.dealType,
      };
    }

    const guarantee = deal.guaranteeAmount;
    const pct = deal.percentage;
    const basis = deal.percentageBasis ?? "net";
    const expCap = deal.expenseCap ?? null;
    const cappedExp = capExpenses(totalExpenses, expCap);
    const netAfterExpenses = Math.max(0, netBoxOffice - cappedExp);

    // Detect flavor from bonuses and prose
    let flavor: VsDealFlavor = "standard";
    const hasWalkout = bonuses.some(
      (b) =>
        b.type === "gross_threshold" &&
        b.label.toLowerCase().includes("walkout")
    );
    const hasRatchet = bonuses.some((b) => b.type === "tier_ratchet");
    if (basis === "gross") flavor = "vs_gross";
    else if (hasWalkout) flavor = "walkout";
    else if (hasRatchet) flavor = "ratchet";

    // Determine ratchet percentage (if applicable)
    let effectivePct = pct;
    let ratchetNote: string | undefined;
    if (hasRatchet && venueCapacity) {
      const ratchetBonus = bonuses.find((b) => b.type === "tier_ratchet");
      if (ratchetBonus && ratchetBonus.type === "tier_ratchet") {
        const fillRate = tickets / venueCapacity;
        const matchedTier = [...ratchetBonus.tiers]
          .reverse()
          .find((t) => fillRate >= t.from);
        if (matchedTier) {
          effectivePct = matchedTier.percentage;
          ratchetNote = `Ratchet applied: ${(fillRate * 100).toFixed(1)}% sold → ${(effectivePct * 100).toFixed(0)}% split (${ratchetBonus.label})`;
        }
      }
    }

    // Calculate the percentage payout
    let pctPayout: number;
    if (basis === "gross") {
      pctPayout = grossBoxOffice * effectivePct;
    } else {
      pctPayout = netAfterExpenses * effectivePct;
    }

    // Walkout pot: 100% of gross above breakeven threshold
    let walkoutPot = 0;
    const walkoutBonus = hasWalkout
      ? bonuses.find(
          (b) =>
            b.type === "gross_threshold" &&
            b.label.toLowerCase().includes("walkout")
        )
      : null;
    if (walkoutBonus && walkoutBonus.type === "gross_threshold") {
      if (grossBoxOffice > walkoutBonus.threshold) {
        walkoutPot = grossBoxOffice - walkoutBonus.threshold;
      }
    }

    // Vs comparison
    const vsGuarantee = guarantee;
    const vsPercentagePayout = pctPayout + walkoutPot;
    const vsWinner: "guarantee" | "percentage" =
      vsPercentagePayout >= vsGuarantee ? "percentage" : "guarantee";
    const baseAmount = Math.max(vsGuarantee, vsPercentagePayout);

    // Non-ratchet bonuses on top (gross thresholds, sellout, attendance)
    const nonRatchetBonuses = bonuses.filter(
      (b) =>
        b.type !== "tier_ratchet" &&
        !(b.type === "gross_threshold" && b.label.toLowerCase().includes("walkout"))
    );
    const bonusResult = evaluateBonuses(nonRatchetBonuses, {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });
    // Bonuses only apply when percentage wins (artist is already above guarantee)
    const bonusTotal =
      vsWinner === "percentage"
        ? bonusResult.applied.reduce((s, b) => s + b.amount, 0)
        : 0;

    const total = baseAmount + bonusTotal;

    // Build audit steps
    const steps: AuditStep[] = [];

    steps.push({
      label: "Gross box office",
      value: grossBoxOffice,
      note: "Total ticket revenue before deducting ticketing fees.",
    });
    steps.push({
      label: "Ticketing fees",
      value: -totalFees,
      isDeduction: true,
      note: "Fees deducted to arrive at net box office.",
    });
    steps.push({
      label: "Net box office",
      value: netBoxOffice,
      isSubtotal: true,
      note: `$${grossBoxOffice.toLocaleString()} − $${totalFees.toLocaleString()} in fees`,
    });

    if (basis === "net") {
      steps.push({
        label: `Total expenses (passed through)`,
        value: -totalExpenses,
        isDeduction: true,
        note: `${totalExpenses > cappedExp ? `Capped at $${expCap?.toLocaleString()} — actual was $${totalExpenses.toLocaleString()}` : "Within expense cap"}`,
      });
      if (expCap != null && totalExpenses > expCap) {
        steps.push({
          label: `Expense cap applied`,
          value: -cappedExp,
          isDeduction: true,
          note: `Deal specifies a $${expCap.toLocaleString()} expense cap. Overage of $${(totalExpenses - expCap).toLocaleString()} absorbed by venue.`,
        });
      } else {
        steps.push({
          label: `Expenses deducted (within cap)`,
          value: -cappedExp,
          isDeduction: true,
          note: expCap
            ? `$${cappedExp.toLocaleString()} of $${expCap.toLocaleString()} cap used`
            : "No expense cap on this deal",
        });
      }
      steps.push({
        label: "Net after expenses",
        value: netAfterExpenses,
        isSubtotal: true,
        note: `$${netBoxOffice.toLocaleString()} net − $${cappedExp.toLocaleString()} expenses`,
      });
    }

    if (ratchetNote) {
      steps.push({
        label: `Percentage (ratcheted to ${(effectivePct * 100).toFixed(0)}%)`,
        value: pctPayout,
        note: ratchetNote,
      });
    } else {
      steps.push({
        label: `Artist's percentage (${(effectivePct * 100).toFixed(0)}% of ${basis === "gross" ? "gross" : "net after expenses"})`,
        value: pctPayout,
        note:
          basis === "gross"
            ? `$${grossBoxOffice.toLocaleString()} × ${(effectivePct * 100).toFixed(0)}%`
            : `$${netAfterExpenses.toLocaleString()} × ${(effectivePct * 100).toFixed(0)}%`,
      });
    }

    if (walkoutPot > 0 && walkoutBonus && walkoutBonus.type === "gross_threshold") {
      steps.push({
        label: "Walkout pot",
        value: walkoutPot,
        note: `Gross ($${grossBoxOffice.toLocaleString()}) exceeded breakeven of $${walkoutBonus.threshold.toLocaleString()} — artist takes the overage`,
      });
    }

    steps.push({
      label: "Guarantee floor",
      value: vsGuarantee,
      note: `Guarantee is $${vsGuarantee.toLocaleString()}. Percentage payout is $${vsPercentagePayout.toLocaleString()}.`,
    });

    steps.push({
      label:
        vsWinner === "percentage"
          ? `▲ Percentage wins — $${vsPercentagePayout.toLocaleString()} > $${vsGuarantee.toLocaleString()} guarantee`
          : `▼ Guarantee wins — $${vsGuarantee.toLocaleString()} > $${vsPercentagePayout.toLocaleString()} percentage`,
      value: baseAmount,
      isSubtotal: true,
      note:
        vsWinner === "percentage"
          ? "Artist earns more from ticket performance than the guarantee floor."
          : "Ticket performance didn't exceed the guarantee — artist gets the floor.",
    });

    if (bonusResult.applied.length > 0 && vsWinner === "percentage") {
      for (const b of bonusResult.applied) {
        steps.push({ label: b.label, value: b.amount, note: b.reason });
      }
    } else if (bonusResult.applied.length > 0 && vsWinner === "guarantee") {
      steps.push({
        label: "Bonuses not applied",
        value: 0,
        note: "Structured bonuses apply when the percentage path wins. Artist is on the guarantee — bonuses don't stack.",
      });
    }

    steps.push({
      label: "Total to artist",
      value: total,
      isSubtotal: true,
    });

    const formulaParts: string[] = [];
    if (vsWinner === "percentage") {
      formulaParts.push(
        `${(effectivePct * 100).toFixed(0)}% of ${basis} ($${pctPayout.toLocaleString()})`
      );
      if (walkoutPot) formulaParts.push(`walkout pot $${walkoutPot.toLocaleString()}`);
    } else {
      formulaParts.push(`guarantee $${vsGuarantee.toLocaleString()}`);
    }
    if (bonusTotal) formulaParts.push(`bonuses $${bonusTotal.toLocaleString()}`);

    // Build ratchet bonus eval entry for notTriggered if applicable
    const ratchetBonusEvals: BonusEval[] = bonuses
      .filter((b) => b.type === "tier_ratchet")
      .map((b) => ({
        label: b.label,
        amount: 0,
        triggered: hasRatchet,
        reason: ratchetNote ?? "Applied as percentage modifier",
      }));

    const walkoutEvals: BonusEval[] =
      walkoutBonus && walkoutBonus.type === "gross_threshold"
        ? [
            {
              label: walkoutBonus.label,
              amount: walkoutPot,
              triggered: walkoutPot > 0,
              reason:
                walkoutPot > 0
                  ? `Gross $${grossBoxOffice.toLocaleString()} exceeded breakeven $${walkoutBonus.threshold.toLocaleString()}`
                  : `Gross $${grossBoxOffice.toLocaleString()} did not reach breakeven $${walkoutBonus.threshold.toLocaleString()}`,
            },
          ]
        : [];

    return {
      supported: true,
      dealType: deal.dealType,
      flavor,
      grossBoxOffice,
      netBoxOffice,
      totalFees,
      totalExpenses,
      expenseCap: expCap,
      cappedExpenses: cappedExp,
      totalToArtist: total,
      steps,
      finalFormula: formulaParts.join(" + "),
      bonusesApplied: [...bonusResult.applied, ...walkoutEvals.filter((e) => e.triggered), ...ratchetBonusEvals.filter((e) => e.triggered)],
      bonusesNotTriggered: [...bonusResult.notTriggered, ...walkoutEvals.filter((e) => !e.triggered), ...ratchetBonusEvals.filter((e) => !e.triggered)],
      vsGuarantee,
      vsPercentagePayout,
      vsWinner,
    };
  }

  // ── Percentage of net ─────────────────────────────────────────────────────
  if (deal.dealType === "percentage_of_net") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-net deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }

    const pct = deal.percentage;
    const expCap = deal.expenseCap ?? null;
    const cappedExp = capExpenses(totalExpenses, expCap);
    const netAfterExpenses = Math.max(0, netBoxOffice - cappedExp);
    const pctPayout = netAfterExpenses * pct;

    const bonusResult = evaluateBonuses(bonuses, {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });
    const bonusTotal = bonusResult.applied.reduce((s, b) => s + b.amount, 0);
    const total = pctPayout + bonusTotal;

    const steps: AuditStep[] = [
      { label: "Gross box office", value: grossBoxOffice },
      {
        label: "Ticketing fees",
        value: -totalFees,
        isDeduction: true,
        note: "Subtracted to arrive at net.",
      },
      { label: "Net box office", value: netBoxOffice, isSubtotal: true },
      {
        label: "Expenses (passed through)",
        value: -cappedExp,
        isDeduction: true,
        note:
          expCap != null && totalExpenses > expCap
            ? `Capped at $${expCap.toLocaleString()} (actual $${totalExpenses.toLocaleString()})`
            : expCap
            ? `$${cappedExp.toLocaleString()} of $${expCap.toLocaleString()} cap used`
            : "No cap",
      },
      {
        label: "Net after expenses",
        value: netAfterExpenses,
        isSubtotal: true,
      },
      {
        label: `Artist share (${(pct * 100).toFixed(0)}% of net)`,
        value: pctPayout,
        note: `$${netAfterExpenses.toLocaleString()} × ${(pct * 100).toFixed(0)}%`,
        isSubtotal: true,
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
      { label: "Total to artist", value: total, isSubtotal: true },
    ];

    return {
      supported: true,
      dealType: deal.dealType,
      grossBoxOffice,
      netBoxOffice,
      totalFees,
      totalExpenses,
      expenseCap: expCap,
      cappedExpenses: cappedExp,
      totalToArtist: total,
      steps,
      finalFormula: `${(pct * 100).toFixed(0)}% × $${netAfterExpenses.toLocaleString()} net after expenses = $${pctPayout.toLocaleString()}${bonusTotal ? ` + $${bonusTotal.toLocaleString()} bonus(es)` : ""}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ── Door deal ─────────────────────────────────────────────────────────────
  if (deal.dealType === "door") {
    const expCap = deal.expenseCap ?? null;
    const cappedExp = capExpenses(totalExpenses, expCap);
    const total = Math.max(0, grossBoxOffice - cappedExp);

    const steps: AuditStep[] = [
      {
        label: "Gross box office (door revenue)",
        value: grossBoxOffice,
        note: "All ticket revenue goes to the artist on a door deal.",
      },
      {
        label: "Show expenses (passed through)",
        value: -cappedExp,
        isDeduction: true,
        note:
          expCap != null && totalExpenses > expCap
            ? `Capped at $${expCap.toLocaleString()} (actual $${totalExpenses.toLocaleString()})`
            : "Within expense cap",
      },
      {
        label: "Total to artist",
        value: total,
        isSubtotal: true,
        note: "Artist keeps door revenue after recouping show costs.",
      },
    ];

    return {
      supported: true,
      dealType: deal.dealType,
      grossBoxOffice,
      netBoxOffice,
      totalFees,
      totalExpenses,
      expenseCap: expCap,
      cappedExpenses: cappedExp,
      totalToArtist: total,
      steps,
      finalFormula: `Door: $${grossBoxOffice.toLocaleString()} gross − $${cappedExp.toLocaleString()} expenses = $${total.toLocaleString()}`,
      bonusesApplied: [],
      bonusesNotTriggered: [],
    };
  }

  // Fallback (should never hit with correct dealType enum)
  return {
    supported: false,
    dealType: deal.dealType,
    reason: `Deal type "${deal.dealType}" is not recognized.`,
  };
}
